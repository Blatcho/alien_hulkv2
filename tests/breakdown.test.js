// Breaking point (sim/breakdown.js): clawed below a third of his health a trooper freezes, bolts or
// goes berserk - and gets over it once it's quiet around him, or he's patched up.
import { beforeAll, describe, expect, it } from 'vitest';
import { BREAK } from '../src/core/config.js';
import { walkLimits } from '../src/gen/layout.js';
import { generateLevel } from '../src/gen/level.js';
import { initPhysics } from '../src/physics/physics.js';
import { makeAlien } from '../src/sim/entities.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };

/**
 * Nothing on the board (no hordes either), the squad on its way - and nobody patching anyone up
 * (a stim or a dressing past half his health ends a breakdown at once: tested on its own).
 */
function calm(opts = {}) {
  const w = new World(generateLevel('A1'), { params: {}, ...opts });
  for (const a of w.aliens) { a.alive = false; w.physics.removeHitbox(a); }
  w.reserve = 0;
  w.director.hordeSize = 0;
  w.stims = 0;
  w.abilities.dressings = 0;
  run(w, 40);
  return w;
}
/** On until the whole squad is walking in one room with floor `need` metres ahead of the point man. */
function roomAhead(w, need = 10) {
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
/** A hostile standing there doing nothing (a threat near him, until it's taken away). */
function lurker(w, x, room, state = 'hunt') {
  const [wl, wr] = walkLimits(w.level.rooms[room]);
  const a = w.addAlien(makeAlien(w.rng, Math.min(wr, Math.max(wl, x)), w.level.rooms[room].y0, room, state, { type: 'drone' }));
  a.wakeT = 99;
  a.hp = a.maxHp = 1e6; // nobody shoots it dead before we're done
  return a;
}
const gone = (w, a) => { a.alive = false; w.physics.removeHitbox(a); };
/** Clawed down to `frac` of his health by `a`, breaking the way we say. */
function claw(w, m, a, frac, mode) {
  w.breakRng = { weighted: (ways) => mode ?? ways[0][0] };
  w.damage(m, m.hp - m.maxHp * frac, a, { x: m.x, y: m.y + 1.3, dx: 1, dy: 0 });
}

describe('breaking point', () => {
  it('below a third of his health he breaks - once, until he\'s been patched up past half', () => {
    const w = calm();
    const lead = roomAhead(w);
    const m = w.squad.order[1];
    const a = lurker(w, lead.x + w.squad.heading * 6, lead.room);
    const broke = [];
    w.on('breakdown', ({ marine, mode }) => broke.push([marine, mode]));
    claw(w, m, a, 0.4, 'freeze');
    expect(m.breakdown).toBeFalsy(); // hurt, not broken
    claw(w, m, a, 0.25, 'freeze');
    expect(broke).toEqual([[m, 'freeze']]);
    // Over once it's quiet around him...
    gone(w, a);
    run(w, BREAK.MIN + 0.5);
    expect(m.breakdown).toBe(null);
    // ...but he doesn't break again until he's been patched up.
    const b = lurker(w, lead.x + w.squad.heading * 6, lead.room);
    claw(w, m, b, 0.2, 'freeze');
    expect(broke).toHaveLength(1);
    m.hp = m.maxHp * 0.6;
    w.step(STEP);
    claw(w, m, b, 0.2, 'berserk');
    expect(broke).toEqual([[m, 'freeze'], [m, 'berserk']]);
  });

  it('healed past half, it ends at once', () => {
    const w = calm();
    const lead = roomAhead(w);
    const m = w.squad.order[2];
    claw(w, m, lurker(w, lead.x + w.squad.heading * 6, lead.room), 0.2, 'freeze');
    expect(m.breakdown?.mode).toBe('freeze');
    m.hp = m.maxHp * (BREAK.REARM + 0.05);
    w.step(STEP);
    expect(m.breakdown).toBe(null);
  });

  it('which way he breaks is his own: stats weigh it - and the last man standing never runs', () => {
    const w = calm();
    const lead = roomAhead(w);
    const a = lurker(w, lead.x + w.squad.heading * 6, lead.room);
    let ways = null;
    w.breakRng = { weighted: (q) => { ways = Object.fromEntries(q); return 'freeze'; } };
    const m = w.squad.order[1];
    m.stats = { ...m.stats, nrv: 2, spd: 8, str: 3 };
    w.damage(m, m.hp - m.maxHp * 0.2, a, { x: m.x, y: m.y + 1.3, dx: 1, dy: 0 });
    expect(ways.freeze).toBeGreaterThan(ways.berserk); // no nerve: he freezes or runs
    expect(ways.flee).toBeGreaterThan(ways.berserk);
    for (const o of [...w.squad.order]) if (o !== lead) { o.alive = false; w.squad.remove(o); }
    lead.stats = { ...lead.stats, spd: 10 };
    w.damage(lead, lead.hp - lead.maxHp * 0.2, a, { x: lead.x, y: lead.y + 1.3, dx: 1, dy: 0 });
    expect(ways.flee).toBeUndefined();
  });
});

describe('the three ways', () => {
  it('freeze: he won\'t fire or move, and the squad won\'t leave him - until it\'s over', () => {
    const w = calm();
    const lead = roomAhead(w);
    const m = w.squad.order[1];
    const a = lurker(w, lead.x + w.squad.heading * 7, lead.room);
    claw(w, m, a, 0.2, 'freeze');
    const s0 = lead.s;
    const shots0 = m.shots;
    run(w, 2);
    expect(lead.s).toBeCloseTo(s0, 1); // the squad holds for him
    expect(m.shots).toBe(shots0);
    expect(m.target).toBe(null);
    expect(m.anim).toBe('crouch_alert');
    gone(w, a);
    let over = null;
    w.on('breakdown-over', (e) => { over = e; });
    run(w, BREAK.MIN + BREAK.CALM);
    expect(over?.marine).toBe(m);
    // And on they go (whichever way their orders take them next - after a search, if the room has one).
    let walked = 0;
    for (let i = 0; i < 30 * 60 && walked <= 1; i++) { const x = w.squad.leader.x; w.step(STEP); walked += Math.abs(w.squad.leader.x - x); }
    expect(walked).toBeGreaterThan(1);
  });

  it('flee: he drops to the rear and runs back the way they came, hides, then falls back in', () => {
    const w = calm();
    const lead = roomAhead(w);
    const m = lead; // even the point man
    const a = lurker(w, lead.x + w.squad.heading * 3, lead.room);
    const s0 = m.s;
    claw(w, m, a, 0.2, 'flee');
    const shots0 = m.shots;
    expect(w.squad.order.at(-1)).toBe(m);
    expect(w.squad.leader).not.toBe(m);
    run(w, 2);
    expect(m.s).toBeLessThan(s0 - 3); // back along the trail, at a run
    expect(m.shots).toBe(shots0);
    run(w, 6);
    expect(m.breakdown.phase).toBe('hide');
    expect(s0 - m.s).toBeLessThanOrEqual(BREAK.FLEE.DIST + 0.5);
    const hidAt = m.s;
    gone(w, a);
    run(w, BREAK.MIN + BREAK.CALM);
    expect(m.breakdown).toBe(null);
    run(w, 4);
    expect(m.s).toBeGreaterThan(hidAt + 2); // catching the squad up
  });

  it('berserk: he shoots every hostile in sight whatever the orders, faster and quicker on the trigger', () => {
    // Cautious orders: only return fire - and nothing has fired on them.
    const w = calm({ doctrine: { roe: 'cautious' } });
    const lead = roomAhead(w, 12);
    const m = lead;
    const a = lurker(w, lead.x + w.squad.heading * 7, lead.room);
    run(w, 1);
    expect(w.squad.order.every((o) => o.target == null)).toBe(true);
    claw(w, m, a, 0.2, 'berserk');
    const shots0 = m.shots;
    run(w, 1.5);
    expect(m.breakdown.mode).toBe('berserk');
    expect(m.target).toBe(a);
    expect(m.shots).toBeGreaterThan(shots0);
    expect(w.squad.order.filter((o) => o !== m).every((o) => o.target == null)).toBe(true); // the rest hold their fire
  });
});
