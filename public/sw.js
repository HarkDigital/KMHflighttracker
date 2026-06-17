/**
 * sw.js — service worker for the PHL board PWA.
 *
 * Strategy:
 *   - App shell (HTML/CSS/JS/icons): cache-first, precached on install.
 *   - /api/* JSON: network-first with a short timeout, falling back to the last
 *     cached response so the board still shows last-known data offline.
 *   - Cross-origin (Leaflet, map tiles): pass through (network), not precached.
 *
 * Bump SW_VERSION on every deploy to invalidate the old shell cache.
 */
const SW_VERSION = 'v21';
const SHELL_CACHE = 'phl-shell-' + SW_VERSION;
const API_CACHE   = 'phl-api-' + SW_VERSION;

const SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './airports.json',
  './assets/css/board.css',
  './assets/js/runtime-config.js',
  './assets/js/splitflap.js',
  './assets/js/adsb.js',
  './assets/js/adsbdb.js',
  './assets/js/airlines.js',
  './assets/js/flights.js',
  './assets/js/app.js',
  './assets/js/board.js',
  './assets/js/flight.js',
  './assets/js/tracked.js',
  './assets/js/flightpage.js',
  './assets/js/map.js',
  './assets/js/sw-register.js',
  './assets/icons/icon-192.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(SHELL).catch(() => {}))  // tolerate a missing icon
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== SHELL_CACHE && k !== API_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Only manage our own origin; let CDN/tiles go straight to network.
  if (url.origin !== self.location.origin) return;

  // Dynamic JSON (PHP API on IONOS, or static data/ on Pages): network-first
  // (3s) so the board stays fresh, falling back to the last cached copy offline.
  if (url.pathname.includes('/api/') || url.pathname.includes('/data/')) {
    e.respondWith(networkFirst(req));
    return;
  }

  // Navigations: try network, fall back to cached shell, then offline page.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() =>
        caches.match('./index.html').then(r => r || caches.match('./offline.html')))
    );
    return;
  }

  // Static assets: cache-first.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(SHELL_CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => hit))
  );
});

function networkFirst(req) {
  return new Promise(resolve => {
    const timer = setTimeout(fromCache, 3000);
    fetch(req).then(res => {
      clearTimeout(timer);
      const copy = res.clone();
      caches.open(API_CACHE).then(c => c.put(req, copy));
      resolve(res);
    }).catch(() => { clearTimeout(timer); fromCache(); });

    function fromCache() {
      caches.match(req).then(hit => resolve(hit || new Response(
        JSON.stringify({ offline: true, rows: [], aircraft: [] }),
        { headers: { 'Content-Type': 'application/json' } }
      )));
    }
  });
}

// Let the page trigger an immediate update.
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
