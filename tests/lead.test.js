// Lead mode: the player walks one marine with a controller (world.pad) and the others follow him.
import { beforeAll, describe, expect, it } from 'vitest';
import { generateLevel } from '../src/gen/level.js';
import { walkLimits } from '../src/gen/layout.js';
import { initPhysics } from '../src/physics/physics.js';
import { makeAlien } from '../src/sim/entities.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };
function until(w, pred, s) {
  for (let i = 0; i < s * 60 && w.status === 'playing'; i++) { w.step(STEP); if (pred()) return true; }
  return false;
}
const lead = (seed = 'A1', params = { god: true }, opts = {}) => new World(generateLevel(seed), { params, control: 'lead', ...opts });
/** Hold the stick toward x until the player is there (or `s` seconds pass). */
function walkTo(w, x, s = 30) {
  const ok = until(w, () => { const p = w.player; w.steer({ moveX: Math.abs(x - p.x) < 0.08 ? 0 : Math.sign(x - p.x) * 0.6 }); return Math.abs(p.x - w.player.x) < 0.08 && Math.abs(x - w.player.x) < 0.08; }, s);
  w.steer({ moveX: 0 });
  return ok;
}
/** Board the derelict: walk into the outer lock; it cycles and he steps through. */
function board(w) {
  w.steer({ moveX: 1 });
  const ok = until(w, () => w.player.room === w.level.airlock && w.squad.state === 'advance' && !w.squad.trav, 60);
  w.steer({ moveX: 0 });
  return ok;
}
const behind = (w) => w.squad.order.slice(1).every((m) => (w.player.x - m.x) * w.squad.heading > 0.5);
/** Through the door ahead (a sealed one opens on contact) into the next room. */
function throughDoor(w, H = 1) {
  const from = w.player.room;
  w.steer({ moveX: H });
  const ok = until(w, () => w.player.room !== from && !w.squad.trav && w.squad.state === 'advance', 60);
  w.steer({ moveX: 0 });
  return ok;
}

describe('lead mode', () => {
  it('the player is the point man, and nobody moves until the stick does', () => {
    const w = lead();
    expect(w.lead).toBe(true);
    expect(w.player).toBe(w.squad.order[0]);
    expect(w.player.controlled).toBe(true);
    expect(w.state().control).toBe('lead');
    const x0 = w.player.x;
    run(w, 10);
    expect(Math.abs(w.player.x - x0)).toBeLessThan(0.01);
    expect(w.squad.order.every((m) => !m.moving)).toBe(true);
  });

  it('the second marine can be the player\'s', () => {
    const w = lead('A1', { god: true }, { player: 1 });
    expect(w.player).toBe(w.marines[1]);
    expect(w.squad.order[0]).toBe(w.player);
    expect(w.marines[0].controlled).toBe(false);
  });

  it('walking into the outer lock boards the ship; the squad follows him in', () => {
    const w = lead();
    expect(board(w)).toBe(true);
    const air = w.level.airlock;
    expect(w.player.room).toBe(air);
    const [wl, wr] = walkLimits(w.level.rooms[air]);
    expect(walkTo(w, (wl + wr) / 2)).toBe(true);
    expect(until(w, () => w.squad.order.every((m) => m.room === air), 30)).toBe(true);
    expect(behind(w)).toBe(true);
  });

  it('he walks at the stick\'s pace, runs flat out, and the others keep station behind him', () => {
    const w = lead();
    expect(board(w)).toBe(true);
    const [wl, wr] = walkLimits(w.level.rooms[w.level.airlock]);
    expect(walkTo(w, wl + 1)).toBe(true);
    // Half stick: a walk. Full stick: a run.
    w.steer({ moveX: 0.5 });
    run(w, 0.8);
    expect(w.squad.pace).toBe('normal');
    expect(w.player.v).toBeGreaterThan(1);
    expect(w.player.v).toBeLessThan(3);
    w.steer({ moveX: 1 });
    run(w, 0.5);
    expect(w.squad.pace).toBe('run');
    expect(w.player.v).toBeGreaterThan(3.5);
    w.steer({ moveX: 0 });
    run(w, 3);
    expect(w.player.x).toBeLessThan(wr);
    expect(behind(w)).toBe(true);
    for (let i = 1; i < w.squad.order.length; i++) expect(Math.abs(w.squad.order[i].x - w.squad.order[i - 1].x)).toBeLessThan(3);
  });

  it('turning back, he walks through the line and they fall in behind him again', () => {
    const w = lead();
    expect(board(w)).toBe(true);
    const [wl, wr] = walkLimits(w.level.rooms[w.level.airlock]);
    expect(walkTo(w, wr - 1)).toBe(true);
    run(w, 2);
    expect(behind(w)).toBe(true);
    const was = [...w.squad.order];
    expect(walkTo(w, wl + 1)).toBe(true);
    run(w, 3);
    expect(w.squad.heading).toBe(-1);
    expect(behind(w)).toBe(true);
    // The line inverted: the old rear man is nearest him now, and nobody crossed anyone.
    expect(w.squad.order[1]).toBe(was[was.length - 1]);
    for (let i = 1; i < w.squad.order.length; i++) expect(Math.abs(w.squad.order[i].x - w.squad.order[i - 1].x)).toBeLessThan(3);
  });

  it('B holds the others where they are; B again brings them along', () => {
    const w = lead();
    expect(board(w)).toBe(true);
    const [wl, wr] = walkLimits(w.level.rooms[w.level.airlock]);
    expect(walkTo(w, wl + 1)).toBe(true);
    run(w, 2);
    w.toggleHold();
    w.step(STEP);
    expect(w.squad.followersHold).toBe(true);
    const held = w.squad.order.slice(1).map((m) => m.x);
    expect(walkTo(w, wr - 1)).toBe(true);
    w.squad.order.slice(1).forEach((m, i) => expect(Math.abs(m.x - held[i])).toBeLessThan(0.3));
    w.toggleHold();
    expect(until(w, () => behind(w) && Math.abs(w.squad.order[1].x - w.player.x) < 3, 15)).toBe(true);
  });

  it('the trigger fires where he aims, and the kill is his', () => {
    const w = lead();
    expect(board(w)).toBe(true);
    for (const a of w.aliens) { a.alive = false; w.physics.removeHitbox(a); }
    run(w, 1);
    const p = w.player;
    const room = w.level.rooms[p.room];
    const a = makeAlien(w.rng, p.x + 5, room.y0, p.room, 'hunt');
    w.addAlien(a);
    w.physics.addHitbox(a, 0.8, a.height);
    a.visible = true;
    for (const m of w.squad.order.slice(1)) { m.mag = 0; m.reserve = 0; } // the others can't help
    run(w, 1);
    expect(p.shots).toBe(0); // nothing fires by itself
    expect(a.alive).toBe(true);
    w.steer({ aimX: 1, aimY: 0, fire: true });
    expect(until(w, () => !a.alive, 6)).toBe(true);
    expect(p.shots).toBeGreaterThan(0);
    expect(p.kills).toBeGreaterThan(0);
    w.steer({ fire: false, aimX: 0 });
  });

  it('RB changes mags', () => {
    const w = lead();
    run(w, 1);
    const p = w.player;
    p.mag = 3;
    w.reloadWeapon();
    run(w, 0.5);
    expect(p.reloadT).toBeGreaterThan(0);
    expect(until(w, () => p.mag === p.weapon.mag, 6)).toBe(true);
  });

  it('A searches the crate he stands at', () => {
    for (const seed of ['B2', 'C3', 'E5', 'G7', 'Z2']) {
      const w = lead(seed);
      if (!board(w)) continue;
      for (const a of w.aliens) { a.alive = false; w.physics.removeHitbox(a); }
      if (!throughDoor(w)) continue;
      const crate = w.interactables().find((t) => t.kind === 'crate' && t.room === w.player.room);
      if (!crate) continue;
      expect(walkTo(w, crate.x)).toBe(true);
      run(w, 1);
      expect(w.useTarget()?.id).toBe(crate.id);
      w.use();
      w.step(STEP);
      expect(w.squad.action?.type).toBe('search');
      const prop = w.level.rooms[crate.room].props.find((q) => q.id === crate.prop);
      expect(until(w, () => prop.searched, 20)).toBe(true);
      return;
    }
    throw new Error('no seed with a crate past the airlock');
  });

  it('up the stick at a ladder or stairs takes it, and the squad follows', () => {
    for (const seed of ['A1', 'H8', 'F6', 'M5', 'LAD0', 'LAD2']) {
      const w = lead(seed);
      if (!board(w)) continue;
      for (const a of w.aliens) { a.alive = false; w.physics.removeHitbox(a); }
      if (!throughDoor(w)) continue;
      const f = w.squad.features(w.player.room).find((q) => q.type === 'ladder' || q.type === 'stairs');
      if (!f) continue;
      expect(walkTo(w, f.x)).toBe(true);
      const from = w.player.room;
      w.steer({ moveY: f.up ? 1 : -1 });
      w.step(STEP);
      w.steer({ moveY: 0 });
      expect(w.squad.trav?.kind).toBe(f.type);
      expect(until(w, () => w.player.room !== from && !w.squad.trav, 30)).toBe(true);
      const to = w.player.room;
      expect(until(w, () => w.squad.order.every((m) => m.room === to && m.mode === 'walk'), 60)).toBe(true);
      return;
    }
    throw new Error('no seed with a ladder past the airlock');
  });

  it('down, his squad gets him up and he takes point again; dead, the next man is the player\'s', () => {
    const w = lead();
    expect(board(w)).toBe(true);
    for (const a of w.aliens) { a.alive = false; w.physics.removeHitbox(a); }
    w.reserve = 0;
    run(w, 2);
    const p = w.player;
    w.params.god = false;
    w.damage(p, 9999, null);
    expect(p.down).toBe(true);
    expect(w.player).toBe(p);
    expect(until(w, () => !p.down, 40)).toBe(true);
    expect(w.squad.order[0]).toBe(p);
    expect(p.controlled).toBe(true);
    // He can walk again.
    run(w, 2);
    const x0 = p.x;
    w.steer({ moveX: -1 });
    run(w, 1);
    w.steer({ moveX: 0 });
    expect(p.x).toBeLessThan(x0 - 1);
    // Finished off: control passes down the line.
    w.damage(p, 9999, null);
    expect(p.down).toBe(true);
    w.damage(p, 9999, null);
    expect(p.alive).toBe(false);
    expect(w.player).not.toBe(p);
    expect(w.player).toBe(w.squad.order[0]);
    expect(w.player.controlled).toBe(true);
    expect(p.controlled).toBe(false);
    const n = w.player;
    const nx = n.x;
    w.steer({ moveX: 1 });
    run(w, 1.5);
    expect(n.x).toBeGreaterThan(nx + 1);
  });

  it('the goldens: squad mode is untouched by all of this', () => {
    const w = new World(generateLevel('A1'), { params: { god: true } });
    expect(w.lead).toBe(false);
    expect(w.player).toBe(null);
    expect(w.marines.every((m) => !m.controlled)).toBe(true);
  });
});
