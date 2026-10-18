// The duelist (bolt pistol + power sword), the brawler (power fists, no gun) and the gunner
// (minigun): sim/melee.js power weapons, the minigun's spin-up in sim/combat.js, their archetypes,
// and the art they need in marine.glb.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { LOADOUTS, MELEE, WEAPONS } from '../src/core/config.js';
import { Rng } from '../src/core/rng.js';
import { walkLimits } from '../src/gen/layout.js';
import { generateLevel } from '../src/gen/level.js';
import { ARCHETYPES, BUDGET, makeCandidate } from '../src/meta/candidates.js';
import { initPhysics } from '../src/physics/physics.js';
import { makeAlien } from '../src/sim/entities.js';
import { meleeOf } from '../src/sim/melee.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };
const trooper = (archetype) => makeCandidate(new Rng('lo', archetype), { archetype, jitter: false });

/** A cleared ship, this squad on its way through it, standing in a room with floor ahead. */
function squadOf(archetypes, opts = {}) {
  const w = new World(generateLevel('A1'), { params: { god: true }, squad: archetypes.map(trooper), ...opts });
  for (const a of w.aliens) { a.alive = false; w.physics.removeHitbox(a); }
  w.reserve = 0;
  w.director.hordeSize = 0;
  w.kit.grenades = 0; // (a tough foe is "worth a frag" - here they shoot)
  run(w, 25);
  const settle = () => {
    for (let i = 0; i < 60 * 120; i++) {
      const lead = w.squad.leader;
      const [wl, wr] = walkLimits(w.level.rooms[lead.room]);
      const ahead = w.squad.heading > 0 ? wr - lead.x : lead.x - wl;
      if (ahead > 9 && w.squad.order.every((m) => m.room === lead.room && m.mode === 'walk')) return;
      w.step(STEP);
    }
  };
  settle();
  // The first trooper walks point - unless a dead end on the way turned the line round.
  for (let tries = 0; tries < 3 && w.squad.leader !== w.marines[0]; tries++) {
    for (let i = 0; i < 60 * 60 && (w.squad.trav || w.squad.action || w.squad.state !== 'advance'); i++) w.step(STEP);
    w.turnAround();
    run(w, 8);
    settle();
  }
  return w;
}
/** A hostile `dx` metres ahead of marine m (in his heading), awake. */
function foe(w, m, dx, type = 'drone') {
  const [wl, wr] = walkLimits(w.level.rooms[m.room]);
  const a = w.addAlien(makeAlien(w.rng, Math.min(wr, Math.max(wl, m.x + w.squad.heading * dx)), w.level.rooms[m.room].y0, m.room, 'hunt', { type }));
  a.wakeT = 99; // (stands there)
  return a;
}

describe('the new archetypes', () => {
  it('duelist, brawler and gunner: on the budget like everyone, each with his kit', () => {
    for (const [k, gear] of [['duelist', ['pistol', 'sword']], ['brawler', ['fists', undefined]], ['gunner', ['minigun', undefined]]]) {
      const A = ARCHETYPES[k];
      expect(Object.values(A.core).reduce((s, v) => s + v, 0)).toBe(BUDGET);
      expect([A.loadout.weapon, A.loadout.melee]).toEqual(gear);
      expect(LOADOUTS).toContain(A.loadout);
    }
    expect(meleeOf({ loadout: LOADOUTS[4], weapon: WEAPONS.pistol, weaponKey: 'pistol' })).toBe(MELEE.sword);
    expect(meleeOf({ loadout: LOADOUTS[5], weapon: WEAPONS.fists, weaponKey: 'fists' })).toBe(MELEE.fists);
    expect(meleeOf({ loadout: LOADOUTS[0], weapon: WEAPONS.carbine, weaponKey: 'carbine' })).toBe(null);
  });

  it('their art is in the marine model: the new weapons, the sword, the strike clips and the spinning barrels', () => {
    const meta = JSON.parse(readFileSync('public/assets/models/marine.meta.json', 'utf8'));
    for (const n of ['var_weapon_pistol', 'var_weapon_minigun', 'var_weapon_fists', 'var_melee_sword']) expect(meta.nodes).toContain(n);
    for (const c of ['slash', 'punch']) expect(meta.clips.map((x) => x.name)).toContain(c);
    for (const s of ['socket_muzzle_pistol', 'socket_muzzle_minigun', 'socket_light_fists']) expect(meta.sockets).toContain(s);
    const glb = readFileSync('public/assets/models/marine.glb');
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
    expect(json.nodes.map((n) => n.name)).toContain('spin');
  });
});

describe('power fists', () => {
  it('no gun: never a shot - but whatever comes within reach takes a blow that hurts and knocks it back', () => {
    const w = squadOf(['brawler', 'veteran', 'veteran', 'veteran'], { doctrine: { roe: 'cautious' } });
    const m = w.marines[0];
    expect(m.weapon.melee).toBe(true);
    const a = foe(w, m, 1.6);
    a.hp = a.maxHp = 1e4;
    const x0 = a.x;
    let shots = 0;
    const hits = [];
    w.on('shot', (e) => { if (e.marine === m) shots++; });
    w.on('melee-hit', (e) => hits.push(e));
    run(w, 1.2);
    expect(shots).toBe(0);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toEqual(expect.objectContaining({ marine: m, alien: a, weapon: 'fists' }));
    expect(a.hp).toBeLessThanOrEqual(1e4 - MELEE.fists.damage[0] * 0.8);
    expect((a.x - x0) * w.squad.heading).toBeGreaterThan(1); // driven back
    expect(m.anim === 'punch' || hits.length > 0).toBe(true);
  });

  it('they even knock a brute back (a sword doesn\'t)', () => {
    for (const [arch, moves] of [['brawler', true], ['duelist', false]]) {
      const w = squadOf([arch, 'veteran', 'veteran', 'veteran'], { doctrine: { roe: 'cautious' } });
      const m = w.marines[0];
      const a = foe(w, m, 1.8, 'brute');
      a.hp = a.maxHp = 1e4;
      const x0 = a.x;
      let hit = 0;
      w.on('melee-hit', () => hit++);
      for (let i = 0; i < 90 && !hit; i++) w.step(STEP);
      run(w, 0.1);
      expect(hit).toBeGreaterThan(0);
      expect((a.x - x0) * w.squad.heading > 0.3).toBe(moves);
    }
  });

  it('he blocks with them: claws hurt him less', () => {
    const w = squadOf(['brawler', 'veteran', 'veteran', 'veteran']);
    w.params.god = false;
    const [m, v] = w.marines;
    m.stats = v.stats = { ...v.stats };
    const a = foe(w, m, 0.6);
    const b = foe(w, v, 0.6);
    a.damage = b.damage = [20, 20];
    const before = [m.hp, v.hp];
    w.alienStrike(a, m);
    w.alienStrike(b, v);
    expect(before[1] - v.hp).toBeGreaterThan(0);
    expect(before[0] - m.hp).toBeCloseTo((before[1] - v.hp) * WEAPONS.fists.armor * (m.mods.armor / v.mods.armor), 3);
  });
});

describe('the power sword', () => {
  it('the duelist shoots what\'s further off - and cuts down two at once when they close', () => {
    const w = squadOf(['duelist', 'veteran', 'veteran', 'veteran']);
    const m = w.marines[0];
    const far = foe(w, m, 9);
    far.hp = far.maxHp = 1e4;
    let shots = 0;
    w.on('shot', (e) => { if (e.marine === m) shots++; });
    run(w, 2);
    expect(shots).toBeGreaterThan(0); // the bolt pistol at range
    far.alive = false;
    w.physics.removeHitbox(far);
    const near = [foe(w, m, 1.5), foe(w, m, 2.1)];
    for (const a of near) a.hp = a.maxHp = 1e4;
    const struck = new Set();
    let swings = 0;
    w.on('melee-swing', () => swings++);
    w.on('melee-hit', (e) => struck.add(e.alien));
    for (let i = 0; i < 60 && swings < 1; i++) w.step(STEP);
    // Mid-swing he doesn't fire.
    const s0 = shots;
    run(w, MELEE.sword.hit + 0.05);
    expect(shots).toBe(s0);
    expect(struck.size).toBe(2); // CLEAVE 2
  });
});

describe('the minigun', () => {
  it('spins up before the first round, and winds down with nothing to shoot', () => {
    const w = squadOf(['gunner', 'veteran', 'veteran', 'veteran'], { doctrine: { roe: 'alert' } });
    const m = w.marines[0];
    for (const o of w.marines.slice(1)) o.weapon = { ...o.weapon, rate: 0 }; // (only he shoots)
    expect(m.spin ?? 0).toBe(0);
    const a = foe(w, m, 8);
    a.hp = a.maxHp = 1e6;
    let first = null;
    let spun = 0;
    const t0 = w.time;
    w.on('spin-up', () => spun++);
    w.on('shot', (e) => { if (e.marine === m && first === null) first = w.time - t0; });
    run(w, 3);
    expect(spun).toBe(1);
    expect(first).toBeGreaterThanOrEqual(WEAPONS.minigun.spin);
    expect(m.spin).toBe(1);
    a.alive = false;
    w.physics.removeHitbox(a);
    run(w, WEAPONS.minigun.spin * 2 + 0.5);
    expect(m.spin).toBe(0);
  });

  it('a heavy load: the squad walks at its bearer\'s pace', () => {
    const plain = squadOf(['veteran', 'veteran', 'veteran', 'veteran']);
    const w = squadOf(['gunner', 'veteran', 'veteran', 'veteran']);
    w.marines[0].stats = { ...plain.marines[0].stats };
    expect(w.squad.slowest()).toBeCloseTo(plain.squad.slowest() * WEAPONS.minigun.pace, 5);
  });
});
