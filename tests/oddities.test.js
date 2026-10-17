// The ship's other set pieces: a sentry turret to hack, the medbay autodoc, egg clusters, cryo
// pods, and dead crew - one carrying the keycard to a locked storeroom off the route.
import { beforeAll, describe, expect, it } from 'vitest';
import { AUTODOC, DOWN, KIT, SENTRY } from '../src/core/config.js';
import { walkLimits } from '../src/gen/layout.js';
import { generateLevel } from '../src/gen/level.js';
import { initPhysics } from '../src/physics/physics.js';
import { PRESETS } from '../src/sim/doctrine.js';
import { makeAlien } from '../src/sim/entities.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };
const props = (L, test) => L.rooms.flatMap((r) => r.props.filter(test));
const shipWith = (test, from = 0) => {
  for (let i = from; i < from + 120; i++) {
    const L = generateLevel(`ODD${i}`);
    if (test(L)) return L;
  }
  throw new Error('no ship');
};
const yes = { chance: () => true, int: (lo) => lo, float: (lo) => lo, pick: (a) => a[0], next: () => 0 };
const no = { chance: () => false, int: (lo, hi) => hi, float: (lo) => lo, pick: (a) => a[0], next: () => 0.99 };
/** Put the decision for this set piece in front of the squad, as if they had walked up to it. */
const offer = (w, kind, prop) => { w.encounters.offer(kind, prop, { key: `enc${prop.id}` }); return w.squad.decision; };
const choose = (w, d, id, rng = yes) => {
  w.encounters.rng = rng;
  const o = d.options.find((q) => q.id === id);
  w.encounters.resolve(d, o);
  return o;
};

describe('generation', () => {
  it('ships carry turrets, autodocs, eggs in nests, cryo pods, dead crew and locked storerooms', () => {
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      const L = generateLevel(`ODD${i}`);
      for (const p of props(L, (q) => q.encounter || q.kind === 'body')) {
        seen.add(p.encounter ?? 'body');
        if (p.encounter === 'eggs') expect(L.rooms[p.room].nest).toBe(true);
        if (p.encounter === 'autodoc') expect(p.kind).toBe('medbed');
        if (p.encounter === 'cryopod') expect(['survivor', 'alien', 'cache']).toContain(p.pod);
      }
      for (const door of L.portals.filter((q) => q.locked)) {
        seen.add('locked');
        // A dead end off the route, with something worth it inside...
        const side = L.rooms.find((r) => r.locked === door.id);
        expect(side.portals).toEqual([door.id]);
        expect(L.mainPath).not.toContain(side.id);
        expect(side.props.some((p) => p.loot?.type === 'weapon' || p.loot?.type === 'treasure')).toBe(true);
        // ...and its keycard on a dead crewman on the way, nearer the airlock.
        const card = props(L, (p) => p.loot?.type === 'keycard');
        expect(card.length).toBe(1);
        expect(L.mainPath).toContain(card[0].room);
        expect(L.rooms[card[0].room].dist).toBeLessThan(side.dist);
      }
    }
    for (const k of ['autodoc', 'body', 'cryopod', 'eggs', 'locked', 'turret']) expect(seen).toContain(k);
  });
});

describe('the keycard door', () => {
  const lockedShip = () => shipWith((L) => L.portals.some((p) => p.locked));

  it('no card: the card option is greyed, cutting through costs a charge; the card opens it', () => {
    const L = lockedShip();
    const w = new World(L, { params: { god: true } });
    const door = L.portals.find((p) => p.locked);
    const prop = { x: door.x, room: door.a, door, id: `key${door.id}` };
    let d = offer(w, 'keydoor', prop);
    expect(d.options.find((o) => o.id === 'card').off).toBe(true);
    expect(d.options.find((o) => o.id === 'cut').off).toBe(false);
    choose(w, d, 'cut');
    expect(door.locked).toBe(false);
    expect(w.kit.charges).toBe(KIT.CHARGES - 1);
    // Again, with the card off the dead crewman.
    door.locked = true;
    const body = props(L, (p) => p.loot?.type === 'keycard')[0];
    let got = 0;
    w.on('keycard', () => got++);
    w.resolveLoot(body, w.squad.leader);
    expect(got).toBe(1);
    expect(w.kit.keycards).toBe(1);
    d = offer(w, 'keydoor', prop);
    expect(d.options.find((o) => o.id === 'card').off).toBe(false);
    choose(w, d, 'card');
    expect(door.locked).toBe(false);
    expect(w.kit.keycards).toBe(0);
    expect(w.kit.charges).toBe(KIT.CHARGES - 1);
  });

  it('left locked, the squad\'s own routes go round it - until the player sends them there', () => {
    const L = lockedShip();
    const w = new World(L, { params: { god: true }, doctrine: PRESETS.salvage.doctrine });
    const door = L.portals.find((p) => p.locked);
    w.kit.charges = 0;
    expect(w.doctrine.lockedOut(door)).toBe(true); // nothing to open it with
    w.kit.charges = 2;
    expect(w.doctrine.lockedOut(door)).toBe(false);
    door.passed = true; // they chose to leave it
    expect(w.doctrine.lockedOut(door)).toBe(true);
    const side = L.rooms.find((r) => r.locked === door.id);
    side.seen = true;
    const t = w.interactables().find((q) => q.portal === door.id);
    expect(t.label).toBe('Unlock the door');
    w.doctrine.nudge(t);
    expect(door.passed).toBe(false);
  });

  it('a squad sweeping the ship gets its storeroom - or leaves it - and still gets the job done', () => {
    const L = lockedShip();
    const w = new World(L, { params: { god: true }, doctrine: PRESETS.salvage.doctrine });
    let asked = 0;
    w.on('decision', (d) => { if (d.kind === 'keydoor') asked++; });
    run(w, 900);
    expect(w.status).toBe('won');
  }, 120000);
});

describe('the sentry turret', () => {
  it('hacked, it shoots what comes into its room for the squad - until its ammo runs out', () => {
    const L = shipWith((q) => props(q, (p) => p.encounter === 'turret').length > 0);
    const w = new World(L, { params: { god: true } });
    const prop = props(L, (p) => p.encounter === 'turret')[0];
    const d = offer(w, 'turret', prop);
    let online = 0;
    w.on('sentry-online', () => online++);
    choose(w, d, 'hack');
    expect(online).toBe(1);
    expect(w.sentries.length).toBe(1);
    expect(w.interactables().some((t) => t.prop === prop.id)).toBe(false);
    const room = L.rooms[prop.room];
    const [wl, wr] = walkLimits(room);
    const a = w.addAlien(makeAlien(w.rng, prop.x + (prop.x - wl > wr - prop.x ? -6 : 6), room.y0, prop.room, 'hunt', { type: 'brute' }));
    a.wakeT = 99;
    a.hp = a.maxHp = 1e6;
    const s = w.sentries[0];
    let shots = 0;
    w.on('sentry-shot', () => shots++);
    run(w, 2);
    expect(shots).toBeGreaterThan(SENTRY.RATE);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(s.ammo).toBe(SENTRY.AMMO - shots);
    s.ammo = 1;
    run(w, 1);
    expect(s.ammo).toBe(0);
    const n = shots;
    run(w, 1);
    expect(shots).toBe(n); // dry
  });

  it('a botched hack locks it out for good, with an alarm', () => {
    const L = shipWith((q) => props(q, (p) => p.encounter === 'turret').length > 0);
    const w = new World(L, { params: { god: true } });
    const prop = props(L, (p) => p.encounter === 'turret')[0];
    choose(w, offer(w, 'turret', prop), 'hack', no);
    expect(w.sentries.length).toBe(0);
    expect(prop.jammed).toBe(true);
    expect(w.noises.length).toBeGreaterThan(0);
  });
});

describe('the autodoc', () => {
  it('a cycle heals everyone and mends the worst wound; it is spent after', () => {
    const L = shipWith((q) => props(q, (p) => p.encounter === 'autodoc').length > 0);
    const w = new World(L, { params: {} });
    const prop = props(L, (p) => p.encounter === 'autodoc')[0];
    const m = w.squad.order[1];
    const base = { ...m.mods };
    m.hp = 20;
    m.wound = 'arm';
    m.mods = { ...m.mods, spread: m.mods.spread * DOWN.WOUNDS.arm.spread, reload: m.mods.reload * DOWN.WOUNDS.arm.reload };
    w.level.rooms[prop.room].seen = true;
    expect(w.interactables().some((t) => t.label === 'Use the autodoc')).toBe(true);
    choose(w, offer(w, 'autodoc', prop), 'treat');
    expect(m.hp).toBe(20 + AUTODOC.HEAL);
    expect(m.wound).toBe(null);
    expect(m.mods.spread).toBeCloseTo(base.spread);
    expect(m.mods.reload).toBeCloseTo(base.reload);
    expect(w.interactables().some((t) => t.label === 'Use the autodoc')).toBe(false);
  });
});

describe('eggs', () => {
  const eggShip = () => shipWith((q) => props(q, (p) => p.encounter === 'eggs').length > 0);

  it('burnt with a flare: none hatch', () => {
    const L = eggShip();
    const w = new World(L, { params: { god: true } });
    const prop = props(L, (p) => p.encounter === 'eggs')[0];
    const before = w.aliens.length;
    w.reserve = 5;
    choose(w, offer(w, 'eggs', prop), 'burn');
    expect(w.kit.flares).toBe(KIT.FLARES - 1);
    expect(prop.destroyed).toBe(true);
    expect(w.aliens.length).toBe(before);
    expect(w.reserve).toBe(5);
  });

  it('blundered past: they hatch - out of the ship\'s reserve, and none if it\'s spent', () => {
    const L = eggShip();
    const w = new World(L, { params: { god: true } });
    const prop = props(L, (p) => p.encounter === 'eggs')[0];
    w.reserve = 5;
    const before = w.aliens.length;
    choose(w, offer(w, 'eggs', prop), 'sneak', no);
    expect(w.aliens.length).toBeGreaterThan(before);
    expect(w.reserve).toBe(5 - (w.aliens.length - before));
    expect(w.aliens.slice(before).every((a) => a.type === 'runner' && a.state === 'hunt')).toBe(true);
    // A spent ship: nothing left in them.
    const w2 = new World(L, { params: { god: true } });
    w2.reserve = 0;
    const n = w2.aliens.length;
    choose(w2, offer(w2, 'eggs', props(L, (p) => p.encounter === 'eggs')[0]), 'sneak', no);
    expect(w2.aliens.length).toBe(n);
  });
});

describe('cryo pods', () => {
  const podShip = (pod) => shipWith((q) => props(q, (p) => p.encounter === 'cryopod' && p.pod === pod).length > 0);

  it('sharp eyes read what is inside; a survivor comes out to be taken home', () => {
    const L = podShip('survivor');
    const w = new World(L, { params: { god: true } });
    const prop = props(L, (p) => p.encounter === 'cryopod')[0];
    w.encounters.rng = yes;
    const d = offer(w, 'cryopod', prop);
    expect(prop.known).toBe(true);
    expect(d.text).toMatch(/alive/);
    const n = w.survivors.length;
    choose(w, d, 'open');
    expect(w.survivors.length).toBe(n + 1);
  });

  it('known to be hostile, it can be shot through the glass; opened, it comes out fighting', () => {
    const L = podShip('alien');
    const w = new World(L, { params: { god: true } });
    const prop = props(L, (p) => p.encounter === 'cryopod')[0];
    w.encounters.rng = yes;
    const d = offer(w, 'cryopod', prop);
    expect(d.options.some((o) => o.id === 'shoot')).toBe(true);
    const n = w.aliens.length;
    w.reserve = 3;
    choose(w, d, 'open');
    expect(w.aliens.length).toBe(n + 1);
    expect(w.reserve).toBe(2);
  });

  it('frosted over, nobody can tell', () => {
    const L = podShip('cache');
    const w = new World(L, { params: { god: true } });
    const prop = props(L, (p) => p.encounter === 'cryopod')[0];
    w.encounters.rng = no;
    const d = offer(w, 'cryopod', prop);
    expect(prop.known).toBe(false);
    expect(d.options.some((o) => o.id === 'shoot')).toBe(false);
    choose(w, d, 'open');
    expect(w.salvage.length).toBe(1);
  });
});
