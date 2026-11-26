import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMeaningfullyQuieterRoute } from '../src/routing/route-quality.mjs';

const base = { distance: 1000, geometry: { coordinates: [[0, 0], [0.01, 0]] }, id: 'base' };
const alternative = { distance: 1100, geometry: { coordinates: [[0, 0], [0.005, 0.001], [0.01, 0]] }, id: 'alternative' };
const score = route => route.id === 'base'
  ? { score: 20, noisePenalty: 30, quietBonus: 8 }
  : { score: 10, noisePenalty: 15, quietBonus: 12 };

test('selects an alternative only when mapped evidence shows a meaningful improvement', () => {
  const result = selectMeaningfullyQuieterRoute(base, [alternative], score);
  assert.equal(result.route, alternative);
  assert.equal(result.improvement, 10);
});

test('rejects routes that differ geometrically but have no meaningful quietness gain', () => {
  const result = selectMeaningfullyQuieterRoute(base, [alternative], route =>
    ({ score: route.id === 'base' ? 20 : 19, noisePenalty: 20, quietBonus: 1 }));
  assert.equal(result, null);
});

test('does not claim a quiet route when evidence is missing', () => {
  assert.equal(selectMeaningfullyQuieterRoute(base, [alternative], () => null), null);
});

test('rejects excessive detours and invalid route candidates', () => {
  const long = { ...alternative, distance: 3000 };
  assert.equal(selectMeaningfullyQuieterRoute(base, [long], score), null);
  assert.equal(selectMeaningfullyQuieterRoute(base, [null], score), null);
});

test('rejects identical route object and non-finite scores', () => {
  assert.equal(selectMeaningfullyQuieterRoute(base, [base], score), null);
  assert.equal(selectMeaningfullyQuieterRoute(base, [alternative], () => ({ score: NaN, noisePenalty: 0, quietBonus: 0 })), null);
});
