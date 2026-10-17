// Combat effects, all pooled / instanced (no per-shot allocations):
// tracers, muzzle flashes, spark & blood particles, persistent acid splats on the back wall,
// and Rapier-simulated debris (brass casings, chitin gibs) drawn as instanced meshes.
import * as THREE from 'three';
import { WORLD } from '../core/config.js';

const additive = (color) => new THREE.MeshBasicMaterial({
  color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});

class ParticlePool {
  constructor(scene, n, material, size) {
    this.n = n;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(size, size), material, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.p = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, life: 0, max: 1, s: 1, g: 0, c: new THREE.Color() }));
    this.i = 0;
    this.m = new THREE.Matrix4();
  }

  emit(x, y, z, vx, vy, life, color, s = 1, g = 9) {
    const p = this.p[this.i++ % this.n];
    Object.assign(p, { x, y, z, vx, vy, life, max: life, s, g });
    p.c.set(color);
  }

  update(dt) {
    let k = 0;
    for (const p of this.p) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy -= p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = Math.max(0, p.life / p.max);
      const s = p.s * (0.4 + 0.6 * t);
      this.m.makeScale(s, s, s).setPosition(p.x, p.y, p.z);
      this.mesh.setMatrixAt(k, this.m);
      this.mesh.setColorAt(k, p.c.clone().multiplyScalar(t));
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

export class Fx {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.rng = Math.random; // presentation-only randomness

    // Tracers: unit quad stretched between muzzle and impact.
    const tracerGeo = new THREE.PlaneGeometry(1, 1);
    tracerGeo.translate(0.5, 0, 0);
    this.tracers = Array.from({ length: 48 }, () => {
      const m = new THREE.Mesh(tracerGeo, additive(0xffd27a));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      return { mesh: m, life: 0 };
    });
    this.tracerI = 0;

    // Muzzle flashes: star-shaped quads.
    const flashMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: { a: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float a; varying vec2 vUv;
        void main(){ vec2 p = vUv - 0.5; float r = length(p) * 2.0; float ang = atan(p.y, p.x);
          float star = 0.55 + 0.45 * pow(abs(cos(ang * 3.0)), 8.0);
          float v = smoothstep(star, 0.0, r) * a;
          gl_FragColor = vec4(vec3(1.0, 0.8, 0.45) * v * 3.0, 1.0); }`,
    });
    this.flashes = Array.from({ length: 12 }, () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMat.clone());
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      return { mesh: m, life: 0 };
    });
    this.flashI = 0;

    this.sparks = new ParticlePool(scene, 500, additive(0xffffff), 0.07);
    // Burning doorways (ship events): flame tongues and dark smoke, emitted while they burn.
    this.flames = new ParticlePool(scene, 360, additive(0xffffff), 0.26);
    this.smoke = new ParticlePool(scene, 220, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }), 0.7);
    this.fires = new Map(); // portal id -> {x, y, acc}
    this.flares = new Map(); // room id -> {x, y, acc}: a flare burning on the deck
    // Grenades in flight: a dark lump with a red blink.
    this.nades = Array.from({ length: 6 }, () => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0x1c2416 }));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    // Spitter acid: glowing globs in flight, and pools on the deck (a smear of light at floor level -
    // the camera sees the deck edge-on).
    this.globs = Array.from({ length: 12 }, () => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.13, 8), additive(0xb8ff40));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    this.puddles = Array.from({ length: 16 }, () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.16), additive(0x88d020));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    this.blood = new ParticlePool(scene, 500, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }), 0.11);

    // Persistent splats on the back wall.
    const splatGeo = new THREE.CircleGeometry(0.35, 7);
    this.splats = new THREE.InstancedMesh(splatGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0, emissive: 0x1a2a05, transparent: true, opacity: 0.85 }), 400);
    this.splats.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(400 * 3), 3);
    this.splats.count = 0;
    this.splats.frustumCulled = false;
    scene.add(this.splats);
    this.splatI = 0;

    // Debris instanced meshes, positions pulled from Rapier bodies each frame.
    this.casingMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.04, 0.04), new THREE.MeshStandardMaterial({ color: 0xc9a040, metalness: 0.8, roughness: 0.35 }), physics.maxDebris);
    this.gibMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.13, 0), new THREE.MeshStandardMaterial({ color: 0xd8cdb0, roughness: 0.6, flatShading: true }), physics.maxDebris);
    this.gibMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(physics.maxDebris * 3), 3);
    for (const m of [this.casingMesh, this.gibMesh]) { m.frustumCulled = false; m.count = 0; scene.add(m); }
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.one = new THREE.Vector3(1, 1, 1);
    this.gibColors = [new THREE.Color(0xd8cdb0), new THREE.Color(0x4a1f36), new THREE.Color(0x6a2a48)];
    this.ensureFireballs();
  }

  shot(x0, y0, z, x1, y1, { weapon = 'carbine', flash = true, casing = true } = {}) {
    const t = this.tracers[this.tracerI++ % this.tracers.length];
    const len = Math.hypot(x1 - x0, y1 - y0);
    // Tracer is a short streak partway along the path, not the full beam; the marksman's
    // round leaves a long bright line, shotgun pellets short stubs.
    const k0 = weapon === 'marksman' ? 0.02 : this.rng() * 0.35;
    const seg = weapon === 'marksman' ? len : weapon === 'breacher' ? Math.min(len * 0.5, 1.6) : Math.min(len * 0.5, 4.5);
    const dx = (x1 - x0) / len;
    const dy = (y1 - y0) / len;
    t.mesh.position.set(x0 + dx * len * k0, y0 + dy * len * k0, z + 0.4);
    t.mesh.rotation.set(0, 0, Math.atan2(dy, dx));
    t.mesh.scale.set(Math.min(seg, len * (1 - k0)), weapon === 'marksman' ? 0.05 : weapon === 'heavy' ? 0.045 : 0.035, 1);
    t.mesh.visible = true;
    t.life = weapon === 'marksman' ? 0.09 : 0.05;
    if (!flash) return;

    const f = this.flashes[this.flashI++ % this.flashes.length];
    f.mesh.position.set(x0, y0, z + 0.45);
    f.mesh.rotation.z = this.rng() * Math.PI;
    const s = (weapon === 'breacher' ? 0.9 : weapon === 'heavy' ? 0.7 : 0.55) + this.rng() * 0.35;
    f.mesh.scale.set(s, s, s);
    f.mesh.visible = true;
    f.life = 0.045;

    // Brass: ejected up and backwards.
    const dir = Math.sign(dx) || 1;
    if (casing && this.rng() < 0.6) this.physics.spawnDebris('casing', x0 - dir * 0.6, y0 - 0.05, -dir * (1.5 + this.rng() * 1.5), 2.5 + this.rng() * 2, (this.rng() - 0.5) * 30, 0.045).z = z + 0.2;
  }

  sparksAt(x, y, dirX, n = 6) {
    for (let i = 0; i < n; i++) {
      this.sparks.emit(x, y, 0.6, -dirX * (1 + this.rng() * 4) + (this.rng() - 0.5) * 3, (this.rng() - 0.2) * 5, 0.15 + this.rng() * 0.25, this.rng() < 0.5 ? 0xffe0a0 : 0xffa040, 1, 12);
    }
  }

  bloodAt(x, y, dirX, alien = true, n = 8) {
    const col = alien ? [0x9acd32, 0xc8e040, 0x6a8a18] : [0xa01818, 0x701010];
    for (let i = 0; i < n; i++) {
      this.blood.emit(x, y, 0.5, dirX * (0.5 + this.rng() * 3.5) + (this.rng() - 0.5) * 2, (this.rng() - 0.1) * 4, 0.35 + this.rng() * 0.4, col[i % col.length], 1, 14);
    }
    if (alien && this.rng() < 0.5) this.splat(x + dirX * (0.6 + this.rng()), y + (this.rng() - 0.5) * 0.8, 0.6 + this.rng() * 0.8);
  }

  splat(x, y, s, color = null) {
    const i = this.splatI++ % 400;
    this.q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.rng() * Math.PI * 2);
    this.m.compose(this.v.set(x, y, WORLD.BACK_Z + 0.46 + this.rng() * 0.02), this.q, new THREE.Vector3(s, s * (0.6 + this.rng() * 0.6), 1));
    this.splats.setMatrixAt(i, this.m);
    this.splats.setColorAt(i, new THREE.Color(color ?? (this.rng() < 0.5 ? 0x7da020 : 0x5c7a14)));
    this.splats.count = Math.min(400, Math.max(this.splats.count, i + 1));
    this.splats.instanceMatrix.needsUpdate = true;
    this.splats.instanceColor.needsUpdate = true;
  }

  gibs(x, y, dir, n = 7) {
    for (let i = 0; i < n; i++) {
      const d = this.physics.spawnDebris('gib', x + (this.rng() - 0.5) * 0.6, y + 0.4 + this.rng() * 0.8, dir * (1 + this.rng() * 4) + (this.rng() - 0.5) * 3, 2 + this.rng() * 5, (this.rng() - 0.5) * 20, 0.1);
      d.z = (this.rng() - 0.5) * 1.2;
      d.color = this.gibColors[i % 3];
    }
    this.bloodAt(x, y + 0.8, dir, true, 22);
    this.splat(x, y + 0.6, 1.4);
  }

  /** Fuel-barrel explosion: fireball, shockwave ring, sparks, shrapnel, scorch mark. */
  explosion(x, y, r) {
    this.ensureFireballs();
    this.fireExplosion(x, y, r);
  }

  /** Built up front (constructor) so the first blast doesn't stall a frame compiling shaders. */
  ensureFireballs() {
    if (!this.fireballs) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { k: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform float k; varying vec2 vUv;
          float h(vec2 p){ return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5); }
          void main(){ vec2 p = vUv - 0.5; float r = length(p) * 2.0;
            float n = h(floor(vUv * 18.0 + k * 9.0)) * 0.25;
            float core = smoothstep(1.0 - k * 0.5, 0.0, r + n * k);
            vec3 hot = mix(vec3(1.0, 0.9, 0.6), vec3(1.0, 0.35, 0.05), k);
            vec3 col = mix(hot, vec3(0.15, 0.08, 0.05), smoothstep(0.35, 0.9, k));
            gl_FragColor = vec4(col * core * (1.0 - k) * 3.0, 1.0); }`,
      });
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc080, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      this.fireballs = Array.from({ length: 4 }, () => {
        const ball = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat.clone());
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), ringMat.clone());
        for (const o of [ball, ring]) { o.visible = false; o.frustumCulled = false; this.scene.add(o); }
        return { ball, ring, t: 1, r: 1 };
      });
      this.fireI = 0;
    }
  }

  fireExplosion(x, y, r) {
    const f = this.fireballs[this.fireI++ % this.fireballs.length];
    f.t = 0;
    f.r = r;
    f.ball.position.set(x, y, 0.9);
    f.ring.position.set(x, y, 0.95);
    f.ball.visible = f.ring.visible = true;
    for (let i = 0; i < 40; i++) {
      const a = this.rng() * Math.PI * 2;
      const v = 3 + this.rng() * 9;
      this.sparks.emit(x, y, 0.8, Math.cos(a) * v, Math.sin(a) * v + 2, 0.3 + this.rng() * 0.6, this.rng() < 0.5 ? 0xffd080 : 0xff7020, 1.6, 9);
    }
    for (let i = 0; i < 8; i++) {
      const d = this.physics.spawnDebris('gib', x + (this.rng() - 0.5), y + this.rng() * 0.6, (this.rng() - 0.5) * 12, 4 + this.rng() * 7, (this.rng() - 0.5) * 30, 0.09);
      d.z = (this.rng() - 0.5) * 1.5;
      d.color = new THREE.Color(this.rng() < 0.5 ? 0x5a1a14 : 0x2a2a2a);
    }
    this.splat(x, y - 0.1, 2.4, 0x0c0a08);
    this.splat(x + (this.rng() - 0.5), y + 0.8, 1.6, 0x14100c);
  }

  addFire(id, x, y) { this.fires.set(id, { x, y, acc: 0 }); }

  addFlare(id, x, y) {
    this.flares.set(id, { x, y, acc: 0 });
    for (let i = 0; i < 24; i++) this.sparks.emit(x, y + 0.1, 0.8, (this.rng() - 0.5) * 5, 1 + this.rng() * 4, 0.3 + this.rng() * 0.4, 0xff5030, 1.4, 12);
  }

  /** Follow the sim's grenades in flight each frame (the lob is computed by sim/kit.js). */
  syncGrenades(list) {
    this.nades.forEach((m, i) => {
      const g = list[i];
      m.visible = !!g;
      if (!g) return;
      m.position.set(g.x, g.y, 0.75);
      if (Math.floor(g.t * 10) % 2 === 0 && this.rng() < 0.6) this.sparks.emit(g.x, g.y, 0.8, 0, 0, 0.08, 0xff2010, 1.3, 0);
    });
  }

  /** Eggs going up: a gout of flame and greasy smoke. */
  burn(x, y) {
    for (let i = 0; i < 46; i++) {
      const r = this.rng();
      this.flames.emit(x + (this.rng() - 0.5) * 1.4, y + this.rng() * 0.8, 0.2 + this.rng() * 0.5, (this.rng() - 0.5) * 1.5, 1 + this.rng() * 2.5,
        0.4 + this.rng() * 0.5, r < 0.4 ? 0xffd060 : r < 0.8 ? 0xff7a20 : 0xc02a10, 1.2 + this.rng() * 0.6, -1.5);
    }
    for (let i = 0; i < 10; i++) this.smoke.emit(x + (this.rng() - 0.5), y + 1 + this.rng(), 0.3, (this.rng() - 0.5) * 0.5, 0.6 + this.rng() * 0.6, 1.8 + this.rng(), 0x30281e, 1, -0.3);
  }

  /** A cryo pod cracking open: a burst of cold vapour. */
  vapour(x, y) {
    for (let i = 0; i < 24; i++) this.smoke.emit(x + (this.rng() - 0.5) * 0.8, y + 0.6 + this.rng() * 1.2, -0.9, (this.rng() - 0.5) * 2, 0.2 + this.rng() * 0.6, 1 + this.rng(), 0xd8eef8, 0.9, -0.1);
  }

  /** A power-weapon blow: the field discharging - a burst of blue-white sparks (more for the fists). */
  power(x, y, dir, weapon = 'sword') {
    const n = weapon === 'fists' ? 22 : 16;
    for (let i = 0; i < n; i++) {
      const c = this.rng() < 0.5 ? 0xd8f0ff : this.rng() < 0.6 ? 0x7cc4ff : 0xffffff;
      this.sparks.emit(x, y, 0.7, dir * (1 + this.rng() * 5) + (this.rng() - 0.5) * 3, (this.rng() - 0.3) * 6, 0.12 + this.rng() * 0.25, c, 1.3, 8);
    }
  }

  /** A shove: a scuff of sparks off armour and chitin. */
  shove(x, y) {
    for (let i = 0; i < 10; i++) this.sparks.emit(x, y, 0.8, (this.rng() - 0.5) * 4, this.rng() * 3, 0.15 + this.rng() * 0.2, 0xffe0a0, 1, 10);
  }

  /** Follow the sim's acid each frame: globs in flight trail drips; pools glow and fade. */
  syncAcid(projectiles, pools) {
    this.globs.forEach((m, i) => {
      const p = projectiles[i];
      m.visible = !!p;
      if (!p) return;
      m.position.set(p.x, p.y, 0.7);
      if (this.rng() < 0.5) this.sparks.emit(p.x, p.y, 0.6, -p.vx * 0.1, -0.5, 0.25, 0x9fe030, 1.2, 6);
    });
    this.puddles.forEach((m, i) => {
      const p = pools[i];
      m.visible = !!p;
      if (!p) return;
      m.position.set(p.x, p.y + 0.06, 0.9);
      m.scale.set(p.r * 2, 1, 1);
      m.material.opacity = Math.min(1, p.t / 1.5);
      if (this.rng() < 0.08) this.sparks.emit(p.x + (this.rng() - 0.5) * p.r * 2, p.y + 0.05, 0.8, 0, 0.6 + this.rng(), 0.4, 0x9fe030, 1, -0.5);
    });
  }

  acidSplash(x, y) {
    for (let i = 0; i < 14; i++) this.sparks.emit(x, y + 0.1, 0.7, (this.rng() - 0.5) * 4, 1 + this.rng() * 3, 0.3 + this.rng() * 0.3, this.rng() < 0.5 ? 0xc0ff50 : 0x70b020, 1.4, 12);
  }

  removeFire(id) {
    const f = this.fires.get(id);
    this.fires.delete(id);
    if (!f) return;
    for (let i = 0; i < 14; i++) this.smoke.emit(f.x + (this.rng() - 0.5), f.y + 0.5 + this.rng() * 2, 0.4, (this.rng() - 0.5) * 0.6, 0.6 + this.rng(), 1.2 + this.rng(), 0x9a9a9a, 1, -0.4);
  }

  update(dt) {
    // Flares: a hissing red-pink fountain and a drift of smoke, for good.
    for (const f of this.flares.values()) {
      f.acc += dt;
      while (f.acc > 1 / 40) {
        f.acc -= 1 / 40;
        this.sparks.emit(f.x + (this.rng() - 0.5) * 0.1, f.y + 0.12, 0.85, (this.rng() - 0.5) * 1.6, 1.2 + this.rng() * 2.2, 0.25 + this.rng() * 0.35, this.rng() < 0.6 ? 0xff4a30 : 0xffb0a0, 1.2, 6);
        if (this.rng() < 0.12) this.smoke.emit(f.x, f.y + 0.4, 0.6, (this.rng() - 0.5) * 0.3, 0.4 + this.rng() * 0.4, 2 + this.rng(), 0x8a5a60, 0.8, -0.2);
      }
    }
    for (const f of this.fires.values()) {
      f.acc += dt;
      while (f.acc > 1 / 70) {
        f.acc -= 1 / 70;
        const r = this.rng();
        this.flames.emit(f.x + (this.rng() - 0.5) * 0.8, f.y + this.rng() * 2.4, 0.3 + this.rng() * 0.5, (this.rng() - 0.5) * 0.5, 1 + this.rng() * 1.8,
          0.35 + this.rng() * 0.5, r < 0.4 ? 0xffd060 : r < 0.8 ? 0xff7a20 : 0xc02a10, 1 + this.rng() * 0.6, -1.5);
        if (this.rng() < 0.22) this.smoke.emit(f.x + (this.rng() - 0.5) * 0.6, f.y + 2.4 + this.rng() * 0.6, 0.2, (this.rng() - 0.5) * 0.4, 0.5 + this.rng() * 0.5, 1.6 + this.rng(), 0x262422, 1, -0.3);
      }
    }
    this.flames.update(dt);
    this.smoke.update(dt);
    for (const f of this.fireballs ?? []) {
      if (f.t >= 1) continue;
      f.t = Math.min(1, f.t + dt / 0.55);
      const k = f.t;
      const s = f.r * (0.6 + 1.4 * Math.sqrt(k));
      f.ball.scale.set(s, s, 1);
      f.ball.material.uniforms.k.value = k;
      const rs = f.r * 1.6 * Math.sqrt(k);
      f.ring.scale.set(rs, rs, 1);
      f.ring.material.opacity = Math.max(0, 0.8 - k * 1.6);
      if (f.t >= 1) f.ball.visible = f.ring.visible = false;
    }
    for (const t of this.tracers) if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.mesh.visible = false; }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.mesh.material.uniforms.a.value = Math.max(0, f.life / 0.045);
      if (f.life <= 0) f.mesh.visible = false;
    }
    this.sparks.update(dt);
    this.blood.update(dt);

    let nc = 0;
    let ng = 0;
    for (const d of this.physics.debris) {
      const p = d.body.translation();
      const r = d.body.rotation();
      this.q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), r);
      this.m.compose(this.v.set(p.x, p.y, d.z ?? 0.3), this.q, this.one);
      if (d.kind === 'casing') this.casingMesh.setMatrixAt(nc++, this.m);
      else { this.gibMesh.setMatrixAt(ng, this.m); this.gibMesh.setColorAt(ng++, d.color ?? this.gibColors[0]); }
    }
    this.casingMesh.count = nc;
    this.gibMesh.count = ng;
    this.casingMesh.instanceMatrix.needsUpdate = true;
    this.gibMesh.instanceMatrix.needsUpdate = true;
    if (this.gibMesh.instanceColor) this.gibMesh.instanceColor.needsUpdate = true;
  }
}
