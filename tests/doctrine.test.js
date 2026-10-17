import { beforeAll, describe, expect, it } from 'vitest';
import { generateLevel } from '../src/gen/level.js';
import { initPhysics } from '../src/physics/physics.js';
import { DEFAULT_DOCTRINE, PRESETS, doctrineString, parseDoctrine } from '../src/sim/doctrine.js';
import { World } from '../src/sim/world.js';
import { Rng } from '../src/core/rng.js';
import { makeCandidate } from '../src/meta/candidates.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });

function play(seed, doctrine, { god = true, seconds = 900 } = {}) {
  const w = new World(generateLevel(seed), { params: { god }, doctrine });
  const said = [];
  w.on('decision-made', ({ decision, option }) => said.push(`${decision.type}:${option}`));
  for (let i = 0; i < seconds * 60 && w.status === 'playing'; i++) w.step(STEP);
  return { w, said };
}

describe('doctrine', () => {
  it('parses compact strings and ignores junk', () => {
    const d = PRESETS.recon.doctrine;
    expect(parseDoctrine(doctrineString(d))).toEqual(d);
    expect(parseDoctrine('nonsense.x')).toEqual(DEFAULT_DOCTRINE);
    expect(parseDoctrine(null)).toEqual(DEFAULT_DOCTRINE);
  });

  // Standard is the player's game (point and click - tests/manual.test.js); the others run themselves.
  it.each(Object.keys(PRESETS).filter((k) => PRESETS[k].doctrine.route !== 'manual'))('preset %s: the squad reaches the cockpit on its own', (key) => {
    for (const seed of ['A1', 'C3', 'E5']) {
      const { w } = play(seed, PRESETS[key].doctrine);
      expect(w.status, `${key} on ${seed}`).toBe('won');
    }
  }, 120000);

  it('a thorough sweep explores more of the ship than a direct run', () => {
    let direct = 0;
    let thorough = 0;
    for (const seed of ['A1', 'B2', 'D4']) {
      direct += play(seed, { route: 'direct' }).w.stats.rooms;
      thorough += play(seed, { route: 'thorough' }).w.stats.rooms;
    }
    expect(thorough).toBeGreaterThan(direct);
  }, 120000);

  it('loot orders are followed: "leave it" never searches, "everything" always does', () => {
    const leave = play('B2', { loot: 'leave' }).said.filter((s) => s.startsWith('loot:'));
    const all = play('B2', { loot: 'all' }).said.filter((s) => s.startsWith('loot:'));
    expect(leave.length).toBeGreaterThan(0);
    expect(leave.every((s) => s === 'loot:ignore')).toBe(true);
    expect(all.every((s) => s === 'loot:search')).toBe(true);
  }, 60000);

  it('fast squads run when they have the breath; stealthy ones creep', () => {
    const fast = new World(generateLevel('A1'), { params: { god: true }, doctrine: { pace: 'fast' } });
    let ran = false;
    for (let i = 0; i < 60 * 60; i++) { fast.step(STEP); if (fast.squad.pace === 'run') ran = true; }
    expect(ran).toBe(true);
    const slow = new World(generateLevel('A1'), { params: { god: true }, doctrine: { pace: 'stealthy' } });
    for (let i = 0; i < 60 * 10; i++) slow.step(STEP);
    expect(slow.squad.pace).toBe('cautious');
  });

  it('stims go in at the doctrine threshold', () => {
    const w = new World(generateLevel('A1'), { params: { god: true }, doctrine: { stims: 'early' } });
    w.step(STEP);
    const m = w.squad.order[2];
    m.hp = m.maxHp * 0.5;
    const before = w.stims;
    w.step(STEP);
    expect(w.stims).toBe(before - 1);
    const h = new World(generateLevel('A1'), { params: { god: true }, doctrine: { stims: 'hoard' } });
    h.step(STEP);
    h.squad.order[2].hp = h.squad.order[2].maxHp * 0.5;
    const hb = h.stims;
    h.step(STEP);
    expect(h.stims).toBe(hb);
  });
});

describe('specialists', () => {
  it('the best man for a search steps out of the line, does it, and falls back in', () => {
    const squad = ['veteran', 'heavy', 'tech', 'marksman'].map((a, i) => makeCandidate(new Rng('spec', String(i)), { archetype: a, jitter: false }));
    let checked = 0;
    for (const seed of ['A1', 'B2', 'C3', 'D4']) {
      const w = new World(generateLevel(seed), { params: { god: true }, squad, doctrine: { loot: 'all' } });
      const tech = w.marines[2];
      let job = null;        // the search the tech walked up for
      let atWork = false;
      for (let i = 0; i < 60 * 300 && w.status === 'playing'; i++) {
        const before = w.squad.task;
        w.step(STEP);
        const T = w.squad.task;
        if (T && !before && w.squad.action?.type === 'search') job = { prop: w.squad.action.prop, frames: 0, ok: 0, stepping: 0 };
        if (job && T?.phase === 'work') {
          expect(T.m).toBe(tech);
          expect(Math.abs(tech.x - T.x)).toBeLessThan(1);
          job.frames++;
          // A target, a 'clear' call or a fresh mag comes first; on the move (his last step into
          // place) his legs walk.
          if (tech.moving) { job.stepping++; if (tech.anim.startsWith('walk')) job.ok++; } else if (['interact', 'signal'].includes(tech.anim) || tech.target || tech.reloadT > 0) job.ok++;
          atWork = true;
        }
        if (job && atWork && !T) break;
      }
      if (!job || !atWork) continue;
      checked++;
      expect(job.ok).toBe(job.frames);
      expect(job.stepping).toBeLessThan(6);
      expect(job.prop.searched).toBe(true);
      expect(w.squad.task).toBeNull();
      expect(tech.offX).toBe(0);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('nerve', () => {
  const squadWith = (nrvs) => nrvs.map((nrv, i) => {
    const t = makeCandidate(new Rng('nerve', String(i)), { archetype: 'veteran', jitter: false });
    t.stats.nrv = nrv;
    return t;
  });
  const panics = (nrvs, spread = false) => {
    const w = new World(generateLevel('A1'), { params: { god: true }, squad: squadWith(nrvs) });
    const m = w.marines[0];
    if (spread) w.marines.slice(1).forEach((o, i) => { o.x = m.x + 10 + i * 3; });
    let n = 0;
    for (let i = 0; i < 400; i++) { m.panicT = 0; w.nerveCheck(m); if (m.panicT > 0) n++; }
    return n;
  };

  it('only below-average nerve panics, and a steady squad-mate close by holds it together', () => {
    expect(panics([5, 5, 5, 5])).toBe(0);
    const shaky = panics([1, 5, 5, 5], true);   // nobody steady nearby
    expect(shaky).toBeGreaterThan(100);           // ~40%
    const steadied = panics([1, 8, 5, 5]);       // a nerve-8 man right next to him
    expect(steadied).toBeLessThan(shaky * 0.6);
  });
});
