// Cover and chokepoints: aliens go through a doorway one at a time, vault what's on the walking
// line (a brute smashes a barricade), Cover is just cover, and spitter acid is stopped by cover
// for a trooper crouched behind it.
import { beforeAll, describe, expect, it } from 'vitest';
import { COVER, SPIT } from '../src/core/config.js';
import { walkLimits } from '../src/gen/layout.js';
import { generateLevel } from '../src/gen/level.js';
import { initPhysics } from '../src/physics/physics.js';
import { updateAlien } from '../src/sim/alien.js';
import { makeAlien } from '../src/sim/entities.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };
function calm(seed = 'A1') {
  const w = new World(generateLevel(seed), { params: {} });
  for (const a of w.aliens) { a.alive = false; w.physics.removeHitbox(a); }
  w.reserve = 0;
  run(w, 45); // well inside the ship, in a proper room
  return w;
}
/** On until the whole squad is in one room with clear floor `need` metres ahead of the point man. */
function roomAhead(w, need = 9) {
  for (let i = 0; i < 60 * 240; i++) {
    const sq = w.squad;
    const lead = sq.leader;
    const [wl, wr] = walkLimits(w.level.rooms[lead.room]);
    const ahead = sq.heading > 0 ? wr - lead.x : lead.x - wl;
    if (ahead >= need && lead.mode === 'walk' && sq.order.every((m) => m.room === lead.room && m.mode === 'walk')) return lead;
    w.step(STEP);
  }
  throw new Error('no room ahead');
}
const spawn = (w, type, x, room, state = 'hunt') => {
  const a = w.addAlien(makeAlien(w.rng, x, w.level.rooms[room].y0, room, state, { type }));
  a.wakeT = 0;
  return a;
};

describe('chokepoints and vaulting', () => {
  it('a doorway takes one at a time', () => {
    const w = calm();
    // A door well away from the squad (nobody to go for instead).
    const p = w.level.portals.find((q) => q.kind === 'door' && !q.outer && !q.airlock && !q.locked
      && w.squad.order.every((m) => m.room !== q.a && m.room !== q.b));
    w.setDoor(p, true);
    const room = w.level.rooms[p.a];
    const first = spawn(w, 'drone', room.x1 - 1, p.a);
    first.trav = { kind: 'door', portal: p.id, toRoom: p.b, pts: [{ x: first.x, y: room.y0, z: 0, mode: 'walk' }, { x: room.x1 + 1, y: room.y0, z: 0, mode: 'walk' }], i: 0 };
    const second = spawn(w, 'drone', room.x1 - 1.4, p.a);
    second.steps = [{ type: 'portal', portal: p.id }];
    second.repathT = 99;
    updateAlien(w, second, STEP);
    expect(second.trav).toBe(null); // waits its turn
    first.trav = null;
    updateAlien(w, second, STEP);
    expect(second.trav?.portal).toBe(p.id);
  });

  it('something on the walking line is vaulted - slowly; a brute smashes the barricade instead', () => {
    let L;
    let room;
    for (let i = 0; i < 40 && !room; i++) {
      L = generateLevel(`OB${i}`);
      room = L.rooms.find((r) => r.dist >= 2 && r.props.some((p) => p.obstacle === 'jump'));
    }
    const w = new World(L, { params: {} });
    for (const s of w.survivors) s.alive = false; // nothing else to go for
    const ob = room.props.find((p) => p.obstacle === 'jump');
    // A brute (it never pounces over it), something to run at on the far side.
    const a = spawn(w, 'brute', ob.x0 - 0.5, room.id);
    const m = w.squad.order[0];
    Object.assign(m, { room: room.id, x: Math.min(walkLimits(room)[1], ob.x1 + 5), y: room.y0, mode: 'walk' });
    let vaulted = 0;
    for (let i = 0; i < 180; i++) { updateAlien(w, a, STEP); if (a.state === 'vault') vaulted += STEP; }
    expect(vaulted).toBeGreaterThan(COVER.VAULT.jump * 0.6);
    expect(a.x).toBeGreaterThan(ob.x1);
    // A brute and a barricade.
    const bar = { id: 'barT', kind: 'barricade', x: ob.x1 + 2, z: 0, room: room.id, obstacle: 'jump', x0: ob.x1 + 1.4, x1: ob.x1 + 2.6, barricade: true, hp: 160 };
    room.props.push(bar);
    const b = spawn(w, 'brute', bar.x0 - 0.4, room.id);
    for (let i = 0; i < 60 * 3 && !bar.destroyed; i++) updateAlien(w, b, STEP);
    expect(bar.destroyed).toBe(true);
    expect(room.props.includes(bar)).toBe(false);
  });
});

describe('Cover', () => {
  it('is a full stop and nothing else: no kit goes down with it', () => {
    const w = calm();
    const lead = roomAhead(w);
    spawn(w, 'drone', lead.x + w.squad.heading * 8, lead.room);
    w.kit.defend = 1;
    let put = 0;
    w.on('defend', () => put++);
    w.toggleCover();
    expect(w.squad.cover).toBe(true);
    expect(put).toBe(0);
    expect(w.kit.defend).toBe(1);
  });
});

describe('spitter acid', () => {
  it('a spitter keeps its distance and spits', () => {
    const w = calm();
    const lead = roomAhead(w);
    const a = spawn(w, 'spitter', lead.x + w.squad.heading * 8, lead.room);
    a.hp = a.maxHp = 1e6; // long enough to see it work
    w.toggleCover(); // hold still: they won't walk up to it
    let spat = 0;
    w.on('spit', () => spat++);
    const d0 = Math.abs(a.x - lead.x);
    for (let i = 0; i < 60 * 4 && a.alive; i++) w.step(STEP);
    expect(spat).toBeGreaterThan(0);
    if (a.alive) expect(Math.abs(a.x - lead.x)).toBeGreaterThanOrEqual(Math.min(d0, SPIT.RANGE[0]) - 0.5);
  });

  it('acid burns a man in the open; crouched behind cover he takes it on the cover', () => {
    const w = calm();
    const m = w.squad.order[1];
    const room = w.level.rooms[m.room];
    const from = m.x + 9;
    const spitterA = spawn(w, 'spitter', from, m.room);
    const hp = m.hp;
    w.splash({ room: m.room, from, by: spitterA }, { x: m.x, y: m.y + 1, marine: m });
    expect(m.hp).toBeLessThan(hp);
    // Now down behind a barricade on the spitter's side.
    const hp2 = m.hp;
    room.props.push({ id: 'barC', kind: 'barricade', x: m.x + 1.2, z: 0, room: m.room, obstacle: 'jump', x0: m.x + 0.6, x1: m.x + 1.8, barricade: true, hp: 160 });
    w.squad.cover = true;
    w.splash({ room: m.room, from, by: spitterA }, { x: m.x, y: m.y + 1, marine: m });
    expect(m.hp).toBe(hp2);
  });

  it('it pools on the deck, and the pool burns whoever stands in it', () => {
    const w = calm();
    const m = w.squad.order[2];
    w.toggleCover();
    w.pools.push({ x: m.x, room: m.room, y: m.y, r: SPIT.POOL.R, t: 3, max: 3 });
    const hp = m.hp;
    run(w, 2);
    expect(m.hp).toBeLessThan(hp);
    run(w, 2);
    expect(w.pools.length).toBe(0); // and dries up
  });
});
