const CACHE_NAME = 'forma-studio-asymmetric-anatomy-v9';
const APP_FILES = [
  './', './index.html', './bootstrap.js', './styles.css',
  './workspace-ui.css', './workspace-ui.js', './src/main.js',
  './src/skeleton-helper-compat.js', './src/visual-hull.js?v=9',
  './src/reference-cutout.js?v=9', './src/model.js', './src/motion.js',
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

const isoSurfaceFunction = String.raw`function createIsoSurfaceGeometry(THREE, grid, views, onProgress) {
  const { occupancy, indexOf, nx, ny, nz, halfX, halfZ, dx, dy, dz } = grid;
  const sx = nx + 2, sy = ny + 2, sz = nz + 2;
  const fieldIndex = (x, y, z) => (z * sy + y) * sx + x;
  let field = new Float32Array(sx * sy * sz);
  for (let z = 1; z <= nz; z++) {
    for (let y = 1; y <= ny; y++) {
      for (let x = 1; x <= nx; x++) {
        field[fieldIndex(x, y, z)] = occupancy[indexOf(x - 1, y - 1, z - 1)] ? 1 : 0;
      }
    }
  }

  // Separable [1,2,1] smoothing rounds voxel corners before polygonization.
  const blurAxis = (input, axis) => {
    const output = new Float32Array(input.length);
    for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
      const coordinate = axis === 0 ? x : axis === 1 ? y : z;
      const limit = axis === 0 ? sx : axis === 1 ? sy : sz;
      const before = Math.max(0, coordinate - 1), after = Math.min(limit - 1, coordinate + 1);
      const a = axis === 0 ? fieldIndex(before, y, z) : axis === 1 ? fieldIndex(x, before, z) : fieldIndex(x, y, before);
      const b = fieldIndex(x, y, z);
      const c = axis === 0 ? fieldIndex(after, y, z) : axis === 1 ? fieldIndex(x, after, z) : fieldIndex(x, y, after);
      output[b] = (input[a] + 2 * input[b] + input[c]) * 0.25;
    }
    return output;
  };
  for (let pass = 0; pass < 3; pass++) {
    field = blurAxis(field, 0);
    field = blurAxis(field, 1);
    field = blurAxis(field, 2);
  }

  const corners = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const tetrahedra = [[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
  const positions = [], indices = [], vertexMap = new Map();
  const iso = 0.48;
  const pointAt = (x, y, z) => [
    -halfX + (x - 0.5) * dx,
    (y - 0.5) * dy,
    -halfZ + (z - 0.5) * dz,
  ];
  const addVertex = point => {
    const key = point.map(value => Math.round(value * 100000)).join(',');
    let id = vertexMap.get(key);
    if (id !== undefined) return id;
    id = positions.length / 3;
    positions.push(point[0], point[1], point[2]);
    vertexMap.set(key, id);
    return id;
  };
  const interpolate = (a, b, va, vb) => {
    const t = clamp((iso - va) / (vb - va || 1e-8), 0, 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  const emitTriangle = (a, b, c, insideCenter, outsideCenter) => {
    const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    const normal = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]];
    const outward = [outsideCenter[0]-insideCenter[0], outsideCenter[1]-insideCenter[1], outsideCenter[2]-insideCenter[2]];
    if (normal[0]*outward[0] + normal[1]*outward[1] + normal[2]*outward[2] < 0) [b,c] = [c,b];
    indices.push(addVertex(a), addVertex(b), addVertex(c));
  };

  for (let z = 0; z < sz - 1; z++) {
    for (let y = 0; y < sy - 1; y++) for (let x = 0; x < sx - 1; x++) {
      const values = corners.map(([ox,oy,oz]) => field[fieldIndex(x+ox,y+oy,z+oz)]);
      if (values.every(value => value < iso) || values.every(value => value >= iso)) continue;
      const points = corners.map(([ox,oy,oz]) => pointAt(x+ox,y+oy,z+oz));
      for (const tet of tetrahedra) {
        const inside = tet.filter(i => values[i] >= iso);
        const outside = tet.filter(i => values[i] < iso);
        if (!inside.length || !outside.length) continue;
        const centerOf = list => list.reduce((sum,i) => [sum[0]+points[i][0]/list.length,sum[1]+points[i][1]/list.length,sum[2]+points[i][2]/list.length],[0,0,0]);
        const insideCenter = centerOf(inside), outsideCenter = centerOf(outside);
        const edge = (a,b) => interpolate(points[a],points[b],values[a],values[b]);
        if (inside.length === 1) {
          const i=inside[0]; emitTriangle(edge(i,outside[0]),edge(i,outside[1]),edge(i,outside[2]),insideCenter,outsideCenter);
        } else if (inside.length === 3) {
          const o=outside[0]; emitTriangle(edge(o,inside[0]),edge(o,inside[1]),edge(o,inside[2]),insideCenter,outsideCenter);
        } else {
          const a=inside[0], b=inside[1], c=outside[0], d=outside[1];
          const ac=edge(a,c), ad=edge(a,d), bc=edge(b,c), bd=edge(b,d);
          emitTriangle(ac,bc,bd,insideCenter,outsideCenter);
          emitTriangle(ac,bd,ad,insideCenter,outsideCenter);
        }
      }
    }
    if (z % 6 === 0) {
      onProgress?.(0.60 + 0.18 * (z + 1) / (sz - 1), 'Building a rounded continuous character surface…');
    }
  }
  if (!positions.length || !indices.length) throw new Error('No continuous surface was created. Check that the reference silhouettes overlap and are correctly oriented.');

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const uvs = new Float32Array(position.count * 2);
  const fallback = [0.42, 0.46, 0.52];
  for (let i = 0; i < position.count; i++) {
    const x=position.getX(i), y=position.getY(i), z=position.getZ(i);
    const nxv=normal.getX(i), nzv=normal.getZ(i);
    let total=0; const colour=[0,0,0];
    for (const view of views) {
      const facing=nxv*view.direction.x+nzv*view.direction.z;
      // Only project a side reference onto the lateral half facing that camera.
      // The opposite half receives front-view colour or a neutral inferred finish.
      if (Math.abs(view.direction.x) > 0.82 && x * view.direction.x < -0.01) continue;
      if (facing<=0.025) continue;
      const sampled=sampleViewColor(view,x,y,z);
      if (!sampled) continue;
      const weight=Math.pow(facing,3.2); total+=weight;
      colour[0]+=srgbToLinear(sampled[0])*weight;
      colour[1]+=srgbToLinear(sampled[1])*weight;
      colour[2]+=srgbToLinear(sampled[2])*weight;
    }
    if (total <= 0.0001) {
      const frontView = views.find(view => view.reference.role === 'front');
      const frontal = frontView ? sampleViewColor(frontView,x,y,z) : null;
      if (frontal) {
        colour[0]=srgbToLinear(frontal[0]); colour[1]=srgbToLinear(frontal[1]); colour[2]=srgbToLinear(frontal[2]); total=1;
      }
    }
    const out=total>0.0001?colour.map(value=>value/total):fallback;
    colors[i*3]=out[0]; colors[i*3+1]=out[1]; colors[i*3+2]=out[2];
    uvs[i*2]=(x+halfX)/(2*halfX); uvs[i*2+1]=y/CHARACTER_HEIGHT;
  }
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.formaReconstruction={
    method:'smoothed multi-view silhouette isosurface',
    views:views.map(view=>({role:view.reference.role,angleDeg:view.angleDeg,confidence:1})),
    voxelResolution:{x:nx,y:ny,z:nz},filledVoxels:grid.filled,
    vertexCount:position.count,triangleCount:indices.length/3,
    surfaceColour:'multi-view projected vertex colour',
    boundary:'smoothed visual hull; unseen concave surfaces are not inferred',
  };
  return geometry;
}`;

const newInstallWorkflow = "export function installVisualHullWorkflow(THREE, { state, onReconstructed }) {\n  const panel = document.querySelector('.reference-panel');\n  const originalFit = document.querySelector('#fitReferences');\n  if (!panel || !originalFit || originalFit.dataset.visualHullInstalled === 'true') return;\n  originalFit.dataset.visualHullInstalled = 'true';\n  const fitButton = originalFit.cloneNode(true);\n  fitButton.id = 'fitReferences';\n  fitButton.textContent = 'Reconstruct 3D character mesh';\n  originalFit.replaceWith(fitButton);\n\n  if (!document.querySelector('#vhAutoCutoutStyles')) {\n    const style = document.createElement('style');\n    style.id = 'vhAutoCutoutStyles';\n    style.textContent = '.vh-auto-cutout-note{font-size:10px;color:#a8b6c5;margin:8px 0;padding:8px 10px;border:1px solid #354151;border-radius:8px;background:#111a24}.vh-progress{height:5px;border-radius:10px;background:#273241;overflow:hidden;margin:8px 0}.vh-progress>span{display:block;height:100%;width:0;background:#c9f36a;transition:width .15s}.vh-status{font:9px monospace;line-height:1.5;color:#aecb77;min-height:16px;margin:5px 0}';\n    document.head.appendChild(style);\n  }\n  const autoNote = document.createElement('div');\n  autoNote.className = 'vh-auto-cutout-note';\n  autoNote.textContent = 'Background removal: automatic \u00b7 Add both side profiles to capture asymmetry; a missing side uses a neutral anatomy estimate, not copied side pixels.';\n  fitButton.insertAdjacentElement('beforebegin', autoNote);\n  const progressWrap = document.createElement('div');\n  progressWrap.className = 'vh-progress';\n  progressWrap.innerHTML = '<span id=\"vhProgressBar\"></span>';\n  fitButton.insertAdjacentElement('afterend', progressWrap);\n  const progressText = document.createElement('div');\n  progressText.className = 'vh-status';\n  progressText.id = 'vhProgressText';\n  progressText.textContent = 'Add a Front view and at least one Side (facing left or right) view. Add the opposite side when the character is asymmetrical.';\n  progressWrap.insertAdjacentElement('afterend', progressText);\n\n  fitButton.addEventListener('click', async () => {\n    if (fitButton.disabled) return;\n    fitButton.disabled = true;\n    fitButton.textContent = 'Reconstructing rounded 3D surface\u2026';\n    const bar = document.querySelector('#vhProgressBar');\n    const setProgress = (value, message) => {\n      if (bar) bar.style.width = `${Math.round(value * 100)}%`;\n      progressText.textContent = `${Math.round(value * 100)}% \u00b7 ${message}`;\n    };\n    try {\n      const geometry = await buildVisualHull(THREE, state.references, setProgress);\n      onReconstructed(geometry);\n      const info = geometry.userData.formaReconstruction;\n      setProgress(1, `Complete \u00b7 ${info.views.length} views \u00b7 ${info.vertexCount.toLocaleString()} vertices \u00b7 ${info.triangleCount.toLocaleString()} triangles.`);\n      toast('Side-aware 3D surface reconstructed. An unprovided opposite side uses a neutral anatomical estimate; supply both sides for asymmetry.', 'success', 6500);\n    } catch (error) {\n      progressText.textContent = `Reconstruction stopped \u00b7 ${error.message}`;\n      toast(error.message || 'Could not reconstruct this character.', 'error', 6500);\n    } finally {\n      fitButton.disabled = false;\n      fitButton.textContent = 'Reconstruct 3D character mesh';\n    }\n  });\n}";

const anatomyOccupancyFunction = String.raw`async function buildOccupancy(views, settings, onProgress) {
  const { nx, ny, nz } = settings;
  const { halfX, halfZ } = estimateExtents(views);
  const dx = 2 * halfX / nx, dy = CHARACTER_HEIGHT / ny, dz = 2 * halfZ / nz;
  const occupancy = new Uint8Array(nx * ny * nz);
  const indexOf = (x, y, z) => (z * ny + y) * nx + x;
  const front = views.find(view => view.reference.role === 'front');
  if (!front) throw new Error('A Front reference is required to establish the character width and limb placement.');
  const sideViews = views.filter(view => Math.abs(view.direction.x) > 0.82 && Math.abs(view.direction.z) < 0.58);
  if (!sideViews.length) throw new Error('Add at least one direction-labelled side profile.');
  const auxiliaryViews = views.filter(view => view !== front && !sideViews.includes(view));

  const ellipsoid = (x, y, z, cx, cy, cz, rx, ry, rz) => {
    const a=(x-cx)/rx, b=(y-cy)/ry, c=(z-cz)/rz;
    return a*a+b*b+c*c <= 1;
  };
  const capsule = (x, y, z, ax, ay, az, bx, by, bz, radius) => {
    const dx=bx-ax, dy=by-ay, dz=bz-az;
    const length=dx*dx+dy*dy+dz*dz || 1;
    const t=clamp(((x-ax)*dx+(y-ay)*dy+(z-az)*dz)/length,0,1);
    const px=ax+t*dx, py=ay+t*dy, pz=az+t*dz;
    const ox=x-px, oy=y-py, oz=z-pz;
    return ox*ox+oy*oy+oz*oz <= radius*radius;
  };
  const capsule2D = (x, y, ax, ay, bx, by, radius) => {
    const dx=bx-ax, dy=by-ay, length=dx*dx+dy*dy || 1;
    const t=clamp(((x-ax)*dx+(y-ay)*dy)/length,0,1);
    const ox=x-(ax+t*dx), oy=y-(ay+t*dy);
    return ox*ox+oy*oy <= radius*radius;
  };
  const isArmPlane = (x,y) => {
    for (const sign of [-1,1]) {
      const shoulder=sign*.235, elbow=sign*.53, wrist=sign*.795;
      if (capsule2D(x,y,shoulder,1.425,elbow,1.18,.12) ||
          capsule2D(x,y,elbow,1.18,wrist,.99,.105) ||
          ellipsoid(x,y,0,wrist,.94,0,.085,.105,.2)) return true;
    }
    return false;
  };
  const isLegPlane = (x,y) => {
    for (const sign of [-1,1]) {
      if (capsule2D(x,y,sign*.105,.90,sign*.117,.535,.145) ||
          capsule2D(x,y,sign*.117,.535,sign*.12,.15,.115) ||
          ellipsoid(x,y,0,sign*.12,.09,0,.11,.09,.2)) return true;
    }
    return false;
  };
  const anatomyContains = (x, y, z) => {
    // Soft, deliberately neutral human volume for regions not visible in the
    // supplied side photograph. It is not copied from the visible side.
    if (ellipsoid(x,y,z,0,.94,0,.205,.145,.132) ||
        ellipsoid(x,y,z,0,1.105,0,.158,.175,.112) ||
        ellipsoid(x,y,z,0,1.325,0,.205,.235,.139) ||
        ellipsoid(x,y,z,0,1.49,0,.066,.10,.068) ||
        ellipsoid(x,y,z,0,1.70,0,.135,.16,.12) ||
        ellipsoid(x,y,z,0,1.775,-.005,.145,.075,.128) ||
        ellipsoid(x,y,z,0,1.685,.137,.028,.03,.048) ||
        ellipsoid(x,y,z,0,1.715,.112,.022,.045,.035) ||
        ellipsoid(x,y,z,-.045,1.685,.095,.048,.048,.038) ||
        ellipsoid(x,y,z,.045,1.685,.095,.048,.048,.038) ||
        ellipsoid(x,y,z,0,1.635,.075,.075,.05,.067)) return true;
    for (const sign of [-1,1]) {
      const shoulder=sign*.235, elbow=sign*.53, wrist=sign*.795;
      if (capsule(x,y,z,shoulder,1.425,.018,elbow,1.18,.018,.086) ||
          capsule(x,y,z,elbow,1.18,.018,wrist,.99,.018,.071) ||
          ellipsoid(x,y,z,wrist,.94,.018,.056,.087,.061) ||
          capsule(x,y,z,sign*.105,.90,0,sign*.117,.535,0,.108) ||
          capsule(x,y,z,sign*.117,.535,0,sign*.12,.15,0,.078) ||
          ellipsoid(x,y,z,sign*.12,.09,.095,.085,.068,.155)) return true;
      if (ellipsoid(x,y,z,sign*.126,1.69,.012,.027,.048,.042)) return true;
    }
    return false;
  };
  const isArmCorridor = (x, y, z) => {
    for (const sign of [-1,1]) {
      const shoulder=sign*.235, elbow=sign*.53, wrist=sign*.795;
      if (capsule(x,y,z,shoulder,1.425,.018,elbow,1.18,.018,.098) ||
          capsule(x,y,z,elbow,1.18,.018,wrist,.99,.018,.084) ||
          ellipsoid(x,y,z,wrist,.94,.018,.067,.095,.076)) return true;
    }
    return false;
  };
  const isLegCorridor = (x, y, z) => {
    for (const sign of [-1,1]) {
      if (capsule(x,y,z,sign*.105,.90,0,sign*.117,.535,0,.122) ||
          capsule(x,y,z,sign*.117,.535,0,sign*.12,.15,0,.09) ||
          ellipsoid(x,y,z,sign*.12,.09,.095,.096,.078,.17)) return true;
    }
    return false;
  };
  const isFaceCore = (x, y, z) =>
    ellipsoid(x,y,z,0,1.70,0,.135,.16,.12) ||
    ellipsoid(x,y,z,0,1.775,-.005,.145,.075,.128) ||
    ellipsoid(x,y,z,0,1.685,.137,.028,.03,.048) ||
    ellipsoid(x,y,z,0,1.715,.112,.022,.045,.035) ||
    ellipsoid(x,y,z,-.045,1.685,.095,.048,.048,.038) ||
    ellipsoid(x,y,z,.045,1.685,.095,.048,.048,.038) ||
    ellipsoid(x,y,z,0,1.635,.075,.075,.05,.067) ||
    ellipsoid(x,y,z,-.126,1.69,.012,.027,.048,.042) ||
    ellipsoid(x,y,z,.126,1.69,.012,.027,.048,.042);

  let filled = 0;
  for (let z = 0; z < nz; z++) {
    const worldZ = -halfZ + (z + 0.5) * dz;
    for (let y = 0; y < ny; y++) {
      const worldY = (y + 0.5) * dy;
      for (let x = 0; x < nx; x++) {
        const worldX = -halfX + (x + 0.5) * dx;
        // Front and auxiliary/back views constrain the whole body.
        let inside = insideView(front, worldX, worldY, worldZ);
        if (inside) for (const view of auxiliaryViews) {
          if (!insideView(view, worldX, worldY, worldZ)) { inside=false; break; }
        }
        if (inside) {
          // A side camera constrains only the lateral half it physically sees.
          // If no opposite-side image exists, use an anatomical prior on that
          // hidden half rather than mirroring the supplied side silhouette.
          const sideView = sideViews.find(view => worldX * view.direction.x >= -0.0001);
          if (sideView) inside = insideView(sideView, worldX, worldY, worldZ);
          else inside = anatomyContains(worldX, worldY, worldZ);
        }
        if (inside) {
          // Separate sleeves/arms and legs from the torso's extruded silhouette.
          // This gives each limb a round cross-section with actual depth.
          const absX=Math.abs(worldX);
          if (inside && worldY >= .99 && worldY <= 1.49 && absX >= .15 && absX <= .91 && isArmPlane(worldX,worldY)) {
            inside = isArmCorridor(worldX,worldY,worldZ);
          }
          if (inside && worldY >= .055 && worldY <= .94 && absX >= .035 && absX <= .27 && isLegPlane(worldX,worldY)) {
            inside = isLegCorridor(worldX,worldY,worldZ);
          }
        }
        // A small forward-facing facial volume makes the nose/bridge a real
        // protrusion instead of only a side-view colour cutout. It is clipped
        // to the front silhouette and the corresponding side profile when seen.
        if (inside && worldY >= 1.62 && worldY <= 1.745 && Math.abs(worldX) <= .14) inside = isFaceCore(worldX,worldY,worldZ);
        if (!inside && worldY >= 1.64 && worldY <= 1.75 && Math.abs(worldX) <= .035 && worldZ > .105 &&
            insideView(front,worldX,worldY,worldZ) && isFaceCore(worldX,worldY,worldZ)) {
          const sideView=sideViews.find(view=>worldX*view.direction.x>=-0.0001);
          if (!sideView || insideView(sideView,worldX,worldY,worldZ)) inside=true;
        }
        if (inside) { occupancy[indexOf(x,y,z)] = 1; filled++; }
      }
    }
    if (z % 4 === 0) {
      onProgress?.(0.12 + 0.48 * (z + 1) / nz, 'Building side-aware anatomy and intersecting ' + views.length + ' reference views…');
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  if (filled < 500) throw new Error('The view masks do not overlap into a usable 3D volume. Check the side direction and reference silhouettes.');
  return { occupancy, indexOf, nx, ny, nz, halfX, halfZ, dx, dy, dz, filled };
}`;

function patchVisualHullModule(source) {
  source = source.replace(
    'const DEFAULT_ANGLES = { front: 0, side: 90, back: 180, threeQuarter: 45 };',
    'const DEFAULT_ANGLES = { front: 0, side: 90, sideFacingLeft: 90, sideFacingRight: 270, sideOpposite: 270, back: 180, threeQuarter: 45 };'
  );
  source = source.replaceAll('decodeImage(reference.dataUrl)', 'decodeImage(reference.originalDataUrl || reference.dataUrl)');
  source = source.replace(
    /function estimateExtents\(views\) \{[\s\S]*?\n\}/,
    `function estimateExtents(views) {
  const front = views.find(view => view.reference.role === 'front') || views.find(view => view.reference.role === 'back') || views[0];
  const sides = views.filter(view => ['sideFacingLeft','sideFacingRight','side','sideOpposite'].includes(view.reference.role));
  const sidePool = sides.length ? sides : views;
  const side = sidePool.reduce((best, view) => view.aspect > best.aspect ? view : best, sidePool[0]);
  const halfX = clamp(front.aspect * CHARACTER_HEIGHT * 0.5 * 1.045, 0.13, 0.82);
  const halfZ = clamp(side.aspect * CHARACTER_HEIGHT * 0.5 * 1.045, 0.10, 0.70);
  return { halfX, halfZ };
}`
  );
  source = source.replace(
    "  const requiredSide = references.some(reference => reference.role === 'side');",
    "  const requiredSide = references.some(reference => ['sideFacingLeft','sideFacingRight','side','sideOpposite'].includes(reference.role));"
  );
  source = source.replace("Upload separate Front and Side views first. A single picture cannot define a 3D volume.", "Upload a Front view and at least one Side view labelled facing left or facing right. Add both side views to capture asymmetry.");
  source = source.replace(/async function buildOccupancy\(views, settings, onProgress\) \{[\s\S]*?\n\}/, anatomyOccupancyFunction);
  source = source.replace(
    'function createSurfaceGeometry(THREE, grid, views, onProgress) {',
    `${isoSurfaceFunction}\n\nfunction createSurfaceGeometry(THREE, grid, views, onProgress) {\n  return createIsoSurfaceGeometry(THREE, grid, views, onProgress);`
  );
  source = source.replace(/export function installVisualHullWorkflow\(THREE,[\s\S]*$/, newInstallWorkflow);
  return source;
}
function patchMainModule(source) {
  const compatImport = "import './skeleton-helper-compat.js';";
  const reconstructionImport = "import { installVisualHullWorkflow, applyVisualHullToAvatar } from './visual-hull.js?v=9';";
  const cutoutImport = "import { autoCutoutDataUrl } from './reference-cutout.js?v=9';";
  if (!source.includes(compatImport)) source = `${compatImport}\n${source}`;
  if (!source.includes('from \'./visual-hull.js')) source = `${reconstructionImport}\n${source}`;
  else source = source.replace(/from\s+['"]\.\/visual-hull\.js(?:\?v=\d+)?['"]/, "from './visual-hull.js?v=9'");
  if (!source.includes('from \'./reference-cutout.js')) source = `${cutoutImport}\n${source}`;

  if (source.includes('const state = {') && !source.includes('visualHullGeometry:null')) {
    source = source.replace('  shape:{...DEFAULT_SHAPE},', '  shape:{...DEFAULT_SHAPE},\n  visualHullGeometry:null,');
  }

  // Side reference slots encode whether the character faces image-left or image-right.
  source = source.replace(
    "    {role:'side',label:'Side',required:true},",
    "    {role:'sideFacingLeft',label:'Side (facing left)',required:false},\n    {role:'sideFacingRight',label:'Side (facing right)',required:false},"
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
  source = source.replace(
    /  state\.referenceSlots=Array\.isArray\(project\.referenceSlots\)\?project\.referenceSlots:\[[\s\S]*?\n  \];/,
    `state.referenceSlots=[
      {role:'front',label:'Front',required:true},
      {role:'sideFacingLeft',label:'Side (facing left)',required:false},
      {role:'sideFacingRight',label:'Side (facing right)',required:false},
      ...state.referenceSlots.filter(slot=>!['side','sideOpposite','sideFacingLeft','sideFacingRight','front'].includes(slot.role))
    ];`
  );
  const referenceRoleMigration = '  state.references=Array.isArray(project.references)?project.references:[];';
  if (source.includes(referenceRoleMigration) && !source.includes("reference.role==='sideOpposite'")) {
    source = source.replace(referenceRoleMigration, `${referenceRoleMigration}
  state.references.forEach(reference=>{
    if(reference.role==='sideOpposite'||reference.role==='sideFacingRight'||(reference.role==='side'&&Number(reference.angleDeg)===270)){reference.role='sideFacingRight';reference.label='Side (facing right)';reference.angleDeg=270;}
    else if(reference.role==='side'||reference.role==='sideFacingLeft'){reference.role='sideFacingLeft';reference.label='Side (facing left)';if(!Number.isFinite(Number(reference.angleDeg)))reference.angleDeg=90;}
  });`);
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
        $('#viewportHint').textContent='Side-aware volumetric surface with round limb cross-sections and a forward facial volume';
        toast('Side-aware volumetric surface reconstructed with round limb volumes and facial depth. Unseen details remain inferred.','success',7000);
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
      'Backgrounds are removed automatically when images are added. Label side profiles by the direction the character faces: left or right. Both can be supplied for asymmetrical characters. The mesh uses side-specific constraints, volumetric limb priors and a forward facial volume. An unprovided opposite side is estimated neutrally, not copied from the supplied side. Fine clothing folds and hidden details still require additional views or a local neural reconstruction workflow.'
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
