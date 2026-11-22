/**
 * Local reference-image overlay for front/side viewport alignment.
 * This is an editor guide only: it is never attached to the character or exported.
 */
export class ReferenceOverlayManager {
  constructor(THREE, scene) {
    this.THREE = THREE;
    this.scene = scene;
    this.mesh = null;
    this.texture = null;
    this.key = '';
    this.role = '';
    this.visible = true;
    this.opacity = 0.38;
    this.scale = 1;
    this.revision = 0;
  }

  setReference(role, dataUrl) {
    const key = role && dataUrl ? `${role}:${dataUrl}` : '';
    if (key === this.key && this.mesh) {
      this.positionMesh();
      return;
    }
    this.key = key;
    this.role = role || '';
    const revision = ++this.revision;
    this.removeMesh();
    if (!key || !dataUrl) return;

    const loader = new this.THREE.TextureLoader();
    loader.load(dataUrl, texture => {
      if (revision !== this.revision) {
        texture.dispose();
        return;
      }
      texture.colorSpace = this.THREE.SRGBColorSpace;
      texture.anisotropy = 2;
      this.texture = texture;

      const image = texture.image;
      const aspect = image?.naturalWidth && image?.naturalHeight
        ? image.naturalWidth / image.naturalHeight
        : 0.5;
      const height = 1.86;
      const width = this.THREE.MathUtils.clamp(height * aspect, 0.28, 1.35);
      const geometry = new this.THREE.PlaneGeometry(width, height);
      const material = new this.THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: this.opacity,
        depthTest: true,
        depthWrite: false,
        side: this.THREE.DoubleSide,
        toneMapped: false,
      });
      this.mesh = new this.THREE.Mesh(geometry, material);
      this.mesh.name = 'FormaReferenceAlignmentGuide';
      this.mesh.userData.formaReferenceGuide = true;
      this.mesh.renderOrder = -2;
      this.positionMesh();
      this.scene.add(this.mesh);
      this.mesh.visible = this.visible;
    }, undefined, error => {
      if (revision === this.revision) console.warn('Reference overlay could not load:', error);
    });
  }

  positionMesh() {
    if (!this.mesh) return;
    this.mesh.position.set(0, 0.93, -0.205);
    this.mesh.rotation.set(0, 0, 0);
    if (this.role === 'side') {
      this.mesh.rotation.y = Math.PI / 2;
      this.mesh.position.set(-0.205, 0.93, 0);
    }
    this.mesh.scale.setScalar(this.scale);
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    if (this.mesh) this.mesh.visible = this.visible;
  }

  setOpacity(value) {
    this.opacity = this.THREE.MathUtils.clamp(Number(value) / 100, 0.1, 0.8);
    if (this.mesh?.material) this.mesh.material.opacity = this.opacity;
  }

  setScale(value) {
    this.scale = this.THREE.MathUtils.clamp(Number(value) / 100, 0.65, 1.4);
    this.positionMesh();
  }

  removeMesh() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry?.dispose();
      this.mesh.material?.dispose();
      this.mesh = null;
    }
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
  }

  dispose() {
    this.revision += 1;
    this.removeMesh();
    this.key = '';
  }
}
