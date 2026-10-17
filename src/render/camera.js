// Side-on orthographic camera: follows the squad with look-ahead, zooms with the wheel or +/-,
// shakes on trauma (screen shake decays quadratically), and snaps to whole pixels in pixel mode.
import * as THREE from 'three';

export class FollowCamera {
  constructor(viewHeight = 13) {
    this.viewHeight = viewHeight;
    this.targetHeight = viewHeight;
    this.cam = new THREE.OrthographicCamera(-10, 10, 5, -5, 0.1, 200);
    this.cam.position.set(0, 0, 60);
    this.center = new THREE.Vector2();
    this.trauma = 0;
    this.kick = new THREE.Vector2();
    this.aspect = 16 / 9;
    this.time = 0;
    this.pixelLines = 0; // pixel mode: the frame's height in pixels, to snap to (0 = off)
  }

  resize(w, h) {
    this.aspect = w / h;
    this.apply();
  }

  zoom(delta) {
    this.targetHeight = THREE.MathUtils.clamp(this.targetHeight * (1 + delta), 8, 26);
  }

  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  push(dx, dy) { this.kick.x += dx; this.kick.y += dy; }

  /** Jump straight to a point (level start). */
  teleport(x, y) { this.center.set(x, y); this.apply(); }

  update(dt, tx, ty) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 3.2);
    this.center.x += (tx - this.center.x) * k;
    this.center.y += (ty - this.center.y) * (1 - Math.exp(-dt * 2.4));
    this.viewHeight += (this.targetHeight - this.viewHeight) * (1 - Math.exp(-dt * 6));
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.kick.multiplyScalar(Math.exp(-dt * 14));
    this.apply();
  }

  apply() {
    const h = this.viewHeight / 2;
    const w = h * this.aspect;
    const s = this.trauma * this.trauma * 0.35;
    const t = this.time * 40;
    let x = this.center.x + this.kick.x + s * Math.sin(t * 1.3);
    let y = this.center.y + this.kick.y + s * Math.cos(t * 1.7);
    if (this.pixelLines) {
      const px = this.viewHeight / this.pixelLines; // one pixel in metres, at this zoom
      x = Math.round(x / px) * px;
      y = Math.round(y / px) * px;
    }
    Object.assign(this.cam, { left: -w, right: w, top: h, bottom: -h });
    this.cam.position.set(x, y, 60);
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
  }

  /** World-space view rectangle. */
  bounds() {
    const p = this.cam.position;
    return { x0: p.x + this.cam.left, x1: p.x + this.cam.right, y0: p.y + this.cam.bottom, y1: p.y + this.cam.top };
  }
}
