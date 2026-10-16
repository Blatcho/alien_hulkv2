// Juice: pooled particles (sparks, acid, blood, dust, smoke, flame), acid pools that keep burning,
// muzzle flashes, hit-stop, screen shake, floating damage numbers, the shield bubble.
import * as THREE from 'three';

const MAX = 700;

export class FX {
  constructor(game) {
    this.game = game;
    const scene = game.renderer.scene;
    this.parts = [];
    this.geo = new THREE.BoxGeometry(2, 2, 2);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, MAX);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._c = new THREE.Color();
    this.pools = [];                          // acid pools {x,y,r,t,mesh}
    this.poolGeo = new THREE.BoxGeometry(1, 3, 6);
    this.poolMat = new THREE.MeshBasicMaterial({ color: 0x8cff3a, toneMapped: false, transparent: true, opacity: 0.85 });
    this.flashes = [];                         // {x,y,t,color,range}
    this.hitStopT = 0; this.shakeAmp = 0; this.shakeT = 0; this.shakeDur = 0;
    this.numbers = [];                         // {x,y,text,color,t,big}
    this.timeScale = 1;
    this.shieldMesh = new THREE.Mesh(new THREE.PlaneGeometry(14, 60), new THREE.MeshBasicMaterial({ color: 0x5ab8ff, transparent: true, opacity: 0.35, toneMapped: false, side: THREE.DoubleSide }));
    this.shieldMesh.visible = false; scene.add(this.shieldMesh);
    this.muzzleMesh = new THREE.Mesh(new THREE.PlaneGeometry(18, 10), new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.9, toneMapped: false }));
    this.muzzleMesh.visible = false; scene.add(this.muzzleMesh);
    this.muzzleT = 0;
    this.kicks = new Map();
  }

  emit(x, y, { n = 6, color = 0xffffff, speed = 120, spread = Math.PI * 2, dir = 0, life = 0.5, gravity = 600, size = 2, z = 6, drag = 0, flat = false, sticky = false, bright = 1 } = {}) {
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= MAX) this.parts.shift();
      const a = dir + (Math.random() - 0.5) * spread;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.parts.push({ x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.6 + Math.random() * 0.8), t: 0, color, gravity, size: size * (0.7 + Math.random() * 0.7), drag, flat, sticky, bright, stuck: false });
    }
  }

  spark(x, y, dx, dy) { this.emit(x, y, { n: 7, color: 0xffd080, speed: 220, spread: 1.6, dir: Math.atan2(dy, dx), life: 0.35, gravity: 500, bright: 2.5 }); this.flashes.push({ x, y, t: 0.06, color: 0xffc070, range: 50, intensity: 0.6 }); }
  acid(x, y, dx, dy, n = 8, big = false) {
    this.emit(x, y, { n, color: 0x9cff3c, speed: big ? 260 : 170, spread: 2.2, dir: Math.atan2(dy, dx), life: 0.9, gravity: 700, size: big ? 3 : 2.2, sticky: true, bright: 1.8 });
    this.flashes.push({ x, y, t: 0.08, color: 0x8cff3a, range: 60, intensity: 0.5 });
  }
  acidPool(x, y, r = 24) {
    const mesh = new THREE.Mesh(this.poolGeo, this.poolMat);
    mesh.scale.set(r, 1, 1); mesh.position.set(x, y + 1.5, 3);
    this.game.renderer.scene.add(mesh);
    this.pools.push({ x, y, r, t: 7 + Math.random() * 3, mesh });
    this.game.audio.play('acid', { volume: 0.7, x });
  }
  blood(x, y, n = 6) { this.emit(x, y, { n, color: 0xa01818, speed: 140, life: 0.6, gravity: 700, sticky: true }); }
  dust(x, y, n = 6) { this.emit(x, y, { n, color: 0x8a8070, speed: 50, spread: Math.PI, dir: -Math.PI / 2, life: 0.8, gravity: 120, size: 2.5, drag: 2 }); }
  smoke(x, y, n = 1) { this.emit(x, y, { n, color: 0x30302c, speed: 24, spread: 1.2, dir: Math.PI / 2, life: 1.6, gravity: -40, size: 4, drag: 1 }); }
  flame(x, y, n = 2) { this.emit(x, y, { n, color: Math.random() < 0.5 ? 0xff8a2a : 0xffc050, speed: 60, spread: 0.9, dir: Math.PI / 2, life: 0.55, gravity: -260, size: 3, drag: 1.5, bright: 3 }); }
  explosion(x, y) {
    this.emit(x, y + 8, { n: 40, color: 0xffb040, speed: 320, life: 0.7, gravity: 300, size: 3, bright: 3 });
    this.emit(x, y + 8, { n: 24, color: 0x3a3a3a, speed: 140, life: 1.6, gravity: -60, size: 4, drag: 1.5 });
    this.flashes.push({ x, y: y + 10, t: 0.25, color: 0xffa040, range: 220, intensity: 2.5 });
    this.shake(9, 0.45); this.hitStop(0.06);
  }
  slash(x, y, facing) { this.emit(x, y, { n: 10, color: 0xa01818, speed: 160, spread: 1.2, dir: facing > 0 ? 0 : Math.PI, life: 0.5, gravity: 700, sticky: true }); }
  shieldHit(x, y) { this.emit(x, y, { n: 10, color: 0x7fd0ff, speed: 140, life: 0.35, gravity: 0, bright: 2.5 }); this.flashes.push({ x, y, t: 0.08, color: 0x5ab8ff, range: 70, intensity: 0.8 }); }
  muzzle(x, y, dx, dy, scale = 1) {
    this.flashes.push({ x: x + dx * 8, y: y + dy * 8, t: 0.05, color: 0xffd090, range: 140 * scale, intensity: 1.6 * scale });
    this.muzzleMesh.visible = true; this.muzzleT = 0.045;
    this.muzzleMesh.position.set(x + dx * 10, y + dy * 10, 8);
    this.muzzleMesh.rotation.z = Math.atan2(dy, dx);
    this.muzzleMesh.scale.set(scale, scale, 1);
    this.emit(x + dx * 6, y + dy * 6, { n: 2, color: 0xffe0a0, speed: 200, spread: 0.5, dir: Math.atan2(dy, dx), life: 0.12, gravity: 0, bright: 2 });
  }
  hitStop(t) { this.hitStopT = Math.max(this.hitStopT, t); }
  shake(amp, dur) { if (amp >= this.shakeAmp * (this.shakeT / Math.max(0.01, this.shakeDur))) { this.shakeAmp = amp; this.shakeT = dur; this.shakeDur = dur; } }
  number(x, y, text, color = 0xffffff, big = false) { this.numbers.push({ x, y, text, color, t: 0, big, vy: 40 + Math.random() * 20, vx: (Math.random() - 0.5) * 30 }); }
  kick(entity, amount) { this.kicks.set(entity, amount); }

  update(dt, realDt) {
    const g = this.game;
    // hit-stop is handled by Game (it scales dt); shake decays in real time
    if (this.shakeT > 0) {
      this.shakeT -= realDt;
      const k = Math.max(0, this.shakeT / this.shakeDur);
      const a = this.shakeAmp * k * k;
      g.renderer.shake.x = (Math.random() - 0.5) * 2 * a; g.renderer.shake.y = (Math.random() - 0.5) * 2 * a;
    } else { g.renderer.shake.x = 0; g.renderer.shake.y = 0; }
    this.muzzleT -= dt; if (this.muzzleT <= 0) this.muzzleMesh.visible = false;
    // particles
    const ph = g.physics;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      if (p.t >= p.life) { this.parts.splice(i, 1); continue; }
      if (p.stuck) continue;
      p.vy -= p.gravity * dt;
      if (p.drag) { p.vx *= Math.max(0, 1 - p.drag * dt); p.vy *= Math.max(0, 1 - p.drag * dt); }
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
      if (p.sticky || p.gravity > 0) {
        const r = ph.raycast(p.x, p.y, (nx - p.x) / (Math.hypot(nx - p.x, ny - p.y) || 1), (ny - p.y) / (Math.hypot(nx - p.x, ny - p.y) || 1), Math.hypot(nx - p.x, ny - p.y) || 0.01);
        if (r) { if (p.sticky) { p.stuck = true; p.x = r.x; p.y = r.y; p.life = p.t + 3 + Math.random() * 3; } else { p.vy = -p.vy * 0.3; p.vx *= 0.5; } continue; }
      }
      p.x = nx; p.y = ny;
    }
    const n = Math.min(MAX, this.parts.length);
    for (let i = 0; i < n; i++) {
      const p = this.parts[i];
      const k = 1 - p.t / p.life;
      const s = p.size * (p.stuck ? 1 : 0.5 + 0.5 * k);
      this._m.makeScale(s, s, s); this._m.setPosition(p.x, p.y, p.z);
      this.mesh.setMatrixAt(i, this._m);
      this._c.setHex(p.color).multiplyScalar(p.bright * (p.stuck ? 0.6 : 0.6 + 0.4 * k));
      this.mesh.setColorAt(i, this._c);
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    // acid pools: burn, shrink, hurt whoever stands in them
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const q = this.pools[i];
      q.t -= dt;
      q.mesh.scale.x = q.r * Math.min(1, q.t / 3);
      q.mesh.material.opacity = Math.min(0.85, q.t / 3);
      if (Math.random() < dt * 6) this.emit(q.x + (Math.random() - 0.5) * q.r, q.y + 2, { n: 1, color: 0xa0ff50, speed: 20, spread: 0.6, dir: Math.PI / 2, life: 0.5, gravity: -80, size: 1.5, bright: 1.5 });
      const pl = g.player;
      if (!pl.dead && Math.abs(pl.x - q.x) < q.r * 0.5 + 6 && Math.abs(pl.y - q.y) < 6 && pl.body.onGround) {
        pl.acidT = (pl.acidT || 0) + dt;
        if (pl.acidT > 0.4) { pl.acidT = 0; pl.damage(5, { acid: true }); g.barks.say(pl, 'Acid!', 0.9); }
      }
      if (q.t <= 0) { g.renderer.scene.remove(q.mesh); this.pools.splice(i, 1); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) { this.flashes[i].t -= dt; if (this.flashes[i].t <= 0) this.flashes.splice(i, 1); }
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const q = this.numbers[i]; q.t += dt; q.y += q.vy * dt; q.x += q.vx * dt; q.vy -= 40 * dt;
      if (q.t > 1.1) this.numbers.splice(i, 1);
    }
    // shield bubble
    const pl = g.player;
    this.shieldMesh.visible = pl.shieldUp && !pl.dead;
    if (this.shieldMesh.visible) { this.shieldMesh.position.set(pl.x + pl.facing * 18, pl.y + 30, 6); this.shieldMesh.material.opacity = 0.25 + 0.15 * Math.sin(g.time * 20) + 0.2 * (pl.shield / pl.shieldMax); }
  }

  collectLights(out) {
    for (const f of this.flashes) out.push({ x: f.x, y: f.y, z: 30, color: f.color, intensity: f.intensity * Math.min(1, f.t / 0.04), range: f.range, priority: 1 });
  }
}
