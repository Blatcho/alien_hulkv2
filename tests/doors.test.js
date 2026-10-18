// Door controls and vent welding: close a door behind you, weld it (a charge), cut a welded one
// open (a charge); weld a vent shut. The kit has KIT.CHARGES charges per mission.
import { beforeAll, describe, expect, it } from 'vitest';
import { KIT } from '../src/core/config.js';
import { generateLevel, portalEnds } from '../src/gen/level.js';
import { initPhysics } from '../src/physics/physics.js';
import { DEFAULT_DOCTRINE, PRESETS } from '../src/sim/doctrine.js';
import { makeAlien } from '../src/sim/entities.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };
function until(w, pred, s) {
  for (let i = 0; i < s * 60 && w.status === 'playing'; i++) { w.step(STEP); if (pred()) return true; }
  return false;
}
const lucky = (w) => { w.encounters.rng = { chance: () => true, int: () => 5 }; };
/** Standard orders, aboard, everything asleep: a squad that only moves where it's sent. */
function aboard(seed = 'A1') {
  const w = new World(generateLevel(seed), { params: { god: true }, doctrine: PRESETS.standard.doctrine });
  run(w, 1);
  w.nudge(w.interactables().find((t) => t.label === 'Board the derelict').id);
  until(w, () => w.squad.leader.room === w.level.airlock && w.squad.state === 'hold', 60);
  return w;
}

describe('door controls', () => {
  it('pointing at a door\'s controls walks them over and puts the choices up', () => {
    const w = aboard();
    lucky(w);
    const inner = w.level.portals.find((p) => p.airlock);
    w.setDoor(inner, true);
    const ctl = w.interactables().find((t) => t.kind === 'doorctl' && t.portal === inner.id);
    expect(ctl).toBeTruthy();
    w.nudge(ctl.id);
    expect(until(w, () => w.squad.decision?.kind === 'doorctl', 30)).toBe(true);
    const ids = w.squad.decision.options.map((o) => o.id);
    expect(ids).toEqual(['seal', 'weld', 'leave']);
    w.choose('seal');
    expect(until(w, () => !inner.open, 10)).toBe(true);
  });

  it('a welded door: no alien gets through it - they go round, or not at all', () => {
    const w = aboard();
    const p = w.level.portals.find((q) => q.kind === 'door' && !q.outer && !q.airlock);
    p.welded = true;
    const blocked = (pid) => w.level.portals[pid].fire || w.level.portals[pid].welded;
    const ends = portalEnds(w.level, p);
    const r = w.nav.route({ room: p.a, x: ends[p.a].x }, { room: p.b, x: ends[p.b].x }, { vents: true, blocked });
    if (r) expect(r.steps.some((s) => s.type === 'portal' && s.portal === p.id)).toBe(false);
    // ...and one already forcing it gives up when it's welded in its face.
    const room = w.level.rooms[p.a];
    const a = w.addAlien(makeAlien(w.rng, ends[p.a].x, room.y0, p.a, 'hunt'));
    a.trav = { kind: 'force', t: 0, portal: p };
    run(w, 2);
    expect(p.open).toBe(false);
  });

  it('weld it shut costs a charge; out of charges, the option is off', () => {
    const w = aboard();
    lucky(w);
    const inner = w.level.portals.find((p) => p.airlock);
    const prop = { x: inner.x, room: w.squad.leader.room, door: inner, id: 'd' };
    w.encounters.offer('doorctl', prop, { key: 'k' });
    w.choose('weld');
    run(w, 6);
    expect(inner.welded).toBe(true);
    expect(w.kit.charges).toBe(KIT.CHARGES - 1);
    w.kit.charges = 0;
    w.encounters.offer('doorctl', prop, { key: 'k2' });
    expect(w.squad.decision.options.find((o) => o.id === 'cut').off).toBe(true);
    expect(w.choose('cut')).toBe(false);
  });

  it('a welded door on the way: the self-led squad cuts through it (and gets the job done)', () => {
    const L = generateLevel('A1');
    const w = new World(L, { params: { god: true }, doctrine: DEFAULT_DOCTRINE });
    lucky(w);
    const path = L.mainPath;
    const p = L.portals.find((q) => q.kind === 'door' && !q.airlock && !q.outer
      && ((q.a === path[3] && q.b === path[4]) || (q.a === path[4] && q.b === path[3])));
    p.welded = true;
    let cut = 0;
    w.on('cut', () => cut++);
    run(w, 900);
    expect(cut).toBe(1);
    expect(w.kit.charges).toBe(KIT.CHARGES - 1);
    expect(w.status).toBe('won');
  }, 120000);
});

describe('vents', () => {
  it('a welded vent is closed to the ducts: no routes through it, no ambushes out of it', () => {
    const w = aboard();
    lucky(w);
    const v = w.level.vents.find((q) => q.links.length);
    const prop = { x: v.x, room: v.room, vent: v, id: 'v' };
    w.encounters.offer('vent', prop, { key: 'v' });
    w.choose('weld');
    run(w, 5);
    expect(v.welded).toBe(true);
    // No duct route touches it any more.
    for (const o of w.level.vents) {
      const r = w.nav.route({ room: o.room, x: o.x }, { room: v.room, x: v.x }, { vents: true });
      if (r) expect(r.steps.some((s) => s.type === 'vent' && (s.from === v.id || s.to === v.id))).toBe(false);
    }
    expect(w.director.ventsNear(v.room, 0, 3).includes(v)).toBe(false);
  });

  it('pointing at a vent sends them to weld it', () => {
    // A ship whose first room past the airlock has a vent in sight.
    let w = null;
    let t = null;
    for (const seed of ['A1', 'B2', 'C3', 'D4', 'E5', 'F6']) {
      w = aboard(seed);
      lucky(w);
      // Through the inner door: the airlock itself has no vents.
      const inner = w.interactables().find((q) => q.kind === 'door' && w.level.portals[q.portal].airlock);
      w.nudge(inner.id);
      until(w, () => w.squad.leader.room !== w.level.airlock && w.squad.state === 'hold', 90);
      t = w.interactables().find((q) => q.kind === 'vent' && q.room === w.squad.leader.room)
        ?? w.interactables().find((q) => q.kind === 'vent');
      if (t) break;
    }
    expect(t).toBeTruthy();
    w.nudge(t.id);
    expect(until(w, () => w.squad.decision?.kind === 'vent', 60)).toBe(true);
    w.choose('weld');
    expect(until(w, () => w.level.vents[t.vent].welded, 10)).toBe(true);
  }, 60000);
});
