// Runtime 2D skeletal rig. Parts come from assets/rigs/<name>.json (see tools/gen_sprites.py for
// the conventions). Bones are kept flat inside one Container and transformed manually every frame
// so draw order (z) is independent of the hierarchy.
//
// Angles are degrees. Limbs hang down (0 = straight down; negative swings the tip forward, toward
// the facing direction). Torso and head point up (positive = lean forward).

const DEG = Math.PI / 180;

function smooth(t) { return t * t * (3 - 2 * t); }

export default class Rig extends Phaser.GameObjects.Container {
  constructor(scene, x, y, def, clips, opts = {}) {
    super(scene, x, y);
    this.def = def;
    this.clips = clips;
    this.bones = {};
    this.order = [];
    this.facing = 1;
    this.tintColor = opts.tint || null;
    this.farTint = opts.farTint === undefined ? 0x9a9ab0 : opts.farTint;
    this.scaleFactor = opts.scale || 1;
    this.setScale(this.scaleFactor);

    // Build bone table in parent-first order.
    const byName = {};
    for (const p of def.parts) byName[p.name] = p;
    const resolved = new Set();
    const ordered = [];
    while (ordered.length < def.parts.length) {
      for (const p of def.parts) {
        if (resolved.has(p.name)) continue;
        if (p.parent && !resolved.has(p.parent)) continue;
        resolved.add(p.name); ordered.push(p);
      }
    }
    for (const p of ordered) {
      const img = scene.add.image(0, 0, `rig_${p.tex}`);
      const tex = img.texture.getSourceImage();
      img.setOrigin(p.pivot[0] / tex.width, p.pivot[1] / tex.height);
      if (p.name.endsWith('_far') || p.name === 'shield') img.setTint(this.farTint);
      this.bones[p.name] = { def: p, img, angle: 0, wx: 0, wy: 0, wr: 0, sx: 1, sy: 1, visible: true };
      this.order.push(p.name);
    }
    // add images in z order
    const zsorted = [...def.parts].sort((a, b) => a.z - b.z);
    for (const p of zsorted) this.add(this.bones[p.name].img);
    scene.add.existing(this);
    if (scene.lighting) scene.lighting.lit(this);

    this.clip = null;
    this.clipTime = 0;
    this.clipName = '';
    this.finished = false;
    this.speed = 1;
    this.fade = 0; this.fadeDur = 0; this.fromPose = null;
    this.pose = this.emptyPose();
    this.rootOffset = { x: 0, y: 0 };
    this.extraRot = 0;             // whole-body rotation (dodge roll)
    this.firedEvents = new Set();
    this.onEvent = null;
    this.hitFlash = 0;
    this.base = {};
    if (def.hunch) this.base.torso = def.hunch;
  }

  emptyPose() {
    const p = { root: { x: 0, y: 0 }, bones: {} };
    for (const n of this.order) p.bones[n] = 0;
    return p;
  }

  play(name, { force = false, fade = 90, speed = 1, restart = false } = {}) {
    if (this.clipName === name && !restart && !force) { this.speed = speed; return; }
    const clip = this.clips[name];
    if (!clip) { console.warn('missing clip', name, this.def.name); return; }
    if (this.clip) {
      this.fromPose = this.evaluate(this.clip, this.clipTime);
      this.fade = fade; this.fadeDur = fade;
    }
    this.clip = clip;
    this.clipName = name;
    this.clipTime = 0;
    this.finished = false;
    this.speed = speed;
    this.firedEvents.clear();
  }

  // Evaluate a clip at time t (ms) -> pose object (angles in degrees + root offset)
  evaluate(clip, t) {
    const keys = clip.keys;
    const dur = clip.duration;
    let u = clip.loop ? ((t % dur) + dur) % dur / dur : Math.min(1, t / dur);
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= u) i++;
    const a = keys[i];
    let b, span, local;
    if (i < keys.length - 1) { b = keys[i + 1]; span = b.t - a.t; local = span > 0 ? (u - a.t) / span : 1; }
    else if (clip.loop) { b = keys[0]; span = 1 - a.t; local = span > 0 ? (u - a.t) / span : 1; }
    else { b = a; local = 1; }
    const f = clip.linear ? local : smooth(local);
    const pose = { root: { x: 0, y: 0 }, bones: {} };
    const ap = a.pose, bp = b.pose;
    for (const n of this.order) {
      const av = ap[n] !== undefined ? ap[n] : 0;
      const bv = bp[n] !== undefined ? bp[n] : 0;
      pose.bones[n] = av + (bv - av) * f;
    }
    pose.root.x = (ap.rootX || 0) + ((bp.rootX || 0) - (ap.rootX || 0)) * f;
    pose.root.y = (ap.rootY || 0) + ((bp.rootY || 0) - (ap.rootY || 0)) * f;
    pose.rot = (ap.rot || 0) + ((bp.rot || 0) - (ap.rot || 0)) * f;
    return pose;
  }

  update(dt) {
    if (!this.clip) return;
    const prev = this.clipTime;
    this.clipTime += dt * this.speed;
    const clip = this.clip;
    // events
    if (clip.events && this.onEvent) {
      const dur = clip.duration;
      for (const ev of clip.events) {
        const et = ev.t * dur;
        if (clip.loop) {
          const p = ((prev % dur) + dur) % dur, c = ((this.clipTime % dur) + dur) % dur;
          const crossed = (p <= et && c > et) || (c < p && (et > p || et <= c));
          if (crossed) this.onEvent(ev.name, ev);
        } else if (prev < et && this.clipTime >= et && !this.firedEvents.has(ev.name + ev.t)) {
          this.firedEvents.add(ev.name + ev.t);
          this.onEvent(ev.name, ev);
        }
      }
    }
    if (!clip.loop && this.clipTime >= clip.duration && !this.finished) {
      this.finished = true;
      if (this.onEvent) this.onEvent('end', { clip: this.clipName });
    }
    let pose = this.evaluate(clip, this.clipTime);
    if (this.fade > 0 && this.fromPose) {
      this.fade -= dt;
      const k = smooth(Math.max(0, Math.min(1, 1 - this.fade / this.fadeDur)));
      for (const n of this.order) pose.bones[n] = this.fromPose.bones[n] + (pose.bones[n] - this.fromPose.bones[n]) * k;
      pose.root.x = this.fromPose.root.x + (pose.root.x - this.fromPose.root.x) * k;
      pose.root.y = this.fromPose.root.y + (pose.root.y - this.fromPose.root.y) * k;
      pose.rot = (this.fromPose.rot || 0) + ((pose.rot || 0) - (this.fromPose.rot || 0)) * k;
    }
    this.pose = pose;
    this.apply(pose);
  }

  apply(pose) {
    const rootRot = ((pose.rot || 0) + this.extraRot) * DEG;
    const cosR = Math.cos(rootRot), sinR = Math.sin(rootRot);
    for (const n of this.order) {
      const b = this.bones[n];
      const d = b.def;
      const local = (pose.bones[n] || 0) + (this.base[n] || 0);
      let px = pose.root.x + this.rootOffset.x, py = pose.root.y + this.rootOffset.y, pr = rootRot;
      if (d.parent) {
        const P = this.bones[d.parent];
        px = P.wx; py = P.wy; pr = P.wr;
      }
      const c = Math.cos(pr), s = Math.sin(pr);
      const ax = d.at[0], ay = d.at[1];
      b.wx = px + ax * c - ay * s;
      b.wy = py + ax * s + ay * c;
      b.wr = pr + local * DEG;
      b.img.setPosition(b.wx, b.wy).setRotation(b.wr);
    }
    this.scaleX = this.facing * this.scaleFactor;
  }

  setFacing(f) { this.facing = f < 0 ? -1 : 1; }

  flash(ms = 90) { this.hitFlash = ms; for (const n of this.order) this.bones[n].img.setTintFill(0xffffff); }

  tick(dt) {
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      if (this.hitFlash <= 0) {
        for (const n of this.order) {
          const b = this.bones[n];
          b.img.clearTint();
          if (n.endsWith('_far') || n === 'shield') b.img.setTint(this.farTint);
          if (this.tintColor) b.img.setTint(this.tintColor);
        }
      }
    }
  }

  // World position of a bone tip (end of its length) — used for hitboxes and effects.
  boneTip(name, len) {
    const b = this.bones[name];
    if (!b) return { x: this.x, y: this.y };
    const L = len !== undefined ? len : (b.def.len || 0);
    const lx = -Math.sin(b.wr) * L, ly = Math.cos(b.wr) * L;
    return { x: this.x + (b.wx + lx) * this.facing * this.scaleFactor, y: this.y + (b.wy + ly) * this.scaleFactor };
  }

  bonePos(name) {
    const b = this.bones[name];
    return { x: this.x + b.wx * this.facing * this.scaleFactor, y: this.y + b.wy * this.scaleFactor };
  }

  setBoneVisible(name, v) { if (this.bones[name]) this.bones[name].img.setVisible(v); }
}
