// Breakables (sim/hazards.js): furniture that breaks, containers smashed open (loot by force),
// gas cylinders and fuse boxes, the fire a blast leaves, and weak bulkheads a charge or a blast
// opens into a doorway the ship never had (gen/populate.js placeBreaches, world.breach).
import { beforeAll, describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/config.js';
import { Rng } from '../src/core/rng.js';
import { CLASS_KEYS, seedCode } from '../src/gen/classes.js';
import { bfs } from '../src/gen/layout.js';
import { generateLevel } from '../src/gen/level.js';
import { PROPS } from '../src/gen/templates.js';
import { initPhysics } from '../src/physics/physics.js';
import { DEFAULT_DOCTRINE } from '../src/sim/doctrine.js';
import { makeAlien } from '../src/sim/entities.js';
import { BLAST, FIRE } from '../src/sim/hazards.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };
function until(w, pred, s) {
  for (let i = 0; i < s * 60 && w.status === 'playing'; i++) { w.step(STEP); if (pred()) return true; }
  return false;
}
/** A ship (a seed, or a level already generated) with nothing hunting on it. */
function calm(ship, opts = {}) {
  const w = new World(typeof ship === 'string' ? generateLevel(ship) : ship, { params: { god: true }, ...opts });
  for (const a of w.aliens) { a.alive = false; w.physics.removeHitbox(a); }
  w.reserve = 0;
  w.director.hordeSize = 0;
  return w;
}
const seeds = [...Array.from({ length: 24 }, (_, i) => `BK${i}`), ...CLASS_KEYS.map((k) => seedCode(k, 'BK'))];
const withBreach = (test = () => true) => {
  for (const s of seeds) { const L = generateLevel(s); if (L.breaches.length && test(L)) return L; }
  throw new Error('no ship with a weak bulkhead');
};

describe('weak bulkheads', () => {
  it('one or two per ship, in solid walls between rooms a long way apart by the doors', () => {
    let total = 0;
    let mirrored = 0;
    for (const s of seeds) {
      const L = generateLevel(s);
      expect(L.breaches.length).toBeLessThanOrEqual(2);
      total += L.breaches.length;
      for (const b of L.breaches) {
        const ra = L.rooms[b.a];
        const rb = L.rooms[b.b];
        expect(ra.deck).toBe(rb.deck);
        expect(ra.x1).toBeCloseTo(b.x, 5); // a on the left, b on the right - mirrored ships too
        expect(rb.x0).toBeCloseTo(b.x, 5);
        expect(L.portals.some((p) => p.kind === 'door' && ((p.a === b.a && p.b === b.b) || (p.a === b.b && p.b === b.a)))).toBe(false);
        expect(ra.type).not.toBe('airlock');
        expect(rb.type).not.toBe('airlock');
        expect([b.a, b.b]).not.toContain(L.objective.room);
        expect(bfs(L.rooms, L.portals, b.a).dist[b.b]).toBeGreaterThanOrEqual(4);
        // The wall is two solids: the lintel, and the lower part that goes.
        expect(L.solids.some((q) => q.kind === 'breach' && q.breach === b.id && Math.abs((q.x0 + q.x1) / 2 - b.x) < 1e-6 && q.y1 - q.y0 === WORLD.DOOR_H)).toBe(true);
        expect(L.solids.some((q) => q.kind === 'bulkhead' && Math.abs((q.x0 + q.x1) / 2 - b.x) < 1e-6 && q.y0 === ra.y0 + WORLD.DOOR_H)).toBe(true);
        if (L.mirror) mirrored++;
      }
    }
    expect(total).toBeGreaterThan(seeds.length / 2);
    expect(mirrored).toBeGreaterThan(0);
  });

  it('blown open, it is a doorway: a short route, a clear line of sight, and the point is gone', () => {
    const L = withBreach();
    const w = calm(L);
    const b = L.breaches[0];
    const ra = L.rooms[b.a];
    const rb = L.rooms[b.b];
    w.step(STEP); // (the physics answers queries once it has stepped)
    const from = { room: b.a, x: ra.x1 - 1.5 };
    const to = { room: b.b, x: rb.x0 + 1.5 };
    const before = w.nav.route(from, to);
    expect(before.steps.filter((s) => s.type === 'portal').length).toBeGreaterThanOrEqual(4);
    expect(w.physics.los(b.x - 1, ra.y0 + 1.2, b.x + 1, ra.y0 + 1.2)).toBe(false);
    L.rooms[b.a].seen = true;
    expect(w.interactables().filter((t) => t.kind === 'breach')).toHaveLength(1);
    let opened = null;
    w.on('breach', (ev) => { opened = ev; });
    expect(w.breach(b.id)).toBe(true);
    w.step(STEP);
    expect(b.open).toBe(true);
    expect(opened.portal.breach).toBe(b.id);
    const p = L.portals[L.portals.length - 1];
    expect(p).toBe(opened.portal);
    expect(p.open).toBe(true);
    expect(ra.portals).toContain(p.id);
    expect(rb.portals).toContain(p.id);
    expect(w.nav.route(from, to).steps.filter((s) => s.type === 'portal')).toHaveLength(1);
    expect(w.physics.los(b.x - 1, ra.y0 + 1.2, b.x + 1, ra.y0 + 1.2)).toBe(true);
    expect(w.interactables().some((t) => t.kind === 'breach')).toBe(false);
    expect(w.breach(b.id)).toBe(false); // once
  });

  it('a blast against it opens it; one further off does not', () => {
    const L = withBreach();
    const w = calm(L);
    const b = L.breaches[0];
    const ra = L.rooms[b.a];
    w.hazards.explode(b.x - BLAST.BREACH - 1.5, ra.y0 + 1, null, { fire: false });
    expect(b.open).toBe(false);
    w.hazards.explode(b.x - 1.2, ra.y0 + 1, null, { fire: false });
    expect(b.open).toBe(true);
  });

  it('a charge set by the squad opens it - if the charge takes', () => {
    const L = withBreach();
    const w = calm(L, { doctrine: DEFAULT_DOCTRINE });
    const b = L.breaches[0];
    const by = w.squad.leader;
    const d = { kind: 'breach', prop: { x: b.x - 0.6, room: b.a, breach: b, far: b.b, id: `breach${b.id}` }, feature: { key: 'x' } };
    const charges = w.kit.charges;
    w.encounters.rng = { chance: () => false, int: () => 5 };
    w.encounters.resolve(d, { id: 'blow', stat: 'str', odds: 0.5, by });
    expect(w.kit.charges).toBe(charges - 1);
    expect(b.open).toBe(false);
    w.encounters.rng = { chance: () => true, int: () => 5 };
    w.encounters.resolve(d, { id: 'blow', stat: 'str', odds: 1, by });
    expect(w.kit.charges).toBe(charges - 2);
    expect(b.open).toBe(true);
  });

  it('pointed at it, the squad walks up and the choice comes up; through it, they reach the room beyond', () => {
    // A weak wall near the way in, so the walk there is short.
    const L = withBreach((lvl) => lvl.rooms[lvl.breaches[0].a].dist <= 3 || lvl.rooms[lvl.breaches[0].b].dist <= 3);
    const w = calm(L, { doctrine: DEFAULT_DOCTRINE });
    const b = L.breaches[0];
    const near = L.rooms[b.a].dist <= L.rooms[b.b].dist ? b.a : b.b;
    const far = near === b.a ? b.b : b.a;
    run(w, 20);
    L.rooms[near].seen = true;
    const t = w.interactables().find((q) => q.kind === 'breach' && q.room === near);
    expect(t).toBeTruthy();
    w.nudge(t.id);
    w.step(STEP);
    expect(w.doctrine.override?.verb).toBe('breach');
    let asked = null;
    w.on('decision', (dec) => { if (dec.kind === 'breach') asked = dec; });
    expect(until(w, () => asked, 240)).toBe(true);
    expect(w.squad.leader.room).toBe(near);
    w.encounters.rng = { chance: () => true, int: () => 5 };
    w.choose('blow');
    run(w, 6); // setting the charge takes a few seconds
    expect(b.open).toBe(true);
    // Through the hole to the room beyond.
    w.doctrine.moveTo(far, (L.rooms[far].x0 + L.rooms[far].x1) / 2);
    expect(until(w, () => w.squad.order.every((m) => m.room === far), 90)).toBe(true);
  }, 120000);
});

describe('breakables', () => {
  it('furniture breaks in a blast and leaves its wreck', () => {
    const w = calm('BK0');
    const e = w.props.find((p) => ['table', 'shelf', 'bunk', 'crate', 'locker'].includes(p.prop.kind));
    expect(e).toBeTruthy();
    expect(PROPS[e.prop.kind].wreck).toBe('rubble');
    let gone = null;
    w.on('prop-destroyed', (ev) => { if (ev.entity === e) gone = ev; });
    w.hazards.explode(e.x, e.y + 0.6, null, { r: 3, damage: 100, fire: false });
    expect(e.alive).toBe(false);
    expect(e.prop.destroyed).toBe(true);
    expect(gone.prop).toBe(e.prop);
    expect(w.physics.hitboxes.has(e.id)).toBe(false);
  });

  it('loot by force: the hardy survives, the delicate is ruined, a weapon comes out bent, and what hid inside comes out', () => {
    const w = calm('BK1');
    const crates = w.props.filter((p) => p.prop.loot !== undefined || PROPS[p.prop.kind].interact).slice(0, 4);
    expect(crates.length).toBe(4);
    const [stim, cash, gun, nest] = crates;
    stim.prop.loot = { type: 'stim' };
    cash.prop.loot = { type: 'credits', amount: 50 };
    gun.prop.loot = { type: 'weapon', item: { type: 'weapon', cls: 'carbine', rarity: 'epic', name: 'Mk.III Test Carbine', affixes: [], value: 300 } };
    nest.prop.loot = { type: 'ambush' };
    for (const c of crates) c.prop.searched = false;
    w.hazards.rng = Object.assign(new Rng('bk', 'spill'), { chance: () => true });
    w.reserve = 1;
    const aliens = w.aliens.length;
    for (const c of crates) w.hazards.explode(c.x, c.y + 0.6, null, { r: 1.5, damage: 200, fire: false });
    expect(stim.prop.loot.type).toBe('ruined');
    expect(cash.prop.loot).toEqual({ type: 'credits', amount: 50 });
    expect(gun.prop.loot.item.rarity).toBe('rare');
    expect(gun.prop.loot.bent).toBe(true);
    expect(nest.prop.loot.type).toBe('empty');
    expect(w.aliens.length).toBe(aliens + 1);
    expect(w.aliens[w.aliens.length - 1].hp).toBeLessThan(w.aliens[w.aliens.length - 1].maxHp);
    // The wreck is still worth a look: searching it says what the blast left.
    const said = [];
    w.on('bark', (b) => said.push(b.text));
    w.resolveLoot(stim.prop, w.squad.leader);
    expect(said.some((t) => /Smashed/.test(t))).toBe(true);
    const credits = w.credits;
    w.resolveLoot(cash.prop, w.squad.leader);
    expect(w.credits).toBe(credits + 50);
  });

  it('a gas cylinder goes up with a smaller blast and a short fire', () => {
    const L = generateLevel('BK2');
    const room = L.rooms.find((r) => r.dist >= 2 && !r.exterior);
    const x = (room.x0 + room.x1) / 2;
    room.props.push({ id: 9001, kind: 'gas_cylinder', x, z: PROPS.gas_cylinder.z, room: room.id });
    const w = new World(L, { params: { god: true } });
    const cyl = w.props.find((p) => p.prop.id === 9001);
    expect(cyl.explosive).toBe(true);
    const blasts = [];
    const fires = [];
    w.on('explosion', (ev) => blasts.push(ev));
    w.on('blast-fire', (ev) => fires.push(ev));
    w.damage(cyl, 50, null, { x, y: room.y0 + 0.5, dx: 1, dy: 0 });
    run(w, 0.3);
    expect(blasts).toHaveLength(1);
    expect(blasts[0].r).toBe(PROPS.gas_cylinder.blast.r);
    expect(blasts[0].r).toBeLessThan(BLAST.RADIUS);
    expect(fires).toHaveLength(1);
    expect(fires[0].room).toBe(room.id);
    expect(fires[0].until - w.time).toBeLessThan(FIRE.TIME);
  });

  it('a fuse box shot out puts its room in the dark', () => {
    const L = generateLevel('BK3');
    const room = L.rooms.find((r) => r.dist >= 2 && !r.exterior && !r.powerOut);
    const x = (room.x0 + room.x1) / 2;
    room.props.push({ id: 9002, kind: 'fuse_box', x, z: PROPS.fuse_box.z, room: room.id });
    const w = new World(L, { params: { god: true } });
    const box = w.props.find((p) => p.prop.id === 9002);
    let blown = null;
    w.on('fuse-blown', (ev) => { blown = ev; });
    expect(room.powerOut).toBeFalsy();
    w.damage(box, 40, null, { x, y: room.y0 + 1.5, dx: 1, dy: 0 });
    expect(room.powerOut).toBe(true);
    expect(blown.room).toBe(room);
    expect(PROPS.fuse_box.wreck).toBe('fuse_box_broken');
  });

  it('the fire a blast leaves burns whoever stands in it, then goes out', () => {
    const w = calm('BK4');
    const room = w.level.rooms.find((r) => r.dist >= 2 && !r.exterior);
    const x = (room.x0 + room.x1) / 2;
    const a = w.addAlien(makeAlien(w.rng, x + 0.5, room.y0, room.id, 'hunt', { type: 'brute' }));
    a.wakeT = 99;
    const hp = a.hp;
    let out = null;
    w.on('blast-fire-out', (ev) => { out = ev; });
    w.hazards.light(x, room.y0, room.id);
    expect(w.hazards.burning(room.id, x + 1)).toBe(true);
    run(w, 1.2);
    expect(a.hp).toBeLessThan(hp);
    const mid = a.hp;
    run(w, FIRE.TIME);
    expect(out).not.toBeNull();
    expect(w.hazards.fires).toHaveLength(0);
    const after = a.hp;
    run(w, 1);
    expect(a.hp).toBe(after);
    expect(mid).toBeGreaterThan(after);
  });
});
