// Difficulty (meta/difficulty.js): set on the briefing, folded into the ship's mods - how many
// hostiles, how hard they are, how big the ship, how often a horde.
import { beforeAll, describe, expect, it } from 'vitest';
import { ALIEN_TYPES, HORDE } from '../src/core/config.js';
import { generateLevel } from '../src/gen/level.js';
import { DEFAULT_DIFFICULTY, difficultyString, parseDifficulty, withDifficulty } from '../src/meta/difficulty.js';
import { initPhysics } from '../src/physics/physics.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };
const level = (d, mods = {}, seed = 'A1') => generateLevel(seed, { mods: withDifficulty(mods, { ...DEFAULT_DIFFICULTY, ...d }) });

describe('difficulty', () => {
  it('normal changes nothing: the same ship as before', () => {
    expect(withDifficulty({ cols: 20, decks: 3 }, DEFAULT_DIFFICULTY)).toEqual({ cols: 20, decks: 3 });
    const a = generateLevel('A1');
    const b = level({});
    expect(b.hostiles).toEqual(a.hostiles);
    expect(b.rooms.length).toBe(a.rooms.length);
  });

  it('it goes in the URL and comes back out; anything unknown is normal', () => {
    const d = { enemies: 'swarm', strength: 'tough', ship: 'large', hordes: 'often' };
    expect(difficultyString(d)).toBe('swarm.tough.large.often');
    expect(parseDifficulty(difficultyString(d))).toEqual(d);
    expect(parseDifficulty('lots.x')).toEqual(DEFAULT_DIFFICULTY);
    expect(parseDifficulty(null)).toEqual(DEFAULT_DIFFICULTY);
  });

  it('enemies: fewer or more hostiles aboard - and a smaller or bigger horde', () => {
    const n = (enemies) => level({ enemies }).hostiles.total - level({ enemies }).horde.size;
    expect(n('few')).toBeLessThan(n('normal'));
    expect(n('normal')).toBeLessThan(n('many'));
    expect(n('many')).toBeLessThan(n('swarm'));
    const horde = (enemies) => level({ enemies }).horde.size;
    expect(horde('few')).toBeLessThan(horde('normal'));
    expect(horde('normal')).toBeLessThan(horde('swarm'));
    expect(horde('swarm')).toBeLessThanOrEqual(HORDE.MAX);
  });

  it('strength: tougher hides and harder claws (the stock types untouched)', () => {
    const base = new World(level({}));
    const tough = new World(level({ strength: 'brutal' }));
    const weak = new World(level({ strength: 'weak' }));
    const a = base.aliens[0];
    expect(tough.aliens[0].maxHp).toBeGreaterThan(a.maxHp);
    expect(tough.aliens[0].damage[1]).toBeGreaterThan(a.damage[1]);
    expect(weak.aliens[0].maxHp).toBeLessThan(a.maxHp);
    expect(weak.aliens[0].damage[1]).toBeLessThan(a.damage[1]);
    expect(a.damage).toEqual(ALIEN_TYPES[a.type].damage);
    // Ones out of the vents too.
    const bred = tough.addAlien(tough.breed(a.x, a.y, a.room, 'hunt', a.type));
    expect(bred.maxHp).toBe(tough.aliens[0].maxHp);
  });

  it('ship size: shorter or longer, a deck more when large - every size generates', () => {
    const small = level({ ship: 'small' });
    const large = level({ ship: 'large' });
    const med = level({});
    expect(small.cls).toBe(med.cls); // the class is the seed's; the size scales within it
    expect(small.cols).toBeLessThan(med.cols);
    expect(large.cols).toBeGreaterThan(med.cols);
    expect(large.decks).toBe(med.decks + 1);
    expect(large.rooms.length).toBeGreaterThan(med.rooms.length);
    expect(large.hostiles.total).toBeGreaterThan(med.hostiles.total); // not an emptier ship
    // The campaign's ships within limits too, whatever their class.
    for (const cls of ['corvette', 'freighter', 'liner', 'research', 'station']) {
      for (const ship of ['small', 'large']) {
        const L = level({ ship }, { cls }, 'B2');
        expect(L.cls).toBe(cls);
        expect(L.cols).toBeGreaterThanOrEqual(12);
        expect(L.cols).toBeLessThanOrEqual(36);
        expect(L.decks).toBeLessThanOrEqual(6);
      }
    }
  });

  it('hordes off: none aboard, however loud', () => {
    const L = level({ hordes: 'off' });
    expect(L.horde.size).toBe(0);
    const w = new World(L, { params: { god: true } });
    for (const e of [...w.aliens, ...w.critters]) { e.alive = false; w.physics.removeHitbox(e); }
    w.reserve = 0;
    run(w, 40);
    let warned = 0;
    w.on('horde-warning', () => warned++);
    w.director.heat = 1e6;
    run(w, 20);
    expect(warned).toBe(0);
  });

  it('hordes often: it comes with less noise, and likelier', () => {
    const quiet = (hordes) => {
      const w = new World(level({ hordes }), { params: { god: true } });
      for (const e of [...w.aliens, ...w.critters]) { e.alive = false; w.physics.removeHitbox(e); }
      w.reserve = w.director.hordeSize;
      run(w, 40);
      return w;
    };
    // Heat right where an ordinary ship's could only just start to come.
    const often = quiet('often');
    expect(often.director.hordeSize).toBeGreaterThan(0);
    let came = 0;
    often.on('horde-warning', () => came++);
    for (let t = 0; t < 60 && !came; t++) { often.director.heat = HORDE.START; run(often, 1); }
    expect(came).toBe(1);
    const normal = quiet('normal');
    let came2 = 0;
    normal.on('horde-warning', () => came2++);
    for (let t = 0; t < 60; t++) { normal.director.heat = HORDE.START; run(normal, 1); }
    expect(came2).toBe(0);
  });
});
