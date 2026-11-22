/**
 * Browser-local multi-view visual-hull reconstruction for Forma Studio.
 *
 * Builds a closed triangle surface by intersecting orthographic silhouette
 * constraints from manually selected character views. Vertex colour is baked
 * from the real source pixels by view-facing projection. This is a classical
 * visual hull, not a neural radiance field, Gaussian splat, or diffusion model.
 */
const EDIT_W = 288;
const EDIT_H = 432;
const CHARACTER_HEIGHT = 1.82;
const DEFAULT_ANGLES = { front: 0, side: 90, back: 180, threeQuarter: 45 };
const ANGLE_OPTIONS = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const radians = degrees => degrees * Math.PI / 180;

function decodeImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A reference image could not be decoded. Try PNG, JPG or WebP.'));
    image.src = dataUrl;
  });
}

function imageLayout(image, width = EDIT_W, height = EDIT_H) {
  const scale = Math.min((width - 12) / image.naturalWidth, (height - 12) / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  return { scale, x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight };
}

function median(values) {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function autoMaskFromPixels(rgba, width, height, threshold = 48) {
  const border = [];
  const stride = 2;
  for (let x = 0; x < width; x += stride) {
    for (const y of [0, height - 1]) {
      const p = (y * width + x) * 4;
      border.push([rgba[p], rgba[p + 1], rgba[p + 2], rgba[p + 3]]);
    }
  }
  for (let y = 0; y < height; y += stride) {
    for (const x of [0, width - 1]) {
      const p = (y * width + x) * 4;
      border.push([rgba[p], rgba[p + 1], rgba[p + 2], rgba[p + 3]]);
    }
  }
  const transparent = border.filter(pixel => pixel[3] < 64).length > border.length * 0.42;
  const bg = [0, 1, 2].map(channel => median(border.filter(p => p[3] >= 64).map(p => p[channel])));
  const count = width * height;
  const visited = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0, tail = 0;

  const isBackground = index => {
    const p = index * 4;
    if (rgba[p + 3] < 36) return true;
    if (transparent) return rgba[p + 3] < 150;
    const dr = rgba[p] - bg[0], dg = rgba[p + 1] - bg[1], db = rgba[p + 2] - bg[2];
    return Math.sqrt(dr * dr + dg * dg + db * db) <= threshold;
  };
  const push = index => {
    if (visited[index] || !isBackground(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) push(index - 1);
    if (x + 1 < width) push(index + 1);
    if (y > 0) push(index - width);
    if (y + 1 < height) push(index + width);
  }

  const mask = new Uint8Array(count);
  let foreground = 0;
  for (let i = 0; i < count; i++) {
    if (!visited[i] && rgba[i * 4 + 3] > 24) { mask[i] = 1; foreground++; }
  }
  return { mask, foreground, background: tail, transparent };
}

function maskToDataUrl(mask) {
  const canvas = document.createElement('canvas');
  canvas.width = EDIT_W;
  canvas.height = EDIT_H;
  const context = canvas.getContext('2d');
  const image = context.createImageData(EDIT_W, EDIT_H);
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4;
    image.data[p] = 255;
    image.data[p + 1] = 255;
    image.data[p + 2] = 255;
    image.data[p + 3] = mask[i] ? 255 : 0;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function defaultAngle(reference, index = 0) {
  if (Number.isFinite(Number(reference.angleDeg))) return Number(reference.angleDeg);
  if (Object.prototype.hasOwnProperty.call(DEFAULT_ANGLES, reference.role)) return DEFAULT_ANGLES[reference.role];
  return (index * 45) % 360;
}

function boundsOfMask(mask) {
  let minX = EDIT_W, minY = EDIT_H, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < EDIT_H; y++) {
    for (let x = 0; x < EDIT_W; x++) {
      if (!mask[y * EDIT_W + x]) continue;
      count++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const width = maxX - minX + 1, height = maxY - minY + 1;
  if (width < 8 || height < 30 || count < 180 || count > EDIT_W * EDIT_H * 0.94) {
    throw new Error('A view has no usable character silhouette. Crop to one character, run Auto mask, and paint/erase until only that character remains.');
  }
  return { minX, minY, maxX, maxY, width, height, count };
}

async function analyseReference(reference, index, threshold = 48) {
  const image = await decodeImage(reference.dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = EDIT_W; canvas.height = EDIT_H;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const layout = imageLayout(image);
  context.clearRect(0, 0, EDIT_W, EDIT_H);
  context.drawImage(image, layout.x, layout.y, layout.width, layout.height);
  const sourceImage = context.getImageData(0, 0, EDIT_W, EDIT_H);
  let mask;
  if (reference.maskDataUrl) {
    const maskImage = await decodeImage(reference.maskDataUrl);
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = EDIT_W; maskCanvas.height = EDIT_H;
    const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
    maskContext.clearRect(0, 0, EDIT_W, EDIT_H);
    maskContext.drawImage(maskImage, 0, 0, EDIT_W, EDIT_H);
    const rgba = maskContext.getImageData(0, 0, EDIT_W, EDIT_H).data;
    mask = new Uint8Array(EDIT_W * EDIT_H);
    for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3] > 20 ? 1 : 0;
  } else {
    const result = autoMaskFromPixels(sourceImage.data, EDIT_W, EDIT_H, threshold);
    mask = result.mask;
    reference.maskDataUrl = maskToDataUrl(mask);
  }
  const bounds = boundsOfMask(mask);
  const angleDeg = defaultAngle(reference, index);
  reference.angleDeg = angleDeg;
  return {
    reference, image, pixels: sourceImage.data, mask, bounds,
    width: EDIT_W, height: EDIT_H,
    aspect: bounds.width / bounds.height,
    angleDeg,
    direction: { x: Math.sin(radians(angleDeg)), z: Math.cos(radians(angleDeg)) },
  };
}

function projectedPixel(view, x, y, z) {
  const theta = radians(view.angleDeg);
  const horizontal = x * Math.cos(theta) - z * Math.sin(theta);
  const px = view.bounds.minX + view.bounds.width / 2 + horizontal / CHARACTER_HEIGHT * view.bounds.height;
  const py = view.bounds.minY + (1 - y / CHARACTER_HEIGHT) * view.bounds.height;
  return { x: Math.round(px), y: Math.round(py) };
}

function insideView(view, x, y, z) {
  const pixel = projectedPixel(view, x, y, z);
  if (pixel.x < view.bounds.minX || pixel.x > view.bounds.maxX || pixel.y < view.bounds.minY || pixel.y > view.bounds.maxY) return false;
  return view.mask[pixel.y * view.width + pixel.x] === 1;
}

function sampleViewColor(view, x, y, z) {
  const p = projectedPixel(view, x, y, z);
  if (p.x < 0 || p.x >= view.width || p.y < 0 || p.y >= view.height) return null;
  const index = p.y * view.width + p.x;
  if (!view.mask[index]) return null;
  const i = index * 4;
  return [view.pixels[i] / 255, view.pixels[i + 1] / 255, view.pixels[i + 2] / 255];
}

function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function getGridSettings() {
  const mobile = window.matchMedia?.('(max-width: 720px)').matches || (navigator.deviceMemory && navigator.deviceMemory <= 4);
  return mobile
    ? { nx: 52, ny: 92, nz: 52 }
    : { nx: 104, ny: 176, nz: 104 };
}

function estimateExtents(views) {
  const front = views.find(view => view.reference.role === 'front') || views.reduce((best, view) => Math.abs(Math.cos(radians(view.angleDeg))) > Math.abs(Math.cos(radians(best.angleDeg))) ? view : best, views[0]);
  const side = views.find(view => view.reference.role === 'side') || views.reduce((best, view) => Math.abs(Math.sin(radians(view.angleDeg))) > Math.abs(Math.sin(radians(best.angleDeg))) ? view : best, views[0]);
  const halfX = clamp(front.aspect * CHARACTER_HEIGHT * 0.5 * 1.045, 0.13, 0.82);
  const halfZ = clamp(side.aspect * CHARACTER_HEIGHT * 0.5 * 1.045, 0.10, 0.70);
  return { halfX, halfZ };
}

async function buildOccupancy(views, settings, onProgress) {
  const { nx, ny, nz } = settings;
  const { halfX, halfZ } = estimateExtents(views);
  const dx = 2 * halfX / nx, dy = CHARACTER_HEIGHT / ny, dz = 2 * halfZ / nz;
  const occupancy = new Uint8Array(nx * ny * nz);
  const indexOf = (x, y, z) => (z * ny + y) * nx + x;
  let filled = 0;
  for (let z = 0; z < nz; z++) {
    const worldZ = -halfZ + (z + 0.5) * dz;
    for (let y = 0; y < ny; y++) {
      const worldY = (y + 0.5) * dy;
      for (let x = 0; x < nx; x++) {
        const worldX = -halfX + (x + 0.5) * dx;
        let inside = true;
        for (const view of views) {
          if (!insideView(view, worldX, worldY, worldZ)) { inside = false; break; }
        }
        if (inside) { occupancy[indexOf(x, y, z)] = 1; filled++; }
      }
    }
    if (z % 4 === 0) {
      onProgress?.(0.12 + 0.48 * (z + 1) / nz, `Intersecting ${views.length} silhouette views…`);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  if (filled < 500) throw new Error('The view masks do not overlap into a usable 3D volume. Check the view angles, crops and masks.');
  return { occupancy, indexOf, nx, ny, nz, halfX, halfZ, dx, dy, dz, filled };
}

function createSurfaceGeometry(THREE, grid, views, onProgress) {
  const { occupancy, indexOf, nx, ny, nz, halfX, halfZ, dx, dy, dz } = grid;
  const vertexIndex = new Int32Array((nx + 1) * (ny + 1) * (nz + 1));
  vertexIndex.fill(-1);
  const vertexStrideX = nx + 1;
  const vertexStrideY = (nx + 1) * (ny + 1);
  const positions = [];
  const uvs = [];
  const indices = [];
  const vertexId = (gx, gy, gz) => {
    const key = gz * vertexStrideY + gy * vertexStrideX + gx;
    if (vertexIndex[key] !== -1) return vertexIndex[key];
    const id = positions.length / 3;
    positions.push(-halfX + gx * dx, gy * dy, -halfZ + gz * dz);
    uvs.push(gx / nx, gy / ny);
    vertexIndex[key] = id;
    return id;
  };
  const faces = [
    { d: [-1, 0, 0], c: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]] },
    { d: [ 1, 0, 0], c: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
    { d: [0,-1,0], c: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
    { d: [0, 1,0], c: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]] },
    { d: [0,0,-1], c: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] },
    { d: [0,0, 1], c: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },
  ];
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (!occupancy[indexOf(x, y, z)]) continue;
        for (const face of faces) {
          const ax = x + face.d[0], ay = y + face.d[1], az = z + face.d[2];
          if (ax >= 0 && ax < nx && ay >= 0 && ay < ny && az >= 0 && az < nz && occupancy[indexOf(ax, ay, az)]) continue;
          const ids = face.c.map(c => vertexId(x + c[0], y + c[1], z + c[2]));
          indices.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
        }
      }
    }
    if (z % 6 === 0) {
      onProgress?.(0.60 + 0.18 * (z + 1) / nz, 'Creating the closed triangle surface…');
    }
  }
  if (!positions.length || !indices.length) throw new Error('No surface was created. Recheck your masks and camera angles.');

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');
  const colors = new Float32Array((positions.length / 3) * 3);
  const fallback = [0.42, 0.46, 0.52];
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const nxv = normal.getX(i), nzv = normal.getZ(i);
    let total = 0;
    const colour = [0, 0, 0];
    for (const view of views) {
      const facing = nxv * view.direction.x + nzv * view.direction.z;
      if (facing <= 0.025) continue;
      const sampled = sampleViewColor(view, x, y, z);
      if (!sampled) continue;
      const weight = Math.pow(facing, 3.2);
      total += weight;
      colour[0] += srgbToLinear(sampled[0]) * weight;
      colour[1] += srgbToLinear(sampled[1]) * weight;
      colour[2] += srgbToLinear(sampled[2]) * weight;
    }
    const out = total > 0.0001 ? colour.map(value => value / total) : fallback;
    colors[i * 3] = out[0]; colors[i * 3 + 1] = out[1]; colors[i * 3 + 2] = out[2];
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.formaReconstruction = {
    method: 'multi-view silhouette visual hull',
    views: views.map(view => ({ role: view.reference.role, angleDeg: view.angleDeg, confidence: 1 })),
    voxelResolution: { x: nx, y: ny, z: nz },
    filledVoxels: grid.filled,
    vertexCount: position.count,
    triangleCount: indices.length / 3,
    surfaceColour: 'multi-view projected vertex colour',
  };
  return geometry;
}

function closestDistance(point, a, b) {
  const ab = b.clone().sub(a);
  const length = ab.lengthSq() || 1;
  const t = clamp(point.clone().sub(a).dot(ab) / length, 0, 1);
  return point.distanceTo(a.clone().addScaledVector(ab, t));
}

function addSkinWeights(THREE, geometry, avatar) {
  avatar.bones.forEach(bone => bone.rotation.set(0, 0, 0));
  avatar.root.updateMatrixWorld(true);
  const bones = avatar.skeleton.bones;
  const segments = bones.map((bone, index) => {
    const start = bone.getWorldPosition(new THREE.Vector3());
    const child = bone.children.find(item => item.isBone);
    const end = child ? child.getWorldPosition(new THREE.Vector3()) : start.clone();
    return { index, start, end };
  });
  const positions = geometry.getAttribute('position');
  const skinIndex = new Uint16Array(positions.count * 4);
  const skinWeight = new Float32Array(positions.count * 4);
  const local = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    local.fromBufferAttribute(positions, i);
    const point = avatar.root.localToWorld(local.clone());
    const nearest = segments.map(segment => ({
      index: segment.index,
      distance: closestDistance(point, segment.start, segment.end),
    })).sort((a, b) => a.distance - b.distance).slice(0, 4);
    let sum = 0;
    const weights = nearest.map(item => {
      const weight = 1 / Math.pow(item.distance + 0.025, 2.4);
      sum += weight;
      return weight;
    });
    nearest.forEach((item, n) => {
      skinIndex[i * 4 + n] = item.index;
      skinWeight[i * 4 + n] = weights[n] / (sum || 1);
    });
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
}

export function applyVisualHullToAvatar(THREE, avatar, sourceGeometry) {
  if (!avatar?.mesh || !sourceGeometry) return false;
  const geometry = sourceGeometry.clone();
  addSkinWeights(THREE, geometry, avatar);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const oldGeometry = avatar.mesh.geometry;
  avatar.mesh.geometry = geometry;
  avatar.skeleton.calculateInverses();
  avatar.mesh.bind(avatar.skeleton);
  avatar.mesh.material.vertexColors = true;
  avatar.mesh.material.needsUpdate = true;
  oldGeometry?.dispose?.();
  avatar.root.userData.formaReconstruction = sourceGeometry.userData.formaReconstruction;
  avatar.mesh.userData.formaReconstruction = sourceGeometry.userData.formaReconstruction;
  avatar.helper?.update?.();
  avatar.root.updateMatrixWorld(true);
  return true;
}

function installStyles() {
  if (document.querySelector('#visualHullStyles')) return;
  const style = document.createElement('style');
  style.id = 'visualHullStyles';
  style.textContent = `
    .vh-review-row{display:flex;gap:7px;margin:8px 0 10px}
    .vh-review-button{flex:1;border:1px solid #374456;background:#171f29;color:#dce5ef;border-radius:8px;padding:8px 9px;font-size:10px;font-weight:600}
    .vh-review-button:hover{border-color:#c9f36a;color:#c9f36a}
    .vh-editor{border:1px solid #354151;border-radius:10px;background:#101720;padding:10px;margin:8px 0 12px}
    .vh-editor[hidden]{display:none}
    .vh-editor-top{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
    .vh-editor label{display:flex;flex-direction:column;gap:5px;color:#98a6b8;font-size:9px}
    .vh-editor select{width:100%;background:#18212c;color:#e2e9f1;border:1px solid #354151;border-radius:6px;padding:7px;font-size:10px}
    .vh-canvas-wrap{width:min(100%,220px);margin:0 auto 8px;border:1px solid #38475a;border-radius:7px;overflow:hidden;background:#0a0e14;touch-action:none}
    #vhMaskCanvas{width:100%;height:auto;display:block;touch-action:none;cursor:crosshair}
    .vh-tool-row{display:flex;flex-wrap:wrap;gap:5px;margin:7px 0}
    .vh-tool-row button{flex:1 1 30%;border:1px solid #344153;background:#19222d;color:#cbd5e1;border-radius:6px;padding:7px 5px;font-size:9px}
    .vh-tool-row button.active{border-color:#c9f36a;color:#c9f36a;background:rgba(201,243,106,.08)}
    .vh-range-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}
    .vh-range-row input{width:100%}
    .vh-note{font-size:9px;line-height:1.5;color:#8290a2;margin:7px 0}
    .vh-status{font:9px 'DM Mono',monospace;line-height:1.5;color:#aecb77;min-height:16px;margin:5px 0}
    .vh-progress{height:5px;border-radius:10px;background:#273241;overflow:hidden;margin:7px 0}
    .vh-progress>span{display:block;height:100%;width:0;background:#c9f36a;transition:width .15s}
    #fitReferences{white-space:normal;line-height:1.3}
  `;
  document.head.appendChild(style);
}

function makeEditorUI(panel) {
  const row = document.createElement('div');
  row.className = 'vh-review-row';
  row.innerHTML = '<button class="vh-review-button" id="vhReviewToggle" type="button">Review / crop / mask views</button>';
  panel.querySelector('#fitReferences')?.insertAdjacentElement('beforebegin', row);

  const editor = document.createElement('div');
  editor.className = 'vh-editor';
  editor.id = 'vhEditor';
  editor.hidden = true;
  editor.innerHTML = `
    <div class="vh-editor-top">
      <label>Reference view<select id="vhViewSelect"></select></label>
      <label>Camera angle<select id="vhAngleSelect">${ANGLE_OPTIONS.map(angle => `<option value="${angle}">${angle}°</option>`).join('')}</select></label>
    </div>
    <div class="vh-canvas-wrap"><canvas id="vhMaskCanvas" width="${EDIT_W}" height="${EDIT_H}" aria-label="Silhouette mask editor"></canvas></div>
    <div class="vh-tool-row">
      <button id="vhAutoMask" type="button">Auto mask</button>
      <button id="vhCropMode" type="button">Crop panel</button>
      <button id="vhPaintMode" type="button">Paint</button>
      <button id="vhEraseMode" type="button">Erase</button>
      <button id="vhInvertMask" type="button">Invert</button>
      <button id="vhApplyCrop" type="button" disabled>Apply crop</button>
      <button id="vhClearMask" type="button">Clear mask</button>
      <button id="vhSaveMask" type="button">Save mask</button>
    </div>
    <div class="vh-range-row">
      <label>Background sensitivity <output id="vhThresholdOut">48</output><input id="vhThreshold" type="range" min="10" max="150" value="48"></label>
      <label>Brush size <output id="vhBrushOut">14</output><input id="vhBrush" type="range" min="4" max="36" value="14"></label>
    </div>
    <p class="vh-note">Green = kept character. Red = removed background. Crop a single turnaround panel first, then Auto mask. Paint/Erase to clean the silhouette. Each view must show the same pose from a different angle.</p>
    <div class="vh-status" id="vhEditorStatus">Choose a view to prepare its silhouette.</div>
  `;
  row.insertAdjacentElement('afterend', editor);
  return { row, editor };
}

function updateReferenceCard(reference) {
  const card = document.querySelector(`#referenceGrid [data-role="${CSS.escape(reference.role)}"]`);
  const image = card?.querySelector('img');
  if (image) image.src = reference.dataUrl;
}

function drawEditor(editorState) {
  const canvas = document.querySelector('#vhMaskCanvas');
  if (!canvas || !editorState?.image) return;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, EDIT_W, EDIT_H);
  context.drawImage(editorState.image, editorState.layout.x, editorState.layout.y, editorState.layout.width, editorState.layout.height);
  if (!editorState.maskReady) {
    if (editorState.mode === 'crop' && editorState.cropRect) {
      const r = editorState.cropRect;
      context.save(); context.strokeStyle = '#c9f36a'; context.lineWidth = 2; context.setLineDash([5, 3]);
      context.strokeRect(r.x, r.y, r.width, r.height); context.restore();
    }
    return;
  }
  const overlay = context.createImageData(EDIT_W, EDIT_H);
  for (let i = 0; i < editorState.mask.length; i++) {
    const p = i * 4;
    if (editorState.mask[i]) {
      overlay.data[p] = 105; overlay.data[p + 1] = 220; overlay.data[p + 2] = 105; overlay.data[p + 3] = 32;
    } else {
      overlay.data[p] = 245; overlay.data[p + 1] = 65; overlay.data[p + 2] = 65; overlay.data[p + 3] = 82;
    }
  }
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = EDIT_W; overlayCanvas.height = EDIT_H;
  overlayCanvas.getContext('2d').putImageData(overlay, 0, 0);
  context.drawImage(overlayCanvas, 0, 0);
  if (editorState.mode === 'crop' && editorState.cropRect) {
    const r = editorState.cropRect;
    context.save();
    context.strokeStyle = '#c9f36a'; context.lineWidth = 2; context.setLineDash([5, 3]);
    context.strokeRect(r.x, r.y, r.width, r.height);
    context.restore();
  }
}

function maskEditorLoad(reference, editorState, status) {
  return decodeImage(reference.dataUrl).then(image => {
    const source = document.createElement('canvas');
    source.width = EDIT_W; source.height = EDIT_H;
    const context = source.getContext('2d', { willReadFrequently: true });
    const layout = imageLayout(image);
    context.clearRect(0, 0, EDIT_W, EDIT_H);
    context.drawImage(image, layout.x, layout.y, layout.width, layout.height);
    let mask;
    if (reference.maskDataUrl) {
      return decodeImage(reference.maskDataUrl).then(maskImage => {
        const maskCanvas = document.createElement('canvas'); maskCanvas.width = EDIT_W; maskCanvas.height = EDIT_H;
        const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
        maskContext.drawImage(maskImage, 0, 0, EDIT_W, EDIT_H);
        const rgba = maskContext.getImageData(0, 0, EDIT_W, EDIT_H).data;
        mask = new Uint8Array(EDIT_W * EDIT_H);
        for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3] > 20 ? 1 : 0;
        editorState.image = image; editorState.layout = layout; editorState.mask = mask; editorState.reference = reference;
        editorState.maskReady = true; editorState.cropRect = null; editorState.mode = 'paint';
        drawEditor(editorState);
        status.textContent = `${reference.label || reference.role}: saved mask loaded.`;
      });
    }
    mask = new Uint8Array(EDIT_W * EDIT_H);
    editorState.image = image; editorState.layout = layout; editorState.mask = mask; editorState.reference = reference;
    editorState.maskReady = false; editorState.cropRect = null; editorState.mode = 'paint';
    drawEditor(editorState);
    status.textContent = `${reference.label || reference.role}: run Auto mask to isolate the character.`;
  });
}

function paintCircle(mask, x, y, radius, value) {
  const minX = Math.max(0, Math.floor(x - radius)), maxX = Math.min(EDIT_W - 1, Math.ceil(x + radius));
  const minY = Math.max(0, Math.floor(y - radius)), maxY = Math.min(EDIT_H - 1, Math.ceil(y + radius));
  const r2 = radius * radius;
  for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
    const dx = px - x, dy = py - y;
    if (dx * dx + dy * dy <= r2) mask[py * EDIT_W + px] = value;
  }
}

function makeManualMaskCanvas(mask) { return maskToDataUrl(mask); }

async function buildVisualHull(THREE, references, onProgress) {
  const requiredFront = references.some(reference => reference.role === 'front');
  const requiredSide = references.some(reference => reference.role === 'side');
  if (!requiredFront || !requiredSide) throw new Error('Upload separate Front and Side views first. A single picture cannot define a 3D volume.');
  if (references.length < 2) throw new Error('At least two different character views are required.');
  const views = [];
  for (let i = 0; i < references.length; i++) {
    const reference = references[i];
    const view = await analyseReference(reference, i, 48);
    views.push(view);
    if (!reference.maskDataUrl) reference.maskDataUrl = maskToDataUrl(view.mask);
    onProgress?.(0.08 * (i + 1) / references.length, `Preparing ${reference.label || reference.role} view…`);
  }
  const uniqueAngles = new Set(views.map(view => Math.round(view.angleDeg / 10) * 10));
  if (uniqueAngles.size < 2) throw new Error('Your view angles are duplicates. Set Front to 0°, Side to 90°, and assign the other angles in the mask editor.');
  const settings = getGridSettings();
  const grid = await buildOccupancy(views, settings, onProgress);
  await new Promise(resolve => requestAnimationFrame(resolve));
  const geometry = createSurfaceGeometry(THREE, grid, views, onProgress);
  onProgress?.(0.82, 'Binding the reconstructed surface to the humanoid rig…');
  geometry.userData.formaReconstruction.sourceViewCount = views.length;
  geometry.userData.formaReconstruction.angles = views.map(view => view.angleDeg);
  geometry.userData.formaReconstruction.boundary = 'visual-hull; unseen concave surfaces are not inferred';
  return geometry;
}

export function installVisualHullWorkflow(THREE, { state, getAvatars, onReconstructed }) {
  const panel = document.querySelector('.reference-panel');
  const originalFit = document.querySelector('#fitReferences');
  if (!panel || !originalFit || originalFit.dataset.visualHullInstalled === 'true') return;
  originalFit.dataset.visualHullInstalled = 'true';
  const fitButton = originalFit.cloneNode(true);
  fitButton.id = 'fitReferences';
  fitButton.textContent = 'Reconstruct 3D mesh from views';
  originalFit.replaceWith(fitButton);
  const { row, editor } = makeEditorUI(panel);
  installStyles();

  let editorState = { reference: null, image: null, layout: null, mask: new Uint8Array(EDIT_W * EDIT_H), mode: 'paint', cropRect: null, pointerStart: null };
  const viewSelect = editor.querySelector('#vhViewSelect');
  const angleSelect = editor.querySelector('#vhAngleSelect');
  const canvas = editor.querySelector('#vhMaskCanvas');
  const status = editor.querySelector('#vhEditorStatus');
  const threshold = editor.querySelector('#vhThreshold');
  const brush = editor.querySelector('#vhBrush');
  const progressWrap = document.createElement('div');
  progressWrap.className = 'vh-progress';
  progressWrap.innerHTML = '<span id="vhProgressBar"></span>';
  fitButton.insertAdjacentElement('afterend', progressWrap);
  const progressText = document.createElement('div');
  progressText.className = 'vh-status';
  progressText.id = 'vhProgressText';
  progressText.textContent = 'Upload and crop the same character from each angle. Clean masks before reconstruction for best results.';
  progressWrap.insertAdjacentElement('afterend', progressText);

  const refreshViewOptions = () => {
    const oldValue = viewSelect.value;
    viewSelect.innerHTML = '';
    state.references.forEach((reference, index) => {
      const option = document.createElement('option');
      option.value = reference.role;
      option.textContent = `${reference.label || reference.role} · ${defaultAngle(reference, index)}°`;
      viewSelect.appendChild(option);
    });
    if (state.references.some(reference => reference.role === oldValue)) viewSelect.value = oldValue;
    const selected = state.references.find(reference => reference.role === viewSelect.value) || state.references[0];
    if (selected) loadSelectedView(selected);
  };

  const loadSelectedView = reference => {
    if (!reference) return;
    angleSelect.value = String(defaultAngle(reference, state.references.indexOf(reference)));
    return maskEditorLoad(reference, editorState, status).catch(error => { status.textContent = error.message; });
  };

  viewSelect.addEventListener('change', () => {
    const reference = state.references.find(item => item.role === viewSelect.value);
    loadSelectedView(reference);
  });
  angleSelect.addEventListener('change', () => {
    if (!editorState.reference) return;
    editorState.reference.angleDeg = Number(angleSelect.value);
    status.textContent = `${editorState.reference.label || editorState.reference.role} assigned to ${angleSelect.value}°.`;
    refreshViewOptionsLabel();
  });
  function refreshViewOptionsLabel() {
    const selected = viewSelect.value;
    [...viewSelect.options].forEach(option => {
      const reference = state.references.find(item => item.role === option.value);
      if (reference) option.textContent = `${reference.label || reference.role} · ${defaultAngle(reference, state.references.indexOf(reference))}°`;
    });
    viewSelect.value = selected;
  }

  row.querySelector('#vhReviewToggle').addEventListener('click', () => {
    editor.hidden = !editor.hidden;
    if (!editor.hidden) refreshViewOptions();
  });
  threshold.addEventListener('input', () => { editor.querySelector('#vhThresholdOut').textContent = threshold.value; });
  brush.addEventListener('input', () => { editor.querySelector('#vhBrushOut').textContent = brush.value; });

  editor.querySelector('#vhAutoMask').addEventListener('click', () => {
    if (!editorState.image) return;
    const source = document.createElement('canvas'); source.width = EDIT_W; source.height = EDIT_H;
    const context = source.getContext('2d', { willReadFrequently: true });
    context.drawImage(editorState.image, editorState.layout.x, editorState.layout.y, editorState.layout.width, editorState.layout.height);
    const result = autoMaskFromPixels(context.getImageData(0, 0, EDIT_W, EDIT_H).data, EDIT_W, EDIT_H, Number(threshold.value));
    editorState.mask = result.mask;
    editorState.maskReady = true;
    editorState.reference.maskDataUrl = makeManualMaskCanvas(editorState.mask);
    drawEditor(editorState);
    try {
      const bounds = boundsOfMask(editorState.mask);
      status.textContent = `Auto mask ready · ${bounds.count.toLocaleString()} foreground pixels. Paint/erase or save.`;
    } catch (error) { status.textContent = error.message; }
  });

  const setMode = mode => {
    editorState.mode = mode;
    editorState.cropRect = null;
    ['vhCropMode', 'vhPaintMode', 'vhEraseMode'].forEach(id => editor.querySelector(`#${id}`).classList.toggle('active',
      (id === 'vhCropMode' && mode === 'crop') || (id === 'vhPaintMode' && mode === 'paint') || (id === 'vhEraseMode' && mode === 'erase')));
    editor.querySelector('#vhApplyCrop').disabled = true;
    status.textContent = mode === 'crop' ? 'Drag around one turnaround panel, then choose Apply crop.' : `${mode === 'erase' ? 'Erase background' : 'Paint character'} on the mask.`;
  };
  editor.querySelector('#vhCropMode').addEventListener('click', () => setMode('crop'));
  editor.querySelector('#vhPaintMode').addEventListener('click', () => setMode('paint'));
  editor.querySelector('#vhEraseMode').addEventListener('click', () => setMode('erase'));

  const pointerPoint = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width * EDIT_W, 0, EDIT_W - 1), y: clamp((event.clientY - rect.top) / rect.height * EDIT_H, 0, EDIT_H - 1) };
  };
  canvas.addEventListener('pointerdown', event => {
    if (!editorState.image) return;
    event.preventDefault(); canvas.setPointerCapture(event.pointerId);
    const point = pointerPoint(event);
    if (editorState.mode === 'crop') {
      editorState.pointerStart = point;
      editorState.cropRect = { x: point.x, y: point.y, width: 1, height: 1 };
    } else {
      editorState.pointerStart = point;
      editorState.maskReady = true;
      paintCircle(editorState.mask, point.x, point.y, Number(brush.value), editorState.mode === 'erase' ? 0 : 1);
    }
    drawEditor(editorState);
  });
  canvas.addEventListener('pointermove', event => {
    if (!editorState.pointerStart) return;
    const point = pointerPoint(event);
    if (editorState.mode === 'crop') {
      const start = editorState.pointerStart;
      editorState.cropRect = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) };
      editor.querySelector('#vhApplyCrop').disabled = editorState.cropRect.width < 8 || editorState.cropRect.height < 12;
    } else {
      editorState.maskReady = true;
      paintCircle(editorState.mask, point.x, point.y, Number(brush.value), editorState.mode === 'erase' ? 0 : 1);
    }
    drawEditor(editorState);
  });
  const finishPointer = () => {
    if (editorState.mode !== 'crop' && editorState.reference && editorState.mask) {
      editorState.reference.maskDataUrl = maskToDataUrl(editorState.mask);
      status.textContent = 'Mask edits auto-saved to this reference view.';
    }
    editorState.pointerStart = null;
  };
  canvas.addEventListener('pointerup', finishPointer);
  canvas.addEventListener('pointercancel', finishPointer);

  editor.querySelector('#vhApplyCrop').addEventListener('click', async () => {
    const rect = editorState.cropRect;
    if (!rect || !editorState.image || rect.width < 8 || rect.height < 12) return;
    const layout = editorState.layout;
    const left = clamp((rect.x - layout.x) / layout.scale, 0, editorState.image.naturalWidth);
    const top = clamp((rect.y - layout.y) / layout.scale, 0, editorState.image.naturalHeight);
    const right = clamp((rect.x + rect.width - layout.x) / layout.scale, 0, editorState.image.naturalWidth);
    const bottom = clamp((rect.y + rect.height - layout.y) / layout.scale, 0, editorState.image.naturalHeight);
    const cropWidth = Math.max(2, right - left), cropHeight = Math.max(2, bottom - top);
    const cropped = document.createElement('canvas');
    cropped.width = Math.round(cropWidth); cropped.height = Math.round(cropHeight);
    cropped.getContext('2d').drawImage(editorState.image, left, top, cropWidth, cropHeight, 0, 0, cropped.width, cropped.height);
    editorState.reference.dataUrl = cropped.toDataURL('image/png');
    editorState.reference.maskDataUrl = null;
    editorState.maskReady = false;
    updateReferenceCard(editorState.reference);
    await loadSelectedView(editorState.reference);
    status.textContent = 'Panel cropped. Run Auto mask, then save the mask.';
    setMode('paint');
  });

  editor.querySelector('#vhInvertMask').addEventListener('click', () => {
    if (!editorState.mask) return;
    editorState.maskReady = true;
    for (let i = 0; i < editorState.mask.length; i++) editorState.mask[i] = editorState.mask[i] ? 0 : 1;
    if (editorState.reference) editorState.reference.maskDataUrl = maskToDataUrl(editorState.mask);
    drawEditor(editorState);
    status.textContent = 'Mask inverted. Save only if the character is green and the background is red.';
  });
  editor.querySelector('#vhClearMask').addEventListener('click', () => {
    editorState.mask.fill(0); editorState.maskReady = true;
    if (editorState.reference) editorState.reference.maskDataUrl = maskToDataUrl(editorState.mask);
    drawEditor(editorState); status.textContent = 'Mask cleared. Use Paint to mark the character, or Auto mask.';
  });
  editor.querySelector('#vhSaveMask').addEventListener('click', () => {
    if (!editorState.reference) return;
    try {
      const bounds = boundsOfMask(editorState.mask);
      editorState.reference.maskDataUrl = maskToDataUrl(editorState.mask);
      status.textContent = `Saved silhouette · ${bounds.count.toLocaleString()} pixels. This mask will be used for 3D reconstruction.`;
    } catch (error) { status.textContent = error.message; }
  });

  fitButton.addEventListener('click', async () => {
    if (fitButton.disabled) return;
    fitButton.disabled = true;
    fitButton.textContent = 'Reconstructing actual 3D volume…';
    const bar = document.querySelector('#vhProgressBar');
    const setProgress = (value, message) => {
      if (bar) bar.style.width = `${Math.round(value * 100)}%`;
      progressText.textContent = `${Math.round(value * 100)}% · ${message}`;
    };
    try {
      const references = state.references;
      const geometry = await buildVisualHull(THREE, references, setProgress);
      onProgressComplete(setProgress);
      onReconstructed(geometry);
      const info = geometry.userData.formaReconstruction;
      progressText.textContent = `Complete · ${info.views.length} views · ${info.vertexCount.toLocaleString()} vertices · ${info.triangleCount.toLocaleString()} triangles.`;
      status.textContent = 'Reconstructed mesh applied to the character and its 22-bone rig.';
    } catch (error) {
      progressText.textContent = `Reconstruction stopped · ${error.message}`;
      status.textContent = error.message;
    } finally {
      fitButton.disabled = false;
      fitButton.textContent = 'Reconstruct 3D mesh from views';
    }
  });

  function onProgressComplete(setProgress) { setProgress(1, 'Reconstruction complete.'); }
  refreshViewOptions();

  // The main uploader rebuilds #referenceGrid after each image is selected.
  // Keep the angle selector in sync rather than requiring the user to close and
  // reopen the review panel before the new view becomes available.
  const referenceGrid = document.querySelector('#referenceGrid');
  if (referenceGrid && typeof MutationObserver !== 'undefined') {
    const referenceObserver = new MutationObserver(() => refreshViewOptions());
    referenceObserver.observe(referenceGrid, { childList: true });
  }
}
