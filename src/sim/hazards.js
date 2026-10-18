// Destructible scenery. Fuel barrels and gas cylinders explode (area damage to everyone, chain
// reactions, a huge noise that wakes the ship) and leave a fire burning where they stood;
// consoles short out; furniture breaks; a fuse box going kills its room's lights for good.
// A container smashed open spills what it held - the hardy things survive the blast, the
// delicate don't (loot by force). A blast against a weak bulkhead (gen/populate.js
// placeBreaches) opens it.
//
// Barrels are only hit by rounds that MISS their target (stray fire) or on purpose: a
// trooper takes the shot when hostiles bunch up next to a barrel and no friendly is close.
import { Rng } from '../core/rng.js';
import { roomAt } from '../gen/level.js';
import { G } from '../physics/physics.js';
import { PROPS } from '../gen/templates.js';
import { wake } from './alien.js';
import { rollWeapon } from './loot.js';

export const BLAST = { RADIUS: 4.2, DAMAGE: 115, NOISE: 45, CHAIN_DELAY: 0.14, SAFE_DIST: 4.8, BREACH: 2.4 };
/** The fire a blast leaves on the deck: how long it burns, how far it reaches, what it does per tick. */
export const FIRE = { TIME: 7, R: 1.5, TICK: 0.5, DAMAGE: 4, ALIEN: 7 };
const GRADES = ['common', 'rare', 'epic', 'legendary'];

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

/** Nobody friendly inside the blast radius of this barrel. */
export function blastSafe(world, barrel) {
  const cx = barrel.x;
  const cy = barrel.y + 0.6;
  for (const m of world.squad.order) if (Math.hypot(m.x - cx, m.y - cy) < BLAST.SAFE_DIST) return false;
  for (const s of world.survivors ?? []) if (s.alive && s.identified && Math.hypot(s.x - cx, s.y - cy) < BLAST.SAFE_DIST) return false;
  return true;
}

/** Is blowing this barrel up worth it right now? Returns hostiles in blast range (0 = no). */
export function barrelValue(world, barrel) {
  if (!barrel.explosive || !barrel.alive || !blastSafe(world, barrel)) return 0;
  const cx = barrel.x;
  const cy = barrel.y + 0.6;
  const R = (PROPS[barrel.prop.kind].blast?.r ?? BLAST.RADIUS) * 0.75;
  let n = 0;
  for (const a of world.aliens) {
    if (a.alive && a.state !== 'vent' && a.state !== 'dormant' && Math.hypot(a.x - cx, a.y - cy) < R) n++;
  }
  return n;
}

export class Hazards {
  constructor(world) {
    this.world = world;
    this.pending = []; // scheduled explosions {t, e}
    this.fires = [];   // burning deck {id, x, y, room, until, next}
    this.rng = new Rng(world.level.seed, 'spill');
    this.nextFire = 1;
  }

  /** A destructible reached 0 hp. */
  destroy(e, source = null, delay = 0.04) {
    const w = this.world;
    if (!e.alive) return;
    e.alive = false;
    e.prop.destroyed = true;
    w.physics.removeHitbox(e);
    this.spill(e.prop, source ?? e.lastHitBy);
    if (PROPS[e.prop.kind].fuse) this.blowFuse(e);
    w.emit('prop-destroyed', { entity: e, prop: e.prop });
    if (e.explosive) this.pending.push({ t: w.time + delay, e });
  }

  /**
   * Loot by force: a container smashed open. Credits, ammo, keycards and kit survive; stims,
   * medkits and rations don't; a weapon may come out a grade worse; a sealed locker needs no
   * hacking any more; whatever was hiding inside comes out, hurt.
   */
  spill(prop, by) {
    const w = this.world;
    if (prop.encounter === 'armoury' || prop.encounter === 'locker') { prop.encounter = null; prop.encounterDone = true; }
    w.squad?.featureCache?.delete(prop.room); // (an encounter became plain loot)
    if (!prop.loot || prop.searched) return;
    const L = prop.loot;
    if (L.type === 'ambush') {
      prop.searched = true;
      prop.loot = { type: 'empty' };
      if (w.reserve <= 0) return;
      w.reserve--;
      const room = w.level.rooms[prop.room];
      const a = w.addAlien(w.breed(prop.x, room.y0, prop.room, 'hunt'));
      a.hp = Math.max(1, Math.round(a.hp * 0.4));
      a.wakeT = 0.3;
      w.emit('ambush', { count: 1, prop, blasted: true });
      return;
    }
    if (L.type === 'stim' || L.type === 'medkit' || L.type === 'food' || L.type === 'drink') prop.loot = { type: 'ruined' };
    else if (L.type === 'treasure' && this.rng.chance(0.5)) prop.loot = { type: 'ruined' };
    else if (L.type === 'weapon' && L.item.rarity !== 'common' && this.rng.chance(0.5)) {
      L.item = rollWeapon(this.rng, { cls: L.item.cls, rarity: GRADES[GRADES.indexOf(L.item.rarity) - 1] });
      L.bent = true;
    }
    w.emit('spilled', { prop, by });
  }

  /** A fuse box blown: that room's lights go, and stay gone (nothing to reset). */
  blowFuse(e) {
    const w = this.world;
    const room = w.level.rooms[e.room];
    room.powerOut = true;
    room.fuseBlown = true;
    w.emit('fuse-blown', { room, prop: e.prop, x: e.x, y: e.y });
  }

  update() {
    const w = this.world;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].t > w.time) continue;
      const { e } = this.pending.splice(i, 1)[0];
      this.explode(e.x, e.y + 0.6, e.lastHitBy, { ...(PROPS[e.prop.kind].blast ?? {}), room: e.room });
    }
    // The fires: they burn whoever stands in them, then go out.
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (w.time >= f.until) { this.fires.splice(i, 1); w.emit('blast-fire-out', { id: f.id }); continue; }
      if (w.time < f.next) continue;
      f.next = w.time + FIRE.TICK;
      for (const v of [...w.marines, ...w.aliens, ...w.critters]) {
        if (!v.alive || v.room !== f.room || Math.abs(v.x - f.x) > FIRE.R || v.y > f.y + 1.2 || v.y < f.y - 0.5) continue;
        if (v.kind === 'alien' && (v.state === 'vent' || v.surface !== 'floor')) continue;
        if (v.kind === 'marine') w.burn(v, FIRE.DAMAGE);
        else w.damage(v, FIRE.ALIEN, null, { x: v.x, y: v.y + 0.6, dx: 0, dy: 0.4, fire: true });
      }
    }
  }

  /** Is that spot on the deck burning? */
  burning(room, x) { return this.fires.some((f) => f.room === room && Math.abs(f.x - x) <= FIRE.R); }

  /**
   * A blast: a fuel barrel by default; a gas cylinder (templates.js PROPS blast) or a frag
   * grenade passes its own radius, damage and noise. It leaves a fire, and opens a weak
   * bulkhead it goes off against.
   */
  explode(x, y, source, { r = BLAST.RADIUS, damage = BLAST.DAMAGE, noise = BLAST.NOISE, grenade = false, room = null, fire = true } = {}) {
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
        if (v.hp <= 0) this.destroy(v, source, BLAST.CHAIN_DELAY);
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
    const rid = room ?? roomAt(w.level, x, y);
    if (fire && rid >= 0) this.light(x, w.level.rooms[rid].y0, rid, R / BLAST.RADIUS);
    for (const b of w.level.breaches ?? []) {
      if (b.open) continue;
      const ra = w.level.rooms[b.a];
      if (Math.abs(b.x - x) <= BLAST.BREACH * (R / BLAST.RADIUS) && y > ra.y0 - 0.5 && y < ra.y1 + 0.5) w.breach(b.id, source);
    }
  }

  /** A fire where a blast was: FIRE.TIME seconds of burning deck (less for a small blast). */
  light(x, y, room, scale = 1) {
    const w = this.world;
    const f = { id: `f${this.nextFire++}`, x, y, room, until: w.time + FIRE.TIME * Math.min(1, Math.max(0.5, scale)), next: w.time + FIRE.TICK };
    this.fires.push(f);
    w.emit('blast-fire', { id: f.id, x, y, room, until: f.until });
  }
}
