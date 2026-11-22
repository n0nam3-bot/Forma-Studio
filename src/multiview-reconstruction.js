/**
 * Two-view character fitting for Forma Studio.
 *
 * This is a local, image-derived mesh fitting method: front/side silhouettes
 * drive per-height cross-section deformation, and the photographs are
 * projected into vertex colours on the actual skinned surface. No photo planes
 * are created or exported. It is not Gaussian splatting or neural image-to-3D.
 */
const CANVAS_WIDTH = 192;
const CANVAS_HEIGHT = 320;
const PROFILE_SAMPLES = 160;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function decodeImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A reference image could not be decoded. Try a PNG, JPG or WebP image.'));
    image.src = dataUrl;
  });
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))];
}

async function analyseView(reference) {
  const image = await decodeImage(reference.dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser could not create an image-analysis canvas.');

  const scale = Math.min((CANVAS_WIDTH - 16) / image.naturalWidth, (CANVAS_HEIGHT - 16) / image.naturalHeight);
  const drawWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const drawHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const offsetX = Math.round((CANVAS_WIDTH - drawWidth) / 2);
  const offsetY = Math.round((CANVAS_HEIGHT - drawHeight) / 2);
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
  const pixels = context.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  const rgba = pixels.data;

  const border = [];
  const stride = 3;
  for (let x = 0; x < CANVAS_WIDTH; x += stride) {
    for (const y of [0, CANVAS_HEIGHT - 1]) {
      const p = (y * CANVAS_WIDTH + x) * 4;
      border.push([rgba[p], rgba[p + 1], rgba[p + 2], rgba[p + 3]]);
    }
  }
  for (let y = 0; y < CANVAS_HEIGHT; y += stride) {
    for (const x of [0, CANVAS_WIDTH - 1]) {
      const p = (y * CANVAS_WIDTH + x) * 4;
      border.push([rgba[p], rgba[p + 1], rgba[p + 2], rgba[p + 3]]);
    }
  }

  const transparent = border.filter(pixel => pixel[3] < 48).length > border.length * 0.55;
  const background = [0, 0, 0];
  if (!transparent) {
    background[0] = percentile(border.map(p => p[0]), 0.5);
    background[1] = percentile(border.map(p => p[1]), 0.5);
    background[2] = percentile(border.map(p => p[2]), 0.5);
  }

  const mask = new Uint8Array(CANVAS_WIDTH * CANVAS_HEIGHT);
  let minX = CANVAS_WIDTH, minY = CANVAS_HEIGHT, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < CANVAS_HEIGHT; y++) {
    for (let x = 0; x < CANVAS_WIDTH; x++) {
      const pixel = (y * CANVAS_WIDTH + x) * 4;
      const alpha = rgba[pixel + 3];
      if (alpha < 38) continue;
      let foreground;
      if (transparent) foreground = alpha > 96;
      else {
        const dr = rgba[pixel] - background[0];
        const dg = rgba[pixel + 1] - background[1];
        const db = rgba[pixel + 2] - background[2];
        foreground = Math.sqrt(dr * dr + dg * dg + db * db) > 34;
      }
      if (!foreground) continue;
      mask[y * CANVAS_WIDTH + x] = 1;
      count++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }

  const bboxWidth = maxX - minX + 1;
  const bboxHeight = maxY - minY + 1;
  const imageArea = CANVAS_WIDTH * CANVAS_HEIGHT;
  if (bboxWidth < 12 || bboxHeight < 60 || count < imageArea * 0.004 || count > imageArea * 0.88) {
    throw new Error(`${reference.label || reference.role} view could not be separated from its background. Use a full-body image with a plain, contrasting background.`);
  }

  const rawProfile = new Float32Array(PROFILE_SAMPLES);
  for (let row = 0; row < PROFILE_SAMPLES; row++) {
    const y0 = minY + Math.floor((row / PROFILE_SAMPLES) * bboxHeight);
    const y1 = Math.min(maxY, minY + Math.ceil(((row + 1) / PROFILE_SAMPLES) * bboxHeight));
    const xs = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (mask[y * CANVAS_WIDTH + x]) xs.push(x);
      }
    }
    if (xs.length >= 2) {
      const left = percentile([...xs], 0.03);
      const right = percentile([...xs], 0.97);
      rawProfile[row] = Math.max(0.008, (right - left + 1) / (2 * bboxHeight));
    }
  }

  // Fill rows that were empty between separated body parts, then smooth the profile.
  for (let i = 0; i < rawProfile.length; i++) {
    if (rawProfile[i] > 0) continue;
    let before = i - 1, after = i + 1;
    while (before >= 0 && rawProfile[before] <= 0) before--;
    while (after < rawProfile.length && rawProfile[after] <= 0) after++;
    if (before >= 0 && after < rawProfile.length) {
      const t = (i - before) / (after - before);
      rawProfile[i] = rawProfile[before] * (1 - t) + rawProfile[after] * t;
    } else rawProfile[i] = rawProfile[before >= 0 ? before : after] || 0.02;
  }
  const profile = new Float32Array(PROFILE_SAMPLES);
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    let sum = 0, samples = 0;
    for (let j = Math.max(0, i - 3); j <= Math.min(PROFILE_SAMPLES - 1, i + 3); j++) {
      sum += rawProfile[j]; samples++;
    }
    profile[i] = sum / samples;
  }

  return {
    role: reference.role,
    label: reference.label || reference.role,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    pixels: rgba,
    mask,
    profile,
    bounds: { minX, minY, maxX, maxY, width: bboxWidth, height: bboxHeight },
    aspect: bboxWidth / bboxHeight,
    confidence: clamp(0.55 + (count / imageArea) * 0.75 + (bboxHeight / CANVAS_HEIGHT) * 0.12, 0.45, 0.94),
  };
}

export async function prepareTwoViewFit(references) {
  const frontRef = references.find(item => item.role === 'front');
  const sideRef = references.find(item => item.role === 'side');
  if (!frontRef || !sideRef) throw new Error('A front and a side reference are both required for two-view fitting.');
  const [front, side, back] = await Promise.all([
    analyseView(frontRef),
    analyseView(sideRef),
    references.some(item => item.role === 'back') ? analyseView(references.find(item => item.role === 'back')) : Promise.resolve(null),
  ]);
  return { front, side, back, method: 'two-view-silhouette-and-projection', createdAt: Date.now() };
}

function sampleProfile(profile, t) {
  const index = clamp(t, 0, 1) * (profile.length - 1);
  const low = Math.floor(index), high = Math.min(profile.length - 1, low + 1);
  const blend = index - low;
  return profile[low] * (1 - blend) + profile[high] * blend;
}

function smoothArray(values, radius = 3) {
  const output = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      sum += values[j]; count++;
    }
    output[i] = sum / count;
  }
  return output;
}

function imageSample(view, u, t) {
  if (!view) return null;
  const x = clamp(Math.round(view.bounds.minX + clamp(u, 0, 1) * (view.bounds.width - 1)), 0, view.width - 1);
  const y = clamp(Math.round(view.bounds.minY + clamp(1 - t, 0, 1) * (view.bounds.height - 1)), 0, view.height - 1);
  const index = y * view.width + x;
  if (!view.mask[index]) return null;
  const p = index * 4;
  return [view.pixels[p] / 255, view.pixels[p + 1] / 255, view.pixels[p + 2] / 255];
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function mixProjection(frontColor, sideColor, backColor, normal, fallback) {
  const weights = [];
  if (frontColor && normal.z > 0.05) weights.push([frontColor, Math.pow(normal.z, 2.2)]);
  if (backColor && normal.z < -0.05) weights.push([backColor, Math.pow(-normal.z, 2.2)]);
  if (!backColor && frontColor && normal.z < -0.05) weights.push([[frontColor[0], frontColor[1], frontColor[2]], Math.pow(-normal.z, 1.0) * 0.25]);
  if (sideColor && Math.abs(normal.x) > 0.05) weights.push([sideColor, Math.pow(Math.abs(normal.x), 2.2)]);
  if (!weights.length) return fallback;
  let total = 0;
  const result = [0, 0, 0];
  for (const [color, weight] of weights) {
    total += weight;
    result[0] += color[0] * weight;
    result[1] += color[1] * weight;
    result[2] += color[2] * weight;
  }
  if (total < 1e-5) return fallback;
  return result.map(value => srgbToLinear(value / total));
}

/** Apply actual mesh deformation and photo-derived vertex colour to a skinned avatar. */
export function applyTwoViewFit(THREE, avatar, fit) {
  if (!avatar?.mesh?.geometry || !fit?.front || !fit?.side) return false;
  const geometry = avatar.mesh.geometry;
  const position = geometry.getAttribute('position');
  if (!position?.count) return false;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const modelHeight = Math.max(0.1, box.max.y - box.min.y);
  const bins = PROFILE_SAMPLES;
  const currentX = new Float32Array(bins);
  const currentZ = new Float32Array(bins);
  const vertexBins = new Uint16Array(position.count);
  const vertexT = new Float32Array(position.count);

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const t = clamp((y - box.min.y) / modelHeight, 0, 1);
    const bin = Math.min(bins - 1, Math.floor(t * (bins - 1)));
    vertexBins[i] = bin;
    vertexT[i] = t;
    currentX[bin] = Math.max(currentX[bin], Math.abs(position.getX(i)));
    currentZ[bin] = Math.max(currentZ[bin], Math.abs(position.getZ(i)));
  }

  const fillMissing = values => {
    for (let i = 0; i < values.length; i++) {
      if (values[i] > 1e-4) continue;
      let before = i - 1, after = i + 1;
      while (before >= 0 && values[before] <= 1e-4) before--;
      while (after < values.length && values[after] <= 1e-4) after++;
      if (before >= 0 && after < values.length) {
        const t = (i - before) / (after - before);
        values[i] = values[before] * (1 - t) + values[after] * t;
      } else values[i] = values[before >= 0 ? before : after] || 0.08;
    }
  };
  fillMissing(currentX); fillMissing(currentZ);

  const desiredX = new Float32Array(bins);
  const desiredZ = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    const t = i / (bins - 1);
    desiredX[i] = Math.max(0.025, sampleProfile(fit.front.profile, t) * modelHeight);
    desiredZ[i] = Math.max(0.025, sampleProfile(fit.side.profile, t) * modelHeight);
  }
  const scaleX = smoothArray(Float32Array.from(desiredX, (value, i) => clamp(value / Math.max(currentX[i], 0.01), 0.48, 2.15)), 2);
  const scaleZ = smoothArray(Float32Array.from(desiredZ, (value, i) => clamp(value / Math.max(currentZ[i], 0.01), 0.42, 2.35)), 2);

  // Move the rest skeleton by the same per-height profile so its joints remain
  // aligned with the fitted surface before refreshing the inverse bind matrices.
  avatar.root.updateMatrixWorld(true);
  const restBoneWorld = avatar.bones.map(bone => ({
    bone,
    position: bone.getWorldPosition(new THREE.Vector3()),
  }));
  for (const item of restBoneWorld) {
    const t = clamp((item.position.y - box.min.y) / modelHeight, 0, 1);
    const bin = Math.min(bins - 1, Math.floor(t * (bins - 1)));
    const fittedWorld = new THREE.Vector3(
      item.position.x * scaleX[bin],
      item.position.y,
      item.position.z * scaleZ[bin],
    );
    if (item.bone.parent) item.bone.position.copy(item.bone.parent.worldToLocal(fittedWorld));
    else item.bone.position.copy(fittedWorld);
    avatar.root.updateMatrixWorld(true);
  }

  // This changes the vertex positions of the real character mesh; it does not add image planes.
  for (let i = 0; i < position.count; i++) {
    const bin = vertexBins[i];
    position.setX(i, position.getX(i) * scaleX[bin]);
    position.setZ(i, position.getZ(i) * scaleZ[bin]);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const normals = geometry.getAttribute('normal');
  const colors = geometry.getAttribute('color');
  const output = colors?.array || new Float32Array(position.count * 3);
  const fallback = [0.45, 0.48, 0.52];
  for (let i = 0; i < position.count; i++) {
    const bin = vertexBins[i];
    const t = vertexT[i];
    const x = position.getX(i), z = position.getZ(i);
    const halfX = Math.max(0.025, desiredX[bin]);
    const halfZ = Math.max(0.025, desiredZ[bin]);
    const frontColor = imageSample(fit.front, 0.5 + x / (2 * halfX), t);
    const sideColor = imageSample(fit.side, 0.5 + z / (2 * halfZ), t);
    const backColor = imageSample(fit.back, 0.5 + x / (2 * halfX), t);
    const normal = {x:normals.getX(i),y:normals.getY(i),z:normals.getZ(i)};
    const base = colors ? [colors.getX(i), colors.getY(i), colors.getZ(i)] : fallback;
    const color = mixProjection(frontColor, sideColor, backColor, normal, base);
    output[i * 3] = color[0]; output[i * 3 + 1] = color[1]; output[i * 3 + 2] = color[2];
  }
  if (colors) colors.needsUpdate = true;
  else geometry.setAttribute('color', new THREE.Float32BufferAttribute(output, 3));

  avatar.root.updateMatrixWorld(true);
  avatar.skeleton.calculateInverses();
  avatar.mesh.bind(avatar.skeleton);
  avatar.helper?.update?.();

  geometry.userData.formaReconstruction = {
    method: 'two-view silhouette deformation + projective vertex colour',
    frontConfidence: fit.front.confidence,
    sideConfidence: fit.side.confidence,
    photosBakedIntoGeometry: true,
  };
  avatar.root.userData.formaReconstruction = geometry.userData.formaReconstruction;
  avatar.mesh.material.vertexColors = true;
  avatar.mesh.material.needsUpdate = true;
  return true;
}
