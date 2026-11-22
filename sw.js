// Forma Studio reconstruction patch layer. The pinned v9 service worker keeps
// the existing offline cache, WebGL fallbacks, cutout workflow and model wiring.
// This layer only adjusts the visual-hull constraints and versioned imports.
const BASE_SW_CANDIDATES = [
  'https://cdn.jsdelivr.net/gh/n0nam3-bot/Forma-Studio@d25746b237644936a99c0deb3436ea07ad4f9e3f/sw.js',
  'https://fastly.jsdelivr.net/gh/n0nam3-bot/Forma-Studio@d25746b237644936a99c0deb3436ea07ad4f9e3f/sw.js',
  'https://gcore.jsdelivr.net/gh/n0nam3-bot/Forma-Studio@d25746b237644936a99c0deb3436ea07ad4f9e3f/sw.js',
];
let baseLoaded = false;
let baseLoadError = null;
for (const url of BASE_SW_CANDIDATES) {
  try { importScripts(url); baseLoaded = true; break; }
  catch (error) { baseLoadError = error; }
}
if (!baseLoaded) throw baseLoadError || new Error('Forma Studio base worker could not be loaded.');

// Precache the newly versioned modules. APP_FILES is intentionally the same
// mutable array used by the imported worker's existing install handler.
APP_FILES.push('./src/visual-hull.js?v=10', './src/reference-cutout.js?v=10');

const patchVisualHullModuleV9 = patchVisualHullModule;
patchVisualHullModule = function (source) {
  source = patchVisualHullModuleV9(source);

  // Keep 3/4 views as tolerant, secondary constraints. Front and labelled side
  // views remain authoritative for limb placement and anatomical proportions.
  const auxiliaryMarker = "  const auxiliaryViews = views.filter(view => view !== front && !sideViews.includes(view));";
  const auxiliaryReplacement = `  const obliqueViews = views.filter(view => {
    if (view === front || sideViews.includes(view) || view.reference.role === 'back') return false;
    if (view.reference.role === 'threeQuarter') return true;
    const angle = ((Number(view.angleDeg) % 90) + 90) % 90;
    return angle > 18 && angle < 72;
  });
  const auxiliaryViews = views.filter(view => view !== front && !sideViews.includes(view) && !obliqueViews.includes(view));

  // Distance-to-foreground maps let a 3/4 view refine contour shape without
  // destroying parts because its crop or perspective is slightly different.
  const obliqueTolerance = 10;
  const obliqueDistance = new Map();
  for (const view of obliqueViews) {
    const distance = new Uint8Array(view.mask.length);
    distance.fill(255);
    const queue = new Int32Array(view.mask.length);
    let head = 0, tail = 0;
    for (let i = 0; i < view.mask.length; i++) {
      if (view.mask[i]) { distance[i] = 0; queue[tail++] = i; }
    }
    while (head < tail) {
      const index = queue[head++];
      const nextDistance = distance[index] + 1;
      if (nextDistance > obliqueTolerance) continue;
      const px = index % view.width;
      const py = Math.floor(index / view.width);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const x = px + ox, y = py + oy;
        if (x < 0 || x >= view.width || y < 0 || y >= view.height) continue;
        const target = y * view.width + x;
        if (distance[target] <= nextDistance) continue;
        distance[target] = nextDistance;
        queue[tail++] = target;
      }
    }
    obliqueDistance.set(view, distance);
  }
  const insideOblique = (view, x, y, z) => {
    const pixel = projectedPixel(view, x, y, z);
    if (pixel.x < 0 || pixel.x >= view.width || pixel.y < 0 || pixel.y >= view.height) return false;
    return obliqueDistance.get(view)[pixel.y * view.width + pixel.x] <= obliqueTolerance;
  };`;
  if (!source.includes('const obliqueTolerance = 10')) {
    if (!source.includes(auxiliaryMarker)) throw new Error('Forma patch: missing auxiliary view marker');
    source = source.replace(auxiliaryMarker, auxiliaryReplacement);
  }

  const sideConstraintMarker = `        if (inside) {
          // A side camera constrains only the lateral half it physically sees.`;
  const sideConstraintReplacement = `        if (inside) for (const view of obliqueViews) {
          if (!insideOblique(view, worldX, worldY, worldZ)) { inside = false; break; }
        }
        if (inside) {
          // A side camera constrains only the lateral half it physically sees.`;
  if (!source.includes('insideOblique(view, worldX, worldY, worldZ)')) {
    if (!source.includes(sideConstraintMarker)) throw new Error('Forma patch: missing side constraint marker');
    source = source.replace(sideConstraintMarker, sideConstraintReplacement);
  }

  // Bridge tiny voxel cracks only where arms attach to the shoulder/chest and
  // legs attach to the pelvis. The rest of the silhouette retains its gaps.
  const smoothMarker = '  // Separable [1,2,1] smoothing rounds voxel corners before polygonization.';
  const smoothReplacement = `  // Close one-cell gaps at shoulder and hip attachment zones before smoothing.
  const jointBlend = new Float32Array(field.length);
  jointBlend.set(field);
  for (let z = 1; z < sz - 1; z++) for (let y = 1; y < sy - 1; y++) for (let x = 1; x < sx - 1; x++) {
    const worldX = -halfX + (x - 1) * dx;
    const worldY = (y - 1) * dy;
    const absX = Math.abs(worldX);
    const shoulderZone = worldY >= 1.13 && worldY <= 1.47 && absX >= 0.15 && absX <= 0.60;
    const hipZone = worldY >= 0.82 && worldY <= 1.00 && absX >= 0.055 && absX <= 0.25;
    if (!shoulderZone && !hipZone) continue;
    const i = fieldIndex(x, y, z);
    if (field[i] >= 0.5) continue;
    const neighbours = [field[i-1], field[i+1], field[i-sx], field[i+sx], field[i-sx*sy], field[i+sx*sy]];
    let support = 0;
    for (const value of neighbours) if (value >= 0.5) support++;
    if (support >= 2) jointBlend[i] = 1;
  }
  field = jointBlend;

  // Separable [1,2,1] smoothing rounds voxel corners before polygonization.`;
  if (!source.includes('const jointBlend = new Float32Array(field.length)')) {
    if (!source.includes(smoothMarker)) throw new Error('Forma patch: missing isosurface smoothing marker');
    source = source.replace(smoothMarker, smoothReplacement);
  }

  // Give 3/4 pixels a lower texture vote so they refine curvature without
  // overpowering front/side colour placement.
  source = source.replace(
    '      const weight=Math.pow(facing,3.2); total+=weight;',
    "      const obliqueWeight = view.reference.role === 'threeQuarter' ? 0.35 : 1;\n      const weight=Math.pow(facing,3.2)*obliqueWeight; total+=weight;"
  );

  return source;
};

const patchMainModuleV9 = patchMainModule;
patchMainModule = function (source) {
  source = patchMainModuleV9(source);
  source = source.replaceAll("./visual-hull.js?v=9", "./visual-hull.js?v=10");
  source = source.replaceAll("./reference-cutout.js?v=9", "./reference-cutout.js?v=10");
  return source;
};
