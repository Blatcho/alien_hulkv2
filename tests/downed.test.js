// Down, not dead: a lethal blow puts a trooper on the deck until a squad-mate gets him up -
// or something finishes him. No clock.
import { beforeAll, describe, expect, it } from 'vitest';
import { DOWN } from '../src/core/config.js';
import { generateLevel } from '../src/gen/level.js';
import { initPhysics } from '../src/physics/physics.js';
import { PRESETS } from '../src/sim/doctrine.js';
import { makeAlien } from '../src/sim/entities.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };
function until(w, pred, s) {
  for (let i = 0; i < s * 60 && w.status === 'playing'; i++) { w.step(STEP); if (pred()) return true; }
  return false;
}
/** A ship with nothing hunting yet: the squad aboard, hostiles cleared off the board. */
function calm(seed = 'A1', doctrine = undefined) {
  const w = new World(generateLevel(seed), { params: {}, doctrine });
  for (const a of w.aliens) { a.alive = false; w.physics.removeHitbox(a); }
  w.reserve = 0;
  run(w, 12);
  return w;
}

describe('down, not dead', () => {
  it('a lethal blow puts him on the deck and out of the line - still alive', () => {
    const w = calm();
    const m = w.squad.order[2];
    let downed = null;
    w.on('downed', (e) => { downed = e.marine; });
    w.damage(m, 9999, null);
    expect(downed).toBe(m);
    expect(m.alive).toBe(true);
    expect(m.down).toBe(true);
    expect(w.squad.order).not.toContain(m);
    expect(w.status).toBe('playing');
  });

  it('there is no clock: left alone, he stays down - and alive', () => {
    const w = calm('A1', PRESETS.standard.doctrine);
    const m = w.squad.order[3];
    w.damage(m, 9999, null);
    w.toggleCover(); // a full stop: nobody goes to him
    run(w, 60);
    expect(m.alive).toBe(true);
    expect(m.down).toBe(true);
    w.toggleCover();
    expect(until(w, () => !m.down, 30)).toBe(true); // released: they get him up
  });

  it('a strike on a man down finishes him', () => {
    const w = calm();
    const m = w.squad.order[1];
    w.damage(m, 9999, null);
    const room = w.level.rooms[m.room];
    const a = w.addAlien(makeAlien(w.rng, m.x + 1, room.y0, m.room, 'hunt'));
    let finished = false;
    w.on('marine-died', ({ marine }) => { finished = marine === m; });
    w.alienStrike(a, m);
    expect(finished).toBe(true);
    expect(m.alive).toBe(false);
    expect(m.down).toBe(false);
  });

  it('once it is quiet, the medic gets him up: he falls in at the rear with a wound', () => {
    const w = calm();
    const m = w.squad.order[1];
    const stims = w.stims;
    w.damage(m, 9999, null);
    let by = null;
    w.on('revived', (e) => { by = e.by; });
    expect(until(w, () => !m.down, 30)).toBe(true);
    expect(by).toBeTruthy();
    expect(by).not.toBe(m);
    expect(w.squad.order[w.squad.order.length - 1]).toBe(m);
    expect(m.hp).toBeGreaterThan(0);
    expect(['leg', 'arm']).toContain(m.wound);
    expect(w.stims).toBe(stims - 1); // the stims order allows it: up stronger
    expect(m.hp).toBeGreaterThanOrEqual(Math.round(m.maxHp * DOWN.STIM_HP) - 1);
    // ...and he walks back into the line from where he lay.
    run(w, 5);
    expect(Math.abs(m.offX)).toBeLessThan(0.05);
    expect(w.squad.order.every((o) => !o.down)).toBe(true);
  });

  it('hoarding stims: he gets up on a field dressing instead', () => {
    const w = calm('A1', { ...PRESETS.salvage.doctrine, stims: 'hoard' });
    const m = w.squad.order[2];
    const stims = w.stims;
    w.damage(m, 9999, null);
    expect(until(w, () => !m.down, 30)).toBe(true);
    expect(w.stims).toBe(stims);
    expect(m.hp).toBeLessThanOrEqual(Math.round(m.maxHp * DOWN.HP * 2));
  });

  it('pointing at a man down sends the squad to get him up', () => {
    const w = calm('A1', PRESETS.standard.doctrine);
    const m = w.squad.order[3];
    w.damage(m, 9999, null);
    const t = w.interactables().find((q) => q.kind === 'downed');
    expect(t.label).toContain(m.name);
    w.nudge(t.id);
    expect(until(w, () => !m.down, 30)).toBe(true);
  });

  it('a leg wound slows the whole squad; an arm wound spoils his aim', () => {
    const w = calm();
    const before = w.squad.slowest();
    const m = w.squad.order[1];
    const spread = m.mods.spread;
    m.wound = 'leg';
    expect(w.squad.slowest()).toBeCloseTo(before * DOWN.WOUNDS.leg.pace, 5);
    w.damage(m, 9999, null);
    m.wound = null;
    w.wounds = { chance: () => false }; // -> arm
    w.revive(m, w.squad.leader);
    expect(m.wound).toBe('arm');
    expect(m.mods.spread).toBeCloseTo(spread * DOWN.WOUNDS.arm.spread, 5);
  });

  it('nobody left standing: the mission is lost, and the men down are lost with it', () => {
    const w = calm();
    for (const m of [...w.squad.order]) w.damage(m, 9999, null);
    w.step(STEP);
    expect(w.status).toBe('lost');
    expect(w.results().troopers.every((t) => !t.alive)).toBe(true);
  });

  it('still down when the uplink completes: carried out from the command deck, left behind elsewhere', () => {
    const w = calm();
    const [a, b] = [w.squad.order[2], w.squad.order[3]];
    w.damage(a, 9999, null);
    w.damage(b, 9999, null);
    a.room = w.level.objective.room;
    b.room = w.level.airlock;
    w.completeUplink();
    expect(a.alive).toBe(true);
    expect(a.down).toBe(false);
    expect(b.alive).toBe(false);
    expect(w.status).toBe('won');
  });
});
