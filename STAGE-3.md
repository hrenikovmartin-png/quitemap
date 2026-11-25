# QuietWalk — Stage 3

## What changed

- CI now runs the Vite production build, Node regression tests, and Playwright browser checks.
- Added regression checks for the Krasnodar Krai boundary, route acceptance, camera bounds, GPS freshness/accuracy, permission denial, and safe rerouting.
- Extracted reusable navigation geometry helpers into `src/navigation/geometry.mjs` with unit tests.
- Fixed GPS permission-denial and synchronous startup failures so navigation stops cleanly and controls reset.
- Added a PWA manifest, app icon, and service worker to cache the app shell, local boundary, and Leaflet assets for offline reopening.
- Added a network-state indicator. Offline mode does not provide new routing, address search, Overpass data, or fresh map tiles.
- Added local history for the last 12 routes, with boundary-checked replay.
- Added GPX import with XML, file-size, point-count, coordinate, and full route-boundary validation.

## Checks

```sh
npm install
npm install --no-save playwright
npx playwright install chromium
npm run build
npm test
npm run test:browser
```

The browser smoke test verifies the local compressed boundary, map startup, navigation controls, PWA registration/manifest/cache, offline reopening, and GPX acceptance/rejection.

## Important limitations

- The quietness score is an OSM-based heuristic, not a measured sound level in dB.
- Offline support currently covers the app shell, local region boundary, and Leaflet assets. It does not provide offline routing or offline map tiles.
- GPS still requires a real HTTPS browser/device with location permission for end-to-end field validation.
- ORS, CARTO, OSM/Overpass, Nominatim, and map-tile services remain external dependencies. API keys stay in browser local storage and are not committed.
