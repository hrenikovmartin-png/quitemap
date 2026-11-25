export function haversine(a, b) {
  const values = [...a, ...b].map(Number);
  if (values.length !== 4 || !values.every(Number.isFinite)) return Infinity;
  const [lon1, lat1, lon2, lat2] = values;
  const radians = value => value * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, x)));
}

export function bearingBetween(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return 0;
  const radians = value => value * Math.PI / 180;
  const lat1 = radians(Number(a[1]));
  const lat2 = radians(Number(b[1]));
  const deltaLon = radians(Number(b[0]) - Number(a[0]));
  if (![lat1, lat2, deltaLon].every(Number.isFinite)) return 0;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function nearestRouteSegment(location, coordinates) {
  const lat = Number(location?.lat);
  const lon = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      !Array.isArray(coordinates) || coordinates.length < 2) {
    return { distance: Infinity, index: -1, fraction: 0 };
  }

  const cos = Math.max(0.15, Math.cos(lat * Math.PI / 180));
  const sx = 111320 * cos;
  const sy = 110540;
  let best = Infinity;
  let bestIndex = 0;
  let bestFraction = 0;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const a = coordinates[i];
    const b = coordinates[i + 1];
    if (!Array.isArray(a) || !Array.isArray(b) ||
        ![a[0], a[1], b[0], b[1]].every(value => Number.isFinite(Number(value)))) continue;

    const ax = (Number(a[0]) - lon) * sx;
    const ay = (Number(a[1]) - lat) * sy;
    const dx = (Number(b[0]) - Number(a[0])) * sx;
    const dy = (Number(b[1]) - Number(a[1])) * sy;
    const denominator = dx * dx + dy * dy;
    const fraction = denominator
      ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator))
      : 0;
    const distance = Math.hypot(ax + fraction * dx, ay + fraction * dy);

    if (distance < best) {
      best = distance;
      bestIndex = i;
      bestFraction = fraction;
    }
  }

  return { distance: best, index: best === Infinity ? -1 : bestIndex, fraction: bestFraction };
}
