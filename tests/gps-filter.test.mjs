import test from 'node:test';
import assert from 'node:assert/strict';
import { filterGpsFix } from '../src/navigation/gps-filter.mjs';

const fix = (lat, lon, timestamp, accuracy = 8) => ({ lat, lon, timestamp, accuracy });

test('accepts the first valid GPS fix without shifting it', () => {
  const first = fix(45.04, 38.976, 1000, 12);
  const result = filterGpsFix(null, first);
  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'initial');
  assert.deepEqual(result.position, first);
});

test('smooths nearby fixes and favours the more accurate measurement', () => {
  const previous = fix(45.04, 38.976, 1000, 30);
  const next = fix(45.0401, 38.9761, 2000, 5);
  const result = filterGpsFix(previous, next);
  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'smoothed');
  assert.ok(result.position.lat > previous.lat);
  assert.ok(result.position.lat < next.lat);
  assert.ok(result.position.lon > previous.lon);
  assert.ok(result.position.lon < next.lon);
  assert.ok(result.position.lat > 45.04007);
});

test('rejects stale or repeated timestamps without moving the previous fix', () => {
  const previous = fix(45.04, 38.976, 2000, 10);
  for (const timestamp of [1000, 2000]) {
    const result = filterGpsFix(previous, fix(45.0401, 38.9761, timestamp, 5));
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'stale');
    assert.equal(result.position, previous);
  }
});

test('rejects physically implausible GPS jumps', () => {
  const previous = fix(45.04, 38.976, 1000, 5);
  const result = filterGpsFix(previous, fix(45.05, 38.99, 2000, 5));
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'jump');
  assert.equal(result.position, previous);
});

test('fails safely for malformed coordinates and accuracy', () => {
  const previous = fix(45.04, 38.976, 1000, 10);
  assert.equal(filterGpsFix(previous, fix(NaN, 38.976, 2000, 5)).reason, 'invalid');
  assert.equal(filterGpsFix(previous, fix(45.04, 38.976, 2000, 0)).reason, 'invalid');
  assert.equal(filterGpsFix(previous, null).reason, 'invalid');
});

test('resets safely if the stored previous fix is malformed', () => {
  const next = fix(45.04, 38.976, 2000, 10);
  const result = filterGpsFix({ lat: NaN }, next);
  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'reset');
  assert.deepEqual(result.position, next);
});
