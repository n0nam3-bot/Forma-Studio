// Forma Studio service worker: offline caching only. It does NOT rewrite any source files
// (the runtime patch layer was folded into the sources in R-1; see HANDOFF.md section 3).
// RULE: bump CACHE_NAME on every release, and the ?v= of any module whose content changed.
const CACHE_NAME = 'forma-studio-source-fold-v9';
const APP_FILES = [
  './', './index.html', './bootstrap.js', './styles.css',
  './workspace-ui.css?v=4', './workspace-ui.js?v=4', './src/main.js',
  './src/skeleton-helper-compat.js', './src/visual-hull.js?v=9',
  './src/reference-cutout.js?v=8', './src/model.js', './src/motion.js',
  './src/persistence.js',
];
const THREE_PREFIXES = [
  'https://cdn.jsdelivr.net/npm/three@0.180.0/',
  'https://unpkg.com/three@0.180.0/',
  'https://fastly.jsdelivr.net/npm/three@0.180.0/',
  'https://gcore.jsdelivr.net/npm/three@0.180.0/',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 'reload' bypasses the HTTP cache so a release never precaches stale copies of its own files.
    await cache.addAll(APP_FILES.map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const threeCdn = THREE_PREFIXES.some(prefix => url.href.startsWith(prefix));
  if (!sameOrigin && !threeCdn) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    let response = await cache.match(request);
    if (!response) {
      response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  })());
});
