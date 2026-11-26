import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRouteNoisePenalty, computeQuietnessScore, compareRouteNoise } from '../src/routing/quiet-score.mjs';

const distance = (points, report) => report.distance;

test('route penalty respects proximity, source weights and sensitivity', () => {
  const route = [[38.9, 45.0], [38.91, 45.01]];
  const reports = [{ distance: 80, weight: 2, influenceRadius: 200 }];
  assert.ok(computeRouteNoisePenalty(route, reports, distance, 1) >
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
