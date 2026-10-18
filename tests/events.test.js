// Ship events: a deck's power failing, a doorway on fire, a distress call. None on a clock - each
// starts when the squad gets somewhere and waits for the squad to deal with it.
import { beforeAll, describe, expect, it } from 'vitest';
import { generateLevel } from '../src/gen/level.js';
import { initPhysics } from '../src/physics/physics.js';
import { DEFAULT_DOCTRINE, PRESETS } from '../src/sim/doctrine.js';
import { DISTRESS_BONUS } from '../src/sim/shipevents.js';
import { World } from '../src/sim/world.js';
import { inView } from '../src/vis/sight.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };
function until(w, pred, s) {
  for (let i = 0; i < s * 60 && w.status === 'playing'; i++) { w.step(STEP); if (pred()) return true; }
  return false;
}
const withEvent = (kind, from = 0, test = () => true) => {
  for (let i = from; i < from + 200; i++) {
    const L = generateLevel(`EV${i}`);
    const e = L.events.find((q) => q.kind === kind);
    if (e && test(L, e)) return { L, e, seed: `EV${i}` };
  }
  throw new Error(`no ${kind}`);
};

describe('ship events', () => {
  it('ships carry none, one or two of them - every kind turns up', () => {
    const kinds = new Set();
    let none = 0;
    for (let i = 0; i < 40; i++) {
      const L = generateLevel(`EV${i}`);
      expect(L.events.length).toBeLessThanOrEqual(2);
      if (!L.events.length) none++;
      for (const e of L.events) {
        kinds.add(e.kind);
        if (e.kind === 'power') {
          const room = L.rooms[e.junction.room];
          expect(room.deck).toBe(e.deck);
          expect(room.props.find((p) => p.id === e.junction.prop).kind).toBe('console');
        }
        if (e.kind === 'fire') expect(L.portals[e.portal].kind).toBe('door');
        if (e.kind === 'distress') expect(L.rooms[e.room].dist).toBeGreaterThanOrEqual(3);
      }
    }
    expect([...kinds].sort()).toEqual(['distress', 'fire', 'power']);
    expect(none).toBeGreaterThan(0);
  });

  it('the power fails when the squad reaches the deck - and stays out until they fix it', () => {
    const { L, e } = withEvent('power');
    const w = new World(L, { params: { god: true }, doctrine: DEFAULT_DOCTRINE });
    let out = 0;
    w.on('power-out', () => out++);
    expect(L.rooms.some((r) => r.powerOut)).toBe(false);
    w.shipEvents.powerOut(w.shipEvents.get('power'));
    expect(out).toBe(1);
    for (const id of e.rooms) expect(L.rooms[id].powerOut).toBe(true);
    // In the dark nobody sees far without a torch.
    const m = w.marines[0];
    expect(inView(m, m.x + m.facing * -4, m.y + 1.6, false, false)).toBe(true);
    expect(inView(m, m.x + m.facing * -4, m.y + 1.6, false, true)).toBe(false);
    // The junction is now an encounter: reset the breakers and the lights come back.
    const prop = L.rooms[e.junction.room].props.find((p) => p.id === e.junction.prop);
    expect(prop.encounter).toBe('junction');
    expect(w.interactables().some((t) => t.label === 'Restore the power')).toBe(true);
    run(w, 120);
    w.encounters.rng = { chance: () => true, int: () => 5 };
    const d = { kind: 'junction', prop, feature: { key: 'x' } };
    w.encounters.resolve(d, { id: 'restore', stat: 'int', odds: 1, by: w.squad.leader });
    for (const id of e.rooms) expect(L.rooms[id].powerOut).toBe(false);
  });

  it('a botched hot-wire bites, and the breakers can be tried again', () => {
    const { L, e } = withEvent('power');
    const w = new World(L, { params: {}, doctrine: DEFAULT_DOCTRINE });
    w.shipEvents.powerOut(w.shipEvents.get('power'));
    const prop = L.rooms[e.junction.room].props.find((p) => p.id === e.junction.prop);
    const by = w.squad.leader;
    const hp = by.hp;
    w.encounters.rng = { chance: () => false };
    w.encounters.resolve({ kind: 'junction', prop, feature: { key: 'x' } }, { id: 'hotwire', stat: 'str', odds: 0.5, by });
    expect(by.hp).toBeLessThan(hp);
    expect(prop.encounterDone).toBe(false);
    expect(L.rooms[e.rooms[0]].powerOut).toBe(true);
  });

  it('a doorway on fire stops the squad; the orders deal with it and they still get the job done', () => {
    const { L } = withEvent('fire', 0, (lvl, e) => {
      const p = lvl.portals[e.portal];
      return lvl.mainPath.includes(p.a) && lvl.mainPath.includes(p.b);
    });
    const w = new World(L, { params: { god: true }, doctrine: DEFAULT_DOCTRINE });
    let fire = 0;
    w.on('fire', () => fire++);
    run(w, 900);
    expect(fire).toBe(1); // it broke out (ahead of them, or behind - either way)
    expect(w.status).toBe('won');
  }, 120000);

  it('meeting a burning door ahead: the choice comes up, and putting it out opens the way', () => {
    const L = generateLevel('A1');
    const w = new World(L, { params: { god: true }, doctrine: DEFAULT_DOCTRINE });
    // Set a door well along the route on fire before they get there.
    const path = L.mainPath;
    const p = L.portals.find((q) => q.kind === 'door' && !q.airlock && !q.outer
      && ((q.a === path[3] && q.b === path[4]) || (q.a === path[4] && q.b === path[3])));
    expect(p).toBeTruthy();
    p.fire = true;
    let asked = 0;
    let out = 0;
    w.on('decision', (d) => { if (d.kind === 'fire') asked++; });
    w.on('fire-out', () => out++);
    w.encounters.rng = { chance: () => true, int: () => 5 };
    run(w, 900);
    expect(asked).toBeGreaterThan(0);
    expect(out).toBe(1);
    expect(p.fire).toBe(false);
    expect(w.status).toBe('won');
  }, 120000);

  it('aliens route round a burning door (by the vents)', () => {
    const { L, e } = withEvent('fire');
    const w = new World(L, { params: { god: true } });
    const p = L.portals[e.portal];
    p.fire = true;
    const r = w.nav.route({ room: p.a, x: L.rooms[p.a].x0 + 2 }, { room: p.b, x: L.rooms[p.b].x1 - 2 }, { vents: true, blocked: (pid) => L.portals[pid].fire });
    if (r) expect(r.steps.some((s) => s.type === 'portal' && s.portal === p.id)).toBe(false);
  });

  it('a distress call puts a survivor deep in the ship and a beacon on the tracker; a sweep answers it', () => {
    // A caller on or beside the way to the bridge: a sweep of a big ship can otherwise reach the
    // bridge (and win) before it gets round to a far corner.
    const nearRoute = (L, e) => L.mainPath.includes(e.room) || L.rooms[e.room].portals.some((pid) => { const p = L.portals[pid]; return L.mainPath.includes(p.a === e.room ? p.b : p.a); });
    const { L, e } = withEvent('distress', 0, nearRoute);
    const w = new World(L, { params: { god: true }, doctrine: PRESETS.salvage.doctrine });
    // Nothing hunting, and no vermin to draw fire past a hiding caller: he lives long enough to be
    // found (here, to test the call itself).
    for (const a of [...w.aliens, ...w.critters]) { a.alive = false; w.physics.removeHitbox(a); }
    w.reserve = 0;
    let call = null;
    let answered = null;
    w.on('distress', (ev) => { call = ev; });
    w.on('distress-answered', (ev) => { answered = ev; });
    expect(until(w, () => call, 600)).toBe(true);
    expect(call.room.id).toBe(e.room);
    expect(w.survivors.some((s) => s.distress && s.room === e.room)).toBe(true);
    expect(w.interactables().some((t) => t.kind === 'distress')).toBe(true);
    const credits = w.credits;
    // Answering it: point at the beacon (as the card says) - the sweep goes to the caller.
    let ok = false;
    for (let k = 0; k < 12 && !ok; k++) {
      const beacon = w.interactables().find((t) => t.kind === 'distress');
      if (beacon) w.nudge(beacon.id);
      ok = until(w, () => answered, 75);
    }
    expect(ok).toBe(true);
    expect(w.credits).toBeGreaterThanOrEqual(credits + DISTRESS_BONUS);
  }, 120000);
});
