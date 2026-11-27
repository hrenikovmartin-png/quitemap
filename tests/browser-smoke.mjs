import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.b64': 'text/plain; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  const target = path.resolve(root, '.' + pathname);
  if (!target.startsWith(root + path.sep) && target !== path.join(root, 'index.html')) {
    res.writeHead(403).end('Forbidden'); return;
  }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream' });
    res.end(data);
  });
});

let browser;
const errors = [];
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(4173, '127.0.0.1', resolve);
  });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push('pageerror: ' + error.message));
  let nativeAlternativesRequested = false;
  let forceOrsFailure = false;
  await page.addInitScript(async () => {
    const legacy = await caches.open('quietwalk-shell-v2');
    await legacy.put(new Request(new URL('legacy-cache-probe', location.href)), new Response('stale'));
    localStorage.setItem('qwmax_orsKey', JSON.stringify('quietwalk-browser-test-key-not-real'));
    localStorage.setItem('qwmax_reports', JSON.stringify([{ id: 9001, lat: 45.04, lon: 38.98, reason: 'Тестовая шумная дорога', created: new Date().toISOString() }]));
  });
  let primaryTileFailures = 0;
  let fallbackTileRequests = 0;
  await page.route('https://tile.openstreetmap.org/**', async route => {
    primaryTileFailures++;
    await route.abort('failed');
  });
  await page.route('https://tile.openstreetmap.de/**', async route => {
    fallbackTileRequests++;
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l7sAAAAASUVORK5CYII=', 'base64');
    await route.fulfill({ status: 200, contentType: 'image/png', body: pixel });
  });
  await page.route('https://nominatim.openstreetmap.org/search?**', async route => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    const start = q.includes('TEST_START');
    const item = start
      ? { lat: '45.035', lon: '38.975', display_name: 'TEST_START, Краснодар, Россия' }
      : { lat: '45.045', lon: '38.985', display_name: 'TEST_END, Краснодар, Россия' };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([item]) });
  });
  await page.route('https://api.heigit.org/openrouteservice/**', async route => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type, accept'
      } });
      return;
    }
    if (forceOrsFailure) {
      await route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'mock ORS unavailable' }) });
      return;
    }
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.alternative_routes) nativeAlternativesRequested = true;
    const coords = body.coordinates || [];
    const start = coords[0], end = coords[coords.length - 1];
    const base = { type: 'Feature', geometry: { type: 'LineString', coordinates: [start, end] }, properties: { summary: { distance: 1500, duration: 1000 }, segments: [] } };
    const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2 + 0.0024];
    const alternative = { type: 'Feature', geometry: { type: 'LineString', coordinates: [start, mid, end] }, properties: { summary: { distance: 1570, duration: 1050 }, segments: [] } };
    const waypoint = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { summary: { distance: 1650, duration: 1100 }, segments: [] } };
    await route.fulfill({ status: 200, contentType: 'application/geo+json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'FeatureCollection', features: coords.length === 2 ? [base, alternative] : [waypoint] }) });
  });
  const response = await page.goto('http://127.0.0.1:4173/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (!response?.ok()) throw new Error('index.html did not load successfully');

  try {
    await page.waitForFunction(() => {
      const status = document.getElementById('mapStatus')?.textContent || '';
      return status.includes('Область QuietWalk: Краснодарский край + Адыгея') ||
        status.includes('Не удалось загрузить границу области QuietWalk') ||
        status.includes('Граница области QuietWalk не загружена');
    }, { timeout: 45000 });
  } catch (error) {
    throw new Error('Boundary startup timed out. Browser diagnostics: ' + errors.join(' | ') + ' · ' + error.message);
  }

  const result = await page.evaluate(async () => {
    const swReady = await Promise.race([navigator.serviceWorker?.ready.then(registration => !!registration.active).catch(() => false) ?? Promise.resolve(false), new Promise(resolve => setTimeout(() => resolve(false), 20000))]);
    const manifestResponse = await fetch('manifest.webmanifest');
    const manifest = manifestResponse.ok ? await manifestResponse.json() : null;
    const shellCache = await caches.open('quietwalk-shell-v3').catch(() => null);
    const cachedBoundary = !!(shellCache && await shellCache.match(new URL('krasnodar-krai.geojson.gz.b64', document.baseURI).href));
    const status = document.getElementById('mapStatus')?.textContent || '';
    const boundaryResponse = await fetch('krasnodar-krai.geojson.gz.b64', { cache: 'no-store' });
    const encoded = (await boundaryResponse.text()).trim();
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const decompressed = await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    ).json();
    const features = decompressed.features || [decompressed];
    const namedKrai = features.some(feature => {
      const props = feature.properties || {};
      const name = [props.shapeName, props.shapeNameAlt, props.NAME_1, props.name, props.NAME, props.region, props.Region, props.admin1Name].filter(Boolean).join(' ');
      return /krasnodar|краснодар/i.test(name);
    });
    return {
      status,
      serviceWorkerReady: swReady,
      manifestLoaded: !!manifest && manifest.short_name === 'QuietWalk',
      offlineBoundaryCached: cachedBoundary,
      legacyCacheRemoved: !(await caches.keys()).includes('quietwalk-shell-v2'),
      leafletLoaded: !!window.L,
      mapCreated: !!document.querySelector('#map.leaflet-container'),
      boundaryHttpOk: boundaryResponse.ok,
      boundaryGzipOk: bytes[0] === 31 && bytes[1] === 139,
      boundaryHasKrasnodarFeature: namedKrai,
      quietButton: !!document.getElementById('quietBtn'),
      fastButton: !!document.getElementById('fastBtn'),
      startNavigationButton: !!document.getElementById('startNavBtn'),
      stopNavigationButton: !!document.getElementById('stopNavBtn'),
      routeHistoryTab: !!document.querySelector('[data-tab="history"]'),
      gpxImportButton: !!document.getElementById('importGpxBtn')
    };
  });

  for (const key of ['serviceWorkerReady', 'manifestLoaded', 'offlineBoundaryCached', 'legacyCacheRemoved', 'leafletLoaded', 'mapCreated', 'boundaryHttpOk', 'boundaryGzipOk', 'boundaryHasKrasnodarFeature', 'quietButton', 'fastButton', 'startNavigationButton', 'stopNavigationButton', 'routeHistoryTab', 'gpxImportButton']) {
    if (!result[key]) throw new Error('Browser check failed: ' + key);
  }
  await page.waitForFunction(() => (document.getElementById('toast')?.textContent || '').includes('включён резервный источник'), { timeout: 20000 });
  if (primaryTileFailures < 4 || fallbackTileRequests < 1) {
    throw new Error('Basemap fallback was not activated after primary tile failures: ' + JSON.stringify({ primaryTileFailures, fallbackTileRequests }));
  }
  console.log('PASS: basemap switches to the OSM.de fallback when primary OSM tiles fail.');
  if (!result.status.includes('Область QuietWalk: Краснодарский край + Адыгея')) {
    throw new Error('The application did not accept the Krasnodar Krai boundary: ' + result.status);
  }
  // Mock Overpass only after the initial boundary/shell checks; startup place loading
  // is intentionally left untouched so this integration test cannot mask boundary state.
  await page.route('https://routing.openstreetmap.de/routed-foot/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.split('/driving/')[1] || '';
    const coords = path.split(';').map(pair => pair.split(',').map(Number));
    const start = coords[0], end = coords[coords.length - 1];
    const base = { distance: 1500, duration: 1000, geometry: { type: 'LineString', coordinates: [start, end] }, legs: [] };
    const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2 + 0.0024];
    const alternative = { distance: 1570, duration: 1050, geometry: { type: 'LineString', coordinates: [start, mid, end] }, legs: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'Ok', routes: url.searchParams.get('alternatives') === 'true' ? [base, alternative] : [base] }) });
  });
  await page.route('https://ovp.dresel.systems/api/interpreter', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ elements: [] }) });
  });
  await page.fill('#searchInput', 'TEST_START');
  await page.click('#searchBtn');
  await page.waitForFunction(() => (document.getElementById('searchInput')?.value || '').includes('Краснодар'), { timeout: 15000 });
  await page.evaluate(() => window.qwUseSearch());
  await page.fill('#searchInput', 'TEST_END');
  await page.click('#searchBtn');
  await page.waitForFunction(() => (document.getElementById('searchInput')?.value || '').includes('Краснодар'), { timeout: 15000 });
  await page.evaluate(() => window.qwUseSearch());
  const selectedPoints = await page.evaluate(() => ({
    start: document.getElementById('startLabel')?.textContent || '',
    end: document.getElementById('endLabel')?.textContent || ''
  }));
  if (selectedPoints.start === selectedPoints.end) throw new Error('Route integration test selected the same point twice: ' + JSON.stringify(selectedPoints));
  await page.click('#quietBtn');
  try {
    await page.waitForFunction(() => {
      const title = document.getElementById('routeTitle')?.textContent || '';
      const status = document.getElementById('mapStatus')?.textContent || '';
      const toast = document.getElementById('toast')?.textContent || '';
      return title.includes('Тихий маршрут') || status.includes('Не удалось построить маршрут') || toast.includes('Не удалось построить пеший маршрут');
    }, { timeout: 30000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      title: document.getElementById('routeTitle')?.textContent || '',
      status: document.getElementById('mapStatus')?.textContent || '',
      toast: document.getElementById('toast')?.textContent || '',
      start: document.getElementById('startLabel')?.textContent || '',
      end: document.getElementById('endLabel')?.textContent || ''
    }));
    throw new Error('Quiet route generation timed out: ' + JSON.stringify(diagnostic) + ' · ' + errors.join(' | '));
  }
  if (!nativeAlternativesRequested) throw new Error('Quiet route did not request native ORS alternatives');
  const routedResult = await page.evaluate(() => ({
    title: document.getElementById('routeTitle')?.textContent || '',
    status: document.getElementById('mapStatus')?.textContent || '',
    distance: document.getElementById('distance')?.textContent || '',
    description: document.getElementById('routeDesc')?.textContent || '',
    toast: document.getElementById('toast')?.textContent || ''
  }));
  if (!routedResult.title.includes('Тихий маршрут') || !routedResult.distance || !routedResult.status.includes('построен')) {
    throw new Error('Quiet route integration check failed: ' + JSON.stringify(routedResult) + ' · ' + errors.join(' | '));
  }
  console.log('PASS: quiet route is built from mocked ORS alternatives and mapped noise evidence.');

  forceOrsFailure = true;
  await page.click('#resetBtn');
  await page.fill('#searchInput', 'TEST_START');
  await page.click('#searchBtn');
  await page.waitForFunction(() => (document.getElementById('searchInput')?.value || '').includes('Краснодар'), { timeout: 15000 });
  await page.evaluate(() => window.qwUseSearch());
  await page.fill('#searchInput', 'TEST_END');
  await page.click('#searchBtn');
  await page.waitForFunction(() => (document.getElementById('searchInput')?.value || '').includes('Краснодар'), { timeout: 15000 });
  await page.evaluate(() => window.qwUseSearch());
  await page.click('#quietBtn');
  await page.waitForFunction(() => {
    const status = document.getElementById('mapStatus')?.textContent || '';
    const toast = document.getElementById('toast')?.textContent || '';
    return status.includes('Тихий маршрут построен') || status.includes('Не удалось построить маршрут') || toast.includes('Не удалось построить пеший маршрут');
  }, { timeout: 30000 });
  const fallbackResult = await page.evaluate(() => ({
    title: document.getElementById('routeTitle')?.textContent || '',
    status: document.getElementById('mapStatus')?.textContent || '',
    distance: document.getElementById('distance')?.textContent || '',
    toast: document.getElementById('toast')?.textContent || ''
  }));
  if (!fallbackResult.title.includes('Тихий маршрут') || !fallbackResult.status.includes('построен') || !fallbackResult.distance) {
    throw new Error('Quiet route OSRM fallback check failed: ' + JSON.stringify(fallbackResult));
  }
  console.log('PASS: quiet route remains available when ORS is unavailable and OSRM alternatives are used.');

  const validGpx = '<?xml version="1.0"?><gpx version="1.1" creator="QuietWalk" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="45.04" lon="38.976"/><trkpt lat="45.041" lon="38.977"/></trkseg></trk></gpx>';
  await page.setInputFiles('#gpxInput', { name: 'quietwalk-valid.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(validGpx) });
  await page.waitForFunction(() => document.getElementById('routeTitle')?.textContent.includes('Импортированный GPX-маршрут'), { timeout: 15000 });
  const adygeaGpx = '<?xml version="1.0"?><gpx version="1.1" creator="QuietWalk" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="44.609" lon="40.1"/><trkpt lat="44.61" lon="40.11"/></trkseg></trk></gpx>';
  await page.setInputFiles('#gpxInput', { name: 'quietwalk-adygea.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(adygeaGpx) });
  await page.waitForFunction(() => (document.getElementById('toast')?.textContent || '').includes('GPX загружен') && (document.getElementById('toast')?.textContent || '').includes('области QuietWalk'), { timeout: 15000 });
  if (!(await page.locator('#routeTitle').textContent()).includes('Импортированный GPX-маршрут')) throw new Error('Adygea route was not accepted by the QuietWalk service area');
  console.log('PASS: GPX route inside Adygea is accepted.');
  const outsideGpx = '<?xml version="1.0"?><gpx version="1.1" creator="QuietWalk" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="41" lon="29"/><trkpt lat="41.001" lon="29.001"/></trkseg></trk></gpx>';
  await page.setInputFiles('#gpxInput', { name: 'quietwalk-outside.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(outsideGpx) });
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('внутри области QuietWalk'), { timeout: 10000 });
  console.log('PASS: GPX import accepts an in-region route and rejects outside coordinates.');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, { timeout: 20000 });
  await page.context().setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => {
      const map = document.querySelector('#map.leaflet-container');
      const boundaryPaths = document.querySelectorAll('#map .leaflet-overlay-pane svg path').length;
      return !!map && boundaryPaths > 0;
    }, { timeout: 45000 });
    const offlineResult = await page.evaluate(() => ({
      leafletLoaded: !!window.L,
      mapCreated: !!document.querySelector('#map.leaflet-container'),
      boundaryLoaded: document.querySelectorAll('#map .leaflet-overlay-pane svg path').length > 0
    }));
    if (!offlineResult.leafletLoaded || !offlineResult.mapCreated || !offlineResult.boundaryLoaded) {
      throw new Error('Offline shell did not reopen correctly: ' + JSON.stringify(offlineResult));
    }
    console.log('QUIETWALK_OFFLINE_RESULT=' + JSON.stringify(offlineResult));
  } finally {
    await page.context().setOffline(false);
  }

  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobilePage.on('pageerror', error => errors.push('mobile pageerror: ' + error.message));
  const mobileResponse = await mobilePage.goto('http://127.0.0.1:4173/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (!mobileResponse?.ok()) throw new Error('Mobile page did not load successfully');
  await mobilePage.waitForFunction(() => (document.getElementById('mapStatus')?.textContent || '').includes('Область QuietWalk: Краснодарский край + Адыгея'), { timeout: 45000 });
  const mobileLayout = await mobilePage.evaluate(() => ({
    mapHeight: document.querySelector('.mapwrap')?.getBoundingClientRect().height || 0,
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    routeHistoryTab: !!document.querySelector('[data-tab="history"]'),
    gpxImportButton: !!document.getElementById('importGpxBtn')
  }));
  if (mobileLayout.mapHeight < 300 || mobileLayout.documentWidth > mobileLayout.viewportWidth + 2 || !mobileLayout.routeHistoryTab || !mobileLayout.gpxImportButton) {
    throw new Error('Mobile layout check failed: ' + JSON.stringify(mobileLayout));
  }
  console.log('QUIETWALK_MOBILE_RESULT=' + JSON.stringify(mobileLayout));
  await mobilePage.close();

  if (errors.length) throw new Error('Uncaught browser errors: ' + errors.join(' | '));

  console.log('QUIETWALK_BROWSER_SMOKE_RESULT=' + JSON.stringify(result));
  console.log('PASS: app shell, service worker, manifest, cached boundary, Leaflet, region feature and navigation controls.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
