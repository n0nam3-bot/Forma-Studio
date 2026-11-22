const CACHE_NAME = 'forma-studio-two-view-reconstruction-v5';
const APP_FILES = [
  './',
  './index.html',
  './bootstrap.js',
  './styles.css',
  './workspace-ui.css',
  './workspace-ui.js',
  './src/main.js',
  './src/skeleton-helper-compat.js',
  './src/multiview-reconstruction.js',
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
    "import { prepareTwoViewFit, applyTwoViewFit } from './multiview-reconstruction.js';",
  ];
  for (const line of imports) {
    if (!source.includes(line)) source = `${line}\n${source}`;
  }

  // Keep the image-derived fit with the project state so proportions can be
  // rebuilt without losing the source-view geometry/appearance information.
  source = source.replace(
    '  shape:{...DEFAULT_SHAPE},',
    '  shape:{...DEFAULT_SHAPE}, imageFit:null,'
  );

  // Fit the actual generated skinned surface before its geometry is cloned for
  // the rig, animation and export workspaces. No photo plane is ever created.
  const avatarMarker = "  exportAvatar=createHumanoid(state.shape,{name:'ExportCharacter',geometryOverride:sharedGeometry});";
  if (source.includes(avatarMarker) && !source.includes('applyTwoViewFit(THREE,avatar,state.imageFit)')) {
    source = source.replace(avatarMarker, `${avatarMarker}\n  if(state.imageFit){[buildAvatar,rigAvatar,sourceAvatar,resultAvatar,exportAvatar].forEach(avatar=>applyTwoViewFit(THREE,avatar,state.imageFit));}`);
  }

  const shapeLabelBlock = `  $('#meshStats').textContent='22 BONES · 1 SKINNED MESH';
  $('#modelSourceLabel').textContent='PARAMETRIC HUMANOID · SKINNED';
  $('#viewportHint').textContent='Proportions applied · refine joint placement in Rig & pose';`;
  if (source.includes(shapeLabelBlock)) {
    source = source.replace(shapeLabelBlock, `  $('#meshStats').textContent=state.imageFit?'IMAGE-DERIVED SILHOUETTE · PROJECTED SURFACE COLOUR':'22 BONES · 1 SKINNED MESH';
  $('#modelSourceLabel').textContent=state.imageFit?'TWO-VIEW FIT · IMAGE-COLOURED SKINNED MESH':'PARAMETRIC HUMANOID · SKINNED';
  $('#viewportHint').textContent=state.imageFit?'Actual mesh geometry and vertex colours fitted from front + side references':'Proportions applied · refine joint placement in Rig & pose';`);
  }

  const fitFunctionMarker = 'async function measureReferenceSilhouette(reference) {';
  if (!source.includes('async function rebuildTwoViewFit()') && source.includes(fitFunctionMarker)) {
    const fitFunction = `
let twoViewFitRevision=0;
async function rebuildTwoViewFit(){
  const front=state.references.find(item=>item.role==='front');
  const side=state.references.find(item=>item.role==='side');
  const revision=++twoViewFitRevision;
  if(!front||!side){
    state.imageFit=null;
    if(state.meshMode!=='imported'){
      createAllAvatars();
      updateSourceChoice();
    }
    return;
  }
  try{
    const fit=await prepareTwoViewFit(state.references);
    if(revision!==twoViewFitRevision)return;
    state.imageFit=fit;
    if(state.meshMode==='fitted'){
      createAllAvatars();
      $('#modelSourceLabel').textContent='TWO-VIEW FIT · IMAGE-COLOURED SKINNED MESH';
      $('#meshStats').textContent='IMAGE-DERIVED SILHOUETTE · PROJECTED SURFACE COLOUR';
      $('#viewportHint').textContent='Actual mesh geometry and vertex colours fitted from front + side references';
    }else{
      toast('Reference fit is ready for the generated humanoid. The imported mesh is unchanged.','info',5000);
    }
    const confidence=Math.round((fit.front.confidence+fit.side.confidence)*50);
    toast('Front and side views fitted into the actual 3D mesh ('+confidence+'% capture confidence). Inspect the silhouette and refine proportions.','success',6500);
  }catch(error){
    if(revision!==twoViewFitRevision)return;
    state.imageFit=null;
    toast('Two-view fit failed: '+(error.message||'Could not analyse these images.'),'error',7000);
  }
}

`;
    source = source.replace(fitFunctionMarker, `${fitFunction}${fitFunctionMarker}`);
  }

  // Run the fitting pass as soon as references change, including file-picker
  // and drag/drop uploads. The input images remain local to this browser.
  const pickerMarker = `        state.references.push({role:slot.role,label:slot.label,name:file.name,dataUrl});
        renderReferenceGrid();
        toast(\x60${'${slot.label}'} reference added locally. No upload was made.\x60);`;
  if (source.includes(pickerMarker) && !source.includes('void rebuildTwoViewFit();\n        toast')) {
    source = source.replace(pickerMarker, pickerMarker.replace('        toast(', '        void rebuildTwoViewFit();\n        toast('));
  }

  const dropMarker = `state.references.push({role:slot.role,label:slot.label,name:file.name,dataUrl});renderReferenceGrid();toast(\x60${'${slot.label}'} reference added locally.\x60);`;
  if (source.includes(dropMarker)) {
    source = source.replace(dropMarker, dropMarker.replace('toast(', 'void rebuildTwoViewFit();toast('));
  }

  const removeMarker = "state.references=state.references.filter(item=>item.role!==slot.role);renderReferenceGrid();";
  source = source.replaceAll(removeMarker, `${removeMarker}void rebuildTwoViewFit();`);

  // Rebuild from saved local projects after their reference images are restored.
  source = source.replace(
    '  await loadSavedProject();\n  requestAnimationFrame(frame);',
    '  await loadSavedProject();\n  await rebuildTwoViewFit();\n  requestAnimationFrame(frame);'
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
    }
    const oldNotice = '<strong>Important:</strong> two images do not contain enough information to recover hidden geometry or photo textures. This fitting mode creates a clean, editable base mesh; it is not a neural scan or Gaussian-splat conversion.';
    const newNotice = '<strong>Two-view fitting:</strong> the actual mesh is reshaped to the front/side silhouettes and its surface vertex colours are projected from those views. This is approximate two-view silhouette fitting, not neural photogrammetry; hidden structure, separate clothing parts and fine surface relief remain inferred.';
    if (html.includes(oldNotice)) html = html.replace(oldNotice, newNotice);
    return rewrittenResponse(response, html);
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
