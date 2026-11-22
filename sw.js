const CACHE_NAME = 'forma-studio-reference-cutout-v7';
const APP_FILES = [
  './', './index.html', './bootstrap.js', './styles.css',
  './workspace-ui.css', './workspace-ui.js', './src/main.js',
  './src/skeleton-helper-compat.js', './src/visual-hull.js?v=7',
  './src/reference-cutout.js?v=7', './src/model.js', './src/motion.js',
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

function patchVisualHullModule(source) {
  source = source.replace(
    /const\s*\{\s*editor\s*\}\s*=\s*makeEditorUI\(panel\);/,
    'const { row, editor } = makeEditorUI(panel);'
  );
  source = source.replace(
    'const DEFAULT_ANGLES = { front: 0, side: 90, back: 180, threeQuarter: 45 };',
    'const DEFAULT_ANGLES = { front: 0, side: 90, sideOpposite: 270, back: 180, threeQuarter: 45 };'
  );
  source = source.replaceAll('decodeImage(reference.dataUrl)', 'decodeImage(reference.originalDataUrl || reference.dataUrl)');
  source = source.replace('Review / crop / mask views', 'Refine cutout / view direction');
  source = source.replace('Camera angle<select id="vhAngleSelect">', 'Camera angle · side direction<select id="vhAngleSelect">');
  source = source.replace(
    "  const angleSelect = editor.querySelector('#vhAngleSelect');",
    `  const angleSelect = editor.querySelector('#vhAngleSelect');\n  [...angleSelect.options].forEach(option => {\n    const labels = { 0: '0° · Front', 90: '90° · Side (front points image-left)', 180: '180° · Back', 270: '270° · Other side (front points image-right)' };\n    option.textContent = labels[Number(option.value)] || \`${'${option.value}'}°\`;\n  });`
  );
  source = source.replace(
    'Each view must show the same pose from a different angle.',
    'Backgrounds are removed automatically on upload. For side views, 90° means the character’s front points toward image-left; 270° means image-right. Add Other side for an asymmetrical opposite profile.'
  );
  source = source.replace(
    "editorState.reference.dataUrl = cropped.toDataURL('image/png');\n    editorState.reference.maskDataUrl = null;",
    "editorState.reference.dataUrl = cropped.toDataURL('image/png');\n    editorState.reference.originalDataUrl = editorState.reference.dataUrl;\n    editorState.reference.maskDataUrl = null;"
  );

  // Choose the widest front and side silhouettes when opposite-side images are
  // supplied. Both are still intersected as independent camera constraints.
  source = source.replace(
    /function estimateExtents\(views\) \{[\s\S]*?\n\}/,
    `function estimateExtents(views) {
  const frontCandidates = views.filter(view => ['front', 'back'].includes(view.reference.role));
  const sideCandidates = views.filter(view => ['side', 'sideOpposite'].includes(view.reference.role));
  const front = views.find(view => view.reference.role === 'front')
    || views.find(view => view.reference.role === 'back')
    || views.reduce((best, view) => Math.abs(Math.cos(radians(view.angleDeg))) > Math.abs(Math.cos(radians(best.angleDeg))) ? view : best, views[0]);
  const side = (sideCandidates.length ? sideCandidates : views)
    .reduce((best, view) => view.aspect > best.aspect ? view : best, (sideCandidates.length ? sideCandidates : views)[0]);
  const halfX = clamp(front.aspect * CHARACTER_HEIGHT * 0.5 * 1.045, 0.13, 0.82);
  const halfZ = clamp(side.aspect * CHARACTER_HEIGHT * 0.5 * 1.045, 0.10, 0.70);
  return { halfX, halfZ };
}`
  );

  const smoothFunction = `function smoothVoxelSurface(geometry, pairs = 3) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!position || !index || position.count > 450000) return;
  const links = Array.from({ length: position.count }, () => new Set());
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    links[a].add(b); links[a].add(c);
    links[b].add(a); links[b].add(c);
    links[c].add(a); links[c].add(b);
  }
  let current = position.array.slice();
  const pass = amount => {
    const next = current.slice();
    for (let i = 0; i < links.length; i++) {
      const neighbours = links[i];
      if (!neighbours.size) continue;
      let x = 0, y = 0, z = 0;
      for (const neighbour of neighbours) {
        const offset = neighbour * 3;
        x += current[offset]; y += current[offset + 1]; z += current[offset + 2];
      }
      const count = neighbours.size;
      const offset = i * 3;
      next[offset] += (x / count - current[offset]) * amount;
      next[offset + 1] += (y / count - current[offset + 1]) * amount;
      next[offset + 2] += (z / count - current[offset + 2]) * amount;
    }
    current = next;
  };
  // Taubin-style positive/negative passes soften voxel stair-steps while
  // limiting the shrinkage caused by ordinary Laplacian smoothing.
  for (let i = 0; i < pairs; i++) { pass(0.34); pass(-0.36); }
  position.array.set(current);
  position.needsUpdate = true;
}`;
  if (!source.includes('function smoothVoxelSurface')) {
    source = source.replace(
      'function createSurfaceGeometry(THREE, grid, views, onProgress) {',
      `${smoothFunction}\n\nfunction createSurfaceGeometry(THREE, grid, views, onProgress) {`
    );
  }
  source = source.replace(
    '  geometry.setIndex(indices);\n  geometry.computeVertexNormals();',
    '  geometry.setIndex(indices);\n  smoothVoxelSurface(geometry, 4);\n  geometry.computeVertexNormals();'
  );
  return source;
}

function patchMainModule(source) {
  const compatImport = "import './skeleton-helper-compat.js';";
  const reconstructionImport = "import { installVisualHullWorkflow, applyVisualHullToAvatar } from './visual-hull.js?v=7';";
  const cutoutImport = "import { autoCutoutDataUrl } from './reference-cutout.js?v=7';";
  if (!source.includes(compatImport)) source = `${compatImport}\n${source}`;
  if (!source.includes('from \'./visual-hull.js')) source = `${reconstructionImport}\n${source}`;
  else source = source.replace(/from\s+['"]\.\/visual-hull\.js(?:\?v=\d+)?['"]/, "from './visual-hull.js?v=7'");
  if (!source.includes('from \'./reference-cutout.js')) source = `${cutoutImport}\n${source}`;

  if (source.includes('const state = {') && !source.includes('visualHullGeometry:null')) {
    source = source.replace('  shape:{...DEFAULT_SHAPE},', '  shape:{...DEFAULT_SHAPE},\n  visualHullGeometry:null,');
  }

  // The second side profile has its own camera direction, allowing asymmetric
  // silhouettes to constrain the back/front depth independently.
  source = source.replace(
    "    {role:'side',label:'Side',required:true},",
    "    {role:'side',label:'Side',required:true},\n    {role:'sideOpposite',label:'Other side',required:false},"
  );

  // New uploads are cut out locally before being placed in the reference grid.
  // Keep the original pixels separately so later mask refinement can restore
  // details and reconstruction can sample unaltered source colours.
  source = source.replace(
    'const dataUrl=await readFileAsDataURL(file);',
    'const cutout=await autoCutoutDataUrl(await readFileAsDataURL(file)); const dataUrl=cutout.dataUrl;'
  );
  source = source.replaceAll(
    'state.references.push({role:slot.role,label:slot.label,name:file.name,dataUrl});',
    'state.references.push({role:slot.role,label:slot.label,name:file.name,dataUrl,originalDataUrl:cutout.originalDataUrl,maskDataUrl:cutout.maskDataUrl});'
  );
  source = source.replaceAll(
    'reference added locally. No upload was made.',
    'added locally with automatic background removal. No upload was made.'
  );

  // Older locally saved projects did not contain transparent cutouts. Process
  // those references on restore so existing projects receive the same workflow.
  const restoreReferencesMarker = '  state.references=Array.isArray(project.references)?project.references:[];';
  if (source.includes(restoreReferencesMarker) && !source.includes('autoCutoutDataUrl(reference.dataUrl)')) {
    source = source.replace(restoreReferencesMarker, `${restoreReferencesMarker}\n  await Promise.all(state.references.map(async reference=>{\n    if(!reference.originalDataUrl){const cutout=await autoCutoutDataUrl(reference.dataUrl);reference.dataUrl=cutout.dataUrl;reference.originalDataUrl=cutout.originalDataUrl;reference.maskDataUrl=reference.maskDataUrl||cutout.maskDataUrl;}\n  }));`);
  }

  // Preserve the new slot when restoring older .forma projects.
  const restoreMarker = "  state.referenceSlots=Array.isArray(project.referenceSlots)?project.referenceSlots:[\n    {role:'front',label:'Front',required:true},{role:'side',label:'Side',required:true},{role:'back',label:'Back',required:false},{role:'threeQuarter',label:'3/4 view',required:false},\n  ];";
  if (source.includes(restoreMarker) && !source.includes("if(!state.referenceSlots.some(slot=>slot.role==='sideOpposite'))")) {
    source = source.replace(restoreMarker, `${restoreMarker}\n  if(!state.referenceSlots.some(slot=>slot.role==='sideOpposite'))state.referenceSlots.splice(2,0,{role:'sideOpposite',label:'Other side',required:false});`);
  }

  const avatarMarker = "  exportAvatar=createHumanoid(state.shape,{name:'ExportCharacter',geometryOverride:sharedGeometry});";
  if (source.includes(avatarMarker) && !source.includes('applyVisualHullToAvatar(THREE,avatar,state.visualHullGeometry)')) {
    source = source.replace(avatarMarker, `${avatarMarker}\n  if(state.visualHullGeometry){[buildAvatar,rigAvatar,sourceAvatar,resultAvatar,exportAvatar].forEach(avatar=>applyVisualHullToAvatar(THREE,avatar,state.visualHullGeometry));}`);
  }

  // Reconstructed geometry remains in state while proportion controls rebuild and rebind the rig.

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
        $('#modelSourceLabel').textContent='MULTI-VIEW 3D MESH · SKINNED';
        const info=geometry.userData.formaReconstruction||{};
        $('#meshStats').textContent=\`${'${Number(info.vertexCount||0).toLocaleString()}'} VERTICES · ${'${Number(info.triangleCount||0).toLocaleString()}'} TRIANGLES\`;
        $('#viewportHint').textContent='Volumetric mesh reconstructed from intersecting reference silhouettes';
        toast('Multi-view 3D volume reconstructed and bound to the character rig. Review the surface before export.','success',7000);
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
      'Each view constrains the actual 3D volume. Backgrounds are cut out locally. Opposite-side views constrain asymmetry; the surface is smoothed but hidden concave detail still requires more views or a local neural reconstruction workflow.'
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
