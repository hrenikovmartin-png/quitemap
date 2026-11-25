export function computeRouteNoisePenalty(coords, reports, distanceToReport, sensitivity = 2) {
  if (!Array.isArray(coords) || !Array.isArray(reports) || typeof distanceToReport !== 'function') return Infinity;
  const threshold = sensitivity === 1 ? 90 : sensitivity === 3 ? 280 : 170;
  let penalty = 0;
  for (const report of reports) {
    const distance = distanceToReport(coords, report);
    if (distance < threshold) penalty += (threshold - distance) * (Number(report.weight) || 1);
  }
  return penalty;
}

export function computeQuietnessScore(coords, reports, distanceToReport) {
  if (!Array.isArray(coords) || !coords.length || !Array.isArray(reports) || !reports.length ||
      typeof distanceToReport !== 'function') return null;
  const step = Math.max(1, Math.floor(coords.length / 150));
  let total = 0;
  let samples = 0;
  for (let i = 0; i < coords.length; i += step) {
    let exposure = 0;
    for (const report of reports) {
      const radius = report.automatic ? 190 : 115;
      const distance = distanceToReport([coords[i]], report);
      if (distance < radius) exposure += (Number(report.weight) || 1.3) * (1 - distance / radius);
    }
    total += exposure;
    samples++;
  }
  return Math.round(100 * Math.exp(-1.2 * total / samples));
}
