// Destructible scenery. Fuel barrels explode (area damage to everyone, chain reactions,
// a huge noise that wakes the ship); consoles short out and break.
//
// Barrels are only hit by rounds that MISS their target (stray fire) or on purpose: a
// trooper takes the shot when hostiles bunch up next to a barrel and no friendly is close.
import { G } from '../physics/physics.js';
import { PROPS } from '../gen/templates.js';
import { wake } from './alien.js';

export const BLAST = { RADIUS: 4.2, DAMAGE: 115, NOISE: 45, CHAIN_DELAY: 0.14, SAFE_DIST: 4.8 };

let nextPropId = 1;

/** Entity wrappers for destructible props, with Rapier hitboxes (group PROP). */
export function makeDestructibles(world) {
  const list = [];
  for (const room of world.level.rooms) {
    for (const prop of room.props) {
      const def = PROPS[prop.kind];
      if (!def.hp) continue;
      const e = {
        id: `prop${nextPropId++}`, kind: 'prop', prop, explosive: !!def.explosive,
        x: prop.x, y: room.y0, z: prop.z, room: room.id, height: def.h ?? 1.1,
        hp: def.hp, maxHp: def.hp, alive: true, visible: false, moving: false, state: 'still', lastHitBy: null,
      };
      world.physics.addHitbox(e, def.w * 0.8, e.height, G.PROP);
      world.physics.moveHitbox(e);
      list.push(e);
    }
  }
  return list;
}

/** Is blowing this barrel up worth it right now? Returns hostiles in blast range (0 = no). */
/** Nobody friendly inside the blast radius of this barrel. */
export function blastSafe(world, barrel) {
  const cx = barrel.x;
  const cy = barrel.y + 0.6;
  for (const m of world.squad.order) if (Math.hypot(m.x - cx, m.y - cy) < BLAST.SAFE_DIST) return false;
  for (const s of world.survivors ?? []) if (s.alive && s.identified && Math.hypot(s.x - cx, s.y - cy) < BLAST.SAFE_DIST) return false;
  return true;
}

export function barrelValue(world, barrel) {
  if (!barrel.explosive || !barrel.alive || !blastSafe(world, barrel)) return 0;
  const cx = barrel.x;
  const cy = barrel.y + 0.6;
  let n = 0;
  for (const a of world.aliens) {
    if (a.alive && a.state !== 'vent' && a.state !== 'dormant' && Math.hypot(a.x - cx, a.y - cy) < BLAST.RADIUS * 0.75) n++;
  }
  return n;
}

export class Hazards {
  constructor(world) {
    this.world = world;
    this.pending = []; // scheduled explosions {t, e}
  }

  /** A destructible reached 0 hp. */
  destroy(e) {
    const w = this.world;
    e.alive = false;
    e.prop.destroyed = true;
    w.physics.removeHitbox(e);
    w.emit('prop-destroyed', { entity: e, prop: e.prop });
    if (e.explosive) this.pending.push({ t: w.time + 0.04, e });
  }

  update() {
    const w = this.world;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].t > w.time) continue;
      const { e } = this.pending.splice(i, 1)[0];
      this.explode(e.x, e.y + 0.6, e.lastHitBy);
    }
  }

  /** A blast: a fuel barrel by default; a frag grenade passes its own radius, damage and noise. */
  explode(x, y, source, { r = BLAST.RADIUS, damage = BLAST.DAMAGE, noise = BLAST.NOISE, grenade = false } = {}) {
    const w = this.world;
    const R = r;
    w.emit('explosion', { x, y, r: R, grenade });
    w.noise(x, y, noise);
    const victims = [...w.marines, ...w.aliens, ...w.critters, ...(w.survivors ?? []), ...w.props];
    for (const v of victims) {
      if (!v.alive) continue;
      const vy = v.y + (v.height ?? 1) * 0.5;
      const d = Math.hypot(v.x - x, vy - y);
      if (d > R || !w.physics.los(x, y, v.x, vy)) continue;
      const k = Math.pow(1 - d / R, 1.2);
      const dir = Math.sign(v.x - x) || 1;
      if (v.kind === 'prop') {
        // Chain reaction: neighbouring barrels go up a beat later.
        v.hp -= damage * k;
        v.lastHitBy = source;
        if (v.hp <= 0 && v.alive) {
          v.alive = false;
          v.prop.destroyed = true;
          w.physics.removeHitbox(v);
          w.emit('prop-destroyed', { entity: v, prop: v.prop });
          if (v.explosive) this.pending.push({ t: w.time + BLAST.CHAIN_DELAY, e: v });
        }
        continue;
      }
      if (v.kind === 'marine' && w.params.god) continue;
      if (v.kind === 'alien') {
        if (v.state === 'dormant') wake(w, v, 'explosion');
        v.staggerT = 0.9;
        if (!v.trav && v.state !== 'vent') v.x += dir * 1.2 * k;
      }
      w.damage(v, damage * k, source, { x: v.x, y: vy, dx: dir, dy: 0.3, explosion: true, stagger: 0.9 }); // (knocks crawlers off the ceiling)
    }
  }
}
