// Standard orders: the player's game - the squad only moves where it is sent.
import { beforeAll, describe, expect, it } from 'vitest';
import { generateLevel } from '../src/gen/level.js';
import { walkLimits } from '../src/gen/layout.js';
import { initPhysics } from '../src/physics/physics.js';
import { PRESETS, disabledOptions, fitOrders } from '../src/sim/doctrine.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
const STANDARD = PRESETS.standard.doctrine;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };
function until(w, pred, s) {
  for (let i = 0; i < s * 60 && w.status === 'playing'; i++) { w.step(STEP); if (pred()) return true; }
  return false;
}

describe('Standard orders (point and click)', () => {
  it('greys out what cannot apply: the route is yours, and nobody goes looking for every crate', () => {
    expect(disabledOptions(STANDARD)).toEqual({ route: ['direct', 'thorough'], loot: ['all'] });
    expect(disabledOptions(PRESETS.recon.doctrine).route).toEqual(['manual']);
    expect(fitOrders({ ...STANDARD, loot: 'all' }).loot).toBe('way');
  });

  it('the squad holds position until it is given somewhere to go', () => {
    const w = new World(generateLevel('A1'), { params: {}, doctrine: STANDARD });
    const x0 = w.squad.leader.x;
    run(w, 30);
    expect(Math.abs(w.squad.leader.x - x0)).toBeLessThan(0.5);
    expect(w.squad.state).toBe('hold');
  });

  it('a click on the floor sends them there; they stop and hold', () => {
    const w = new World(generateLevel('A1'), { params: { god: true }, doctrine: STANDARD });
    run(w, 1);
    // Board: point at the outer airlock door, then click a spot inside the airlock.
    const board = w.interactables().find((t) => t.label === 'Board the derelict');
    expect(board).toBeTruthy();
    w.nudge(board.id);
    const air = w.level.rooms[w.level.airlock];
    expect(until(w, () => w.squad.leader.room === air.id && w.squad.state === 'hold', 60)).toBe(true);
    const [wl, wr] = walkLimits(air);
    const x = (wl + wr) / 2 + 1;
    w.moveTo(air.id, x);
    expect(until(w, () => w.squad.state === 'hold' && Math.abs(w.squad.leader.x - x) < 0.5, 40)).toBe(true);
    const held = w.squad.leader.x;
    run(w, 10);
    expect(Math.abs(w.squad.leader.x - held)).toBeLessThan(0.3);
  });

  it('sent up a ladder or stairs, they all get off it before holding - even with a short landing', () => {
    const onClimb = (w) => w.squad.order.filter((m) => m.mode === 'climb' || m.mode === 'stairs' || m.mode === 'step');
    let climbs = 0;
    for (const seed of ['LAD0', 'LAD2', 'LAD9', 'LAD12', 'LAD13']) {
      const w = new World(generateLevel(seed), { params: { god: true }, doctrine: STANDARD });
      run(w, 1);
      w.nudge(w.interactables().find((t) => t.label === 'Board the derelict').id);
      for (let k = 0; k < 6; k++) {
        until(w, () => w.squad.state === 'hold' && !w.doctrine.override, 120);
        expect(onClimb(w), `${seed}: holding on a climb`).toEqual([]);
        const here = w.interactables().filter((q) => q.room === w.squad.leader.room);
        const next = here.find((q) => q.kind === 'ladder' || q.kind === 'stairs') ?? here.find((q) => q.kind === 'door' && !w.level.portals[q.portal].open);
        if (!next) break;
        if (next.kind !== 'door') climbs++;
        w.nudge(next.id);
        run(w, 1);
      }
    }
    expect(climbs).toBeGreaterThan(3);
  }, 120000);

  it('a second ladder right at the top of the first: they wait for everyone, then carry on', () => {
    const w = new World(generateLevel('LAD1'), { params: { god: true } });
    run(w, 900);
    expect(w.status).toBe('won');
  }, 120000);

  it('a clicked door is breached and passed, then they hold on the far side', () => {
    const w = new World(generateLevel('DOOR'), { params: { god: true }, doctrine: STANDARD });
    run(w, 1);
    w.nudge(w.interactables().find((t) => t.label === 'Board the derelict').id);
    until(w, () => w.squad.leader.room === w.level.airlock && w.squad.state === 'hold', 60);
    const inner = w.interactables().find((t) => t.kind === 'door' && w.level.portals[t.portal].airlock);
    w.nudge(inner.id);
    const far = w.level.portals[inner.portal].b;
    expect(until(w, () => w.level.portals[inner.portal].open && w.squad.leader.room === far && w.squad.state === 'hold', 90)).toBe(true);
    const x = w.squad.leader.x;
    run(w, 8);
    expect(Math.abs(w.squad.leader.x - x)).toBeLessThan(0.3);
  });

  it('encounters wait for the player - the orders never answer for them', () => {
    let tested = 0;
    for (let i = 0; i < 80 && !tested; i++) {
      const L = generateLevel(`ENC${i}`);
      const prop = L.rooms.filter((r) => r.dist <= 3).flatMap((r) => r.props).find((p) => p.encounter === 'armoury');
      if (!prop) continue;
      const w = new World(L, { params: { god: true }, doctrine: STANDARD });
      // Walk them to it: board, then keep pointing at the locker until they reach it.
      run(w, 1);
      w.nudge(w.interactables().find((t) => t.label === 'Board the derelict').id);
      let d = null;
      for (let k = 0; k < 400 && !d; k++) {
        const t = w.interactables().find((q) => q.prop === prop.id);
        if (t && !w.doctrine.override) w.nudge(t.id);
        else if (!w.doctrine.override) {
          // Not seen yet: move toward the next room on the way to it.
          const lead = w.squad.leader;
          const step = w.nav.route({ room: lead.room, x: lead.x }, { room: prop.room, x: prop.x })?.steps.find((s) => s.type === 'portal');
          const door = step && w.interactables().find((q) => q.portal === step.portal);
          if (door) w.nudge(door.id);
        }
        run(w, 0.5);
        if (w.squad.decision?.encounter) d = w.squad.decision;
      }
      if (!d) continue;
      tested++;
      run(w, 15); // well past the 8 s clock
      expect(w.squad.decision).toBe(d);
      expect(w.squad.state).toBe('decision');
      w.choose('leave');
      run(w, 3);
      // Holding again - unless something else right there put its card up (which also waits).
      const next = w.squad.decision;
      expect(w.squad.state === 'hold' || (w.squad.state === 'decision' && next?.encounter && next !== d)).toBe(true);
    }
    expect(tested).toBe(1);
  });

  it('Turn around reverses the line and holds - it does not wander off', () => {
    const w = new World(generateLevel('A1'), { params: { god: true }, doctrine: STANDARD });
    run(w, 1);
    w.nudge(w.interactables().find((t) => t.label === 'Board the derelict').id);
    until(w, () => w.squad.leader.room === w.level.airlock && w.squad.state === 'hold', 60);
    run(w, 2);
    const rear = w.squad.order[w.squad.order.length - 1];
    const H = w.squad.heading;
    w.turnAround();
    run(w, 4);
    expect(w.squad.leader).toBe(rear);
    expect(w.squad.heading).toBe(-H);
    const x = w.squad.leader.x;
    run(w, 8);
    expect(Math.abs(w.squad.leader.x - x)).toBeLessThan(0.3);
  });
});
