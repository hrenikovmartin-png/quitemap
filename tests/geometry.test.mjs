import test from 'node:test';
import assert from 'node:assert/strict';
import { haversine, bearingBetween, nearestRouteSegment } from '../src/navigation/geometry.mjs';

test('haversine returns zero for identical points and realistic meter distances', () => {
  assert.equal(haversine([38.976, 45.04], [38.976, 45.04]), 0);
  assert.ok(Math.abs(haversine([0, 0], [1, 0]) - 111195) < 10);
});

test('bearing uses geographic lon/lat order', () => {
  assert.ok(Math.abs(bearingBetween([0, 0], [0, 1])) < 0.01);
  assert.ok(Math.abs(bearingBetween([0, 0], [1, 0]) - 90) < 0.01);
});

test('nearest route segment finds the closest point and segment fraction', () => {
  const result = nearestRouteSegment(
    { lat: 0.001, lng: 0.005 },
    [[0, 0], [0.01, 0], [0.02, 0]]
  );
  assert.equal(result.index, 0);
  assert.ok(Math.abs(result.fraction - 0.5) < 0.001);
  assert.ok(result.distance > 100 && result.distance < 112);
});

test('invalid route inputs fail safely without producing a false match', () => {
  assert.equal(nearestRouteSegment({ lat: 0, lng: 0 }, []).distance, Infinity);
  assert.equal(nearestRouteSegment({ lat: NaN, lng: 0 }, [[0, 0], [1, 1]]).index, -1);
  assert.equal(haversine([0, 0], [NaN, 1]), Infinity);
});
