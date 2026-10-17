// Lighting with a FIXED light count (adding/removing lights recompiles every shader):
//   - one SpotLight per marine (flashlights) + a soft additive beam cone,
//   - a pool of PointLights re-assigned each frame to the room lamps nearest the camera,
//   - a pool of muzzle-flash PointLights,
//   - a very dim hemisphere fill so silhouettes never vanish completely.
import * as THREE from 'three';
import { SIGHT } from '../core/config.js';

const LAMP_POOL = 6;
const FLASH_POOL = 3;

function beamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { strength: { value: 0.22 }, color: { value: new THREE.Color(0xe8f0ff) } },
    vertexShader: /* glsl */`
      varying float vAlong; varying vec3 vN; varying vec3 vView;
      void main() {
        vAlong = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float strength; uniform vec3 color;
      varying float vAlong; varying vec3 vN; varying vec3 vView;
      void main() {
        // Clamp before pow(): interpolation leaves vAlong a hair below 0 on some far-end
        // pixels, pow(negative) is NaN, and bloom smears one NaN pixel into a big black box.
        float along = clamp(vAlong, 0.0, 1.0);
        float edge = pow(clamp(abs(dot(vN, vView)), 0.0, 1.0), 1.5);
        float fall = smoothstep(0.0, 0.12, 1.0 - along) * pow(along, 1.4);
        gl_FragColor = vec4(color * strength * edge * fall, 1.0);
      }`,
  });
}

export class Lights {
  constructor(scene, marineCount) {
    this.scene = scene;
    this.hemi = new THREE.HemisphereLight(0x6f86a0, 0x1a1512, 0.35);
    scene.add(this.hemi);
    this.fill = new THREE.DirectionalLight(0x8090a8, 0.25);
    this.fill.position.set(0.3, 0.6, 1);
    scene.add(this.fill);

    this.spots = [];
    const range = SIGHT.CONE_RANGE;
    const coneGeo = new THREE.ConeGeometry(Math.tan(THREE.MathUtils.degToRad(13)) * range * 0.7, range * 0.7, 20, 1, true);
    coneGeo.translate(0, -range * 0.35, 0); // apex at origin, opening along -Y
    coneGeo.rotateZ(Math.PI / 2);       // opening along +X
    this.beamLen = range * 0.7;
    for (let i = 0; i < marineCount; i++) {
      const spot = new THREE.SpotLight(0xeef2ff, 0, range * 1.3, THREE.MathUtils.degToRad(SIGHT.CONE_HALF), 0.6, 1.0);
      spot.target = new THREE.Object3D();
      scene.add(spot, spot.target);
      const beam = new THREE.Mesh(coneGeo, beamMaterial());
      beam.frustumCulled = false;
      scene.add(beam);
      this.spots.push({ spot, beam, on: 0 });
    }

    this.lampLights = Array.from({ length: LAMP_POOL }, () => {
      const l = new THREE.PointLight(0xffffff, 0, 11, 1.6);
      scene.add(l);
      return l;
    });
    this.flashes = Array.from({ length: FLASH_POOL }, () => {
      const l = new THREE.PointLight(0xffb060, 0, 9, 1.6);
      scene.add(l);
      return { light: l, t: 0 };
    });
    this.flashI = 0;
    // One big light for explosions (constant light count, like everything else).
    this.blast = new THREE.PointLight(0xff8a30, 0, 16, 1.4);
    scene.add(this.blast);
    this.blastT = 0;
  }

  explosion(x, y) {
    this.blast.position.set(x, y + 0.5, 1.2);
    this.blastT = 0.35;
  }

  /** Muzzle flash light burst, placed ahead of the barrel so it lights the target area more than the shooter. */
  flash(x, y, z, dir = 0) {
    const f = this.flashes[this.flashI++ % FLASH_POOL];
    f.light.position.set(x + dir * 1.4, y, z + 0.6);
    f.t = 0.1;
  }

  /**
   * @param {Array} marines entities (index-aligned with spots)
   * @param {(m)=>({x,y,z}|null)} muzzleOf world position of the flashlight lens
   * @param {Map} rig per-marine smoothed flashlight state from GameView.updateRig
   */
  update(dt, marines, muzzleOf, flashlightOn, lamps, camCenter, rig) {
    const now = performance.now() / 1000;
    marines.forEach((m, i) => {
      const s = this.spots[i];
      const r = rig?.get(m.id) ?? { fx: m.facing, climb: 0, reach: 20 };
      const side = Math.sign(r.fx) || m.facing;
      const span = Math.abs(r.fx);          // 0 = beam pointing at the camera mid-turn
      const forward = span * (1 - r.climb); // how much of the beam lies in the view plane

      // Squad-mate standing in the beam: dim the spot (it would blow them out). Hysteresis
      // (on < 2.8 m, off > 3.6 m) and a gentle fade so queue shuffles don't pulse the light.
      let ahead = Infinity;
      for (const o of marines) {
        if (o === m || !o.alive || Math.abs(o.y - m.y) > 1.5) continue;
        const d = (o.x - m.x) * side;
        if (d > 0.1) ahead = Math.min(ahead, d);
      }
      if (!s.blocked && ahead < 2.8) s.blocked = true;
      else if (s.blocked && ahead > 3.6) s.blocked = false;
      s.lit = (s.lit ?? 1) + ((s.blocked ? 0.15 : 1) - (s.lit ?? 1)) * Math.min(1, dt * 2.5);
      s.on += ((m.alive && !m.down && flashlightOn ? 1 : 0) - s.on) * Math.min(1, dt * 10);

      // A wounded trooper's light sputters now and then (soft dips, never a strobe).
      const sputter = m.hp < 30 && m.alive && Math.sin(now * 1.7 + i * 3) * Math.sin(now * 5.3 + i) > 0.8 ? 0.55 : 1;
      s.flick = (s.flick ?? 1) + (sputter - (s.flick ?? 1)) * Math.min(1, dt * 12);

      const p = muzzleOf(m);
      s.spot.position.set(p.x, p.y, p.z + 0.3);
      // Mid-turn the torch points at the camera and lights nothing in the scene. (Aiming it at
      // the back wall instead put a spot in FRONT of the squad for a frame or two: a flash of
      // flat front light on everyone - the "flashlight flicker" when a rear guard turned.)
      // Pitched with the weapon (sim/awareness.js): torches sweep vents, hatches and bodies.
      const pitch = m.pitch ?? -0.08;
      s.spot.target.position.set(p.x + side * 10 * Math.cos(pitch), p.y + 10 * Math.sin(pitch) + 10 * r.climb, p.z - 0.2);
      s.spot.intensity = 45 * s.on * s.flick * s.lit * forward * forward;

      // Beam sprite, clipped at the first wall; foreshortened while turning / climbing.
      s.beam.visible = s.on > 0.02 && forward > 0.05;
      s.beam.position.set(p.x, p.y, p.z + 0.05);
      s.beam.rotation.set(0, 0, side < 0 ? Math.PI - pitch : pitch);
      const k = Math.min(1, r.reach / this.beamLen);
      s.beam.scale.set(Math.max(0.05, k) * Math.max(0.05, forward), Math.max(0.05, k), Math.max(0.05, k));
      s.beam.material.uniforms.strength.value = 0.05 * s.on * s.flick * forward;
    });

    // Lamp pool: the few real lights follow the lamps nearest the camera. Slots are sticky -
    // a light keeps its lamp while that lamp is still wanted, fades OUT before it moves and
    // fades IN at its new lamp (instant reassignment made whole wall sections pop on/off).
    const wanted = lamps
      .map((l) => ({ l, d: Math.abs(l.x - camCenter.x) + Math.abs(l.y - camCenter.y) * 1.5 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.lampLights.length)
      .map((e) => e.l);
    this.lampSlots ??= this.lampLights.map((light) => ({ light, lamp: null, level: 0 }));
    const taken = new Set(this.lampSlots.map((s) => s.lamp).filter(Boolean));
    for (const slot of this.lampSlots) {
      const keep = slot.lamp && wanted.includes(slot.lamp);
      if (!keep && slot.level <= 0.02) {
        const next = wanted.find((l) => !taken.has(l));
        if (slot.lamp) taken.delete(slot.lamp);
        slot.lamp = next ?? null;
        if (next) {
          taken.add(next);
          slot.light.position.set(next.x, next.y - 0.2, next.z + 1.0);
          slot.light.color.setHex(next.color);
        }
      }
      const target = slot.lamp && wanted.includes(slot.lamp) ? 1 : 0;
      slot.level += (target - slot.level) * Math.min(1, dt * 5);
      if (target === 0) slot.level = Math.max(0, slot.level - dt * 2);
      slot.light.intensity = slot.lamp ? 4.5 * (slot.lamp.k ?? 1) * slot.level : 0;
    }

    this.blastT = Math.max(0, this.blastT - dt);
    this.blast.intensity = 90 * (this.blastT / 0.35) ** 2;
    for (const f of this.flashes) {
      f.t -= dt;
      // Soft decay instead of on/off, so sustained fire flickers rather than strobes the room.
      f.light.intensity = f.t > 0 ? 4.5 * (f.t / 0.1) ** 1.5 : 0;
    }
  }
}
