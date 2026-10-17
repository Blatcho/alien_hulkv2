// Points of interaction (world.interactables()): everything the squad can be sent to - doors,
// ladders and stairs, crates with something left in them, terminals and set pieces, vents to weld,
// door controls, survivors, men down, fuel barrels, fires - breathes with a faint glow in the
// scene, in a colour for its kind, so the player sees what there is to click before the cursor
// finds it (ui/interact.js then shows the ring and what the squad would do). Only things in rooms
// the squad knows, under the fog of war like everything else; each fades in when it turns up and
// out once it's done (searched, welded, rescued...). A fixed pool of sprites, never reallocated.
import * as THREE from 'three';

// Per kind: colour, size (metres) and strength (x the base glow).
const KIND = {
  door: { color: 0x86d6ff, size: 1.15, k: 0.85 },
  ladder: { color: 0x86d6ff, size: 0.95, k: 0.75 },
  stairs: { color: 0x86d6ff, size: 0.95, k: 0.75 },
  doorctl: { color: 0xa8cce0, size: 0.6, k: 0.5 },
  vent: { color: 0xa8cce0, size: 0.75, k: 0.55 },
  crate: { color: 0xffc463, size: 1.0, k: 1 },
  terminal: { color: 0x7dffa8, size: 0.95, k: 1 },
  distress: { color: 0xffd060, size: 1.3, k: 1.2 },
  survivor: { color: 0xffe6a0, size: 1.3, k: 1 },
  downed: { color: 0xff5a40, size: 1.4, k: 1.2 },
  barrel: { color: 0xff9a40, size: 0.95, k: 0.9 },
  fire: { color: 0xff7a20, size: 1.1, k: 0.8 },
};
const MAX = 160;
const BASE = 0.26;   // glow at the bottom of a breath
const PULSE = 0.2;   // ... and how much it swells
const PERIOD = 2.8;  // seconds a breath
const FADE = 3;      // per second, in and out
const LIST_EVERY = 0.1; // sim seconds between re-reading the list (positions in between come from it too)

/** A soft round glow with a small crisp diamond at its heart (the "something here" pip). */
function glowTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 2.5;
  g.beginPath();
  const r = 7;
  g.moveTo(S / 2, S / 2 - r); g.lineTo(S / 2 + r, S / 2); g.lineTo(S / 2, S / 2 + r); g.lineTo(S / 2 - r, S / 2); g.closePath();
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Markers {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'interaction-markers';
    scene.add(this.group);
    const map = glowTexture();
    this.pool = Array.from({ length: MAX }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false,
      }));
      s.renderOrder = 5;
      s.visible = false;
      this.group.add(s);
      return s;
    });
    this.items = new Map(); // id -> { t (the interactable), a (fade 0..1), on, phase }
    this.listAt = -Infinity; // sim time the list was last read
    this.enabled = true;
  }

  update(world, dt) {
    // (Sim time for the list - it changes when the sim does, paused or stepped; wall-clock time
    // for the breathing, which goes on through a pause.)
    const breathT = performance.now() / 1000;
    if (Math.abs(world.time - this.listAt) >= LIST_EVERY) {
      this.listAt = world.time;
      const now = new Set();
      for (const t of world.status === 'playing' ? world.interactables() : []) {
        if (!KIND[t.kind]) continue;
        now.add(t.id);
        const it = this.items.get(t.id);
        if (it) { it.t = t; it.on = true; } else this.items.set(t.id, { t, a: 0, on: true, phase: (hashId(t.id) % 1000) / 1000 });
      }
      for (const [id, it] of this.items) if (!now.has(id)) it.on = false;
    }
    let n = 0;
    for (const [id, it] of this.items) {
      it.a = Math.max(0, Math.min(1, it.a + (it.on ? FADE : -FADE) * Math.max(dt, 1 / 60)));
      if (!it.on && it.a <= 0) { this.items.delete(id); continue; }
      if (!this.enabled || n >= MAX) continue;
      const t = it.t;
      const K = KIND[t.kind];
      // An open door you'd just walk through matters less than a closed one.
      const open = t.kind === 'door' && world.level.portals[t.portal]?.open;
      const breath = 0.5 + 0.5 * Math.sin(((breathT / PERIOD) + it.phase) * Math.PI * 2);
      const s = this.pool[n++];
      s.visible = true;
      s.position.set(t.x, t.y, 1.2);
      const size = K.size * (0.92 + 0.08 * breath);
      s.scale.set(size, size, 1);
      s.material.color.setHex(K.color);
      s.material.opacity = (BASE + PULSE * breath) * K.k * (open ? 0.5 : 1) * it.a;
    }
    for (let i = n; i < MAX; i++) this.pool[i].visible = false;
  }
}

/** A stable small number from an id (so each marker breathes on its own phase). */
function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}
