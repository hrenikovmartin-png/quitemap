import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'index.html'), 'utf8');

test('regional boundary is loaded from the bundled local asset', () => {
  assert.match(source, /krasnodar-krai\.geojson\.gz\.b64/);
  assert.match(source, /if\(!gj\)\s*\{\s*throw Error\(/);
  assert.match(source, /kraiGeometry=null;kraiGeometries=\[\];kraiBoundarySegments=\[\]/);
});

test('point checks fail closed until the exact geometry is available', () => {
  assert.match(source, /function inKrasnodarKrai\(lat,lon\)\{if\(!Number\.isFinite\(lat\)\|\|!Number\.isFinite\(lon\)[\s\S]{0,260}!kraiGeometry\)return false/);
  assert.match(source, /const KRAI_BOUNDS=\{south:43\.30,north:47\.90,west:36\.50,east:41\.90\}/);
});

test('every router response and final selected route is checked against the region', () => {
  assert.ok((source.match(/if\(!routeInsideKrai\(route\)\)/g) || []).length >= 2,
    'both ORS and fallback route responses must be checked');
  assert.match(source, /if\(!routeInsideKrai\(chosen\)\)throw Error\(/);
  assert.match(source, /if\(routeInsideKrai\(r\)&&!candidates\.some/);
});

test('camera and map bounds remain constrained to the region', () => {
  assert.match(source, /function safeSetView\(latlng,zoom\)\{const ll=L\.latLng\(latlng\);if\(!inKrasnodarKrai\(ll\.lat,ll\.lng\)\)\{toast\(/);
  assert.match(source, /maxBounds:kraiBounds,maxBoundsViscosity:1/);
  assert.match(source, /map\.setMaxBounds\(b\)/);
  assert.match(source, /map\.on\('moveend',clampMapCamera\)/);
});

test('GPS ignores stale and inaccurate fixes and stops on a confirmed outside fix', () => {
  assert.match(source, /navigator\.geolocation\.watchPosition\(onNavigationPosition/);
  assert.match(source, /Date\.now\(\)-pos\.timestamp>20000/);
  assert.match(source, /if\(acc>60\)/);
  assert.match(source, /if\(acc<=35\)[\s\S]{0,180}stopNavigation\(\)/);
  assert.match(source, /navigator\.geolocation\.clearWatch\(watchId\)/);
});

test('rerouting is protected by a navigation session token', () => {
  assert.match(source, /navSession\+\+;navActive=true/);
  assert.match(source, /const session=navSession/);
  assert.match(source, /navActive&&navSession===session/);
  assert.match(source, /navSession\+\+;navActive=false/);
});

test('quietness score is clearly described as an estimate, not decibels', () => {
  assert.match(source, /Обе оценки модельные, по OpenStreetMap; не являются измерением децибел/);
});

test('GPS permission denial and synchronous browser errors cleanly stop navigation', () => {
  assert.match(source, /const handleGpsError=err=>/);
  assert.match(source, /if\(err\.code===1\)\{\s*stopNavigation\(\)/);
  assert.match(source, /watchId=navigator\.geolocation\.watchPosition/);
  assert.match(source, /catch\(error\)\{\s*const msg='Не удалось запустить GPS:/);
  assert.match(source, /stopNavigation\(\);\s*\$\('navStatus'\)\.textContent=msg/);
});

test('recent routes are persisted locally and replay is boundary-checked', () => {
  assert.match(source, /routeHistory=\(Array\.isArray\(store\.get\('routeHistory',\[\]\)\)/);
  assert.match(source, /store\.set\('routeHistory',routeHistory\)/);
  assert.match(source, /function restoreHistoryRoute\(id\)/);
  assert.match(source, /inKrasnodarKrai\(item\.start\?\.lat,item\.start\?\.lng\)/);
  assert.match(source, /inKrasnodarKrai\(item\.end\?\.lat,item\.end\?\.lng\)/);
  assert.match(source, /slice\(0,12\)/);
});

test('GPX import is size-limited and rejects any route outside the regional boundary', () => {
  assert.match(source, /function importGpx\(file\)/);
  assert.match(source, /file\.size>5\*1024\*1024/);
  assert.match(source, /nodes\.length>15000/);
  assert.match(source, /coords\.every\(\(\[lon,lat\]\)=>inKrasnodarKrai\(lat,lon\)\)/);
  assert.match(source, /if\(!routeInsideKrai\(imported\)\)/);
});


test('Adygea is included in the QuietWalk service area without an internal map cutout', () => {
  assert.match(source, /coordinates:\[g\.coordinates\[0\]\]/);
  assert.match(source, /kraiGeometries=matches\.map\(x=>\{const g=x\.geometry/);
  assert.doesNotMatch(source, /maskInteriorHoles|kraiMaskPane|kraiMaskLayer/);
  assert.match(source, /Краснодарский край \+ Адыгея/);
  assert.match(source, /inKrasnodarKrai\(lat,lon\)/);
});

test('classic full-colour OpenStreetMap tiles are preferred in light mode', () => {
  assert.ok(source.indexOf('https://tile.openstreetmap.org/{z}/{x}/{y}.png') < source.indexOf('https://basemaps.cartocdn.com/rastertiles/light_all/'),
    'standard OSM tiles should be preferred before the CARTO light fallback');
  assert.match(source, /\.qw-light-tiles\{filter:none\}/);
  assert.match(source, /\.leaflet-container\{background:#f2f0e9\}/);
  assert.doesNotMatch(source, /kraiMaskPane|fillRule:'evenodd'/);
});


test('the map remains fully tiled outside the highlighted QuietWalk service area', () => {
  assert.doesNotMatch(source, /kraiMaskPane|kraiMaskLayer|maskOuter/);
  assert.match(source, /L\.tileLayer\(t\.u/);
  assert.match(source, /maxBoundsViscosity:1/);
  assert.match(source, /\.leaflet-container\{background:#f2f0e9\}/);
});


test('Stage 4.3.2 accumulates OSM place evidence across bounded regional cells', () => {
  assert.match(source, /from '\.\/src\/data\/place-cache\.mjs'/);
  assert.match(source, /async function loadPlaces\(\)\{\s*if\(!kraiGeometry\)return;/);
  assert.match(source, /getPlaceCell\(center\.lat,center\.lng,KRAI_BOUNDS\)/);
  assert.match(source, /buildOverpassPlacesQuery\(cell\.bounds\)/);
  assert.match(source, /normalizeOSMFeatures\(data\.elements,inKrasnodarKrai\)/);
  assert.match(source, /mergePlaceCells\(cache,cell\.key,normalized\.slice\(0,180\)\)/);
  assert.match(source, /readPlaceCells\(nextCache\)/);
  assert.match(source, /osmPlacesRegionalCacheV1/);
  assert.match(source, /slice\(0,1200\)/);
});


test('automatic noise features share the OSM classifier and preserve road/rail metadata', () => {
  assert.match(source, /const split=splitOSMFeatures\(normalized\)/);
  assert.match(source, /split\.noiseFeatures\.map\(feature/);
  assert.match(source, /highway:feature\.tags\?\.highway/);
  assert.match(source, /railway:feature\.tags\?\.railway/);
});


test('quiet route loads corridor OSM evidence and scores both noise and quiet infrastructure', () => {
  assert.match(source, /buildOverpassRouteQuery/);
  assert.match(source, /async function loadRouteContext\(start,end\)/);
  assert.match(source, /normalizeOSMFeatures\(data\.elements,inKrasnodarKrai\)/);
  assert.match(source, /computeRoutePreference\(/);
  assert.match(source, /computeRouteQuietFeatureBonus\(/);
  assert.match(source, /Поддержка тихой инфраструктурой/);
  assert.match(source, /Данные OpenStreetMap и расчётная модель, не измерение дБ/);
});

test('route-context cache is bounded and quiet-feature geometries outside the region are discarded', () => {
  assert.match(source, /expiresAt:Date\.now\(\)\+2\*60\*60\*1000/);
  assert.match(source, /features:normalized\.slice\(0,240\)/);
  assert.match(source, /feature\.geometry\.every\(point=>inKrasnodarKrai\(point\[1\],point\[0\]\)\)/);
  assert.match(source, /routeQuietFeatures=split\.quietFeatures\.slice\(0,100\)/);
  assert.match(source, /autoReports=split\.noiseFeatures\.slice\(0,140\)/);
});

test('all selected route candidates remain subject to the existing exact regional geometry guard', () => {
  assert.match(source, /if\(!routeInsideKrai\(chosen\)\)throw Error\(/);
  assert.match(source, /if\(routeInsideKrai\(r\)&&!candidates\.some/);
});


test('failed route-corridor lookup cannot reuse stale automatic noise features from another route', () => {
  assert.match(source, /routeQuietFeatures=quietFeatures\.filter\(feature=>minDistanceToReportsForOne\(\[\[a\.lng,a\.lat\],\[b\.lng,b\.lat\]\],feature\)<500\)/);
  assert.match(source, /autoReports=\[\];\s*toast\('Данные OSM для этого коридора недоступны/);
});


test('Overpass fallback uses a bounded total deadline rather than multiplying timeout by host count', () => {
  assert.match(source, /const deadline=Date\.now\(\)\+Math\.max\(1000,Math\.min\(60000,Number\(timeout\)\|\|18000\)\)/);
  assert.match(source, /const remaining=deadline-Date\.now\(\)/);
  assert.match(source, /AbortSignal\.timeout\(Math\.min\(9000,remaining\)\)/);
});


test('quiet-only OSM corridor data is included in the route explanation', () => {
  assert.match(source, /reports\.length\|\|autoReports\.length\|\|routeQuietFeatures\.length/);
  assert.match(source, /тихой инфраструктуры/);
  assert.match(source, /routeNoiseExplanation\(base,chosen\)/);
});

test('candidate scoring uses simplified route geometry for both noise and quiet-feature distances', () => {
  assert.match(source, /computeRoutePreference\(compact,\[\.\.\.reports,\.\.\.autoReports\],routeQuietFeatures/);
});


test('quiet place map rendering draws detailed geometry only when every vertex is inside the service area', () => {
  assert.match(source, /raw\.every\(point=>Array\.isArray\(point\).*inKrasnodarKrai\(\+point\[1\],\+point\[0\]\)\)/);
  assert.match(source, /const isArea=closed&&!!\(p\.tags\?\.leisure\|\|p\.tags\?\.landuse\)/);
  assert.match(source, /L\.polygon\(latlngs,style\):L\.polyline\(latlngs,style\)/);
  assert.match(source, /simplifyNoiseGeometry\(raw,180,7\)/);
});
