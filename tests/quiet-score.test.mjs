import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRouteNoisePenalty, computeQuietnessScore, compareRouteNoise, computeRouteQuietFeatureBonus, computeRoutePreference } from '../src/routing/quiet-score.mjs';

const distance = (points, report) => report.distance;

test('route penalty respects proximity, source weights and sensitivity', () => {
  const route = [[38.9, 45.0], [38.91, 45.01]];
  const reports = [{ distance: 80, weight: 2, influenceRadius: 200 }];
  assert.ok(computeRouteNoisePenalty(route, reports, distance, 1) <
    computeRouteNoisePenalty(route, reports, distance, 2));
  assert.ok(computeRouteNoisePenalty(route, reports, distance, 3) >
    computeRouteNoisePenalty(route, reports, distance, 2));
});

test('route penalty ignores sources outside their influence radius', () => {
  const route = [[38.9, 45.0], [38.91, 45.01]];
  assert.equal(computeRouteNoisePenalty(route, [{ distance: 900, influenceRadius: 200 }], distance), 0);
});

test('road classes and railways receive different influence radii', () => {
  const route = [[38.9, 45.0], [38.91, 45.01]];
  const motorway = computeRouteNoisePenalty(route, [{ distance: 250, highway: 'motorway', automatic: true, weight: 2 }], distance);
  const tertiary = computeRouteNoisePenalty(route, [{ distance: 150, highway: 'tertiary', automatic: true, weight: 0.9 }], distance);
  const railway = computeRouteNoisePenalty(route, [{ distance: 250, railway: 'rail', automatic: true, weight: 2.1 }], distance);
  assert.ok(motorway > 0);
  assert.ok(railway > 0);
  assert.ok(motorway > tertiary);
});

test('quietness score is distance-aware and reports no-data distinctly', () => {
  const coords = [[38.9, 45.0], [38.91, 45.01], [38.92, 45.02]];
  const near = computeQuietnessScore(coords, [{ distance: 0, weight: 1 }], distance);
  const far = computeQuietnessScore(coords, [{ distance: 900, weight: 1 }], distance);
  assert.ok(near < far);
  assert.equal(far, 100);
  assert.equal(computeQuietnessScore(coords, [], distance), null);
});

test('quietness score samples a long route by travelled distance, not vertex count', () => {
  const sparse = [[38.9, 45.0], [38.92, 45.02]];
  const dense = Array.from({ length: 41 }, (_, i) => [38.9 + i * 0.0005, 45 + i * 0.0005]);
  const report = { distance: 0, weight: 1 };
  const scoreSparse = computeQuietnessScore(sparse, [report], distance);
  const scoreDense = computeQuietnessScore(dense, [report], distance);
  assert.ok(Math.abs(scoreSparse - scoreDense) <= 3);
});

test('route comparison explains which candidate has lower mapped exposure', () => {
  const result = compareRouteNoise([[0, 0], [1, 1]], [[0, 0], [1, 1]],
    [{ distance: 0, weight: 1 }], distance);
  assert.equal(result.quieter, 'equal');
  assert.equal(result.difference, 0);
});

test('invalid inputs fail safely', () => {
  assert.equal(computeRouteNoisePenalty([], [], distance), Infinity);
  assert.equal(computeQuietnessScore([[0, 0]], [{ distance: 0 }], distance), 30);
});


test('mapped green spaces and pedestrian ways provide a bounded quiet-feature bonus', () => {
  const route = [[38.9, 45], [38.91, 45.01]];
  const features = [
    { category: 'green-space', distance: 0 },
    { category: 'pedestrian-way', distance: 0 },
    { category: 'pedestrian-way', distance: 0 }
  ];
  const bonus = computeRouteQuietFeatureBonus(route, features, distance);
  assert.ok(bonus > 0 && bonus <= 100);
  assert.equal(computeRouteQuietFeatureBonus(route, [], distance), 0);
});

test('ordinary residential streets do not receive a quiet-feature bonus without mapped evidence', () => {
  const route = [[38.9, 45], [38.91, 45.01]];
  const bonus = computeRouteQuietFeatureBonus(route, [{ category: 'residential', distance: 0 }], distance);
  assert.equal(bonus, 0);
});

test('strict sensitivity increases the influence of mapped quiet features', () => {
  const route = [[38.9, 45], [38.91, 45.01]];
  const features = [{ category: 'green-space', distance: 200 }];
  assert.ok(computeRouteQuietFeatureBonus(route, features, distance, 3) >
    computeRouteQuietFeatureBonus(route, features, distance, 1));
});

test('route preference rewards mapped quiet features while retaining noise penalties', () => {
  const route = [[38.9, 45], [38.91, 45.01]];
  const quiet = [{ category: 'green-space', distance: 0 }];
  const noisy = [{ distance: 0, weight: 1 }];
  const withQuiet = computeRoutePreference(route, noisy, quiet, distance);
  const withoutQuiet = computeRoutePreference(route, noisy, [], distance);
  assert.ok(withQuiet.score < withoutQuiet.score);
  assert.equal(withQuiet.noisePenalty, withoutQuiet.noisePenalty);
});


test('a detour without mapped evidence does not get selected as a quiet route', async () => {
  const { chooseQuietRouteCandidate } = await import('../src/routing/quiet-score.mjs');
  const base = { id: 'shortest', distance: 1000 };
  const detour = { id: 'detour', distance: 1050 };
  assert.equal(chooseQuietRouteCandidate(base, [detour], () => 0), base);
});

test('an alternative is selected only when mapped evidence gives it a meaningful advantage', async () => {
  const { chooseQuietRouteCandidate } = await import('../src/routing/quiet-score.mjs');
  const base = { id: 'shortest', distance: 1000 };
  const worse = { id: 'worse', distance: 1040 };
  const better = { id: 'quieter', distance: 1050 };
  const scores = new Map([[base, 20], [worse, 24], [better, 15]]);
  assert.equal(chooseQuietRouteCandidate(base, [worse, better], route => scores.get(route)), better);
});

test('an alternative with negligible evidence advantage is rejected', async () => {
  const { chooseQuietRouteCandidate } = await import('../src/routing/quiet-score.mjs');
  const base = { id: 'shortest', distance: 1000 };
  const detour = { id: 'detour', distance: 1050 };
  assert.equal(chooseQuietRouteCandidate(base, [detour], route => route === base ? 10 : 9.5), base);
});
