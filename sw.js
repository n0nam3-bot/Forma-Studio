const CACHE_NAME = 'forma-studio-reconstruction-v6';
const APP_FILES = [
  './', './index.html', './bootstrap.js', './styles.css',
  './workspace-ui.css', './workspace-ui.js', './src/main.js',
  './src/skeleton-helper-compat.js', './src/visual-hull.js?v=6',
  './src/model.js', './src/motion.js', './src/persistence.js',
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

function patchVisualHullModule(source) {
  // A previous deployed copy omitted `row` from this destructuring. The review
  // button listener below needs the row returned by makeEditorUI(). Patch both
  // old cached source and keep the replacement idempotent.
  source = source.replace(
    /const\s*\{\s*editor\s*\}\s*=\s*makeEditorUI\(panel\);/,
    'const { row, editor } = makeEditorUI(panel);'
  );
  return source;
}

function patchMainModule(source) {
  const compatImport = "import './skeleton-helper-compat.js';";
  const reconstructionImport = "import { installVisualHullWorkflow, applyVisualHullToAvatar } from './visual-hull.js?v=6';";
  if (!source.includes(compatImport)) source = `${compatImport}\n${source}`;
  if (!source.includes('from \'./visual-hull.js')) source = `${reconstructionImport}\n${source}`;
  else source = source.replace(/from\s+['"]\.\/visual-hull\.js(?:\?v=\d+)?['"]/, "from './visual-hull.js?v=6'");

  if (source.includes('const state = {') && !source.includes('visualHullGeometry:null')) {
    source = source.replace('  shape:{...DEFAULT_SHAPE},', '  shape:{...DEFAULT_SHAPE},\n  visualHullGeometry:null,');
  }

  const avatarMarker = "  exportAvatar=createHumanoid(state.shape,{name:'ExportCharacter',geometryOverride:sharedGeometry});";
  if (source.includes(avatarMarker) && !source.includes('applyVisualHullToAvatar(THREE,avatar,state.visualHullGeometry)')) {
    source = source.replace(avatarMarker, `${avatarMarker}\n  if(state.visualHullGeometry){[buildAvatar,rigAvatar,sourceAvatar,resultAvatar,exportAvatar].forEach(avatar=>applyVisualHullToAvatar(THREE,avatar,state.visualHullGeometry));}`);
  }

  const applyShapeMarker = "function applyShape() {\n  if (state.meshMode==='imported')";
  if (source.includes(applyShapeMarker) && !source.includes('Manual proportion edits cleared the previous visual hull')) {
    source = source.replace(applyShapeMarker, "function applyShape() {\n  if(state.visualHullGeometry){state.visualHullGeometry.dispose?.();state.visualHullGeometry=null;toast('Manual proportion edits cleared the previous visual hull. Reconstruct again to use the reference views.','info',5000);}\n  if (state.meshMode==='imported')");
  }

  const projectReset = "state.meshMode='fitted';state.importedRoot=null;state.importedAnimations=[];state.importedPointCloud=false;";
  if (source.includes(projectReset) && !source.includes("state.visualHullGeometry=null;state.meshMode='fitted'")) {
    source = source.replace(projectReset, "state.visualHullGeometry=null;state.meshMode='fitted';state.importedRoot=null;state.importedAnimations=[];state.importedPointCloud=false;");
  }

  const initReferenceMarker = '  initReferences();';
  if (source.includes(initReferenceMarker) && !source.includes('installVisualHullWorkflow(THREE,')) {
    const setup = `
  try {
    installVisualHullWorkflow(THREE, {
      state,
      onReconstructed: geometry => {
        state.visualHullGeometry=geometry;
        [buildAvatar,rigAvatar,sourceAvatar,resultAvatar,exportAvatar].filter(Boolean).forEach(avatar=>applyVisualHullToAvatar(THREE,avatar,geometry));
        updateSourceChoice();
        $('#modelSourceLabel').textContent='MULTI-VIEW VISUAL HULL · SKINNED';
        const info=geometry.userData.formaReconstruction||{};
        $('#meshStats').textContent=\`${'${Number(info.vertexCount||0).toLocaleString()}'} VERTICES · ${'${Number(info.triangleCount||0).toLocaleString()}'} TRIANGLES\`;
        $('#viewportHint').textContent='Actual mesh generated from the intersected reference silhouettes';
        toast('Multi-view 3D volume reconstructed and bound to the character rig. Review the silhouette and surface before export.','success',7000);
      }
    });
  } catch (error) {
    console.error('Visual-hull tools could not initialize:', error);
    toast(\`Reconstruction tools unavailable: ${'${error?.message||error}'}\`, 'error', 8000);
  }`;
    source = source.replace(initReferenceMarker, `${initReferenceMarker}${setup}`);
  }
  return source;
}

async function applyClientPatches(response, url) {
  if (!response || !response.ok || url.origin !== self.location.origin) return response;

  if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) {
    let html = await response.clone().text();
    if (!html.includes('workspace-ui.css')) {
      const additions = [
        '<link rel="stylesheet" href="./workspace-ui.css?v=4">',
        '<script defer src="./workspace-ui.js?v=4"></script>',
      ].join('\n');
      html = html.replace('</head>', `${additions}\n</head>`);
    }
    html = html.replace('Fit proportions from views', 'Reconstruct 3D mesh from views');
    html = html.replace('Fit a humanoid from proportions', 'Reconstruct from reference views');
    html = html.replace(
      'Builds an editable, rigged character that you refine against the uploaded views.',
      'Builds a closed 3D visual hull by intersecting cleaned silhouettes from multiple camera angles.'
    );
    html = html.replace(
      'two images do not contain enough information to recover hidden geometry or photo textures. This fitting mode creates a clean, editable base mesh; it is not a neural scan or Gaussian-splat conversion.',
      'Each view constrains the actual 3D volume. Crop and clean every silhouette before reconstruction. A visual hull preserves visible outlines but cannot infer hidden concave detail or replace neural image-to-3D.'
    );
    return rewrittenResponse(response, html);
  }

  if (url.pathname.endsWith('/src/main.js')) {
    return rewrittenResponse(response, patchMainModule(await response.clone().text()));
  }
  if (url.pathname.endsWith('/src/visual-hull.js')) {
    return rewrittenResponse(response, patchVisualHullModule(await response.clone().text()));
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
    return applyClientPatches(response, url);
  })());
});
