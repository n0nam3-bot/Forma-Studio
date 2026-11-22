const CACHE_NAME = 'forma-studio-shell-v3';
const APP_FILES = [
  './',
  './index.html',
  './bootstrap.js',
  './styles.css',
  './workspace-ui.css',
  './workspace-ui.js',
  './src/main.js',
  './src/skeleton-helper-compat.js',
  './src/model.js',
  './src/motion.js',
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
    await cache.addAll(APP_FILES);
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

function rewrittenResponse(response, body) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('etag');
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function applyClientPatches(request, response, url) {
  if (!response || !response.ok || url.origin !== self.location.origin) return response;

  if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) {
    let html = await response.clone().text();
    if (!html.includes('workspace-ui.css')) {
      const additions = [
        '<link rel="stylesheet" href="./workspace-ui.css?v=3">',
        '<script defer src="./workspace-ui.js?v=3"></script>',
      ].join('\n');
      html = html.replace('</head>', `${additions}\n</head>`);
      return rewrittenResponse(response, html);
    }
  }

  if (url.pathname.endsWith('/src/main.js')) {
    const source = await response.clone().text();
    const compatibilityImport = "import './skeleton-helper-compat.js';\n";
    if (!source.startsWith(compatibilityImport)) {
      return rewrittenResponse(response, compatibilityImport + source);
    }
  }

  return response;
}

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
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).catch(() => {});
      }
    }
    if (!sameOrigin) return response;
    return applyClientPatches(request, response, url);
  })());
});
