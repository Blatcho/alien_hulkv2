// GLB loading and animated characters. Every model is a Blender-script export (tools/blender) with a
// sidecar meta JSON: bones, which bones are the upper body, clip loop/events/speed, aim bone, muzzle.
// Characters face +x in model space; they are shown at a 3/4 yaw and turned around to face left.
// Upper-body clips (reload, fire, strike) play on the upper bones only, layered over the walk or run
// that the legs keep playing.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

export const YAW = 0.62;
const loader = new GLTFLoader();
const cache = new Map();

export async function loadModel(name) {
  if (cache.has(name)) return cache.get(name);
  const p = (async () => {
    const [gltf, meta] = await Promise.all([
      new Promise((res, rej) => loader.load(`assets/models/${name}.glb`, res, undefined, rej)),
      fetch(`assets/models/${name}.meta.json`).then((r) => (r.ok ? r.json() : {})),
    ]);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const conv = mats.map((m) => toLambert(m));
      o.material = Array.isArray(o.material) ? conv : conv[0];
    });
    const clips = {};
    for (const c of gltf.animations) clips[c.name] = c;
    const upper = new Set(meta.upper || []);
    const split = {};
    if (meta.upper) {
      for (const c of gltf.animations) {
        const up = [], low = [];
        for (const t of c.tracks) {
          const bone = t.name.split('.')[0];
          (upper.has(bone) ? up : low).push(t);
        }
        split[c.name] = {
          upper: new THREE.AnimationClip(c.name + '#u', c.duration, up),
          lower: new THREE.AnimationClip(c.name + '#l', c.duration, low),
        };
      }
    }
    return { name, gltf, meta, clips, split };
  })();
  cache.set(name, p);
  return p;
}

function toLambert(m) {
  const lm = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff });
  if (m.emissive) { lm.emissive.copy(m.emissive); lm.emissiveIntensity = Math.min(1.8, m.emissiveIntensity || 1); }
  lm.name = m.name;
  return lm;
}

export function instantiate(model) {
  const root = skeletonClone(model.gltf.scene);
  const meshes = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const cl = mats.map((m) => m.clone());
    o.material = Array.isArray(o.material) ? cl : cl[0];
    meshes.push(o);
  });
  return { root, meshes };
}

// A rigged character with a lower/upper layer, procedural upper-body aim, clip events and speed.
export class Character {
  constructor(model) {
    this.model = model;
    this.meta = model.meta;
    const { root, meshes } = instantiate(model);
    this.inner = root;
    this.meshes = meshes;
    this.group = new THREE.Group();
    this.group.add(this.inner);
    this.inner.rotation.y = YAW;
    this.mixer = new THREE.AnimationMixer(this.inner);
    this.actions = {};                       // name -> {lower, upper} or {full}
    this.layered = !!model.meta.upper;
    for (const [name, clip] of Object.entries(model.clips)) {
      const spec = (model.meta.clips && model.meta.clips[name]) || {};
      if (this.layered) {
        const s = model.split[name];
        const lower = this.mixer.clipAction(s.lower), upper = this.mixer.clipAction(s.upper);
        for (const a of [lower, upper]) { a.setLoop(spec.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = true; a.enabled = true; }
        this.actions[name] = { lower, upper, spec };
      } else {
        const full = this.mixer.clipAction(clip);
        full.setLoop(spec.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); full.clampWhenFinished = true;
        this.actions[name] = { full, spec };
      }
    }
    this.base = null;                        // name of the base clip (plays on both layers)
    this.upperOverride = null;               // {name, action, done}
    this.facing = 1;
    this.aimAngle = 0;                       // radians, 0 = along facing, + up
    this.aimBone = model.meta.aim_bone ? this.inner.getObjectByName(model.meta.aim_bone) : null;
    this.gunBone = model.meta.gun_bone ? this.inner.getObjectByName(model.meta.gun_bone) : null;
    this.flash = 0;
    this.events = [];                        // clip events fired this frame: {clip, name}
    this._eventState = new Map();
    this.timeScale = 1;
    this._q = new THREE.Quaternion(); this._axis = new THREE.Vector3(); this._pq = new THREE.Quaternion();
    // the muzzle in the gun bone's space, from the rest pose
    this.group.updateMatrixWorld(true);
    const mz = model.meta.muzzle || [20, 0, 40];
    const wp = this.inner.localToWorld(new THREE.Vector3(mz[0], mz[2], -mz[1]));
    this.muzzleLocal = this.gunBone ? this.gunBone.worldToLocal(wp.clone()) : null;
    this.muzzleModel = new THREE.Vector3(mz[0], mz[2], -mz[1]);
  }

  has(name) { return !!this.actions[name]; }

  // Base clip: the whole body (or just the legs while an upper override plays).
  play(name, { fade = 0.12, restart = false, timeScale } = {}) {
    const a = this.actions[name];
    if (!a) return;
    if (this.base === name && !restart) { if (timeScale !== undefined) this.setTimeScale(timeScale); return; }
    const prev = this.base ? this.actions[this.base] : null;
    this.base = name;
    if (this.layered) {
      this._cross(prev && prev.lower, a.lower, fade);
      if (!this.upperOverride) this._cross(prev && prev.upper, a.upper, fade);
    } else {
      this._cross(prev && prev.full, a.full, fade);
    }
    if (timeScale !== undefined) this.setTimeScale(timeScale);
    this._eventState.delete(name);
  }

  _cross(from, to, fade) {
    to.reset(); to.setEffectiveWeight(1); to.setEffectiveTimeScale(this.timeScale); to.play();
    if (from && from !== to) { from.crossFadeTo(to, fade, false); }
  }

  setTimeScale(ts) {
    this.timeScale = ts;
    const a = this.actions[this.base];
    if (!a) return;
    if (this.layered) { a.lower.setEffectiveTimeScale(ts); if (!this.upperOverride) a.upper.setEffectiveTimeScale(ts); }
    else a.full.setEffectiveTimeScale(ts);
  }

  // Upper-body clip over the current base (reload, fire, strike). Returns its duration in seconds.
  playUpper(name, { fade = 0.08, timeScale = 1, loop = false } = {}) {
    const a = this.actions[name];
    if (!a || !this.layered) return 0;
    const cur = this.upperOverride ? this.actions[this.upperOverride.name].upper : (this.base ? this.actions[this.base].upper : null);
    a.upper.reset(); a.upper.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.upper.clampWhenFinished = true;
    a.upper.setEffectiveWeight(1); a.upper.setEffectiveTimeScale(timeScale); a.upper.play();
    if (cur && cur !== a.upper) cur.crossFadeTo(a.upper, fade, false);
    const dur = a.upper.getClip().duration / timeScale;
    this.upperOverride = { name, action: a.upper, t: 0, dur, loop };
    this._eventState.delete(name);
    return dur;
  }

  stopUpper(fade = 0.12) {
    if (!this.upperOverride) return;
    const cur = this.upperOverride.action;
    this.upperOverride = null;
    const base = this.base ? this.actions[this.base].upper : null;
    if (base) { base.reset(); base.time = this.actions[this.base].lower.time; base.setEffectiveWeight(1); base.setEffectiveTimeScale(this.timeScale); base.play(); cur.crossFadeTo(base, fade, false); }
    else cur.stop();
  }

  setFacing(f) {
    if (f === this.facing) return;
    this.facing = f;
    this.inner.rotation.y = f > 0 ? YAW : Math.PI - YAW;
  }

  // Did the base clip finish (non-looping)?
  finished() {
    const a = this.actions[this.base];
    if (!a) return true;
    const act = this.layered ? a.lower : a.full;
    return act.loop === THREE.LoopOnce && act.time >= act.getClip().duration - 1e-3;
  }

  progress() {
    const a = this.actions[this.base];
    if (!a) return 0;
    const act = this.layered ? a.lower : a.full;
    return act.time / act.getClip().duration;
  }

  update(dt) {
    this.events.length = 0;
    this.mixer.update(dt);
    if (this.upperOverride && !this.upperOverride.loop) {
      this.upperOverride.t += dt;
      if (this.upperOverride.t >= this.upperOverride.dur) this.stopUpper();
    }
    // clip events (frame numbers from the meta) for the base clip and the upper override
    this._collectEvents(this.base, this.layered ? 'lower' : 'full');
    if (this.upperOverride) this._collectEvents(this.upperOverride.name, 'upper');
    // procedural aim: rotate the aim bone about the screen normal after the mixer has posed it
    if (this.aimBone && this.aimAngle !== 0) {
      const parent = this.aimBone.parent;
      parent.getWorldQuaternion(this._pq);
      this._axis.set(0, 0, 1).applyQuaternion(this._pq.invert());
      this._q.setFromAxisAngle(this._axis, this.aimAngle * this.facing);
      this.aimBone.quaternion.premultiply(this._q);
    }
    this.group.updateMatrixWorld(true);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt);
      const k = this.flash > 0 ? 1 : 0;
      for (const m of this.meshes) for (const mat of (Array.isArray(m.material) ? m.material : [m.material])) mat.emissive.setScalar(k ? 1.2 : 0), mat.emissiveIntensity = k ? 1 : (mat.userData.ei || 1);
      if (!k) this._restoreEmissive();
    }
  }

  _restoreEmissive() {
    const src = this.model.gltf.scene;
    const srcMeshes = []; src.traverse((o) => { if (o.isMesh) srcMeshes.push(o); });
    this.meshes.forEach((m, i) => {
      const s = srcMeshes[i]; if (!s) return;
      const a = Array.isArray(m.material) ? m.material : [m.material];
      const b = Array.isArray(s.material) ? s.material : [s.material];
      a.forEach((mat, j) => { if (b[j]) { mat.emissive.copy(b[j].emissive); mat.emissiveIntensity = b[j].emissiveIntensity; } });
    });
  }

  hitFlash(t = 0.08) { this.flash = t; }

  _collectEvents(name, layer) {
    const a = this.actions[name];
    if (!a || !a.spec.events) return;
    const act = a[layer];
    const clip = act.getClip();
    const fps = a.spec.fps || 24, frames = a.spec.frames || Math.round(clip.duration * fps) + 1;
    const t = act.time;
    const frame = (t / clip.duration) * (frames - 1) + 1;
    const key = name + layer;
    const last = this._eventState.get(key);
    for (const [ev, list] of Object.entries(a.spec.events)) {
      for (const f of list) {
        const crossed = last === undefined ? frame >= f : (frame >= f && last < f) || (last > frame && (frame >= f || last < f));
        if (crossed) this.events.push({ clip: name, name: ev });
      }
    }
    this._eventState.set(key, frame);
  }

  worldPoint(local, out = new THREE.Vector3()) {
    out.set(local[0], local[2], -local[1]);            // Blender (x, y, z) -> glTF (x, z, -y)
    return this.inner.localToWorld(out);
  }

  // The gun muzzle in world space, following the aim.
  muzzle(out = new THREE.Vector3()) {
    if (this.gunBone && this.muzzleLocal) { out.copy(this.muzzleLocal); return this.gunBone.localToWorld(out); }
    out.copy(this.muzzleModel);
    return this.inner.localToWorld(out);
  }
}
