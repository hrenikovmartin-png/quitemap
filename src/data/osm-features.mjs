const QUIET_TAGS = {
  leisure: new Set(['park', 'garden', 'nature_reserve', 'recreation_ground']),
  landuse: new Set(['forest', 'village_green', 'recreation_ground']),
  highway: new Set(['pedestrian', 'footway', 'path', 'steps', 'cycleway', 'living_street'])
};

const NOISE_ROAD_WEIGHTS = {
  motorway: 2.2, motorway_link: 1.9, trunk: 2.0, trunk_link: 1.7,
  primary: 1.7, primary_link: 1.5, secondary: 1.3, secondary_link: 1.15,
  tertiary: 0.9, tertiary_link: 0.8
};

function validPoint(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function elementCenter(element) {
  if (validPoint(Number(element?.lat), Number(element?.lon))) {
    return { lat: Number(element.lat), lon: Number(element.lon) };
  }
  if (validPoint(Number(element?.center?.lat), Number(element?.center?.lon))) {
    return { lat: Number(element.center.lat), lon: Number(element.center.lon) };
  }
  const geometry = Array.isArray(element?.geometry) ? element.geometry : [];
  const points = geometry.filter(point => validPoint(Number(point?.lat), Number(point?.lon)));
  if (!points.length) return null;
  return {
    lat: points.reduce((sum, point) => sum + Number(point.lat), 0) / points.length,
    lon: points.reduce((sum, point) => sum + Number(point.lon), 0) / points.length
  };
}

function classifyTags(tags = {}) {
  const highway = String(tags.highway || '');
  if (NOISE_ROAD_WEIGHTS[highway]) {
    return { kind: 'noise', category: 'major-road', label: 'Оживлённая дорога', confidence: 'medium', weight: NOISE_ROAD_WEIGHTS[highway] };
  }
  if (tags.railway && ['rail', 'tram', 'light_rail', 'subway'].includes(tags.railway)) {
    return { kind: 'noise', category: 'railway', label: 'Железная дорога', confidence: 'medium', weight: 2.1 };
  }
  if (tags.landuse === 'industrial' || tags.man_made === 'works') {
    return { kind: 'noise', category: 'industrial', label: 'Промышленная зона', confidence: 'medium', weight: 2 };
  }
  if (tags.landuse === 'commercial') {
    return { kind: 'noise', category: 'commercial', label: 'Коммерческая зона', confidence: 'low', weight: 0.8 };
  }
  if (tags.leisure === 'stadium') {
    return { kind: 'noise', category: 'stadium', label: 'Стадион', confidence: 'low', weight: 1.5 };
  }
  if (tags.amenity === 'fuel') {
    return { kind: 'noise', category: 'fuel', label: 'Автозаправка', confidence: 'low', weight: 1.1 };
  }
  if (['nightclub', 'bar'].includes(tags.amenity)) {
    return { kind: 'noise', category: 'nightlife', label: 'Ночное заведение', confidence: 'low', weight: 1.3 };
  }

  for (const [key, values] of Object.entries(QUIET_TAGS)) {
    if (values.has(String(tags[key] || ''))) {
      const value = String(tags[key]);
      const isGreen = key === 'leisure' || key === 'landuse';
      return {
        kind: 'quiet-feature',
        category: isGreen ? 'green-space' : (value === 'living_street' ? 'calm-street' : 'pedestrian-way'),
        label: isGreen ? 'Зелёная зона' : value === 'living_street' ? 'Жилая улица с ограничением движения' : 'Пешеходный маршрут',
        confidence: 'medium',
        weight: 0
      };
    }
  }

  if (['foot', 'hiking'].includes(String(tags.route || ''))) {
    return { kind: 'quiet-feature', category: 'hiking-route', label: 'Пешеходный или туристический маршрут', confidence: 'medium', weight: 0 };
  }

  if (tags.traffic_calming) {
    return { kind: 'quiet-feature', category: 'traffic-calmed', label: 'Улица с успокоением движения', confidence: 'low', weight: 0 };
  }

  const speed = String(tags.maxspeed || '').match(/^\s*(\d+(?:\.\d+)?)\s*(?:km\/h|kmh)?\s*$/i);
  if (speed && Number(speed[1]) <= 30 && highway) {
    return { kind: 'quiet-feature', category: 'low-speed-street', label: 'Улица с ограничением скорости до 30 км/ч', confidence: 'low', weight: 0 };
  }
  return null;
}

/**
 * Build a bounded Overpass query for mapped green spaces and pedestrian-friendly
 * infrastructure. The caller must still validate every returned coordinate
 * against the exact bundled service-area geometry.
 */
export function buildOverpassPlacesQuery(bounds, { timeoutSeconds = 20 } = {}) {
  const values = [bounds?.south, bounds?.west, bounds?.north, bounds?.east].map(Number);
  const [south, west, north, east] = values;
  if (!values.every(Number.isFinite) || south < -90 || north > 90 ||
      west < -180 || east > 180 || south >= north || west >= east) {
    throw new TypeError('Invalid Overpass bounding box');
  }
  const timeout = Math.max(5, Math.min(60, Math.floor(Number(timeoutSeconds) || 20)));
  const bbox = [south, west, north, east].join(',');
  return `[out:json][timeout:${timeout}];(nwr[leisure~"^(park|garden|nature_reserve|recreation_ground)$"](${bbox});nwr[landuse~"^(forest|village_green|recreation_ground)$"](${bbox});nwr[highway~"^(pedestrian|footway|path|steps|cycleway|living_street)$"](${bbox});nwr[highway][maxspeed~"^(20|30)( ?km/h)?$"](${bbox});nwr[route~"^(foot|hiking)$"](${bbox});nwr[traffic_calming](${bbox}););out center tags;`;
}

/**
 * Normalize OSM elements into evidence-labelled features. No feature is
 * considered quiet merely because it is near greenery; each classification
 * is based on explicit OSM tags and remains a heuristic, not an acoustic fact.
 */

/**
 * Route-corridor query: fetches both quiet-feature evidence and potential
 * noise sources with geometry so candidate routes can be compared spatially.
 */
export function buildOverpassRouteQuery(bounds, { timeoutSeconds = 20 } = {}) {
  const values = [bounds?.south, bounds?.west, bounds?.north, bounds?.east].map(Number);
  const [south, west, north, east] = values;
  if (!values.every(Number.isFinite) || south < -90 || north > 90 ||
      west < -180 || east > 180 || south >= north || west >= east) {
    throw new TypeError('Invalid Overpass bounding box');
  }
  const timeout = Math.max(5, Math.min(60, Math.floor(Number(timeoutSeconds) || 20)));
  const bbox = [south, west, north, east].join(',');
  return `[out:json][timeout:${timeout}][maxsize:67108864];(nwr[leisure~"^(park|garden|nature_reserve|recreation_ground)$"](${bbox});nwr[landuse~"^(forest|village_green|recreation_ground|industrial|commercial)$"](${bbox});nwr[highway~"^(pedestrian|footway|path|steps|cycleway|living_street|motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$"](${bbox});nwr[highway][maxspeed~"^(20|30)( ?km/h)?$"](${bbox});nwr[route~"^(foot|hiking)$"](${bbox});nwr[traffic_calming](${bbox});nwr[railway~"^(rail|tram|light_rail|subway)$"](${bbox});nwr[leisure=stadium](${bbox});nwr[amenity~"^(fuel|nightclub|bar)$"](${bbox}););out geom tags;`;
}

export function normalizeOSMFeatures(elements, isInside) {
  if (!Array.isArray(elements) || typeof isInside !== 'function') return [];
  const unique = new Map();
  for (const element of elements) {
    if (!element || !['node', 'way', 'relation'].includes(element.type) ||
        !Number.isSafeInteger(Number(element.id)) || Number(element.id) <= 0) continue;
    const center = elementCenter(element);
    if (!center || !isInside(center.lat, center.lon)) continue;
    const classification = classifyTags(element.tags || {});
    if (!classification) continue;
    const key = element.type + ':' + Number(element.id);
    unique.set(key, {
      id: key,
      osmType: element.type,
      osmId: Number(element.id),
      lat: center.lat,
      lon: center.lon,
      name: String(element.tags?.name || classification.label).slice(0, 120),
      tags: { ...(element.tags || {}) },
      geometry: Array.isArray(element.geometry) ? element.geometry.filter(point => validPoint(Number(point?.lat), Number(point?.lon))).map(point => [Number(point.lon), Number(point.lat)]) : null,
      ...classification,
      source: 'OpenStreetMap'
    });
  }
  return [...unique.values()];
}

export function splitOSMFeatures(features) {
  const safe = Array.isArray(features) ? features : [];
  return {
    quietFeatures: safe.filter(feature => feature?.kind === 'quiet-feature'),
    noiseFeatures: safe.filter(feature => feature?.kind === 'noise')
  };
}
