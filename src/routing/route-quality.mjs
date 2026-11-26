/**
 * Route selection guards against presenting a merely different route as quieter.
 * Scores are relative OSM/user evidence, never measured sound levels.
 */
export function routeGeometrySimilarity(a, b, distanceMeters) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2 ||
      typeof distanceMeters !== 'function') return 1;

  // Keep comparison bounded: ORS may return thousands of vertices. Sampling
  // each vertex against every other vertex would become quadratic and freeze
  // slower devices. Equal-distance samples preserve shape while capping work.
  const sample = (coords, limit = 160) => {
    const cumulative = [0];
    for (let i = 1; i < coords.length; i++) {
      const segmentLength = distanceMeters(coords[i - 1], coords[i]);
      if (!Number.isFinite(segmentLength) || segmentLength < 0) return null;
      cumulative.push(cumulative[i - 1] + segmentLength);
    }
    const total = cumulative[cumulative.length - 1];
    if (!Number.isFinite(total) || total <= 0) return null;

    const count = Math.min(limit, Math.max(2, Math.ceil(total / 25) + 1));
    const points = [];
    let segment = 1;
    for (let i = 0; i < count; i++) {
      const target = total * i / (count - 1);
      while (segment < cumulative.length - 1 && cumulative[segment] < target) segment++;
      const start = cumulative[segment - 1], end = cumulative[segment];
      const fraction = end > start ? (target - start) / (end - start) : 0;
      const from = coords[segment - 1], to = coords[segment];
      points.push([
        Number(from[0]) + (Number(to[0]) - Number(from[0])) * fraction,
        Number(from[1]) + (Number(to[1]) - Number(from[1])) * fraction
      ]);
    }
    return points;
  };

  const aa = sample(a), bb = sample(b);
  // If either geometry cannot be compared safely, treat it as duplicate /
  // unknown and do not let it qualify as a quieter alternative.
  if (!aa || !bb) return 1;
  const directed = (from, to) => {
    let total = 0;
    for (const point of from) {
      let nearest = Infinity;
      for (const other of to) nearest = Math.min(nearest, distanceMeters(point, other));
      total += nearest;
    }
    return total / from.length;
  };
  const mean = (directed(aa, bb) + directed(bb, aa)) / 2;
  return Number.isFinite(mean) ? Math.max(0, Math.min(1, 1 - mean / 250)) : 1;
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
      Number.isFinite(item.score.noisePenalty) && Number.isFinite(item.score.quietBonus))
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
