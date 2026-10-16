// Tracers: pooled thin emissive boxes stepped against tiles, aliens and explosive props.
import * as THREE from 'three';

const MAX = 96;

export class Bullets {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.geo = new THREE.BoxGeometry(14, 1.6, 1.6);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffe8a0 });
    this.mat.emissive = undefined;
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    game.renderer.scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
  }

  spawn(x, y, dx, dy, weapon, owner) {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push({ x, y, dx, dy, speed: weapon.speed, dmg: weapon.dmg, life: weapon.range / weapon.speed, owner, weapon, traveled: 0 });
  }

  update(dt) {
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      const step = b.speed * dt;
      const nx = b.x + b.dx * step, ny = b.y + b.dy * step;
      b.life -= dt; b.traveled += step;
      // aliens
      let hit = false;
      for (const a of g.aliens) {
        if (!a.alive || a.hidden) continue;
        const ab = a.body;
        if (segmentHitsBox(b.x, b.y, nx, ny, ab.left - 2, ab.y, ab.right + 2, ab.top)) {
          const crit = ny > ab.y + ab.h * 0.68 || (b.y > ab.y + ab.h * 0.68);
          const falloff = b.weapon.pellets > 1 ? Math.max(0.35, 1 - b.traveled / b.weapon.range) : 1;
          a.damage(b.dmg * (crit ? 2 : 1) * falloff, { crit, dx: b.dx, dy: b.dy, from: b.owner });
          hit = true; break;
        }
      }
      if (!hit) {
        for (const p of g.world.props) {
          if (!p.alive || p.hp <= 0) continue;
          if (segmentHitsBox(b.x, b.y, nx, ny, p.x - p.w / 2, p.y, p.x + p.w / 2, p.y + p.h)) {
            g.hitProp(p, b.dmg, b.dx, b.dy); hit = true; break;
          }
        }
      }
      if (!hit) {
        const r = g.physics.raycast(b.x, b.y, b.dx, b.dy, step);
        if (r) { g.fx.spark(r.x - b.dx * 2, r.y - b.dy * 2, -b.dx, -b.dy); g.audio.play('wall_hit', { volume: 0.35, x: r.x, minGap: 60 }); hit = true; }
      }
      if (hit || b.life <= 0) { this.list.splice(i, 1); continue; }
      b.x = nx; b.y = ny;
    }
    // instances
    const n = Math.min(MAX, this.list.length);
    for (let i = 0; i < n; i++) {
      const b = this.list[i];
      this._p.set(b.x, b.y, 4);
      this._q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(b.dy, b.dx));
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function segmentHitsBox(x0, y0, x1, y1, L, B, R, Tp) {
  // Liang-Barsky clipping of the segment against the box
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const checks = [[-dx, x0 - L], [dx, R - x0], [-dy, y0 - B], [dy, Tp - y0]];
  for (const [p, q] of checks) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 <= t1;
}
