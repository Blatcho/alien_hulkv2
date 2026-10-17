// The squad's kit (grenades, flares, the Defend guns), firing drills (staggered reloads, top-ups,
// suppression), the shove, the specialists and squad morale.
import { beforeAll, describe, expect, it } from 'vitest';
import { ABILITY, DEFEND, KIT, MORALE, SQUAD, SUPPRESS } from '../src/core/config.js';
import { Rng } from '../src/core/rng.js';
import { walkLimits } from '../src/gen/layout.js';
import { generateLevel } from '../src/gen/level.js';
import { makeCandidate } from '../src/meta/candidates.js';
import { initPhysics } from '../src/physics/physics.js';
import { lit, updateAlien, wake } from '../src/sim/alien.js';
import { doctrineString, parseDoctrine } from '../src/sim/doctrine.js';
import { makeAlien } from '../src/sim/entities.js';
import { updateMedic, updateMelee } from '../src/sim/melee.js';
import { World } from '../src/sim/world.js';
import { aura, canSee } from '../src/vis/sight.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };
const squadOf = (...archetypes) => archetypes.map((a, i) => makeCandidate(new Rng('kit', String(i)), { archetype: a, jitter: false }));
/** Nothing on the board, well inside the ship. */
function calm(params = {}, opts = {}) {
  const w = new World(generateLevel(opts.seed ?? 'A1'), { params, ...opts });
  for (const a of w.aliens) { a.alive = false; w.physics.removeHitbox(a); }
  w.reserve = 0;
  run(w, 45);
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
  const [wl, wr] = walkLimits(w.level.rooms[room]);
  const a = w.addAlien(makeAlien(w.rng, Math.min(wr, Math.max(wl, x)), w.level.rooms[room].y0, room, state, { type }));
  a.wakeT = 0;
  return a;
};
/** Standing there, seen: a target for the kit, doing nothing in the meantime. */
const dummy = (w, type, x, room) => { const a = spawn(w, type, x, room); a.wakeT = 99; a.visible = true; return a; };
/** Terminals and junctions all used: nothing the grenade has to spare (see the test that it does). */
const used = (w) => { for (const p of w.props) if (p.prop.encounter) p.prop.encounterDone = true; };
const sure = () => ({ chance: () => true, float: (lo) => lo, int: (lo) => lo, pick: (arr) => arr[0], next: () => 0 });

describe('the kit', () => {
  it('a grenade into a pack: the throw, the lob, the blast', () => {
    const w = calm({ god: true });
    const lead = roomAhead(w, 12);
    used(w);
    const h = w.squad.heading;
    const a = dummy(w, 'drone', lead.x + h * 9, lead.room);
    const b = dummy(w, 'drone', lead.x + h * 9.8, lead.room);
    expect(w.gear.grenade(true)).toBe(true);
    expect(w.kit.grenades).toBe(KIT.GRENADES - 1);
    let boom = null;
    w.on('explosion', (e) => { boom = e; });
    for (let i = 0; i < 90 && !boom; i++) w.gear.update(STEP);
    expect(boom?.grenade).toBe(true);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('one small one is no reason for the squad to throw - but the player can; never near one of ours', () => {
    const w = calm({ god: true });
    const lead = roomAhead(w, 12);
    used(w);
    const h = w.squad.heading;
    const a = dummy(w, 'runner', lead.x + h * 8, lead.room);
    expect(w.gear.grenade(true)).toBe(false);
    // One of ours right by it: no throw at all.
    const m = w.squad.order[3];
    const x = m.x;
    m.x = a.x - h * 1;
    expect(w.gear.grenade(false)).toBe(false);
    m.x = x;
    expect(w.gear.grenade(false)).toBe(true);
  });

  it('Kit: save - the squad keeps its grenades for the player; use - it throws them itself', () => {
    const w = calm({ god: true });
    const lead = roomAhead(w, 12);
    used(w);
    const h = w.squad.heading;
    dummy(w, 'drone', lead.x + h * 9, lead.room);
    dummy(w, 'drone', lead.x + h * 9.6, lead.room);
    w.doctrine.setOrder('kit', 'save');
    expect(w.gear.auto).toBe(false);
    w.squad.engaged = true;
    w.gear.cool = 0;
    w.gear.update(STEP);
    expect(w.kit.grenades).toBe(KIT.GRENADES);
    w.doctrine.setOrder('kit', 'use');
    w.gear.update(STEP);
    expect(w.kit.grenades).toBe(KIT.GRENADES - 1);
  });

  it('nor next to a terminal they still need', () => {
    const w = calm({ god: true });
    const lead = roomAhead(w, 12);
    used(w);
    const h = w.squad.heading;
    const a = dummy(w, 'drone', lead.x + h * 9, lead.room);
    dummy(w, 'drone', lead.x + h * 9.6, lead.room);
    const t = w.props.find((p) => p.alive && !p.explosive);
    Object.assign(t, { room: a.room, x: a.x + 1, y: a.y });
    t.prop.encounter = 'terminal';
    t.prop.encounterDone = false;
    expect(w.gear.grenade(false)).toBe(false);
    t.prop.encounterDone = true;
    expect(w.gear.grenade(false)).toBe(true);
  });

  it('a flare lights the room for good: the squad sees much further round them in it, power or not', () => {
    const w = calm();
    const m = roomAhead(w, 12);
    const room = w.level.rooms[m.room];
    room.powerOut = true;
    const dir = w.squad.heading;
    m.facing = -dir; // looking the other way: only the all-round awareness can see it
    const t = { x: m.x + dir * aura(m) * 1.5, y: room.y0, height: 1.6, surface: 'floor' };
    expect(aura(m) * 1.5).toBeLessThan(12);
    expect(canSee(w, m, t)).toBe(false);
    let refused = 0;
    w.on('kit-refused', () => refused++);
    w.useKit('flare');
    w.step(STEP);
    expect(room.flare).toBeTruthy();
    expect(w.kit.flares).toBe(KIT.FLARES - 1);
    m.facing = -dir;
    expect(canSee(w, m, t)).toBe(true);
    w.useKit('flare'); // one's enough
    w.step(STEP);
    expect(refused).toBe(1);
    expect(w.kit.flares).toBe(KIT.FLARES - 1);
  });

  it('a creeper in a flared room is in the light, torches or not', () => {
    const w = calm();
    const lead = w.squad.leader;
    const a = spawn(w, 'creeper', lead.x, lead.room);
    w.settings.flashlight = false;
    expect(lit(w, a)).toBe(false);
    w.gear.flare();
    expect(lit(w, a)).toBe(true);
  });

  it('walking into a dark nest, the squad lights it up by itself', () => {
    const w = calm();
    const room = w.level.rooms[w.squad.leader.room];
    Object.assign(room, { nest: true, powerOut: true });
    w.gear.entered = room;
    w.gear.update(STEP);
    expect(room.flare).toBeTruthy();
  });

  it('the squad carries one Defend kit; more turn up in containers', () => {
    expect(KIT.DEFEND).toBe(1);
    expect(new World(generateLevel('A1')).kit.defend).toBe(1);
    const w = calm();
    w.kit.defend = 0;
    let found = null;
    w.on('loot', ({ loot }) => { found = loot.type; });
    w.resolveLoot({ id: 'box', kind: 'crate', room: w.squad.leader.room, loot: { type: 'defend' } }, w.squad.leader);
    expect(found).toBe('defend');
    expect(w.kit.defend).toBe(1);
  });

  it('the Defend button: two guns either side of the squad that fight what comes', () => {
    const w = calm({ god: true });
    const lead = roomAhead(w, 12);
    w.kit.defend = 1;
    let guns = null;
    let xs = null;
    w.on('defend', (e) => { guns = e.guns; xs = w.squad.order.map((m) => m.x); });
    w.useKit('defend');
    w.step(STEP);
    expect(guns).toHaveLength(2);
    expect(w.kit.defend).toBe(0);
    expect(w.squad.cover).toBe(false);
    // Beyond the outermost man each side (or as far as the bulkhead lets them).
    const [wl, wr] = walkLimits(w.level.rooms[lead.room]);
    expect(guns[0].x).toBeCloseTo(Math.max(wl + 0.4, Math.min(...xs) - DEFEND.GAP), 5);
    expect(guns[1].x).toBeCloseTo(Math.min(wr - 0.4, Math.max(...xs) + DEFEND.GAP), 5);
    expect(guns.map((g) => g.facing)).toEqual([-1, 1]);
    expect(guns.every((g) => g.ammo === DEFEND.AMMO && w.sentries.includes(g))).toBe(true);
    // Something comes at the squad: the gun on its side opens up.
    const h = w.squad.heading;
    const a = spawn(w, 'drone', lead.x + h * 9, lead.room);
    a.hp = a.maxHp = 1e6;
    let shots = 0;
    w.on('sentry-shot', ({ sentry }) => { if (sentry.deployed) shots++; });
    run(w, 1.5);
    expect(shots).toBeGreaterThan(3);
    expect(a.hp).toBeLessThan(1e6);
  });

  it('the Defend guns stay where they\'re put and keep firing once the squad has moved on', () => {
    const w = calm({ god: true });
    roomAhead(w, 12);
    let guns = null;
    w.on('defend', (e) => { guns = e.guns; });
    w.useKit('defend');
    w.step(STEP);
    const at = guns.map((q) => [q.x, q.room]);
    const g = guns[0];
    // The squad walks off and leaves them.
    const away = () => w.squad.order.every((m) => m.room !== g.room || Math.abs(m.x - g.x) > DEFEND.RANGE + 10);
    for (let i = 0; i < 60 * 120 && !away(); i++) w.step(STEP);
    expect(away()).toBe(true);
    expect(guns.map((q) => [q.x, q.room])).toEqual(at);
    expect(w.sentries).toEqual(expect.arrayContaining(guns));
    // Something comes by one of them: it opens up, nobody of ours anywhere near.
    const room = w.level.rooms[g.room];
    const [wl, wr] = walkLimits(room);
    const a = spawn(w, 'drone', Math.min(wr - 0.5, Math.max(wl + 0.5, g.x + (g.x - wl > wr - g.x ? -5 : 5))), g.room);
    a.wakeT = 99; // standing there
    a.hp = a.maxHp = 1e6;
    const ammo = g.ammo;
    run(w, 1);
    expect(g.ammo).toBeLessThan(ammo);
    expect(a.hp).toBeLessThan(1e6);
  });

  it('no Defend kit: the button is refused', () => {
    const w = calm();
    roomAhead(w);
    w.kit.defend = 0; // (one may have turned up on the way in)
    let refused = null;
    w.on('kit-refused', ({ item }) => { refused = item; });
    w.useKit('defend');
    w.step(STEP);
    expect(refused).toBe('defend');
    expect(w.sentries).toHaveLength(0);
  });

  it('a horde coming: under the Kit order "use" the squad sets the guns up itself; "save" leaves it to you', () => {
    for (const kit of ['use', 'save']) {
      const w = calm({ god: true }, { doctrine: { ...parseDoctrine('direct.normal.steady.way.critical.on'), kit } });
      roomAhead(w);
      w.kit.defend = 1;
      w.reserve = 4;
      w.director.callHorde(4);
      let put = 0;
      w.on('defend', () => put++);
      run(w, 3);
      expect(w.director.horde?.phase).toBe('warn');
      run(w, 8);
      expect(put).toBe(kit === 'use' ? 1 : 0);
    }
  });

  it('the Kit order rides in the briefing string; old strings default to using it', () => {
    expect(parseDoctrine('direct.normal.steady.way.critical.on').kit).toBe('use');
    const d = parseDoctrine('direct.normal.steady.way.critical.on.save');
    expect(d.kit).toBe('save');
    expect(doctrineString(d).endsWith('.save')).toBe(true);
  });
});

describe('firing drills', () => {
  it('in a lull a half-empty magazine is topped up - one man at a time', () => {
    const w = calm({ god: true });
    const [, b, c] = w.squad.order;
    b.mag = Math.floor(b.weapon.mag * 0.4);
    c.mag = Math.floor(c.weapon.mag * 0.4);
    let both = false;
    for (let i = 0; i < 60 * 12; i++) { w.step(STEP); if (b.reloadT > 0 && c.reloadT > 0 && b.room === c.room) both = true; }
    expect(both).toBe(false);
    expect(b.mag).toBe(b.weapon.mag);
    expect(c.mag).toBe(c.weapon.mag);
  });

  it('low on rounds while a mate is still firing, a man changes mags before he runs dry', () => {
    const w = calm({ god: true });
    const lead = roomAhead(w, 12);
    const a = spawn(w, 'brute', lead.x + w.squad.heading * 10, lead.room);
    a.hp = a.maxHp = 1e7;
    a.wakeT = 99;
    run(w, 1.5); // weapons up on it
    let early = null;
    w.on('reload', ({ marine, topup }) => { if (!topup && marine.mag > 0) early ??= marine; });
    const m = w.squad.order.find((o) => o.weaponKey === 'carbine');
    for (const o of w.squad.order) o.reloadT = 0;
    m.mag = Math.floor(m.weapon.mag * 0.25);
    for (let i = 0; i < 60 * 4 && !early; i++) w.step(STEP);
    expect(early).toBeTruthy(); // (whoever ran low first)
  });

  it('rounds coming in pin one down: slower, and no pouncing', () => {
    const w = calm({ god: true });
    const lead = roomAhead(w, 12);
    const h = w.squad.heading;
    const free = spawn(w, 'drone', lead.x + h * 11, lead.room);
    free.leapRange = 0;
    const x0 = free.x;
    for (let i = 0; i < 20; i++) updateAlien(w, free, STEP);
    const freeRun = Math.abs(free.x - x0);
    const pinned = spawn(w, 'drone', lead.x + h * 11, lead.room);
    const heavy = w.squad.order.find((m) => m.weaponKey === 'heavy');
    for (let i = 0; i < 4; i++) w.damage(pinned, 1, heavy, {});
    pinned.staggerT = 0;
    expect(pinned.suppressT).toBeGreaterThan(SUPPRESS.MIN);
    const x1 = pinned.x;
    for (let i = 0; i < 20; i++) updateAlien(w, pinned, STEP);
    expect(Math.abs(pinned.x - x1)).toBeLessThan(freeRun * 0.8);
    expect(pinned.state).not.toBe('leap');
  });
});

describe('close quarters', () => {
  it('one clawing at a man changing mags gets shoved back and staggered', () => {
    const w = calm({ god: true });
    const m = w.squad.order.find((o) => o.role === 'breacher');
    const room = w.level.rooms[m.room];
    const [wl, wr] = walkLimits(room);
    const dir = m.x - wl > wr - m.x ? -1 : 1;
    const a = spawn(w, 'drone', m.x + dir * 1.2, m.room);
    Object.assign(a, { state: 'attack', target: m });
    m.reloadT = 1;
    w.melee = sure();
    let shoved = 0;
    w.on('shove', () => shoved++);
    updateMelee(w, STEP);
    expect(shoved).toBe(1);
    expect(a.state).toBe('hunt');
    expect(a.staggerT).toBeGreaterThan(0.7);
    expect(Math.abs(a.x - m.x)).toBeGreaterThan(1.5);
    expect(m.bashT).toBeGreaterThan(0);
    // Too heavy to shove: a brute.
    m.shoveCool = 0;
    const b = spawn(w, 'brute', m.x + dir * 1.2, m.room);
    Object.assign(b, { state: 'attack', target: m });
    updateMelee(w, STEP);
    expect(shoved).toBe(1);
  });
});

describe('specialists', () => {
  it('the original four bring their kit\'s speciality: veteran, heavy, breacher, marksman', () => {
    const w = new World(generateLevel('A1'), { params: {} });
    expect(w.marines.map((m) => m.role)).toEqual(['veteran', 'heavy', 'breacher', 'marksman']);
  });

  it('a breacher on the door gets it open in half the time', () => {
    const doorTime = (squad) => {
      const w = new World(generateLevel('A1'), { params: { god: true }, squad });
      for (let i = 0; i < 60 * 120; i++) { w.step(STEP); if (w.squad.action?.type === 'door') return w.squad.action.dur; }
      return null;
    };
    expect(doorTime(null)).toBeCloseTo(SQUAD.DOOR_TIME * ABILITY.DOOR);
    expect(doorTime(squadOf('veteran', 'heavy', 'tech', 'marksman'))).toBeCloseTo(SQUAD.DOOR_TIME);
  });

  it('the marksman\'s round into a sleeper hits far harder', () => {
    const w = calm({ god: true }, { doctrine: { roe: 'alert' } });
    const lead = roomAhead(w, 12);
    const mk = w.squad.order.find((m) => m.role === 'marksman');
    const a = spawn(w, 'brute', lead.x + w.squad.heading * 9, lead.room, 'dormant');
    a.hp = a.maxHp = 1e6;
    let hit = null;
    w.on('hit', (e) => { if (e.entity === a && e.source === mk && !hit) hit = e; });
    for (let i = 0; i < 60 * 8 && !hit; i++) w.step(STEP);
    expect(hit).toBeTruthy();
    expect(hit.dmg).toBeGreaterThanOrEqual(mk.weapon.damage[0] * ABILITY.SNIPE * 0.99);
  });

  it('a scout picks out something shadowing the squad', () => {
    const w = calm({}, { squad: squadOf('veteran', 'heavy', 'tech', 'scout') });
    roomAhead(w, 9);
    const rear = w.squad.order[w.squad.order.length - 1];
    expect(rear.role).toBe('scout');
    const [wl, wr] = walkLimits(w.level.rooms[rear.room]);
    const back = -w.squad.heading;
    const x = Math.min(wr, Math.max(wl, rear.x + back * 7));
    const a = spawn(w, 'runner', x, rear.room, 'dormant');
    w.hive = sure();
    wake(w, a, 'steps');
    let spotted = 0;
    w.on('stalker-spotted', () => spotted++);
    for (let i = 0; i < 60; i++) updateAlien(w, a, STEP);
    if (Math.abs(a.x - rear.x) < ABILITY.SPOT && w.physics.los(rear.x, rear.y + 1.6, a.x, a.y + 0.8)) {
      expect(spotted).toBe(1);
      expect(a.stalk).toBe(null);
    }
  });

  it('a tech welds a vent with his own torch: no charge spent', () => {
    const w = calm({ god: true }, { squad: squadOf('veteran', 'heavy', 'tech', 'marksman') });
    const v = w.level.vents.find((o) => !o.welded);
    const prop = { x: v.x, room: v.room, vent: v, id: `vent${v.id}` };
    const opts = w.encounters.constructor.DEFS?.vent?.options ?? null;
    w.encounters.offer('vent', prop, { key: `vent${v.id}` });
    const d = w.squad.decision;
    const weld = d.options.find((o) => o.id === 'weld');
    expect(weld.needs).toBeUndefined();
    expect(weld.off).toBeFalsy();
    w.encounters.rng = { chance: () => true, int: () => 5 };
    w.encounters.resolve({ kind: 'vent', prop, feature: { key: 'x' } }, weld);
    expect(v.welded).toBe(true);
    expect(w.kit.charges).toBe(KIT.CHARGES);
    expect(opts).toBe(null);
  });

  it('a medic patches up a hurt man next to him in a lull', () => {
    const w = calm({ god: true }, { squad: squadOf('veteran', 'medic', 'tech', 'marksman') });
    const [, medic, hurt] = w.squad.order.length ? [null, w.marines[1], w.marines[2]] : [];
    hurt.room = medic.room;
    hurt.x = medic.x + 1;
    hurt.hp = hurt.maxHp * 0.3;
    const hp = hurt.hp;
    w.squad.engaged = false;
    updateMedic(w, STEP);
    expect(hurt.hp).toBeCloseTo(hp + ABILITY.DRESSING);
    expect(w.abilities.dressings).toBe(ABILITY.DRESSINGS - 1);
    // Not straight away again.
    hurt.hp = hurt.maxHp * 0.3;
    updateMedic(w, STEP);
    expect(hurt.hp).toBeCloseTo(hurt.maxHp * 0.3);
  });
});

describe('morale', () => {
  it('a man down shakes them; getting him up and kills steady them', () => {
    const w = calm({ god: true });
    const v0 = w.morale.value;
    w.emit('downed', { marine: w.marines[3] });
    expect(w.morale.value).toBeCloseTo(v0 + MORALE.DOWNED);
    w.emit('revived', { marine: w.marines[3] });
    expect(w.morale.value).toBeCloseTo(v0 + MORALE.DOWNED + MORALE.REVIVED);
    const v1 = w.morale.value;
    w.emit('kill', { entity: { kind: 'alien', maxHp: 90 } });
    expect(w.morale.value).toBeCloseTo(v1 + MORALE.KILL);
  });

  it('with no veteran it can break - and a breaking squad shoots worse; a veteran holds it at shaken', () => {
    const w = calm({ god: true }, { squad: squadOf('scout', 'heavy', 'tech', 'marksman') });
    w.morale.add(-100);
    expect(w.morale.level.name).toBe('breaking');
    expect(w.morale.mods.spread).toBeGreaterThan(1);
    expect(w.morale.mods.nerve).toBeGreaterThan(0);
    const v = calm({ god: true });
    v.morale.add(-100);
    expect(v.morale.value).toBe(MORALE.VETERAN);
    expect(v.morale.level.name).toBe('shaken');
  });

  it('out of a fight it settles back toward the middle', () => {
    const w = calm({ god: true });
    w.morale.add(30);
    const hi = w.morale.value;
    run(w, 5);
    expect(w.morale.value).toBeLessThan(hi);
    expect(w.morale.value).toBeGreaterThanOrEqual(MORALE.REST);
  });
});
