// Visual side of entities: skinned GLB characters driven by the sim's `anim` state.
// Crossfades between clips, matches walk-cycle playback to movement speed (no foot sliding),
// turns characters to a 3/4 view, hides whatever the squad cannot see.
import * as THREE from 'three';
import { ALIEN, AWARE, CRITTER, SQUAD } from '../core/config.js';
import { STEP } from '../core/loop.js';

const ONE_SHOT = new Set(['die', 'reload', 'jump', 'hit', 'leap', 'signal', 'bash', 'slash', 'punch']);
// Missing clip -> next best (lets the engine run on older art builds).
const FALLBACK = {
  idle_casual: 'idle_alert', idle_alert: 'idle', walk_casual: 'walk_alert', walk_alert: 'walk', walk_aim: 'walk_alert',
  crouch_alert: 'crouch', crouch_aim: 'crouch', crouch: 'aim', aim_up: 'aim', aim_down: 'crouch_aim', signal: 'idle_alert',
  crouch_walk: 'walk_alert', crouch_shoot: 'shoot', aim: 'idle_alert', shoot: 'aim', run: 'walk_alert',
  interact: 'idle_alert', climb: 'walk', reload: 'aim', hit: 'idle_alert', jump: 'idle_alert', bash: 'signal',
  slash: 'bash', punch: 'bash',
  cower: 'idle', wave: 'idle',
  lurk: 'idle', skitter: 'idle', attack: 'idle', leap: 'skitter', scurry: 'idle', scream: 'attack',
};
const MOVE_SPEED = {
  walk: SQUAD.WALK, walk_casual: SQUAD.WALK, walk_alert: SQUAD.WALK, walk_aim: 1.2, run: SQUAD.RUN,
  crouch_walk: SQUAD.CROUCH, climb: SQUAD.CLIMB, skitter: ALIEN.SPEED, scurry: CRITTER.SPEED,
};
const YAW_3Q = 0.42; // radians turned toward the camera
// Aliens on walls and ceilings (sim/alien.js): the whole body rolls onto that surface, applied
// over the usual facing yaw - upside down on the ceiling, side-on against a bulkhead.
const Q_FLOOR = new THREE.Quaternion();
const Q_CEILING = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const Q_WALL_LEFT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
const Q_WALL_RIGHT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
const UP = new THREE.Vector3(0, 1, 0);
const surfaceRoll = (e) => (e.surface === 'ceiling' ? Q_CEILING : e.surface === 'wall' ? (e.side < 0 ? Q_WALL_LEFT : Q_WALL_RIGHT) : Q_FLOOR);
// Clips that pose the weapon themselves (or have no aim): no look-pitch layered on top.
const NO_AIM = new Set(['aim_up', 'aim_down', 'climb', 'interact', 'die', 'signal', 'jump', 'hit', 'slash', 'punch']);
// The minigun's barrels (bone 'spin'): radians a second at full spin (sim/combat.js m.spin).
const SPIN_RATE = 38;
// On the move an action plays over the legs (sim/tactics.js animUpper): the locomotion clip keeps
// the hips and legs, the action clip everything above. Bones by name (GLTF node names, '.' -> '_').
const LEGS = new Set(['hips', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R']);
const legTrack = (t) => LEGS.has(t.name.slice(0, t.name.lastIndexOf('.')).replace(/\./g, '_'));

function placeholder(kind, tint) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: tint ?? (kind === 'alien' ? 0x5a2a44 : 0x6a6a5a), flatShading: true, roughness: 0.7 });
  if (kind === 'marine') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.1, 4, 8), mat);
    body.position.y = 1.0;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.9), new THREE.MeshStandardMaterial({ color: 0x2c3034 }));
    gun.position.set(0, 1.25, 0.5);
    g.add(body, gun);
  } else if (kind === 'alien') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 1.6), mat);
    body.position.y = 0.9;
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.05), new THREE.MeshStandardMaterial({ emissive: 0xffd040, emissiveIntensity: 4 }));
    eyes.position.set(0, 1.15, 0.82);
    g.add(body, eyes);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.5), mat);
    body.position.y = 0.1;
    g.add(body);
  }
  return { root: g, mixer: null, clips: new Map(), sockets: {}, meta: { clips: [] } };
}

export class Actors {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;
    this.views = new Map(); // entity id -> view
    this.tmp = new THREE.Vector3();
    this.q = new THREE.Quaternion();
  }

  view(e) {
    let v = this.views.get(e.id);
    if (v) return v;
    const asset = e.kind;
    const has = this.assets?.gltf.has(asset);
    const inst = has ? this.assets.character(asset, { tint: e.tint, loadout: e.loadout }) : placeholder(e.kind, e.tint);
    inst.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    this.scene.add(inst.root);
    const clipMeta = new Map((inst.meta.clips ?? []).map((c) => [c.name, c]));
    inst.root.scale.setScalar(e.scale ?? 1);
    inst.allSockets = { ...inst.sockets };
    const bones = {};
    let spinBone = null;
    inst.root.traverse((o) => {
      if (o.isBone && ['hips', 'spine', 'chest', 'head'].includes(o.name)) bones[o.name] = o;
      if (o.isBone && o.name === 'spin') spinBone = o;
    });
    // Per-entity phase so loops (breathing, walk cycles) never play in lockstep.
    const seed = ((e.id * 2654435761) >>> 0) / 4294967296;
    v = { e, ...inst, clipMeta, bones, seed, action: null, clipName: null, upper: null, upperName: null, yaw: e.facing > 0 ? Math.PI / 2 : -Math.PI / 2,
      spinBone, spinRest: spinBone?.quaternion.clone() };
    this.views.set(e.id, v);
    return v;
  }

  resolveClip(v, name) {
    let n = name;
    for (let i = 0; i < 4 && n && !v.clips.has(n); i++) n = FALLBACK[n];
    return n && v.clips.has(n) ? n : null;
  }

  /** A clip cut to the legs (hips down) or to everything above them; made once, then reused. */
  half(v, clipName, part) {
    const key = `${clipName}@${part}`;
    if (!v.clips.has(key)) {
      const clip = v.clips.get(clipName);
      v.clips.set(key, new THREE.AnimationClip(key, clip.duration, clip.tracks.filter((t) => legTrack(t) === (part === 'legs'))));
    }
    return key;
  }

  /** The base clip; with an action layered over it (overlay), only its legs. */
  play(v, name, legsOnly = false) {
    const base = this.resolveClip(v, name);
    if (!base || !v.mixer) return;
    const clipName = legsOnly ? this.half(v, base, 'legs') : base;
    if (v.clipName === clipName) return;
    const action = v.mixer.clipAction(v.clips.get(clipName));
    const once = ONE_SHOT.has(base);
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    action.enabled = true;
    action.setEffectiveWeight(1);
    // Loops start at a per-trooper phase - except walk->walk style switches, which keep the
    // current step phase so feet don't jump when the stance changes mid-stride.
    const prevLoco = v.action && MOVE_SPEED[v.baseName];
    if (!once) {
      const phase = prevLoco && MOVE_SPEED[name] ? v.action.time / v.action.getClip().duration : v.seed;
      action.time = (phase % 1) * action.getClip().duration;
    }
    // Stopping mid-reload: the whole-body clip picks up where the one over the legs had got to.
    if (once && v.upperName === base && v.upper) action.time = v.upper.time;
    if (v.action) action.crossFadeFrom(v.action, clipName === 'die' ? 0.1 : 0.18, false);
    action.play();
    v.prev = v.action;
    v.prevClip = v.clipBase;
    v.action = action;
    v.clipName = clipName;
    v.clipBase = base;
    v.baseName = name;
  }

  /** The upper-body layer on the move (a reload, a throw, a burst...): in over the legs, out when done. */
  overlay(v, name) {
    const clipName = name && v.mixer ? this.resolveClip(v, name) : null;
    if (clipName === v.upperName) return;
    v.upper?.fadeOut(0.15);
    v.upper = null;
    v.upperName = clipName;
    if (!clipName) return;
    const action = v.mixer.clipAction(v.clips.get(this.half(v, clipName, 'upper')));
    const once = ONE_SHOT.has(clipName);
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    action.enabled = true;
    action.setEffectiveWeight(1);
    // Setting off mid-reload: carry on from where the whole-body clip had got to.
    if (once && v.prevClip === clipName && v.prev) action.time = v.prev.time;
    action.fadeIn(0.15);
    action.play();
    v.upper = action;
  }

  /** Sync every entity's view. alpha = fixed-step interpolation factor. */
  update(dt, alpha, entities) {
    for (const e of entities) {
      const v = this.view(e);
      const show = e.kind === 'marine' ? !e.taken : e.visible; // taken into the vents: gone
      v.root.visible = show;
      if (!show) continue;
      const x = e.prevX + (e.x - e.prevX) * alpha;
      const y = e.prevY + (e.y - e.prevY) * alpha;
      const z = e.prevZ + (e.z - e.prevZ) * alpha;
      v.root.position.set(x, y, z);

      const climbing = e.mode === 'climb' || (e.mode === 'step' && Math.abs(e.z) > 1.25); // ladder, not stairs
      // Upside down on the ceiling the 3/4 turn goes the other way, so the face still shows.
      const q3 = e.surface === 'ceiling' ? -YAW_3Q : YAW_3Q;
      const target = climbing ? Math.PI : e.facing > 0 ? Math.PI / 2 - q3 : -Math.PI / 2 + q3;
      let d = target - v.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      v.yaw += d * Math.min(1, dt * (e.alive ? 12 : 3));
      if (e.kind === 'alien') {
        v.roll ??= new THREE.Quaternion();
        v.roll.slerp(surfaceRoll(e), Math.min(1, dt * (e.alive ? 12 : 6)));
        v.root.quaternion.copy(v.roll).multiply(this.q.setFromAxisAngle(UP, v.yaw));
      } else v.root.rotation.y = v.yaw;

      if (v.mixer) {
        const upper = e.alive ? e.animUpper : null;
        this.play(v, e.alive ? e.anim : 'die', !!upper && !!this.resolveClip(v, upper));
        this.overlay(v, upper);
        const meta = v.clipMeta.get(v.clipBase);
        if (v.action) {
          // Locomotion clips play at (actual speed / authored stride speed): feet stay planted.
          const nominal = MOVE_SPEED[v.baseName];
          if (nominal) {
            // Taller troopers take longer strides (slower cadence); gait.cadence adds personal rhythm.
            const actual = Math.hypot(e.x - e.prevX, e.y - e.prevY) / STEP;
            const stride = (meta?.speed || nominal) * (e.scale ?? 1);
            const want = actual < 0.05 ? 0 : THREE.MathUtils.clamp((actual / stride) * (e.gait?.cadence ?? 1), 0.3, 2.5);
            // Ease cadence changes (followers speeding up to close gaps) instead of snapping.
            v.cadence = want === 0 ? 0 : (v.cadence ?? want) + (want - (v.cadence ?? want)) * Math.min(1, dt * 6);
            // Backing up (rear guard keeping watch while the queue closes up): stride in reverse.
            const back = (e.x - e.prevX) * e.facing < -1e-4;
            v.action.timeScale = back ? -v.cadence : v.cadence;
          } else v.action.timeScale = 1;
        }
        v.mixer.update(dt);
        if (e.gait && !e.down) this.applyGait(v, e, alpha); // a man down just lies there
        if (v.spinBone && e.weaponKey === 'minigun') this.spinBarrels(v, e, dt);
      } else if (e.alive) {
        // Placeholder bob so movement reads.
        v.root.children[0].position.y = (e.kind === 'marine' ? 1.0 : 0.9) + (e.moving ? Math.abs(Math.sin(performance.now() * 0.012)) * 0.08 : 0);
      } else {
        v.root.rotation.z = THREE.MathUtils.lerp(v.root.rotation.z, Math.PI / 2 * (e.facing || 1), dt * 6);
      }
    }
  }

  /**
   * Personal posture and gait layered on top of the shared clips (after the mixer has posed
   * the skeleton): forward lean, hip sway and bounce in step with the walk cycle, shoulder
   * swagger. Same clips, four distinguishable walkers.
   */
  applyGait(v, e, alpha = 1) {
    const g = e.gait;
    const b = v.bones;
    const D = Math.PI / 180;
    // three's mixer only rewrites a bone when its animated value CHANGES, so on held poses
    // (interact, cover, a paused walk) our offsets would pile up frame after frame. Restore the
    // mixer's own value first whenever the bone still holds last frame's offset result.
    v.gaitBase ??= {};
    v.gaitOut ??= {};
    for (const [name, bone] of Object.entries(b)) {
      if (v.gaitOut[name] && bone.quaternion.equals(v.gaitOut[name])) bone.quaternion.copy(v.gaitBase[name]);
      (v.gaitBase[name] ??= new THREE.Quaternion()).copy(bone.quaternion);
    }
    const moving = v.action && MOVE_SPEED[v.baseName] && v.action.timeScale !== 0;
    const phase = v.action ? (v.action.time / v.action.getClip().duration) * Math.PI * 2 : 0;
    const k = moving ? 1 : 0.35; // posture persists at rest, rhythm only while moving
    if (b.spine) b.spine.rotation.x += g.lean * D * k;
    if (b.head) b.head.rotation.x -= g.lean * 0.6 * D * k;
    if (moving) {
      if (b.hips) b.hips.rotation.z += g.sway * D * Math.sin(phase);
      if (b.chest) b.chest.rotation.y += g.swagger * D * Math.sin(phase + 0.4);
      v.root.position.y += g.bounce * Math.abs(Math.sin(phase));
    }
    // Looking around (sim/awareness.js): the upper body pitches the weapon + torch onto what the
    // trooper is looking at - relative to the pose his stance clip already holds - and the head
    // leads a little. A look behind is an over-the-shoulder turn of the head toward the camera.
    if (e.pitch !== undefined && e.alive) {
      const pitch = e.prevPitch + (e.pitch - e.prevPitch) * alpha;
      const rel = NO_AIM.has(v.upperName ?? v.clipBase) ? 0 : pitch - (e.target ? 0 : AWARE.PITCH_BASE[e.stance] ?? 0);
      if (b.spine) b.spine.rotation.x -= rel * 0.25;
      if (b.chest) b.chest.rotation.x -= rel * 0.5;
      if (b.head) {
        b.head.rotation.x -= rel * 0.3;
        b.head.rotation.y -= (e.facing || 1) * (e.glance ?? 0) * 1.0;
      }
    }
    for (const [name, bone] of Object.entries(b)) (v.gaitOut[name] ??= new THREE.Quaternion()).copy(bone.quaternion);
  }

  /**
   * The minigun's barrel cluster spins with the sim's spin-up (sim/combat.js m.spin), about the
   * barrels' own axis - found once, in the bone's frame, from the bone toward the muzzle.
   */
  spinBarrels(v, e, dt) {
    if (!v.spinAxis) {
      const muzzle = v.sockets.muzzle;
      if (!muzzle) return;
      v.root.updateMatrixWorld(true);
      const from = v.spinBone.getWorldPosition(new THREE.Vector3());
      const inv = v.spinBone.getWorldQuaternion(new THREE.Quaternion()).invert();
      v.spinAxis = muzzle.getWorldPosition(new THREE.Vector3()).sub(from).normalize().applyQuaternion(inv);
    }
    v.spinA = ((v.spinA ?? 0) + dt * SPIN_RATE * (e.spin ?? 0)) % (Math.PI * 2);
    v.spinBone.quaternion.copy(v.spinRest).multiply(this.q.setFromAxisAngle(v.spinAxis, v.spinA));
  }

  /** A trooper swapped weapons: show the right weapon mesh, re-aim sockets, add rarity glow. */
  refreshLoadout(e, rarityColor = null) {
    const v = this.views.get(e.id);
    if (!v?.allSockets) return;
    const w = e.loadout.weapon;
    v.root.traverse((o) => {
      if (!o.name.startsWith('var_weapon_')) return;
      o.visible = o.name === `var_weapon_${w}`;
      if (!o.visible) return;
      o.traverse((m) => {
        if (!m.isMesh) return;
        if (!m.userData.baseMat) m.userData.baseMat = m.material;
        m.material = m.userData.baseMat.clone();
        if (rarityColor) { m.material.emissive = new THREE.Color(rarityColor); m.material.emissiveIntensity = 0.35; }
      });
    });
    v.sockets.muzzle = v.allSockets[`muzzle_${w}`] ?? v.allSockets.muzzle;
    v.sockets.light = v.allSockets[`light_${w}`] ?? v.allSockets.light;
  }

  /** World position of a named socket (e.g. 'muzzle', 'light') or a sensible fallback. */
  socket(e, name, out = new THREE.Vector3()) {
    const v = this.views.get(e.id);
    const s = v?.sockets?.[name];
    if (s && v.root.visible) {
      v.root.updateMatrixWorld(true);
      return s.getWorldPosition(out);
    }
    return out.set(e.x + e.facing * 0.85, e.y + 1.35, e.z + 0.3);
  }

  remove(e) {
    const v = this.views.get(e.id);
    if (!v) return;
    this.scene.remove(v.root);
    this.views.delete(e.id);
  }
}
