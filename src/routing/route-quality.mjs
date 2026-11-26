/**
 * Route selection guards against presenting a merely different route as quieter.
 * Scores are relative OSM/user evidence, never measured sound levels.
 */
export function routeGeometrySimilarity(a, b, distanceMeters) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length ||
      typeof distanceMeters !== 'function') return 0;
  const sample = (coords, count = 24) => Array.from({ length: count }, (_, i) =>
    coords[Math.round(i * (coords.length - 1) / (count - 1))]);
  const aa = sample(a), bb = sample(b);
  const directed = (from, to) => from.reduce((sum, point) =>
    sum + Math.min(...to.map(other => distanceMeters(point, other))), 0) / from.length;
  const mean = (directed(aa, bb) + directed(bb, aa)) / 2;
  return Math.max(0, Math.min(1, 1 - mean / 250));
}

export function selectMeaningfullyQuieterRoute(base, candidates, scoreRoute, {
  minimumRelativeImprovement = 0.12,
  minimumAbsoluteImprovement = 2,
  maximumDetourRatio = 1.65,
  maximumExtraMeters = 600,
  distanceMeters = null
} = {}) {
  if (!base || !Number.isFinite(base.distance) || base.distance <= 0 ||
      !Array.isArray(candidates) || typeof scoreRoute !== 'function') return null;
  const baseScore = scoreRoute(base);
  if (!baseScore || !Number.isFinite(baseScore.score)) return null;
  const pool = candidates.filter(route => route && Number.isFinite(route.distance) &&
    route.distance >= base.distance && route.distance <= base.distance * maximumDetourRatio &&
    route.distance - base.distance <= maximumExtraMeters);
  const ranked = pool.map(route => ({ route, score: scoreRoute(route) }))
    .filter(item => item.score && Number.isFinite(item.score.score) &&
      item.score.noisePenalty !== undefined && item.score.quietBonus !== undefined)
    .filter(item => item.route !== base &&
      (typeof distanceMeters !== 'function' ||
       routeGeometrySimilarity(base.geometry?.coordinates, item.route.geometry?.coordinates, distanceMeters) < 0.92))
    .sort((a, b) => a.score.score - b.score.score || a.route.distance - b.route.distance);
  const best = ranked[0];
  if (!best) return null;
  const improvement = baseScore.score - best.score.score;
  const required = Math.max(minimumAbsoluteImprovement, Math.abs(baseScore.score) * minimumRelativeImprovement);
  if (improvement < required) return null;
  return { route: best.route, baseScore, selectedScore: best.score, improvement };
}
