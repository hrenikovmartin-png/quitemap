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

  const response = await page.goto('http://127.0.0.1:4173/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (!response?.ok()) throw new Error('index.html did not load successfully');

  try {
    await page.waitForFunction(() => {
      const status = document.getElementById('mapStatus')?.textContent || '';
      return status.includes('Точный контур Краснодарского края загружен') ||
        status.includes('Не удалось загрузить точную границу Краснодарского края') ||
        status.includes('Точная граница Краснодарского края не загружена');
    }, { timeout: 45000 });
  } catch (error) {
    throw new Error('Boundary startup timed out. Browser diagnostics: ' + errors.join(' | ') + ' · ' + error.message);
  }

  const result = await page.evaluate(async () => {
    const swReady = await Promise.race([navigator.serviceWorker?.ready.then(registration => !!registration.active).catch(() => false) ?? Promise.resolve(false), new Promise(resolve => setTimeout(() => resolve(false), 20000))]);
    const manifestResponse = await fetch('manifest.webmanifest');
    const manifest = manifestResponse.ok ? await manifestResponse.json() : null;
    const shellCache = await caches.open('quietwalk-shell-v1').catch(() => null);
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
      leafletLoaded: !!window.L,
      mapCreated: !!document.querySelector('#map.leaflet-container'),
      boundaryHttpOk: boundaryResponse.ok,
      boundaryGzipOk: bytes[0] === 31 && bytes[1] === 139,
      boundaryHasKrasnodarFeature: namedKrai,
      quietButton: !!document.getElementById('quietBtn'),
      fastButton: !!document.getElementById('fastBtn'),
      startNavigationButton: !!document.getElementById('startNavBtn'),
      stopNavigationButton: !!document.getElementById('stopNavBtn'),
      routeHistoryTab: !!document.querySelector('[data-tab="history"]')
    };
  });

  for (const key of ['serviceWorkerReady', 'manifestLoaded', 'offlineBoundaryCached', 'leafletLoaded', 'mapCreated', 'boundaryHttpOk', 'boundaryGzipOk', 'boundaryHasKrasnodarFeature', 'quietButton', 'fastButton', 'startNavigationButton', 'stopNavigationButton', 'routeHistoryTab']) {
    if (!result[key]) throw new Error('Browser check failed: ' + key);
  }
  if (!result.status.includes('Точный контур Краснодарского края загружен')) {
    throw new Error('The application did not accept the Krasnodar Krai boundary: ' + result.status);
  }
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, { timeout: 20000 });
  await page.context().setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => {
      const status = document.getElementById('mapStatus')?.textContent || '';
      return status.includes('Точный контур Краснодарского края загружен');
    }, { timeout: 45000 });
    const offlineResult = await page.evaluate(() => ({
      leafletLoaded: !!window.L,
      mapCreated: !!document.querySelector('#map.leaflet-container'),
      boundaryLoaded: (document.getElementById('mapStatus')?.textContent || '').includes('Точный контур Краснодарского края загружен')
    }));
    if (!offlineResult.leafletLoaded || !offlineResult.mapCreated || !offlineResult.boundaryLoaded) {
      throw new Error('Offline shell did not reopen correctly: ' + JSON.stringify(offlineResult));
    }
    console.log('QUIETWALK_OFFLINE_RESULT=' + JSON.stringify(offlineResult));
  } finally {
    await page.context().setOffline(false);
  }

  if (errors.length) throw new Error('Uncaught browser errors: ' + errors.join(' | '));

  console.log('QUIETWALK_BROWSER_SMOKE_RESULT=' + JSON.stringify(result));
  console.log('PASS: app shell, service worker, manifest, cached boundary, Leaflet, region feature and navigation controls.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
