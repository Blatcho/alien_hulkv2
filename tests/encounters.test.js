import { beforeAll, describe, expect, it } from 'vitest';
import { generateLevel } from '../src/gen/level.js';
import { makeCandidate } from '../src/meta/candidates.js';
import { Rng } from '../src/core/rng.js';
import { initPhysics } from '../src/physics/physics.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });

const propsOf = (L, kind) => L.rooms.flatMap((r) => r.props).filter((p) => p.encounter === kind);

/** A seed whose ship has an encounter of this kind. */
function shipWith(kind, prefix = 'ENC') {
  for (let i = 0; i < 80; i++) {
    const L = generateLevel(`${prefix}${i}`);
    if (propsOf(L, kind).length) return L;
  }
  return null;
}

/** Step until the squad is offered an encounter (returns the decision) or time runs out. */
function untilEncounter(w, kind, seconds = 600) {
  for (let i = 0; i < seconds * 60 && w.status === 'playing'; i++) {
    w.step(STEP);
    const d = w.squad.decision;
    if (w.squad.state === 'decision' && d?.encounter && (!kind || d.kind === kind)) return d;
  }
  return null;
}

/** Point the squad at the encounter's prop until they reach it. */
function goTo(w, prop) {
  const t = w.interactables().find((q) => q.prop === prop.id);
  if (t) w.nudge(t.id);
}

describe('encounters', () => {
  it('ships get set pieces from their own random stream, the same every time', () => {
    const a = generateLevel('ENCSEED');
    const b = generateLevel('ENCSEED');
    expect(a.rooms.flatMap((r) => r.props).map((p) => p.encounter ?? '')).toEqual(b.rooms.flatMap((r) => r.props).map((p) => p.encounter ?? ''));
    let armouries = 0;
    let terminals = 0;
    for (let i = 0; i < 40; i++) {
      const L = generateLevel(`ENC${i}`);
      armouries += propsOf(L, 'armoury').length;
      terminals += propsOf(L, 'terminal').length;
    }
    expect(armouries).toBeGreaterThan(5);
    expect(terminals).toBeGreaterThan(5);
  });

  it('a terminal offers its choice with odds from the best mind, and deck plans map the ship', () => {
    const L = shipWith('terminal');
    expect(L).not.toBeNull();
    const w = new World(L, { params: { god: true }, doctrine: { route: 'thorough' } });
    const prop = propsOf(L, 'terminal')[0];
    let d = null;
    for (let i = 0; i < 12 && !d; i++) { goTo(w, prop); d = untilEncounter(w, 'terminal', 60); }
    expect(d).not.toBeNull();
    const dl = d.options.find((o) => o.id === 'download');
    expect(dl.odds).toBeGreaterThan(0);
    expect(dl.who).toMatch(/INT \d/);
    expect(d.deadline).toBeGreaterThan(w.time);
    // Force success for the check, then let it play out.
    w.encounters.rng = { chance: () => true };
    w.choose('download');
    for (let i = 0; i < 60 * 8 && !prop.encounterDone; i++) w.step(STEP);
    expect(prop.encounterDone).toBe(true);
    expect(w.intel).toBe(true);
    expect(w.level.rooms.every((r) => r.seen)).toBe(true);
  });

  it('better stats show better odds', () => {
    const L = shipWith('armoury');
    const odds = (int) => {
      const squad = [0, 1, 2, 3].map((i) => {
        const t = makeCandidate(new Rng('odds', String(i)), { archetype: 'veteran', jitter: false });
        t.stats.int = int;
        return t;
      });
      const w = new World(L, { params: { god: true }, squad });
      const prop = propsOf(L, 'armoury')[0];
      let d = null;
      for (let i = 0; i < 12 && !d; i++) { goTo(w, prop); d = untilEncounter(w, 'armoury', 60); }
      return d?.options.find((o) => o.id === 'hack').odds;
    };
    const lo = odds(3);
    const hi = odds(9);
    expect(lo).toBeDefined();
    expect(hi).toBeGreaterThan(lo);
  });

  it('if the player lets the clock run out, the standing orders choose', () => {
    const L = shipWith('armoury');
    const w = new World(L, { params: { god: true }, doctrine: { loot: 'leave' } });
    const prop = propsOf(L, 'armoury')[0];
    let d = null;
    for (let i = 0; i < 12 && !d; i++) { goTo(w, prop); d = untilEncounter(w, 'armoury', 60); }
    expect(d).not.toBeNull();
    let chosen = null;
    w.on('decision-made', ({ decision, option }) => { if (decision === d) chosen = option; });
    for (let i = 0; i < 60 * 12 && !chosen; i++) w.step(STEP);
    expect(chosen).toBe('leave'); // "leave it" orders
    expect(w.time).toBeGreaterThanOrEqual(d.deadline);
  });

  it('squads on autoplay settle encounters and still finish the job', () => {
    for (const kind of ['armoury', 'terminal']) {
      const L = shipWith(kind, 'AUTO');
      const w = new World(L, { params: { autoplay: true, god: true }, doctrine: { route: 'thorough', loot: 'all' } });
      for (let i = 0; i < 60 * 1200 && w.status === 'playing'; i++) w.step(STEP);
      expect(w.status).toBe('won');
    }
  });
});
