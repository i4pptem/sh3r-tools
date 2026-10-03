import * as THREE from 'three';

const display = point => new THREE.Vector3(-point[0], -point[1], point[2]);

/** A secondary view keeps map navigation and reference-point placement independent. */
export class CameraStudyView {
  constructor(viewport) {
    this.viewport = viewport;
    this.root = new THREE.Group(); viewport.scene.add(this.root); this.root.visible = false;
    this.actor = new THREE.Group(); this.root.add(this.actor);
    const material = new THREE.MeshBasicMaterial({color: 0xe8c58d, wireframe: true});
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(120, 1040, 4, 8), material); body.position.y = 640; this.actor.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(130, 12, 8), material); head.position.y = 1410; this.actor.add(head);
    this.heading = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 50, 0), 450, 0xe8c58d); this.actor.add(this.heading);
    this.heading.traverse(object => object.layers.set(1));
    this.camera = new THREE.PerspectiveCamera(45, 4 / 3, 10, 100000);
    this.helperCamera = this.camera.clone(); this.helper = new THREE.CameraHelper(this.helperCamera); this.helper.layers.set(1); this.root.add(this.helper);
  }
  createWindow() {
    this.panel = document.createElement('div'); this.panel.className = 'camera-study'; this.panel.setAttribute('aria-label', 'Approximate camera view');
    const title = document.createElement('div'); title.className = 'camera-study-title'; title.textContent = 'CAMERA STUDY · APPROXIMATE';
    this.caption = document.createElement('div'); this.caption.className = 'camera-study-caption';
    this.renderer = new THREE.WebGLRenderer({antialias: true}); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.setClearColor(0x151a18);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.panel.append(title, this.renderer.domElement, this.caption); this.viewport.host.append(this.panel);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(this.panel); this.resize();
  }
  resize() {
    if (!this.renderer) return;
    const width = this.panel.clientWidth; if (!width) return;
    this.renderer.setSize(width, Math.round(width * .75), false);
  }
  update(result, point, yaw, visible, height = 835) {
    this.root.visible = !!result;
    if (result) {
      this.actor.position.copy(display(point)); this.actor.rotation.y = -yaw; this.actor.scale.setScalar(height / 1540);
      this.camera.position.copy(display(result.position)); this.camera.up.set(0, 1, 0); this.camera.lookAt(display(result.target));
      this.camera.fov = result.fov; this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
      this.helperCamera.copy(this.camera); this.helperCamera.far = this.camera.position.distanceTo(display(result.target)) * 1.1;
      this.helperCamera.updateProjectionMatrix(); this.helper.update();
    }
    if (visible && result && !this.panel) this.createWindow();
    if (this.panel) {this.panel.hidden = !visible || !result; this.caption.textContent = result ? `Zone ${result.zone} · ${result.mode} · 4:3` : '';}
  }
  render() {
    if (!this.panel || this.panel.hidden || this.panel.offsetParent === null) return;
    this.renderer.render(this.viewport.scene, this.camera);
  }
  dispose() {
    this.observer?.disconnect(); this.renderer?.dispose(); this.panel?.remove(); this.root.removeFromParent();
    const geometries = new Set(), materials = new Set();
    this.root.traverse(object => {if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material);});
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
  }
}
