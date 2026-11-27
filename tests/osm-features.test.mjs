import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverpassPlacesQuery, buildOverpassRouteQuery, normalizeOSMFeatures, splitOSMFeatures } from '../src/data/osm-features.mjs';

const inside = (lat, lon) => lat >= 43 && lat <= 48 && lon >= 36 && lon <= 42;

test('Overpass query includes green spaces and pedestrian infrastructure', () => {
  const query = buildOverpassPlacesQuery({ south: 44, west: 37, north: 46, east: 40 });
  assert.match(query, /leisure.*park\|garden\|nature_reserve/);
  assert.match(query, /natural=wood/);
  assert.match(query, /highway.*pedestrian\|footway\|path/);
  assert.match(query, /traffic_calming/);
  assert.match(query, /maxspeed/);
  assert.match(query, /route.*foot\\|hiking/);
  assert.match(query, /44,37,46,40/);
  assert.match(query, /out geom tags/);
  assert.match(query, /maxsize:33554432/);
});

test('Overpass query rejects malformed or inverted bounds and clamps timeout', () => {
  assert.throws(() => buildOverpassPlacesQuery({ south: 46, west: 37, north: 44, east: 40 }), /bounding box/);
  assert.throws(() => buildOverpassPlacesQuery({ south: 44, west: 37, north: 46, east: 181 }), /bounding box/);
  assert.match(buildOverpassPlacesQuery({ south: 44, west: 37, north: 46, east: 40 }, { timeoutSeconds: 999 }), /timeout:60/);
});

test('parks and pedestrian ways are classified from explicit OSM tags', () => {
  const features = normalizeOSMFeatures([
    { type: 'way', id: 1, center: { lat: 45, lon: 39 }, tags: { leisure: 'park', name: 'Городской парк' } },
    { type: 'way', id: 2, center: { lat: 45.01, lon: 39.01 }, tags: { highway: 'footway' } },
    { type: 'way', id: 3, center: { lat: 45.02, lon: 39.02 }, tags: { highway: 'living_street' } }
  ], inside);
  assert.equal(features.length, 3);
  assert.equal(features[0].category, 'green-space');
  assert.equal(features[0].name, 'Городской парк');
  assert.equal(features[1].category, 'pedestrian-way');
  assert.equal(features[2].category, 'calm-street');
  assert.ok(features.every(feature => feature.source === 'OpenStreetMap'));
});

test('ordinary residential roads are not assumed to be quiet', () => {
  const features = normalizeOSMFeatures([
    { type: 'way', id: 1, center: { lat: 45, lon: 39 }, tags: { highway: 'residential' } }
  ], inside);
  assert.deepEqual(features, []);
});

test('major roads, railways and industrial land are classified as potential noise', () => {
  const features = normalizeOSMFeatures([
    { type: 'way', id: 10, center: { lat: 45, lon: 39 }, tags: { highway: 'primary' } },
    { type: 'way', id: 11, center: { lat: 45, lon: 39 }, tags: { railway: 'rail' } },
    { type: 'way', id: 12, center: { lat: 45, lon: 39 }, tags: { landuse: 'industrial' } }
  ], inside);
  assert.deepEqual(features.map(feature => feature.category), ['major-road', 'railway', 'industrial']);
  assert.ok(features.every(feature => feature.kind === 'noise'));
});

test('features outside the exact service area are discarded', () => {
  const features = normalizeOSMFeatures([
    { type: 'node', id: 1, lat: 45, lon: 39, tags: { leisure: 'park' } },
    { type: 'node', id: 2, lat: 50, lon: 39, tags: { leisure: 'park' } }
  ], inside);
  assert.equal(features.length, 1);
  assert.equal(features[0].osmId, 1);
});

test('duplicate OSM ids are deduplicated and invalid elements are ignored', () => {
  const features = normalizeOSMFeatures([
    { type: 'node', id: 7, lat: 45, lon: 39, tags: { amenity: 'fuel' } },
    { type: 'node', id: 7, lat: 45, lon: 39, tags: { amenity: 'fuel', name: 'Duplicate' } },
    { type: 'node', id: -1, lat: 45, lon: 39, tags: { leisure: 'park' } },
    { type: 'relation', id: 8, tags: { leisure: 'park' } }
  ], inside);
  assert.equal(features.length, 1);
  assert.equal(features[0].name, 'Duplicate');
});

test('mapped foot and hiking relations are included as route evidence', () => {
  const features = normalizeOSMFeatures([
    { type: 'relation', id: 22, center: { lat: 45, lon: 39 }, tags: { route: 'hiking', name: 'Маршрут по парку' } }
  ], inside);
  assert.equal(features.length, 1);
  assert.equal(features[0].category, 'hiking-route');
});

test('speed limit and traffic calming are weak quietness evidence, not guarantees', () => {
  const features = normalizeOSMFeatures([
    { type: 'way', id: 20, center: { lat: 45, lon: 39 }, tags: { highway: 'residential', maxspeed: '30' } },
    { type: 'node', id: 21, lat: 45, lon: 39, tags: { traffic_calming: 'bump' } }
  ], inside);
  assert.equal(features[0].confidence, 'low');
  assert.equal(features[0].category, 'low-speed-street');
  assert.equal(features[1].category, 'traffic-calmed');
});

test('quiet and noise features can be separated without losing source metadata', () => {
  const features = normalizeOSMFeatures([
    { type: 'way', id: 1, center: { lat: 45, lon: 39 }, tags: { leisure: 'garden' } },
    { type: 'way', id: 2, center: { lat: 45, lon: 39 }, tags: { highway: 'trunk' } }
  ], inside);
  const split = splitOSMFeatures(features);
  assert.equal(split.quietFeatures.length, 1);
  assert.equal(split.noiseFeatures.length, 1);
});


test('route-corridor query requests both quiet and noise evidence with geometry', () => {
  const query = buildOverpassRouteQuery({ south: 44, west: 37, north: 46, east: 40 });
  assert.match(query, /leisure.*park/);
  assert.match(query, /natural=wood/);
  assert.match(query, /highway.*footway/);
  assert.match(query, /highway.*motorway/);
  assert.match(query, /railway/);
  assert.match(query, /industrial/);
  assert.match(query, /out geom tags/);
});

test('route-corridor query rejects invalid bounds', () => {
  assert.throws(() => buildOverpassRouteQuery({ south: 45, west: 40, north: 44, east: 39 }), /bounding box/);
});


test('OSM way geometry is retained for map detail rendering', () => {
  const features = normalizeOSMFeatures([
    { type: 'way', id: 31, center: { lat: 45, lon: 39 }, geometry: [
      { lat: 45, lon: 39 }, { lat: 45.001, lon: 39.001 }, { lat: 45, lon: 39 }
    ], tags: { leisure: 'park' } }
  ], inside);
  assert.deepEqual(features[0].geometry, [[39, 45], [39.001, 45.001], [39, 45]]);
});


test('natural=wood forests are included as green-space evidence without claiming measured quietness', () => {
  const features = normalizeOSMFeatures([{ type: 'way', id: 44, center: { lat: 45, lon: 39 }, tags: { natural: 'wood', name: 'Лесной массив' } }], inside);
  assert.equal(features.length, 1);
  assert.equal(features[0].kind, 'quiet-feature');
  assert.equal(features[0].category, 'green-space');
  assert.equal(features[0].confidence, 'medium');
  assert.equal(features[0].name, 'Лесной массив');
});
