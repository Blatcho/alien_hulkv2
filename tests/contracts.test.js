// Contracts (gen/contracts.js, sim/contract.js): what a seed rolls, what the generator places
// for it, and each job played through on a calm ship - the squad goes to the target, does the
// work, and walks home. Also the reactor's fuse, a rescue that can't be finished, and the
// bonuses the debrief checks.
import { beforeAll, describe, expect, it } from 'vitest';
import { generateLevel } from '../src/gen/level.js';
import { BONUS_KEYS, CONTRACTS, CONTRACT_KEYS, contractFor, contractText, evaluateBonuses, rollBonuses } from '../src/gen/contracts.js';
import { Rng } from '../src/core/rng.js';
import { initPhysics } from '../src/physics/physics.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };
const until = (w, pred, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) { w.step(STEP); if (pred()) return true; } return false; };
/** A ship with nothing alive aboard but the crew, the squad on autoplay. */
function calm(seed, contract, extra = {}) {
  const w = new World(generateLevel(seed, { contract, ...extra }), { params: { autoplay: true, god: true } });
  for (const a of [...w.aliens, ...w.critters]) { if (a.type !== 'queen') { a.alive = false; w.physics.removeHitbox(a); } }
  w.reserve = 0;
  w.director.hordeSize = 0;
  w.shipEvents.list.length = 0;
  return w;
}
const SEEDS = Array.from({ length: 12 }, (_, i) => `Q${i}`);

describe('the roll and the placement', () => {
  it('a seed rolls a job its ship can hold; a level nobody names one for is the nav-lock; a named one is made true', () => {
    const kinds = new Set();
    for (const s of [...SEEDS, 'CRV-A1', 'FRT-A1', 'LNR-A1', 'RSV-A1', 'STN-A1']) {
      const L = generateLevel(s);
      expect(L.contract.kind).toBe('uplink');
      const rolled = contractFor(L.bare);
      expect(CONTRACT_KEYS).toContain(rolled.kind);
      expect(rolled.kind).not.toBe('queen');
      kinds.add(rolled.kind);
      expect(generateLevel(s, { contract: rolled.kind }).contract.kind).toBe(rolled.kind);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(4);
    for (const k of ['blackbox', 'reactor', 'beacon', 'rescue', 'escort']) {
      for (const s of SEEDS) {
        const L = generateLevel(s, { contract: k });
        expect(L.contract.kind).toBe(k);
        const target = L.rooms[L.objective.room].props.find((p) => p.objective);
        if (k === 'reactor') { expect(['reactor', 'console']).toContain(target.kind); expect(target.contract).toBe(true); }
        if (k === 'beacon') { expect(target.kind).toBe('beacon_site'); expect(L.rooms[L.objective.room].nest).toBe(true); }
        if (k === 'blackbox') expect(target.kind).toBe('control_panel');
        if (k === 'rescue') { expect(L.contract.crew).toBeGreaterThanOrEqual(2); expect(L.spawns.survivors.length).toBeGreaterThanOrEqual(L.contract.crew); }
        if (k === 'escort') { expect(L.spawns.survivors.filter((q) => q.vip).length).toBe(1); expect(L.contract.vipName).toBeTruthy(); }
        if (k !== 'blackbox') expect(L.rooms.find((r) => r.type === 'cockpit').props.find((p) => p.kind === 'control_panel').objective).toBe(false);
      }
    }
    expect(contractFor('X', { boss: true }).kind).toBe('queen');
    expect(contractFor('X', { want: 'queen' }).kind).not.toBe('queen');
    expect(contractFor('X', { want: 'rescue', threat: 8 }).crew).toBe(4);
    expect(contractText({ kind: 'rescue', crew: 3 })).toContain('3 of them');
    expect(contractText({ kind: 'escort', vipName: 'SATO' })).toContain('SATO');
  });

  it('a boss hulk has the queen in a hall if it has one, and the queen contract', () => {
    let halls = 0;
    for (const s of SEEDS.slice(0, 6)) {
      const L = generateLevel(s, { mods: { boss: true } });
      expect(L.contract.kind).toBe('queen');
      const q = L.spawns.aliens.find((a) => a.type === 'queen');
      expect(q).toBeTruthy();
      expect(L.boss.room).toBe(q.room);
      expect(L.rooms[q.room].nest).toBe(true);
      if (L.rooms[q.room].tall) halls++;
    }
    expect(halls).toBeGreaterThanOrEqual(3);
  });
});

describe('each job played through', () => {
  it('the black box: pulled at the bridge, carried home', () => {
    const w = calm('Q0', 'blackbox');
    expect(w.contract.kind).toBe('blackbox');
    expect(until(w, () => w.contract.phase === 'return', 400)).toBe(true);
    expect(w.kit.blackbox).toBe(1);
    expect(w.contract.goal().kind).toBe('extract');
    expect(until(w, () => w.status !== 'playing', 400)).toBe(true);
    expect(w.status).toBe('won');
    expect(w.results().contract).toMatchObject({ kind: 'blackbox', done: true });
    expect(w.journal.entries.some((e) => e.text.includes('Job done'))).toBe(true);
  }, 120000);

  it('the reactor: the charge set, the fuse running, everyone out before it goes', () => {
    const w = calm('Q0', 'reactor');
    expect(until(w, () => w.contract.phase === 'return', 400)).toBe(true);
    expect(w.contract.fuse).toBeGreaterThan(0);
    expect(w.contract.describe().title).toContain('REACTOR BLOWS IN');
    expect(until(w, () => w.status !== 'playing', 400)).toBe(true);
    expect(w.status).toBe('won');
    expect(w.results().contract.done).toBe(true);
    expect(w.marines.filter((m) => m.alive).length).toBe(4);
  }, 120000);

  it('the reactor goes with the squad still aboard: nobody comes home', () => {
    const w = calm('Q0', 'reactor');
    expect(until(w, () => w.marines.every((m) => m.room !== w.level.dock), 90)).toBe(true); // aboard the derelict
    w.contract.complete(w.level.rooms[w.level.objective.room].props.find((p) => p.contract));
    w.contract.fuse = 0.5;
    w.params.god = false;
    run(w, 2);
    expect(w.status).toBe('lost');
    expect(w.marines.every((m) => !m.alive)).toBe(true);
  });

  it('the beacon: planted in the nest, the nest woken, the squad home', () => {
    const w = calm('Q1', 'beacon');
    let noise = 0;
    w.on('beacon-planted', () => { noise = w.director.heat; });
    expect(until(w, () => w.contract.phase === 'return', 500)).toBe(true);
    expect(w.level.rooms[w.level.objective.room].props.some((p) => p.kind === 'beacon')).toBe(true);
    expect(noise).toBeGreaterThan(0);
    expect(until(w, () => w.status !== 'playing', 500)).toBe(true);
    expect(w.status).toBe('won');
  }, 120000);

  it('the crew: found by sweeping the ship, sent home, the squad after them', () => {
    const w = calm('Q2', 'rescue');
    expect(w.contract.goal()).toBe(null); // nobody in sight: a sweep
    expect(w.contract.describe().sub).toBe('SWEEP THE SHIP.');
    expect(until(w, () => w.contract.phase === 'return', 700)).toBe(true);
    expect(w.contract.found).toBeGreaterThanOrEqual(w.contract.def.crew);
    expect(until(w, () => w.status !== 'playing', 500)).toBe(true);
    expect(w.status).toBe('won');
    expect(w.results().contract.done).toBe(true);
  }, 180000);

  it('a rescue with the crew dead fails, and the squad still extracts for what it has', () => {
    const w = calm('Q2', 'rescue');
    run(w, 2);
    for (const s of w.survivors) { s.alive = false; w.emit('survivor-died', { survivor: s }); }
    expect(w.contract.phase).toBe('failed');
    expect(w.contract.describe().title).toContain('CONTRACT FAILED');
    expect(until(w, () => w.status !== 'playing', 500)).toBe(true);
    expect(w.status).toBe('won');
    expect(w.results().contract.done).toBe(false);
  }, 120000);

  it('the escort: the one who knows the way found and brought home', () => {
    const w = calm('Q3', 'escort');
    const vip = w.survivors.find((s) => s.vip);
    expect(vip).toBeTruthy();
    expect(w.contract.describe().title).toContain('FIND');
    expect(until(w, () => w.contract.phase === 'return', 700)).toBe(true);
    expect(vip.state).toBe('rescued');
    expect(until(w, () => w.status !== 'playing', 500)).toBe(true);
    expect(w.status).toBe('won');
  }, 180000);

  it('the queen: killed in her nest, then everyone out', () => {
    const w = calm('Q0', null, { mods: { boss: true } });
    const q = w.aliens.find((a) => a.type === 'queen');
    expect(q).toBeTruthy();
    expect(q.royal).toBe(true);
    expect(w.contract.goal().kind).toBe('queen');
    expect(until(w, () => !q.alive, 900)).toBe(true);
    expect(w.contract.phase).toBe('return');
    expect(w.credits).toBeGreaterThanOrEqual(400);
    expect(until(w, () => w.status !== 'playing', 500)).toBe(true);
    expect(w.status).toBe('won');
  }, 240000);

  it('the nav-lock is still the nav-lock', () => {
    const w = calm('Q0', 'uplink');
    expect(w.contract.worked).toBe(true);
    expect(until(w, () => w.status !== 'playing', 600)).toBe(true);
    expect(w.status).toBe('won');
    expect(w.results().contract).toMatchObject({ kind: 'uplink', done: true });
  }, 120000);
});

describe('the bonuses', () => {
  it('two different ones per offer, each checked against the run', () => {
    const rng = new Rng('bonus', 'x');
    for (let i = 0; i < 20; i++) {
      const b = rollBonuses(rng);
      expect(b.length).toBe(2);
      expect(new Set(b).size).toBe(2);
      for (const k of b) expect(BONUS_KEYS).toContain(k);
    }
    const r = { status: 'won', cleared: true, rescued: 1, survivorsAboard: 1, troopers: [{ alive: true }, { alive: false }], hordes: 0, time: 500 };
    const e = evaluateBonuses(['clear', 'civilians', 'noloss', 'quiet', 'fast'], r);
    expect(e.map((q) => q.earned)).toEqual([true, true, false, true, true]);
    expect(e[0].pay).toBe(150);
    expect(evaluateBonuses(['clear'], { ...r, status: 'lost' })[0].earned).toBe(false);
    expect(Object.values(CONTRACTS).every((c) => c.pay >= 1)).toBe(true);
  });
});
