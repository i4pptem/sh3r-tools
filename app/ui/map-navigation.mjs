import {Euler, Vector3} from 'three';

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyX', 'KeyC', 'ShiftLeft', 'ShiftRight']);

/** Fly within a focused world viewport; orbit controls continue to own the left/middle mouse. */
export class MapNavigation {
  constructor(canvas, camera, orbit) {
    this.canvas = canvas; this.camera = camera; this.orbit = orbit; this.keys = new Set(); this.speed = 100;
    this.enabled = false; this.available = true; this.looking = false;
    this.events = new AbortController(); const signal = this.events.signal;
    canvas.tabIndex = 0; canvas.setAttribute('aria-label', '3D viewport');
    canvas.addEventListener('pointerdown', event => {
      if (!this.enabled || !this.available) return;
      canvas.focus({preventScroll: true});
      if (event.button !== 2) return;
      event.preventDefault(); event.stopImmediatePropagation();
      this.looking = true; this.orbit.enabled = false; this.pointer = event.pointerId;
      this.last = [event.clientX, event.clientY]; canvas.setPointerCapture(event.pointerId);
      this.distance = Math.max(camera.position.distanceTo(orbit.target), camera.near * 10);
    }, {capture: true, signal});
    canvas.addEventListener('pointermove', event => {
      if (!this.looking) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const angles = new Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      angles.y -= (event.clientX - this.last[0]) * .003;
      angles.x = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, angles.x - (event.clientY - this.last[1]) * .003));
      angles.z = 0; camera.quaternion.setFromEuler(angles); this.last = [event.clientX, event.clientY];
      orbit.target.copy(camera.position).addScaledVector(camera.getWorldDirection(new Vector3()), this.distance);
    }, {capture: true, signal});
    canvas.addEventListener('pointerup', event => {
      if (event.button !== 2 || !this.looking) return;
      event.preventDefault(); event.stopImmediatePropagation(); this.stopLook();
    }, {capture: true, signal});
    canvas.addEventListener('lostpointercapture', () => this.stopLook(), {signal});
    canvas.addEventListener('keydown', event => {
      if (!this.enabled || !this.available || event.ctrlKey || event.metaKey || event.altKey || !movementKeys.has(event.code)) return;
      event.preventDefault(); this.keys.add(event.code);
    }, {signal});
    window.addEventListener('keyup', event => this.keys.delete(event.code), {signal});
    window.addEventListener('blur', () => this.reset(), {signal});
    canvas.addEventListener('blur', () => this.reset(), {signal});
    document.addEventListener('visibilitychange', () => {if (document.hidden) this.reset();}, {signal});
  }
  stopLook() {
    if (!this.looking) return;
    this.looking = false; this.orbit.enabled = this.available;
    if (this.canvas.hasPointerCapture(this.pointer)) this.canvas.releasePointerCapture(this.pointer);
  }
  reset() {this.keys.clear(); this.stopLook();}
  setAvailable(value) {this.available = value; if (!value) this.reset();}
  update(dt) {
    if (!this.enabled || !this.available || !this.keys.size || this.canvas.offsetParent === null) return;
    const axis = (positive, negative) => Number(this.keys.has(positive)) - Number(this.keys.has(negative));
    const forward = this.camera.getWorldDirection(new Vector3()), right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const delta = forward.multiplyScalar(axis('KeyW', 'KeyS')).addScaledVector(right, axis('KeyD', 'KeyA'));
    delta.y += axis('KeyX', 'KeyC');
    if (!delta.lengthSq()) return;
    delta.normalize().multiplyScalar(dt * this.speed * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1));
    this.camera.position.add(delta); this.orbit.target.add(delta);
  }
  dispose() {this.reset(); this.events.abort();}
}
