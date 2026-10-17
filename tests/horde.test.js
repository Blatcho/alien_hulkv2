// The horde (sim/director.js): at most once a ship, brought by noise - then a countdown while the
// squad holds, and the pack out of the vents on both sides at once. And the Defend kits found on
// the way (gen/populate.js).
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFEND, HORDE } from '../src/core/config.js';
import { walkLimits } from '../src/gen/layout.js';
import { generateLevel } from '../src/gen/level.js';
import { NavGraph } from '../src/nav/graph.js';
import { initPhysics } from '../src/physics/physics.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };
const SEEDS = ['A1', 'B2', 'C3', 'D4', 'E5', 'AB12CD'];

describe('a ship\'s horde', () => {
  it.each(SEEDS)('seed %s: one - a swarm - counted in the life signs from the start, apart from the vent reserve', (seed) => {
    const L = generateLevel(seed);
    expect(L.horde.size).toBeGreaterThanOrEqual(HORDE.SIZE);
    const w = new World(L);
    expect(w.director.hordeSize).toBe(L.horde.size);
    expect(w.reserve).toBe(L.hostiles.reserve);
    expect(L.hostiles.total).toBe(L.hostiles.dormant + L.hostiles.reserve + L.horde.size);
    expect(w.lifesigns()).toBe(L.hostiles.total);
  });

  it.each(SEEDS)('seed %s: a Defend kit to carry, more aboard - one beside the squad\'s way to the command deck', (seed) => {
    const L = generateLevel(seed);
    expect(new World(L).kit.defend).toBe(1);
    const kits = L.rooms.flatMap((r) => r.props.filter((p) => p.loot?.type === 'defend').map((p) => ({ r, p })));
    expect(kits.length).toBeGreaterThanOrEqual(DEFEND.WAY);
    const route = new NavGraph(L).route(L.spawns.squad, L.objective, { blocked: (pid) => L.portals[pid].locked });
    const onWay = new Set(route.steps.flatMap((s) => (s.type === 'walk' ? [s.room] : s.type === 'portal' ? [s.from, s.to] : [])));
    expect(kits.some(({ r }) => onWay.has(r.id))).toBe(true);
  });
});

/** A quiet ship (nothing aboard, no vermin, nothing in the vents for an ambush), squad well inside it. */
function quiet() {
  const w = new World(generateLevel('A1'), { params: { god: true } });
  for (const e of [...w.aliens, ...w.critters]) { e.alive = false; w.physics.removeHitbox(e); }
  w.reserve = 0;
  run(w, 40);
  return w;
}

describe('noise brings it', () => {
  it('a quiet squad never hears from it', () => {
    const w = quiet();
    let warned = 0;
    w.on('horde-warning', () => warned++);
    run(w, 90);
    expect(warned).toBe(0);
    expect(w.director.heat).toBeLessThan(HORDE.START);
    expect(w.director.hordeSize).toBeGreaterThan(0); // still out there
  });

  it('every sound heats the ship up, and so do screams, fires and the like; it cools in the quiet', () => {
    const w = quiet();
    const h0 = w.director.heat;
    w.noise(0, 0, 40);
    expect(w.director.heat).toBeCloseTo(h0 + 40 * HORDE.NOISE, 5);
    const h1 = w.director.heat;
    w.emit('scream', { alien: null, woke: 0, called: 0 });
    expect(w.director.heat).toBeCloseTo(h1 + HORDE.EVENTS.scream, 5);
    const h2 = w.director.heat;
    w.director.hordeSize = 0; // (no horde in the way of the cooling)
    w.toggleCover(); // a full stop: no doors, no new decks (a power failure heats it up too)
    run(w, HORDE.HALF);
    expect(w.director.heat).toBeLessThan(h2 * 0.55);
  });

  it('a loud squad brings it - once, and never again on that ship', () => {
    const w = quiet();
    w.reserve = w.director.hordeSize;
    let warned = 0;
    let over = 0;
    w.on('horde-warning', () => warned++);
    w.on('horde-over', () => over++);
    // A firefight's worth of noise, on and on.
    const loud = (s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) { if (i % 6 === 0) w.noise(w.squad.leader.x, w.squad.leader.y, 40); w.step(STEP); } };
    for (let t = 0; t < 120 && !warned; t++) loud(1);
    expect(warned).toBe(1);
    expect(w.director.hordeSize).toBe(0);
    for (let t = 0; t < 90 && !over; t++) loud(1);
    expect(over).toBe(1);
    loud(120);
    expect(warned).toBe(1);
  });

  it('never during the uplink, however loud', () => {
    const w = quiet();
    w.startUplink();
    w.director.heat = 1e6;
    let warned = 0;
    w.on('horde-warning', () => warned++);
    run(w, 10);
    expect(warned).toBe(0);
  });
});

describe('when it comes', () => {
  /** The quiet ship with its horde coming now - the squad out walking (not halfway through a door). */
  function due(size = 6) {
    const w = quiet();
    for (let i = 0; i < 60 * 60 && !(w.squad.state === 'advance' && !w.squad.trav && w.squad.leader.moving); i++) w.step(STEP);
    w.reserve = size;
    return w;
  }

  it('a countdown first, the squad holding where it is - then they all come at once, both sides of it', () => {
    const w = due(6);
    let warned = null;
    let came = null;
    const out = new Set();
    w.on('vent-emerge', ({ alien }) => out.add(alien));
    w.on('horde-warning', (e) => { warned = { ...e, t: w.time }; });
    // Where each one starts its crawl: the vent it went into.
    w.on('horde', (e) => { came = { ...e, t: w.time, from: w.aliens.filter((a) => a.horde).map((a) => a.x) }; });
    w.director.callHorde(6);
    expect(warned).toEqual(expect.objectContaining({ size: 6, seconds: HORDE.WARN }));
    expect(w.director.bracing).toBe(true);
    const s0 = w.squad.leader.s;
    run(w, HORDE.WARN - 0.5);
    expect(came).toBe(null);
    expect(w.squad.leader.s).toBeCloseTo(s0, 1); // held
    run(w, 1);
    expect(came.count).toBe(6);
    expect(came.t - warned.t).toBeCloseTo(HORDE.WARN, 1);
    const pack = w.aliens.filter((a) => a.horde);
    expect(pack).toHaveLength(6);
    expect(w.reserve).toBe(6); // (its own: the ship's reserve untouched)
    expect(pack.every((a) => Object.keys(HORDE.TYPES).includes(a.type))).toBe(true);
    // Out of the vents within a couple of seconds of each other (counted as they come out: a hurt
    // one may bolt back into the ducts afterwards).
    run(w, 6 * HORDE.EMERGE + 0.4);
    expect(pack.every((a) => out.has(a) || !a.alive)).toBe(true);
    // From both sides of the squad, where the ship has vents on both.
    const mid = w.squad.order.reduce((s, m) => s + m.x, 0) / w.squad.order.length;
    const vents = w.director.ventsNear(w.squad.leader.room, 0, 2);
    if (vents.some((v) => v.x < mid) && vents.some((v) => v.x >= mid)) {
      expect(came.from.some((x) => x < mid) && came.from.some((x) => x >= mid)).toBe(true);
    }
  });

  it('it\'s over when they\'re all dead, and the squad moves on', () => {
    const w = due(4);
    let over = 0;
    w.on('horde-over', () => over++);
    w.director.callHorde(4);
    run(w, HORDE.WARN + 1);
    for (let i = 0; i < 60 * 60 && !over; i++) w.step(STEP);
    expect(over).toBe(1);
    expect(w.aliens.filter((a) => a.horde).every((a) => !a.alive)).toBe(true);
    expect(w.director.horde).toBe(null);
    const s0 = w.squad.leader.s;
    run(w, 6);
    expect(w.squad.leader.s).toBeGreaterThan(s0);
  });

  it('no vents left (all welded): they come through the doors at both ends of the room', () => {
    const w = due(4);
    for (const v of w.level.vents) v.welded = true;
    w.director.callHorde(4);
    run(w, HORDE.WARN + 0.5);
    const pack = w.aliens.filter((a) => a.horde);
    expect(pack).toHaveLength(4);
    const room = w.level.rooms[w.squad.leader.room];
    const [wl, wr] = walkLimits(room);
    expect(pack.some((a) => a.x < wl + 1) && pack.some((a) => a.x > wr - 1)).toBe(true);
  });
});
