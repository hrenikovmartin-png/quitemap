import test from 'node:test';
import assert from 'node:assert/strict';
import { getPlaceCell, mergePlaceCells, readPlaceCells, PLACE_CACHE_MAX_CELLS } from '../src/data/place-cache.mjs';

const bounds = { south: 43.3, west: 36.5, north: 47.9, east: 41.9 };

test('regional cells are deterministic, bounded and clipped at service-area rectangle', () => {
  const a = getPlaceCell(45, 39, bounds);
  const b = getPlaceCell(45.01, 39.01, bounds);
  assert.equal(a.key, b.key);
  assert.ok(a.bounds.south >= bounds.south && a.bounds.west >= bounds.west);
  assert.ok(a.bounds.north <= bounds.north && a.bounds.east <= bounds.east);
  assert.throws(() => getPlaceCell(50, 39, bounds), /outside/);
});

test('visited cells accumulate and duplicate OSM ids are deduplicated', () => {
  const one = { osmId: 'way/1', lat: 45, lon: 39, geometry: [[39,45]] };
  const richer = { ...one, geometry: [[39,45],[39.001,45.001]] };
  let cache = mergePlaceCells({ cells: {} }, '1:1', [one], 1000);
  cache = mergePlaceCells(cache, '1:2', [richer, { osmId: 'node/2', lat: 45, lon: 39 }], 2000);
  assert.equal(Object.keys(cache.cells).length, 2);
  const features = readPlaceCells(cache, 2000);
  assert.equal(features.length, 2);
  assert.equal(features.find(x => x.osmId === 'way/1').geometry.length, 2);
});

test('expired cells are ignored and cache size is bounded', () => {
  let cache = { cells: {} };
  for (let i = 0; i < PLACE_CACHE_MAX_CELLS + 5; i++) {
    cache = mergePlaceCells(cache, 'cell-' + i, [{ osmId: 'node/' + i }], 100000 + i);
  }
  assert.equal(Object.keys(cache.cells).length, PLACE_CACHE_MAX_CELLS);
  assert.equal(readPlaceCells(cache, 100000 + PLACE_CACHE_MAX_CELLS + 8 * 24 * 60 * 60 * 1000).length, 0);
});
