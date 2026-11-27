import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('walking routing has an independent Valhalla pedestrian fallback', () => {
  assert.match(source, /https:\/\/valhalla1\.openstreetmap\.de\/route/);
  assert.match(source, /costing:'pedestrian'/);
  assert.match(source, /format:'osrm',shape_format:'geojson'/);
  assert.match(source, /X-Client-Id/);
  assert.match(source, /AbortSignal\.timeout\(12000\)/);
});

test('Valhalla routes pass the same strict region and geometry validation as OSRM routes', () => {
  assert.match(source, /const routes=data\.routes\.map\(toOsrmRoute\)\.filter\(Boolean\)/);
  assert.match(source, /return routeInsideKrai\(route\)\?route:null/);
  assert.match(source, /Полученный маршрут выходит за пределы области QuietWalk/);
});

test('FOSSGIS remains available as the last walking fallback', () => {
  assert.match(source, /routing\.openstreetmap\.de\/routed-foot\/route\/v1\/driving/);
  assert.match(source, /Fallback route attempt failed/);
});
