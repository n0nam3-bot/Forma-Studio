import * as THREE from 'three';

// Three.js SkeletonHelper exposes updateMatrixWorld(), not update().
// Forma Studio's model/pose code calls helper.update(); supply that alias
// before the main application module evaluates any avatar poses.
const helperPrototype = THREE.SkeletonHelper.prototype;
if (typeof helperPrototype.update !== 'function') {
  Object.defineProperty(helperPrototype, 'update', {
    configurable: true,
    writable: true,
    value() {
      this.updateMatrixWorld(true);
    },
  });
}
