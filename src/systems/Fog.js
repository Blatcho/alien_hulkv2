// Fog of war from a visibility polygon: rays are cast from the marine's eyes through the tile grid
// (floors, bulkheads, closed doors and vents occlude), the fan is drawn into a 'visible' canvas and
// accumulated into a 'seen' canvas. A full-ship quad in front of the scene darkens what is unseen
// and dims what is only remembered. The flashlight cone reaches further than the ambient glimpse.
import * as THREE from 'three';
import { T, TILE } from '../gen/Ship.js';

const RAYS = 180;
const RES = 4;                                  // world pixels per fog texel

export class Fog {
  constructor(game) {
    this.game = game;
    const ship = game.ship;
    this.w = Math.ceil((ship.W * TILE) / RES); this.h = Math.ceil((ship.H * TILE) / RES);
    this.vis = document.createElement('canvas'); this.vis.width = this.w; this.vis.height = this.h;
    this.seen = document.createElement('canvas'); this.seen.width = this.w; this.seen.height = this.h;
    this.vctx = this.vis.getContext('2d'); this.sctx = this.seen.getContext('2d');
    this.sctx.fillStyle = '#000'; this.sctx.fillRect(0, 0, this.w, this.h);
    this.visTex = new THREE.CanvasTexture(this.vis); this.seenTex = new THREE.CanvasTexture(this.seen);
    for (const t of [this.visTex, this.seenTex]) { t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.colorSpace = THREE.NoColorSpace; t.flipY = false; }
    const W = ship.W * TILE, H = ship.H * TILE;
    const mat = new THREE.ShaderMaterial({
      uniforms: { vis: { value: this.visTex }, seen: { value: this.seenTex }, memory: { value: 0.42 } },
      transparent: true, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D vis; uniform sampler2D seen; uniform float memory; varying vec2 vUv;
        void main(){ vec2 uv = vUv; float v = texture2D(vis, uv).r; float s = texture2D(seen, uv).r;
        float a = 1.0 - max(v, s * memory); gl_FragColor = vec4(0.01, 0.012, 0.02, a); }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    this.mesh.position.set(W / 2, H / 2, 300);
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
    game.renderer.scene.add(this.mesh);
    this.hits = new Float32Array(RAYS);         // distance per ray from the last cast
    this.ox = 0; this.oy = 0;
    this.range = 300; this.coneRange = 470; this.coneHalf = 0.42;
    this.aimA = 0;
    this.tick = 0;
  }

  // Distance a ray travels before hitting an occluder (closed doors occlude).
  cast(x0, y0, a, maxD) {
    const ph = this.game.physics;
    const dx = Math.cos(a), dy = Math.sin(a);
    const n = Math.ceil(maxD / 6);
    for (let i = 1; i <= n; i++) {
      const d = (maxD * i) / n;
      const c = Math.floor((x0 + dx * d) / TILE), r = Math.floor((y0 + dy * d) / TILE);
      const t = ph.tile(c, r);
      if (t === T.SOLID || t === T.AIRLOCK || t === T.VENT || t === T.HATCH || (t === T.DOOR && !this.game.world.doorOpenAt(c, r))) return Math.min(maxD, d + 26);
    }
    return maxD;
  }

  update(dt) {
    const p = this.game.player;
    const ex = p.cx, ey = p.body.y + p.body.h * 0.85;
    this.ox = ex; this.oy = ey;
    this.aimA = Math.atan2(p.aim.y, p.aim.x);
    const ctx = this.vctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, this.w, this.h);
    // polygon
    const pts = [];
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2;
      let da = Math.abs(((a - this.aimA + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const inCone = da < this.coneHalf && !p.dead;
      const maxD = inCone ? this.coneRange : this.range;
      const d = this.cast(ex, ey, a, maxD);
      this.hits[i] = d;
      pts.push([ex + Math.cos(a) * d, ey + Math.sin(a) * d]);
    }
    const grad = ctx.createRadialGradient(ex / RES, ey / RES, 10, ex / RES, ey / RES, this.coneRange / RES);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.75, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x / RES, y / RES) : ctx.moveTo(x / RES, y / RES)));
    ctx.closePath(); ctx.fill();
    // the room the marine stands in is always faintly lit (the cut-away lets the player see it)
    const room = this.game.world.roomOf(p.x, p.y);
    if (room) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect((room.x0 * TILE) / RES, (room.y0 * TILE) / RES, ((room.x1 - room.x0 + 1) * TILE) / RES, ((room.y1 - room.y0 + 1) * TILE) / RES);
      this.game.world.seen.add(room.id);
    }
    this.visTex.needsUpdate = true;
    // memory
    this.tick++;
    if (this.tick % 3 === 0) {
      const s = this.sctx;
      s.globalCompositeOperation = 'lighter';
      s.globalAlpha = 0.5;
      s.drawImage(this.vis, 0, 0);
      s.globalAlpha = 1;
      this.seenTex.needsUpdate = true;
    }
  }

  // Is a world point inside the current visibility polygon? (for hiding hostiles in the dark)
  visibleAt(x, y, slack = 12) {
    const dx = x - this.ox, dy = y - this.oy;
    const d = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    let i = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * RAYS) % RAYS;
    const h = Math.max(this.hits[i], this.hits[(i + 1) % RAYS], this.hits[(i + RAYS - 1) % RAYS]);
    return d <= h + slack;
  }
}
