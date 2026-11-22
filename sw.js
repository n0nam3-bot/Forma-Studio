const CACHE_NAME = 'forma-studio-reference-guide-v4';
const APP_FILES = [
  './',
  './index.html',
  './bootstrap.js',
  './styles.css',
  './workspace-ui.css',
  './workspace-ui.js',
  './src/main.js',
  './src/skeleton-helper-compat.js',
  './src/reference-overlay.js',
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
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function patchMainModule(source) {
  const imports = [
    "import './skeleton-helper-compat.js';",
    "import { ReferenceOverlayManager } from './reference-overlay.js';",
  ];
  for (const line of imports) {
    if (!source.includes(line)) source = `${line}\n${source}`;
  }

  const viewsMarker = 'const views = {};';
  if (!source.includes('function syncReferenceOverlay(') && source.includes(viewsMarker)) {
    const helpers = `
const referenceOverlaySettings = { enabled: true, opacity: 38, scale: 100 };
function syncReferenceOverlay(view = views.build) {
  if (!view?.referenceOverlay) return;
  const role = view.cameraType === 'front' ? 'front' : view.cameraType === 'side' ? 'side' : '';
  const reference = role ? state.references.find(item => item.role === role) : null;
  view.referenceOverlay.setReference(role || null, reference?.dataUrl || null);
  const hasReference = Boolean(reference);
  view.referenceOverlay.setVisible(referenceOverlaySettings.enabled && hasReference);
  view.referenceOverlay.setOpacity(referenceOverlaySettings.opacity);
  view.referenceOverlay.setScale(referenceOverlaySettings.scale);
  const toggle = document.querySelector('#referenceOverlayToggle');
  if (toggle) {
    toggle.classList.toggle('active', referenceOverlaySettings.enabled && hasReference);
    toggle.setAttribute('aria-pressed', String(referenceOverlaySettings.enabled));
    toggle.title = hasReference
      ? 'Toggle the semi-transparent photo guide. It is not baked into the exported mesh.'
      : 'Choose Front or Side and upload that reference view to show an alignment guide.';
  }
}
function installReferenceOverlayControls() {
  const actions = document.querySelector('#buildViewportWrap')?.closest('.viewport-panel')?.querySelector('.viewport-toolbar .viewport-actions');
  if (!actions || document.querySelector('#referenceOverlayControls')) return;
  const controls = document.createElement('div');
  controls.id = 'referenceOverlayControls';
  controls.className = 'reference-guide-controls';
  controls.innerHTML = '<button id="referenceOverlayToggle" class="icon-button active" type="button" aria-pressed="true">REF</button><label title="Photo overlay opacity"><span>Opacity</span><input id="referenceOverlayOpacity" type="range" min="10" max="80" value="38" /></label><label title="Photo overlay scale"><span>Scale</span><input id="referenceOverlayScale" type="range" min="65" max="140" value="100" /></label>';
  actions.prepend(controls);
  document.querySelector('#referenceOverlayToggle').addEventListener('click', () => {
    referenceOverlaySettings.enabled = !referenceOverlaySettings.enabled;
    syncReferenceOverlay();
  });
  document.querySelector('#referenceOverlayOpacity').addEventListener('input', event => {
    referenceOverlaySettings.opacity = Number(event.target.value);
    syncReferenceOverlay();
  });
  document.querySelector('#referenceOverlayScale').addEventListener('input', event => {
    referenceOverlaySettings.scale = Number(event.target.value);
    syncReferenceOverlay();
  });
}
`;
    source = source.replace(viewsMarker, `${viewsMarker}\n${helpers}`);
  }

  const viewMarker = 'const view={canvas,renderer,scene,camera:cameraObj,controls,model:null,disposed:false};';
  if (source.includes(viewMarker) && !source.includes('referenceOverlay:new ReferenceOverlayManager')) {
    source = source.replace(viewMarker, 'const view={canvas,renderer,scene,camera:cameraObj,controls,model:null,disposed:false,referenceOverlay:new ReferenceOverlayManager(THREE,scene)};');
  }

  const cameraMarker = "function setCamera(view,type='three') {\n  if(!view)return;\n  const target=view.controls.target;";
  if (source.includes(cameraMarker) && !source.includes('view.cameraType=type;')) {
    source = source.replace(cameraMarker, "function setCamera(view,type='three') {\n  if(!view)return;\n  view.cameraType=type;\n  const target=view.controls.target;");
    source = source.replace('  view.controls.update();\n}\n\nfunction setViewModel', '  view.controls.update();\n  syncReferenceOverlay(view);\n}\n\nfunction setViewModel');
  }

  source = source.replace(
    '    view.disposed=true;\n    view.resizeObserver?.disconnect();',
    '    view.referenceOverlay?.dispose();\n    view.disposed=true;\n    view.resizeObserver?.disconnect();'
  );
  source = source.replace(
    "  $('#referenceCount').textContent=`${state.references.length} / 8`;\n}",
    "  $('#referenceCount').textContent=`${state.references.length} / 8`;\n  syncReferenceOverlay();\n}"
  );
  source = source.replace(
    "  createPageViews('build');\n  createAllAvatars();",
    "  createPageViews('build');\n  installReferenceOverlayControls();\n  createAllAvatars();\n  syncReferenceOverlay();"
  );

  return source;
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
    const source = patchMainModule(await response.clone().text());
    return rewrittenResponse(response, source);
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
      if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone()).catch(() => {});
    }
    if (!sameOrigin) return response;
    return applyClientPatches(request, response, url);
  })());
});
