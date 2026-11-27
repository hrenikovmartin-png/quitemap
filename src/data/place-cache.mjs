const LAT_STEP = 0.08;
const LON_STEP = 0.10;
export const PLACE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
export const PLACE_CACHE_MAX_CELLS = 16;

// OSM IDs are unique only within an element type (node, way, relation).
// Keep legacy prefixed IDs readable while avoiding cross-type cache collisions.
function featureIdentity(feature) {
  if (feature?.osmId == null) return null;
  if (feature.osmType) return String(feature.osmType) + '/' + String(feature.osmId);
  const legacyId = String(feature.osmId);
  return legacyId.includes('/') ? legacyId : String(feature.id || legacyId);
}

export function getPlaceCell(lat, lon, bounds) {
  const latitude = Number(lat), longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      !bounds || latitude < bounds.south || latitude > bounds.north ||
      longitude < bounds.west || longitude > bounds.east) {
    throw new TypeError('Point is outside the regional place-cache bounds');
  }
  const row = Math.floor((latitude - bounds.south) / LAT_STEP);
  const column = Math.floor((longitude - bounds.west) / LON_STEP);
  const south = Math.max(bounds.south, bounds.south + row * LAT_STEP);
  const west = Math.max(bounds.west, bounds.west + column * LON_STEP);
  return {
    key: row + ':' + column,
    bounds: {
      south, west,
      north: Math.min(bounds.north, south + LAT_STEP),
      east: Math.min(bounds.east, west + LON_STEP)
    }
  };
}

export function mergePlaceCells(cache, key, features, now = Date.now()) {
  const cells = cache && typeof cache === 'object' && !Array.isArray(cache.cells)
    ? { ...(cache.cells || {}) } : {};
  cells[key] = { fetchedAt: now, features: Array.isArray(features) ? features : [] };
  const ordered = Object.entries(cells)
    .filter(([, cell]) => cell && Number.isFinite(cell.fetchedAt) &&
      now - cell.fetchedAt <= PLACE_CACHE_TTL && Array.isArray(cell.features))
    .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
    .slice(0, PLACE_CACHE_MAX_CELLS);
  const retained = Object.fromEntries(ordered);
  const unique = new Map();
  for (const [, cell] of ordered) {
    for (const feature of cell.features) {
      if (!feature) continue;
      const id = featureIdentity(feature);
      if (!id) continue;
      const previous = unique.get(id);
      if (!previous || (feature.geometry?.length || 0) > (previous.geometry?.length || 0)) unique.set(id, feature);
    }
  }
  return { cells: retained, features: [...unique.values()] };
}

export function readPlaceCells(cache, now = Date.now()) {
  if (!cache || typeof cache !== 'object' || !cache.cells || typeof cache.cells !== 'object') return [];
  const unique = new Map();
  for (const cell of Object.values(cache.cells)) {
    if (!cell || !Number.isFinite(cell.fetchedAt) || now - cell.fetchedAt > PLACE_CACHE_TTL || !Array.isArray(cell.features)) continue;
    for (const feature of cell.features) {
      if (!feature) continue;
      const id = featureIdentity(feature);
      if (!id) continue;
      const previous = unique.get(id);
      if (!previous || (feature.geometry?.length || 0) > (previous.geometry?.length || 0)) unique.set(id, feature);
    }
  }
  return [...unique.values()];
}
