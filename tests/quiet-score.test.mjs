import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRouteNoisePenalty, computeQuietnessScore } from '../src/routing/quiet-score.mjs';

const distance = (points, report) => report.distance;

test('route penalty respects sensitivity and source weights', () => {
  const route = [[38.9, 45.0], [38.91, 45.01]];
  const reports = [{ distance: 80, weight: 2 }];
  assert.equal(computeRouteNoisePenalty(route, reports, distance, 1), 20);
  assert.equal(computeRouteNoisePenalty(route, reports, distance, 2), 180);
  assert.equal(computeRouteNoisePenalty(route, reports, distance, 3), 400);
});

test('quietness score falls near noise sources and rises outside their influence radius', () => {
  const coords = [[38.9, 45.0], [38.91, 45.01], [38.92, 45.02]];
  const near = computeQuietnessScore(coords, [{ distance: 0, weight: 1 }], distance);
  const far = computeQuietnessScore(coords, [{ distance: 500, weight: 1 }], distance);
  assert.ok(near < far);
  assert.equal(far, 100);
});

test('quietness score distinguishes automatic and manual source radii', () => {
  const coords = [[38.9, 45.0]];
  const manual = computeQuietnessScore(coords, [{ distance: 150, weight: 1 }], distance);
  const automatic = computeQuietnessScore(coords, [{ distance: 150, weight: 1, automatic: true }], distance);
  assert.ok(automatic < 100);
  assert.equal(manual, 100);
});

test('empty route or source data returns a neutral/no-data result', () => {
  assert.equal(computeQuietnessScore([], [{ distance: 0 }], distance), null);
  assert.equal(computeQuietnessScore([[0, 0]], [], distance), null);
  assert.equal(computeRouteNoisePenalty([], [], distance), 0);
});
