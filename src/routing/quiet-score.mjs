const ROAD_RADIUS = {
  motorway: 520, motorway_link: 420, trunk: 460, trunk_link: 380,
  primary: 360, primary_link: 300, secondary: 260, secondary_link: 220,
  tertiary: 190, tertiary_link: 160
};

const SENSITIVITY = { 1: 0.8, 2: 1, 3: 1.25 };

function sourceProfile(report, sensitivity = 2) {
  const highway = report?.highway;
  const reason = String(report?.reason || '').toLowerCase();
  let radius = Number(report?.influenceRadius);
  if (!Number.isFinite(radius) || radius <= 0) {
    if (report?.railway || reason.includes('желез')) radius = 380;
    else if (reason.includes('промышлен')) radius = 340;
    else if (reason.includes('коммерч')) radius = 210;
    else if (reason.includes('стадион')) radius = 280;
    else if (reason.includes('заправ')) radius = 170;
    else if (reason.includes('ночн')) radius = 160;
    else radius = ROAD_RADIUS[highway] || (report?.automatic ? 180 : 150);
  }

  const fallbackWeight = report?.railway ? 2.1
    : reason.includes('промышлен') ? 2
    : reason.includes('стадион') ? 1.5
    : 1;
  const weight = Number(report?.weight);
  return {
    radius: radius * (SENSITIVITY[sensitivity] || SENSITIVITY[2]),
    weight: Number.isFinite(weight) && weight > 0 ? weight : fallbackWeight
  };
}

function validCoordinates(coords) {
  return Array.isArray(coords) && coords.length > 0 &&
    coords.every(point => Array.isArray(point) && point.length >= 2 &&
      Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])));
}

function distanceMeters(a, b) {
  const radians = value => value * Math.PI / 180;
  const lon1 = Number(a[0]), lat1 = Number(a[1]);
  const lon2 = Number(b[0]), lat2 = Number(b[1]);
  const dLat = radians(lat2 - lat1), dLon = radians(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function sampleRoute(coords, maxSamples = 150, spacingMeters = 35) {
  if (!validCoordinates(coords)) return [];
  if (coords.length === 1) return [coords[0]];
  const cumulative = [0];
  for (let i = 1; i < coords.length; i++) {
    cumulative.push(cumulative[i - 1] + distanceMeters(coords[i - 1], coords[i]));
  }
  const total = cumulative[cumulative.length - 1];
  if (!Number.isFinite(total) || total <= 0) return [coords[0]];
  const count = Math.min(maxSamples, Math.max(2, Math.ceil(total / spacingMeters) + 1));
  const samples = [];
  let segment = 1;
  for (let i = 0; i < count; i++) {
    const target = total * i / (count - 1);
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment++;
    const start = cumulative[segment - 1], end = cumulative[segment];
    const fraction = end > start ? (target - start) / (end - start) : 0;
    const a = coords[segment - 1], b = coords[segment];
    samples.push([
      Number(a[0]) + (Number(b[0]) - Number(a[0])) * fraction,
      Number(a[1]) + (Number(b[1]) - Number(a[1])) * fraction
    ]);
  }
  return samples;
}

/**
 * Returns a relative route penalty (not decibels). Larger values mean
 * greater mapped exposure to potentially noisy OSM features.
 */
export function computeRouteNoisePenalty(coords, reports, distanceToReport, sensitivity = 2) {
  if (!validCoordinates(coords) || !Array.isArray(reports) ||
      typeof distanceToReport !== 'function') return Infinity;
  let penalty = 0;
  for (const report of reports) {
    const distance = distanceToReport(coords, report);
    if (!Number.isFinite(distance) || distance < 0) continue;
    const profile = sourceProfile(report, sensitivity);
    const proximity = Math.max(0, 1 - distance / profile.radius);
    penalty += proximity * profile.weight * 100;
  }
  return penalty;
}

/**
 * A 0–100 map-based heuristic. It is not an acoustic measurement.
 */
export function computeQuietnessScore(coords, reports, distanceToReport, sensitivity = 2) {
  if (!validCoordinates(coords) || !Array.isArray(reports) || !reports.length ||
      typeof distanceToReport !== 'function') return null;

  const samples = sampleRoute(coords);
  if (!samples.length) return null;
  let totalExposure = 0;
  for (const sample of samples) {
    let exposure = 0;
    for (const report of reports) {
      const distance = distanceToReport([sample], report);
      if (!Number.isFinite(distance) || distance < 0) continue;
      const profile = sourceProfile(report, sensitivity);
      exposure += profile.weight * Math.max(0, 1 - distance / profile.radius);
    }
    totalExposure += exposure;
  }
  const averageExposure = totalExposure / samples.length;
  return Math.max(0, Math.min(100, Math.round(100 * Math.exp(-1.2 * averageExposure))));
}

export function compareRouteNoise(coordsA, coordsB, reports, distanceToReport, sensitivity = 2) {
  const a = computeRouteNoisePenalty(coordsA, reports, distanceToReport, sensitivity);
  const b = computeRouteNoisePenalty(coordsB, reports, distanceToReport, sensitivity);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { penaltyA: a, penaltyB: b, quieter: a === b ? 'equal' : a < b ? 'A' : 'B', difference: Math.abs(a - b) };
}
