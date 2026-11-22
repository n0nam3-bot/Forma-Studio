/**
 * Lightweight browser-local background removal for reference images.
 * Best results are obtained with a plain/softly varying background or an
 * already-transparent PNG. This is deterministic colour segmentation, not an
 * online AI service; difficult photographic backgrounds may need refinement.
 */
const PREVIEW_W = 288;
const PREVIEW_H = 432;
const MAX_ANALYSIS_EDGE = 840;
const MAX_SOURCE_EDGE = 1800;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read this reference image.'));
    image.src = dataUrl;
  });
}

function median(values) {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function borderSamples(data, width, height) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 90));
  const add = (x, y) => {
    const i = (y * width + x) * 4;
    samples.push([data[i], data[i + 1], data[i + 2], data[i + 3]]);
  };
  for (let x = 0; x < width; x += step) {
    for (let offset = 0; offset < 3; offset++) {
      add(x, Math.min(height - 1, offset));
      add(x, Math.max(0, height - 1 - offset));
    }
  }
  for (let y = step; y < height - step; y += step) {
    for (let offset = 0; offset < 3; offset++) {
      add(Math.min(width - 1, offset), y);
      add(Math.max(0, width - 1 - offset), y);
    }
  }
  return samples;
}

function segmentBackground(data, width, height) {
  const count = width * height;
  const edges = borderSamples(data, width, height);
  const transparentEdges = edges.filter(pixel => pixel[3] < 30).length / Math.max(1, edges.length);
  const mask = new Uint8Array(count);

  // Transparent source images already contain a trustworthy alpha channel.
  if (transparentEdges > 0.35) {
    let kept = 0;
    for (let i = 0; i < count; i++) {
      const alpha = data[i * 4 + 3];
      mask[i] = alpha > 32 ? 1 : 0;
      kept += mask[i];
    }
    return { mask, kept, removed: count - kept, mode: 'source alpha' };
  }

  const opaqueEdges = edges.filter(pixel => pixel[3] > 24);
  const background = [0, 1, 2].map(channel => median(opaqueEdges.map(pixel => pixel[channel])));
  const edgeDistances = opaqueEdges.map(pixel => {
    const dr = pixel[0] - background[0];
    const dg = pixel[1] - background[1];
    const db = pixel[2] - background[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  });
  // Adapt tolerance to gentle gradients while limiting over-removal around
  // similarly coloured hair, skin, clothing and accessories.
  const tolerance = clamp(median(edgeDistances) * 2.1 + 34, 38, 86);
  const toleranceSq = tolerance * tolerance;
  const candidate = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    if (data[p + 3] < 24) {
      candidate[i] = 1;
      continue;
    }
    const dr = data[p] - background[0];
    const dg = data[p + 1] - background[1];
    const db = data[p + 2] - background[2];
    candidate[i] = dr * dr + dg * dg + db * db <= toleranceSq ? 1 : 0;
  }

  // Flood-fill only background-coloured pixels connected to the image border.
  // This preserves similarly coloured details enclosed by the character.
  const visited = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  const push = index => {
    if (visited[index] || !candidate[index]) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) push(index - 1);
    if (x + 1 < width) push(index + 1);
    if (y > 0) push(index - width);
    if (y + 1 < height) push(index + width);
  }

  let kept = 0;
  for (let i = 0; i < count; i++) {
    const alpha = data[i * 4 + 3];
    mask[i] = !visited[i] && alpha > 24 ? 1 : 0;
    kept += mask[i];
  }
  return { mask, kept, removed: count - kept, mode: 'edge-connected background' };
}

function makeMaskCanvas(mask, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4;
    image.data[p] = 255;
    image.data[p + 1] = 255;
    image.data[p + 2] = 255;
    image.data[p + 3] = mask[i] ? 255 : 0;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function makePreviewMask(maskCanvas, width, height) {
  const preview = document.createElement('canvas');
  preview.width = PREVIEW_W;
  preview.height = PREVIEW_H;
  const context = preview.getContext('2d');
  const scale = Math.min((PREVIEW_W - 12) / width, (PREVIEW_H - 12) / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(maskCanvas, (PREVIEW_W - drawWidth) / 2, (PREVIEW_H - drawHeight) / 2, drawWidth, drawHeight);
  return preview.toDataURL('image/png');
}

/** Returns a transparent preview, reusable original and alpha mask. */
export async function autoCutoutDataUrl(originalDataUrl) {
  try {
    const image = await loadImage(originalDataUrl);
    const scale = Math.min(1, MAX_ANALYSIS_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const analysis = document.createElement('canvas');
    analysis.width = width;
    analysis.height = height;
    const analysisContext = analysis.getContext('2d', { willReadFrequently: true });
    analysisContext.drawImage(image, 0, 0, width, height);
    const pixels = analysisContext.getImageData(0, 0, width, height).data;
    const result = segmentBackground(pixels, width, height);
    const ratio = result.kept / Math.max(1, width * height);

    // Do not silently destroy an image when the segmentation has no credible
    // foreground/background separation. The existing mask editor remains usable.
    if (ratio < 0.015 || ratio > 0.94) {
      return {
        dataUrl: originalDataUrl,
        originalDataUrl,
        maskDataUrl: null,
        removedPixels: 0,
        mode: 'needs manual refinement',
      };
    }

    const sourceScale = Math.min(1, MAX_SOURCE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const sourceWidth = Math.max(1, Math.round(image.naturalWidth * sourceScale));
    const sourceHeight = Math.max(1, Math.round(image.naturalHeight * sourceScale));
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = sourceWidth;
    sourceCanvas.height = sourceHeight;
    const sourceContext = sourceCanvas.getContext('2d');
    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = 'high';
    sourceContext.drawImage(image, 0, 0, sourceWidth, sourceHeight);
    const sourceHasAlpha = result.mode === 'source alpha';
    const compactOriginal = sourceCanvas.toDataURL(sourceHasAlpha ? 'image/webp' : 'image/jpeg', 0.92);
    const lowResMask = makeMaskCanvas(result.mask, width, height);

    const fullMask = document.createElement('canvas');
    fullMask.width = sourceWidth;
    fullMask.height = sourceHeight;
    const fullMaskContext = fullMask.getContext('2d');
    fullMaskContext.imageSmoothingEnabled = true;
    fullMaskContext.imageSmoothingQuality = 'high';
    fullMaskContext.filter = 'blur(0.65px)';
    fullMaskContext.drawImage(lowResMask, 0, 0, fullMask.width, fullMask.height);
    fullMaskContext.filter = 'none';

    const output = document.createElement('canvas');
    output.width = sourceWidth;
    output.height = sourceHeight;
    const outputContext = output.getContext('2d');
    outputContext.drawImage(sourceCanvas, 0, 0);
    outputContext.globalCompositeOperation = 'destination-in';
    outputContext.drawImage(fullMask, 0, 0);
    outputContext.globalCompositeOperation = 'source-over';

    return {
      dataUrl: output.toDataURL('image/webp', 0.94),
      originalDataUrl: compactOriginal,
      maskDataUrl: makePreviewMask(lowResMask, width, height),
      removedPixels: result.removed,
      mode: result.mode,
    };
  } catch (error) {
    console.warn('Automatic reference background removal skipped:', error);
    return {
      dataUrl: originalDataUrl,
      originalDataUrl,
      maskDataUrl: null,
      removedPixels: 0,
      mode: 'needs manual refinement',
    };
  }
}
