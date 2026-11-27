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
const DEFAULT_ANGLES = { front: 0, side: 90, sideFacingLeft: 90, sideFacingRight: 270, sideOpposite: 270, back: 180, threeQuarter: 45 };
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
  const image = await decodeImage(reference.originalDataUrl || reference.dataUrl);
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
    reference, image, pixels: sourceImage.data, colourPixels: paddedColours(sourceImage.data, mask, EDIT_W, EDIT_H), mask, bounds,
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
  const source = view.colourPixels || view.pixels;
  return [source[i] / 255, source[i + 1] / 255, source[i + 2] / 255];
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
  const front = views.find(view => view.reference.role === 'front') || views.find(view => view.reference.role === 'back') || views[0];
  const sides = views.filter(view => ['sideFacingLeft','sideFacingRight','side','sideOpposite'].includes(view.reference.role));
  const sidePool = sides.length ? sides : views;
  const side = sidePool.reduce((best, view) => view.aspect > best.aspect ? view : best, sidePool[0]);
  const halfX = clamp(front.aspect * CHARACTER_HEIGHT * 0.5 * 1.045, 0.13, 0.82);
  const halfZ = clamp(side.aspect * CHARACTER_HEIGHT * 0.5 * 1.045, 0.10, 0.70);
  return { halfX, halfZ };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reconstruction quality. Pictures only describe the figure's OUTLINE from a few directions, so the raw silhouette volume is a
// blocky box: pasting the front picture on its front face and the side pictures on its side faces gives two faces, two
// torsos, extra arms. These steps make the pictures describe ONE shared surface instead:
//   1. roundCrossSections  - reshape every body part of every horizontal slice from a rectangle into a rounded super-ellipse;
//   2. paintSurface        - paint each surface point from the single best picture that can actually see it (no mixing);
//   3. keptFraction        - a picture whose pose differs from the rest is left out instead of carving the figure away.
// ---------------------------------------------------------------------------------------------------------------------
const CANONICAL_ROLES = ['front', 'back', 'side', 'sideFacingLeft', 'sideFacingRight', 'sideOpposite'];
const VIEW_CONSISTENCY = 0.96;

function roundCrossSections(grid, power = 2.4) {
  const { occupancy, nx, ny, nz, dx, dz } = grid;
  const label = new Int32Array(nx * nz), stack = new Int32Array(nx * nz), members = new Int32Array(nx * nz);
  const limb = new Uint8Array(occupancy.length);   // 1 = cell belongs to a thin part (arm, hand, neck)
  grid.limb = limb;
  let filled = 0;
  for (let y = 0; y < ny; y++) {
    label.fill(0);
    let nextLabel = 0;
    for (let z0 = 0; z0 < nz; z0++) {
      for (let x0 = 0; x0 < nx; x0++) {
        const start = z0 * nx + x0;
        if (label[start] || !occupancy[(z0 * ny + y) * nx + x0]) continue;
        nextLabel++;
        let top = 0, count = 0, minX = x0, maxX = x0, minZ = z0, maxZ = z0;
        stack[top++] = start; label[start] = nextLabel;
        while (top > 0) {
          const cell = stack[--top];
          members[count++] = cell;
          const cx = cell % nx, cz = (cell - cx) / nx;
          if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
          if (cz < minZ) minZ = cz; if (cz > maxZ) maxZ = cz;
          if (cx > 0 && !label[cell - 1] && occupancy[(cz * ny + y) * nx + cx - 1]) { label[cell - 1] = nextLabel; stack[top++] = cell - 1; }
          if (cx < nx - 1 && !label[cell + 1] && occupancy[(cz * ny + y) * nx + cx + 1]) { label[cell + 1] = nextLabel; stack[top++] = cell + 1; }
          if (cz > 0 && !label[cell - nx] && occupancy[((cz - 1) * ny + y) * nx + cx]) { label[cell - nx] = nextLabel; stack[top++] = cell - nx; }
          if (cz < nz - 1 && !label[cell + nx] && occupancy[((cz + 1) * ny + y) * nx + cx]) { label[cell + nx] = nextLabel; stack[top++] = cell + nx; }
        }
        const widthCells = maxX - minX + 1, depthCells = maxZ - minZ + 1;
        if (count < 8 || widthCells < 3 || depthCells < 3) { filled += count; continue; }
        const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2;
        const a = widthCells / 2;
        let b = depthCells / 2, thin = false;
        if (b * dz > 1.5 * a * dx) { b = (1.5 * a * dx) / dz; thin = true; } // thin parts (arms, neck) cannot be much deeper than they are wide
        for (let m = 0; m < count; m++) {
          const cell = members[m], cx = cell % nx, cz = (cell - cx) / nx;
          const u = Math.abs(cx - centerX) / a, v = Math.abs(cz - centerZ) / b;
          if (Math.pow(u, power) + Math.pow(v, power) > 1) occupancy[(cz * ny + y) * nx + cx] = 0;
          else { filled++; if (thin) limb[(cz * ny + y) * nx + cx] = 1; }
        }
      }
    }
  }
  return filled;
}

function keptFraction(grid, view) {
  const { occupancy, nx, ny, nz, halfX, halfZ, dx, dy, dz } = grid;
  let kept = 0, total = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (!occupancy[(z * ny + y) * nx + x]) continue;
    total++;
    if (insideView(view, -halfX + (x + 0.5) * dx, (y + 0.5) * dy, -halfZ + (z + 0.5) * dz)) kept++;
  }
  return total ? kept / total : 0;
}

function viewAtAngle(view, angleDeg) {
  return { ...view, angleDeg, direction: { x: Math.sin(radians(angleDeg)), z: Math.cos(radians(angleDeg)) } };
}

// Anti-aliased pixels along a picture's outline mix in the background colour; replace the outermost pixel ring with the colour just inside it.
function paddedColours(pixels, mask, width, height, erode = 3, search = 6) {
  const rows = new Uint8Array(width * height), inside = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let ok = 1;
    for (let k = -erode; k <= erode && ok; k++) { const xx = x + k; if (xx < 0 || xx >= width || !mask[y * width + xx]) ok = 0; }
    rows[y * width + x] = ok;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let ok = 1;
    for (let k = -erode; k <= erode && ok; k++) { const yy = y + k; if (yy < 0 || yy >= height || !rows[yy * width + x]) ok = 0; }
    inside[y * width + x] = ok;
  }
  const out = new Uint8ClampedArray(pixels);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!mask[i] || inside[i]) continue;
    let bestDistance = 1e9, bx = -1, by = -1;
    for (let dy = -search; dy <= search; dy++) for (let dx = -search; dx <= search; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || xx >= width || yy < 0 || yy >= height || !inside[yy * width + xx]) continue;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) { bestDistance = distance; bx = xx; by = yy; }
    }
    if (bx >= 0) { const s = (by * width + bx) * 4, o = i * 4; out[o] = pixels[s]; out[o + 1] = pixels[s + 1]; out[o + 2] = pixels[s + 2]; }
  }
  return out;
}

function smoothSample(view, x, y, z) {
  const theta = radians(view.angleDeg);
  const horizontal = x * Math.cos(theta) - z * Math.sin(theta);
  const px = view.bounds.minX + view.bounds.width / 2 + horizontal / CHARACTER_HEIGHT * view.bounds.height;
  const py = view.bounds.minY + (1 - y / CHARACTER_HEIGHT) * view.bounds.height;
  const nearestX = Math.round(px), nearestY = Math.round(py);
  if (nearestX < 0 || nearestX >= view.width || nearestY < 0 || nearestY >= view.height || !view.mask[nearestY * view.width + nearestX]) return null;
  const source = view.colourPixels || view.pixels;
  const x0 = Math.max(0, Math.min(view.width - 2, Math.floor(px))), y0 = Math.max(0, Math.min(view.height - 2, Math.floor(py)));
  const tx = Math.max(0, Math.min(1, px - x0)), ty = Math.max(0, Math.min(1, py - y0));
  const rgb = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = source[(y0 * view.width + x0) * 4 + c], b = source[(y0 * view.width + x0 + 1) * 4 + c];
    const d = source[((y0 + 1) * view.width + x0) * 4 + c], e = source[((y0 + 1) * view.width + x0 + 1) * 4 + c];
    rgb[c] = ((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty) / 255;
  }
  return rgb;
}

function paintSurface(geometry, grid, views) {
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), index = geometry.index.array;
  const count = position.count;
  const { occupancy, nx, ny, nz, halfX, halfZ, dx, dy, dz } = grid;
  const colors = new Float32Array(count * 3), known = new Uint8Array(count);
  const step = Math.min(dx, dz) * 0.9, reach = 2 * Math.max(halfX, halfZ) + 0.1;
  const solidAt = (x, y, z) => {
    const ix = Math.floor((x + halfX) / dx), iy = Math.floor(y / dy), iz = Math.floor((z + halfZ) / dz);
    return ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && occupancy[(iz * ny + iy) * nx + ix] === 1;
  };
  // A picture can only paint a point it can see: march from the point towards that picture's camera; solid volume in the way hides it.
  const canSee = (view, x, y, z, nxv, nyv, nzv) => {
    let px = x + nxv * 0.014, py = y + nyv * 0.014, pz = z + nzv * 0.014;
    const sx = view.direction.x * step, sz = view.direction.z * step;
    for (let travelled = 0; travelled < reach; travelled += step) {
      px += sx; pz += sz;
      if (solidAt(px, py, pz)) return false;
    }
    return true;
  };
  const candidates = [], limb = grid.limb;
  for (let i = 0; i < count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const nxv = normal.getX(i), nyv = normal.getY(i), nzv = normal.getZ(i);
    const lix = Math.floor((x - nxv * 0.008 + halfX) / dx), liy = Math.floor((y - nyv * 0.008) / dy), liz = Math.floor((z - nzv * 0.008 + halfZ) / dz);
    const isThin = !!limb && lix >= 0 && liy >= 0 && liz >= 0 && lix < nx && liy < ny && liz < nz && limb[(liz * ny + liy) * nx + lix] === 1;
    candidates.length = 0;
    for (const view of views) {
      if (isThin && view.reference.role !== 'front' && view.reference.role !== 'back') continue;
      const facing = nxv * view.direction.x + nzv * view.direction.z;
      if (facing <= 0.38) continue;
      const rgb = smoothSample(view, x, y, z);
      if (rgb) candidates.push({ facing, score: facing * (view.reference.role === 'front' || view.reference.role === 'back' ? 1 : 0.5), rgb, view });
    }
    if (!candidates.length) continue;
    candidates.sort((a, b) => b.score - a.score);
    let best = -1, total = 0, r = 0, g = 0, b2 = 0;
    for (const candidate of candidates) {
      if (best >= 0 && candidate.score < best - 0.18) break;            // only pictures that see it about equally well may blend (narrow seam)
      if (!canSee(candidate.view, x, y, z, nxv, nyv, nzv)) continue;
      if (best < 0) best = candidate.score;
      const weight = Math.pow(Math.max(0, 1 - (best - candidate.score) / 0.18), 2);
      total += weight;
      r += srgbToLinear(candidate.rgb[0]) * weight; g += srgbToLinear(candidate.rgb[1]) * weight; b2 += srgbToLinear(candidate.rgb[2]) * weight;
    }
    if (total > 0) { colors[i * 3] = r / total; colors[i * 3 + 1] = g / total; colors[i * 3 + 2] = b2 / total; known[i] = 1; }
  }
  // Points no picture could see (top of the head, inner legs, hidden folds) take the DOMINANT colour of the painted points near them:
  // one median colour per small cell of painted points, then the median of the nearby cells (thin outline strokes cannot smear into streaks).
  const P = position.array, cell = 0.03, hash = new Map();
  const keyOf = (x, y, z) => ((Math.floor(x / cell) + 512) * 1024 + (Math.floor(y / cell) + 512)) * 1024 + (Math.floor(z / cell) + 512);
  for (let i = 0; i < count; i++) {
    if (!known[i]) continue;
    const key = keyOf(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    const bucket = hash.get(key);
    if (bucket) bucket.push(i); else hash.set(key, [i]);
  }
  const reds = [], greens = [], blues = [];
  const middle = (list) => { list.sort((a, b) => a - b); return list[list.length >> 1]; };
  const cells = new Map();
  for (const [key, members] of hash) {
    reds.length = greens.length = blues.length = 0;
    for (const j of members) { reds.push(colors[j * 3]); greens.push(colors[j * 3 + 1]); blues.push(colors[j * 3 + 2]); }
    cells.set(key, { r: middle(reds), g: middle(greens), b: middle(blues), n: members.length });
  }
  for (let i = 0; i < count; i++) {
    if (known[i]) continue;
    const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let found = 0;
    reds.length = greens.length = blues.length = 0;
    for (const radius of [0.06, 0.1, 0.16, 0.3]) {
      const span = Math.ceil(radius / cell), limit = (radius + cell) * (radius + cell);
      for (let ix = -span; ix <= span; ix++) for (let iy = -span; iy <= span; iy++) for (let iz = -span; iz <= span; iz++) {
        const entry = cells.get(((cx + ix + 512) * 1024 + (cy + iy + 512)) * 1024 + (cz + iz + 512));
        if (!entry) continue;
        const ddx = (cx + ix + 0.5) * cell - x, ddy = (cy + iy + 0.5) * cell - y, ddz = (cz + iz + 0.5) * cell - z;
        if (ddx * ddx + ddy * ddy + ddz * ddz > limit) continue;
        reds.push(entry.r); greens.push(entry.g); blues.push(entry.b); found += entry.n;
      }
      if (found >= 8) break;
      reds.length = greens.length = blues.length = 0; found = 0;
    }
    if (!reds.length) { colors[i * 3] = 0.42; colors[i * 3 + 1] = 0.46; colors[i * 3 + 2] = 0.52; continue; }
    colors[i * 3] = middle(reds); colors[i * 3 + 1] = middle(greens); colors[i * 3 + 2] = middle(blues);
  }
  return colors;
}

async function buildOccupancy(views, settings, onProgress, options = {}) {
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
  if (filled >= 500 && options.round !== false) filled = roundCrossSections({ occupancy, nx, ny, nz, dx, dz });
  if (filled < 500) throw new Error('The view masks do not overlap into a usable 3D volume. Check the view angles, crops and masks.');
  return { occupancy, indexOf, nx, ny, nz, halfX, halfZ, dx, dy, dz, filled };
}

function createIsoSurfaceGeometry(THREE, grid, views, onProgress) {
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
      // Outside the grid counts as empty, so the volume always fades out before the edge and the surface closes
      // (mirroring the edge value left the top of the head open once the volume reached the top of the grid).
      const hasBefore = coordinate > 0, hasAfter = coordinate < limit - 1;
      const before = hasBefore ? coordinate - 1 : 0, after = hasAfter ? coordinate + 1 : limit - 1;
      const a = axis === 0 ? fieldIndex(before, y, z) : axis === 1 ? fieldIndex(x, before, z) : fieldIndex(x, y, before);
      const b = fieldIndex(x, y, z);
      const c = axis === 0 ? fieldIndex(after, y, z) : axis === 1 ? fieldIndex(x, after, z) : fieldIndex(x, y, after);
      output[b] = ((hasBefore ? input[a] : 0) + 2 * input[b] + (hasAfter ? input[c] : 0)) * 0.25;
    }
    return output;
  };
  for (let pass = 0; pass < 3; pass++) {
    field = blurAxis(field, 0);
    field = blurAxis(field, 1);
    field = blurAxis(field, 2);
  }
  for (let pass = 0; pass < 2; pass++) field = blurAxis(field, 1); // extra vertical smoothing hides slice-to-slice ridges

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
  const colors = paintSurface(geometry, grid, views);
  const uvs = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) { uvs[i*2]=(position.getX(i)+halfX)/(2*halfX); uvs[i*2+1]=position.getY(i)/CHARACTER_HEIGHT; }
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
}

function createSurfaceGeometry(THREE, grid, views, onProgress) {
  return createIsoSurfaceGeometry(THREE, grid, views, onProgress);
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
  return decodeImage(reference.originalDataUrl || reference.dataUrl).then(image => {
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
  const requiredSide = references.some(reference => ['sideFacingLeft','sideFacingRight','side','sideOpposite'].includes(reference.role));
  if (!requiredFront || !requiredSide) throw new Error('Upload a Front view and at least one Side view labelled facing left or facing right. Add both side views to capture asymmetry.');
  if (references.length < 2) throw new Error('At least two different character views are required.');
  const views = [];
  for (let i = 0; i < references.length; i++) {
    const reference = references[i];
    const view = await analyseReference(reference, i, 48);
    views.push(view);
    if (!reference.maskDataUrl) reference.maskDataUrl = maskToDataUrl(view.mask);
    onProgress?.(0.08 * (i + 1) / references.length, `Preparing ${reference.label || reference.role} view…`);
  }
  const canonical = views.filter(view => CANONICAL_ROLES.includes(view.reference.role));
  const extras = views.filter(view => !CANONICAL_ROLES.includes(view.reference.role));
  const uniqueAngles = new Set(canonical.map(view => Math.round(view.angleDeg / 10) * 10));
  if (uniqueAngles.size < 2) throw new Error('Your view angles are duplicates. Set Front to 0° and Side to 90°.');
  const settings = getGridSettings();
  const grid = await buildOccupancy(canonical, settings, onProgress, { round: false });
  // Front, side and back pictures define the volume. Any extra angle (3/4 etc.) must agree with that volume to be used, and then only
  // for colour: a picture with a different pose would otherwise carve parts of the figure away.
  const colourViews = [...canonical], ignoredViews = [];
  for (const extra of extras) {
    const assumed = extra.angleDeg;
    const options = [assumed, (360 - assumed) % 360].filter((angle, i, list) => list.indexOf(angle) === i);
    let best = null;
    for (const angle of options) {
      const candidate = viewAtAngle(extra, angle), consistency = keptFraction(grid, candidate);
      if (!best || consistency > best.consistency) best = { candidate, consistency, angle };
    }
    if (best.consistency >= VIEW_CONSISTENCY) { extra.reference.angleDeg = best.angle; colourViews.push(best.candidate); }
    else ignoredViews.push({ role: extra.reference.role, label: extra.reference.label || extra.reference.role, consistency: Number(best.consistency.toFixed(3)) });
  }
  onProgress?.(0.6, 'Rounding the blocky silhouette volume into body-like cross-sections…');
  grid.filled = roundCrossSections(grid);
  if (grid.filled < 500) throw new Error('The view masks do not overlap into a usable 3D volume. Check the view angles, crops and masks.');
  await new Promise(resolve => requestAnimationFrame(resolve));
  const geometry = createSurfaceGeometry(THREE, grid, colourViews, onProgress);
  onProgress?.(0.82, 'Binding the reconstructed surface to the humanoid rig…');
  const info = geometry.userData.formaReconstruction;
  info.sourceViewCount = views.length;
  info.angles = colourViews.map(view => view.angleDeg);
  info.ignoredViews = ignoredViews;
  info.surfaceColour = 'one best picture per surface point (no blending across pictures)';
  info.boundary = 'rounded visual hull; unseen concave surfaces are not inferred';
  return geometry;
}

export function installVisualHullWorkflow(THREE, { state, onReconstructed, notify }) {
  const panel = document.querySelector('.reference-panel');
  const originalFit = document.querySelector('#fitReferences');
  if (!panel || !originalFit || originalFit.dataset.visualHullInstalled === 'true') return;
  originalFit.dataset.visualHullInstalled = 'true';
  const fitButton = originalFit.cloneNode(true);
  fitButton.id = 'fitReferences';
  fitButton.textContent = 'Reconstruct 3D character mesh';
  originalFit.replaceWith(fitButton);

  if (!document.querySelector('#vhAutoCutoutStyles')) {
    const style = document.createElement('style');
    style.id = 'vhAutoCutoutStyles';
    style.textContent = '.vh-auto-cutout-note{font-size:10px;color:#a8b6c5;margin:8px 0;padding:8px 10px;border:1px solid #354151;border-radius:8px;background:#111a24}.vh-progress{height:5px;border-radius:10px;background:#273241;overflow:hidden;margin:8px 0}.vh-progress>span{display:block;height:100%;width:0;background:#c9f36a;transition:width .15s}.vh-status{font:9px monospace;line-height:1.5;color:#aecb77;min-height:16px;margin:5px 0}';
    document.head.appendChild(style);
  }
  const autoNote = document.createElement('div');
  autoNote.className = 'vh-auto-cutout-note';
  autoNote.textContent = 'Background removal: automatic · Front + either side direction; add both sides for asymmetry.';
  fitButton.insertAdjacentElement('beforebegin', autoNote);
  const progressWrap = document.createElement('div');
  progressWrap.className = 'vh-progress';
  progressWrap.innerHTML = '<span id="vhProgressBar"></span>';
  fitButton.insertAdjacentElement('afterend', progressWrap);
  const progressText = document.createElement('div');
  progressText.className = 'vh-status';
  progressText.id = 'vhProgressText';
  progressText.textContent = 'Add a Front view and at least one Side (facing left or right) view. Add the opposite side when the character is asymmetrical.';
  progressWrap.insertAdjacentElement('afterend', progressText);

  fitButton.addEventListener('click', async () => {
    if (fitButton.disabled) return;
    fitButton.disabled = true;
    fitButton.textContent = 'Reconstructing rounded 3D surface…';
    const bar = document.querySelector('#vhProgressBar');
    const setProgress = (value, message) => {
      if (bar) bar.style.width = `${Math.round(value * 100)}%`;
      progressText.textContent = `${Math.round(value * 100)}% · ${message}`;
    };
    try {
      const geometry = await buildVisualHull(THREE, state.references, setProgress);
      onReconstructed(geometry);
      const info = geometry.userData.formaReconstruction;
      const left = (info.ignoredViews || []).map(item => item.label);
      const leftNote = left.length ? ` · Left out: ${left.join(', ')} (its pose does not match the other pictures)` : '';
      setProgress(1, `Complete · ${info.views.length} pictures used · ${info.vertexCount.toLocaleString()} vertices · ${info.triangleCount.toLocaleString()} triangles${leftNote}.`);
      notify?.(left.length ? `Reconstructed. Left out ${left.join(', ')}: its pose does not match the other pictures, so it would have cut parts of the figure away.` : 'Rounded 3D surface reconstructed and bound to the character rig. Review the silhouette in the viewport.', 'success', 8000);
    } catch (error) {
      progressText.textContent = `Reconstruction stopped · ${error.message}`;
      notify?.(error.message || 'Could not reconstruct this character.', 'error', 6500);
    } finally {
      fitButton.disabled = false;
      fitButton.textContent = 'Reconstruct 3D character mesh';
    }
  });
}