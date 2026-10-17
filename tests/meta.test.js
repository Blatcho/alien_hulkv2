import { beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng.js';
import { generateLevel } from '../src/gen/level.js';
import { STATS } from '../src/core/config.js';
import { ARCHETYPES, BUDGET, candidatePool, makeCandidate } from '../src/meta/candidates.js';
import { COST, costAt, grow, talentCap } from '../src/meta/growth.js';
import {
  LEVELS, applyRun, buyUpgrade, deployable, equipFromStash, levelFor, migrate, newProfile,
  rankFor, recruit, recruitCost, trooperMods,
} from '../src/meta/profile.js';
import { RANK_TIERS, tierOf } from '../src/meta/ranks.js';
import { NO_MODS, STAT_KEYS, baseStats, checkChance, statsToMods } from '../src/sim/stats.js';
import { shipOffers } from '../src/meta/ships.js';
import { initPhysics } from '../src/physics/physics.js';
import { rollWeapon } from '../src/sim/loot.js';
import { World } from '../src/sim/world.js';

beforeAll(async () => { await initPhysics(); });

const result = (p, over = {}) => ({
  status: 'won', kills: 10, credits: 200, salvage: 300, rescued: 1, cleared: false, stash: [], rewardMult: 1,
  troopers: deployable(p).map((t, i) => ({ id: t.id, alive: true, kills: i === 0 ? 8 : 1, weaponItem: t.weaponItem })),
  ...over,
});

describe('campaign profile', () => {
  it('starts with the four named troopers, ready to deploy', () => {
    const p = newProfile('TEST');
    expect(p.roster.map((t) => t.name)).toEqual(['VOSS', 'REYES', 'OKAFOR', 'LINDQVIST']);
    expect(deployable(p)).toHaveLength(4);
    expect(new Set(p.roster.map((t) => t.loadout.weapon)).size).toBe(4);
  });

  it('a win pays out, raises the threat and grants XP', () => {
    const p = newProfile('TEST');
    const before = p.credits;
    const d = applyRun(p, result(p));
    expect(d.won).toBe(true);
    expect(p.credits).toBeGreaterThan(before + 200);
    expect(p.threat).toBe(1);
    const top = p.roster.find((t) => t.name === 'VOSS');
    expect(top.xp).toBeGreaterThanOrEqual(LEVELS[1]);
    expect(d.troopers.find((t) => t.id === top.id).after).toBeGreaterThan(d.troopers.find((t) => t.id === top.id).before);
  });

  it('the dead go to the memorial; a loss keeps only 25% of recovered credits', () => {
    const p = newProfile('TEST');
    const r = result(p, { status: 'lost' });
    r.troopers[1].alive = false;
    const before = p.credits;
    applyRun(p, r);
    expect(p.roster).toHaveLength(3);
    expect(p.memorial[0].name).toBe('REYES');
    expect(p.threat).toBe(0);
    expect(p.credits).toBe(before + 50);
  });

  it('recruiting is free below four troopers, otherwise costs credits', () => {
    const p = newProfile('TEST');
    const rng = new Rng('r', 'r');
    p.credits = 0;
    expect(recruit(p, rng)).toBeNull();
    p.roster.pop();
    expect(recruit(p, rng)).not.toBeNull();
    p.credits = 1000;
    const cost = recruitCost(p);
    recruit(p, rng);
    expect(p.credits).toBe(1000 - cost);
  });

  it('a version-1 save migrates: trait and perks become stats, the roster survives', () => {
    const p = newProfile('OLD');
    p.version = 1;
    p.pendingPromotions = [];
    for (const t of p.roster) { delete t.stats; delete t.core; delete t.archetype; t.trait = 'eagle'; t.perks = []; }
    p.roster[1].perks = ['tough', 'hunter'];
    const m = migrate(p);
    expect(m.version).toBe(2);
    expect(m.roster).toHaveLength(4);
    const heavy = m.roster[1];
    expect(heavy.archetype).toBe('heavy');
    expect(heavy.core.per).toBe(ARCHETYPES.heavy.core.per + 1);                 // eagle-eyed
    expect(heavy.stats.sta).toBe(ARCHETYPES.heavy.core.sta + 1);                // Hardened
    expect(heavy.stats.str).toBe(ARCHETYPES.heavy.core.str + 1);                // Hunter
    expect(m.roster.every((t) => t.trait === undefined && t.perks === undefined)).toBe(true);
    expect(migrate({ version: 99 })).toBeNull();
  });

  it('upgrades and stash equips spend and swap correctly', () => {
    const p = newProfile('TEST');
    p.credits = 1000;
    expect(buyUpgrade(p, 'armor')).toBe(true);
    expect(p.upgrades.armor).toBe(1);
    const gun = rollWeapon(new Rng('g', 'g'), { cls: 'marksman', luck: 5 });
    p.stash.push(gun);
    expect(equipFromStash(p, p.roster[0].id, 0)).toBe(true);
    expect(p.roster[0].weaponItem).toBe(gun);
    expect(p.roster[0].loadout.weapon).toBe('marksman');
  });
});

describe('derelict offers', () => {
  it('offers three stable ships whose modifiers all generate valid levels', () => {
    const p = newProfile('SHIPS');
    const a = shipOffers(p);
    expect(a).toHaveLength(3);
    expect(shipOffers(p)).toEqual(a);
    for (let k = 0; k < 6; k++) {
      p.seedCounter = k;
      for (const o of shipOffers(p)) {
        const L = generateLevel(o.seed, { threat: 2, mods: o.mods });
        expect(L.rooms.length).toBeGreaterThan(8);
        expect(L.hostiles.total).toBeGreaterThan(20);
      }
    }
  });

  it('a campaign squad deploys with its names, weapons, stats and upgrades', () => {
    const p = newProfile('SQUAD');
    p.roster[0].stats.sta = 8;
    p.upgrades.armor = 2;
    const squad = deployable(p).map((t) => ({ ...t, mods: trooperMods(t), rank: 'SGT.' }));
    const world = new World(generateLevel('SQ1'), { params: { autoplay: true, god: true }, squad, upgrades: p.upgrades });
    expect(world.marines.map((m) => m.name)).toEqual(squad.map((t) => t.name));
    expect(world.marines[0].maxHp).toBe(100 + 6 * 3 + 20);
    expect(world.marines[1].stats).toEqual(p.roster[1].stats);
    for (let i = 0; i < 60 * 600 && world.status === 'playing'; i++) world.step(1 / 60);
    expect(world.status).toBe('won');
    const r = world.results();
    expect(r.troopers.every((t) => squad.some((s) => s.id === t.id))).toBe(true);
  });
});

describe('trooper stats', () => {
  it('all stats at 5 give exactly the neutral modifiers (the pre-stats game)', () => {
    expect(statsToMods(baseStats(), 'carbine')).toEqual({ ...NO_MODS });
    expect(statsToMods(baseStats(), 'heavy')).toEqual({ ...NO_MODS });
  });

  it('each stat moves its effects one way', () => {
    const at = (k, v, w = 'heavy') => statsToMods({ ...baseStats(), [k]: v }, w);
    expect(at('acc', 9).spread).toBeLessThan(at('acc', 2).spread);
    expect(at('str', 9).spread).toBeLessThan(at('str', 2).spread);   // heavy weapons
    expect(at('str', 9, 'carbine').spread).toBe(1);
    expect(at('str', 9).armor).toBeLessThan(1);
    expect(at('per', 9).acquire).toBeLessThan(at('per', 2).acquire);
    expect(at('per', 9).sight).toBeGreaterThan(0);
    expect(at('int', 9).search).toBeLessThan(at('int', 2).search);
    expect(at('sta', 9).hp).toBeGreaterThan(0);
    expect(at('sta', 9).drain).toBeLessThan(1);
    expect(at('spd', 9).reload).toBeLessThan(1);
    expect(at('nrv', 9).focus).toBeLessThan(1);
    expect(at('lck', 9).crit).toBeGreaterThan(0);
    expect(at('lck', 2).crit).toBe(0);
    expect(checkChance({ ...baseStats(), int: 9 }, 'int')).toBeGreaterThan(checkChance(baseStats(), 'int'));
    expect(checkChance({ ...baseStats(), int: 10, lck: 10 }, 'int', 0.9)).toBeLessThanOrEqual(0.95);
  });

  it('every archetype spends the same budget, and candidates keep it', () => {
    for (const a of Object.values(ARCHETYPES)) expect(STAT_KEYS.reduce((s, k) => s + a.core[k], 0)).toBe(BUDGET);
    const rng = new Rng('cand', 'x');
    for (let i = 0; i < 50; i++) {
      const t = makeCandidate(rng);
      expect(STAT_KEYS.reduce((s, k) => s + t.core[k], 0)).toBe(BUDGET);
      for (const k of STAT_KEYS) expect(t.core[k]).toBeGreaterThanOrEqual(STATS.MIN);
      expect(t.stats).toEqual(t.core);
    }
  });

  it('quick play offers 8 distinct, seed-stable candidates', () => {
    const a = candidatePool('SEED1');
    expect(a).toHaveLength(8);
    expect(new Set(a.map((t) => t.archetype)).size).toBe(8);
    expect(new Set(a.map((t) => t.name)).size).toBe(8);
    expect(candidatePool('SEED1')).toEqual(a);
    expect(candidatePool('SEED2')).not.toEqual(a);
  });

  it('a reroll is a fresh set for the same ship - and stable too', () => {
    const a = candidatePool('SEED1');
    const b = candidatePool('SEED1', 8, 1);
    expect(b).toHaveLength(8);
    expect(b).toEqual(candidatePool('SEED1', 8, 1));
    expect(b.map((t) => t.name + t.archetype + t.xp)).not.toEqual(a.map((t) => t.name + t.archetype + t.xp));
    expect(b.map((t) => t.id)).toEqual(a.map((t) => t.id)); // c0..c7, picked by the URL
  });
});

describe('ranks', () => {
  it('five, Private to Captain: each brings its points, mostly into the archetype\'s strengths, and its XP', () => {
    expect(RANK_TIERS.map((r) => r.name)).toEqual(['Private', 'Corporal', 'Sergeant', 'Lieutenant', 'Captain']);
    for (const tier of RANK_TIERS) {
      const rng = new Rng('rank', tier.key);
      for (let i = 0; i < 20; i++) {
        const t = makeCandidate(rng, { archetype: 'marksman', rank: tier });
        expect(STAT_KEYS.reduce((s, k) => s + t.core[k], 0)).toBe(BUDGET + tier.bonus);
        for (const k of STAT_KEYS) expect(t.core[k]).toBeLessThanOrEqual(STATS.MAX);
        expect(rankFor(levelFor(t.xp))).toBe(tier.abbr);
      }
    }
    // A Captain marksman shoots better than a Private one, on the whole.
    const avg = (tier) => { const rng = new Rng('acc', tier.key); let n = 0; for (let i = 0; i < 40; i++) n += makeCandidate(rng, { archetype: 'marksman', rank: tier }).core.acc; return n / 40; };
    expect(avg(RANK_TIERS[4])).toBeGreaterThan(avg(RANK_TIERS[0]));
  });

  it('candidates come in every rank, the higher the rarer; campaign promotions follow the same five', () => {
    const count = Object.fromEntries(RANK_TIERS.map((r) => [r.abbr, 0]));
    for (let i = 0; i < 100; i++) for (const t of candidatePool(`R${i}`)) count[rankFor(levelFor(t.xp))]++;
    for (let i = 1; i < RANK_TIERS.length; i++) expect(count[RANK_TIERS[i].abbr]).toBeGreaterThan(0);
    expect(count['PVT.']).toBeGreaterThan(count['SGT.']);
    expect(count['SGT.']).toBeGreaterThan(count['CPT.']);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((l) => rankFor(l))).toEqual(['PVT.', 'PVT.', 'CPL.', 'CPL.', 'SGT.', 'SGT.', 'LT.', 'CPT.']);
    expect(tierOf('LT.').name).toBe('Lieutenant');
    expect(tierOf('???').name).toBe('Private');
  });
});

describe('learning by doing', () => {
  const fresh = () => makeCandidate(new Rng('grow', 'x'), { archetype: 'rookie', jitter: false });

  it('practice turns into stat points, dearer the better the trooper already is', () => {
    const t = fresh();
    const acc = t.stats.acc;
    const gains = grow(t, { acc: costAt('acc', acc) + 1 });
    expect(gains.acc).toBe(1);
    expect(t.stats.acc).toBe(acc + 1);
    expect(costAt('acc', 8)).toBeGreaterThan(costAt('acc', 5));
    expect(costAt('acc', 2)).toBeLessThan(COST.acc);
  });

  it('unspent practice is banked for the next run', () => {
    const t = fresh();
    const v = t.stats.int;
    grow(t, { int: costAt('int', v) * 0.6 });
    expect(t.stats.int).toBe(v);
    grow(t, { int: costAt('int', v) * 0.6 });
    expect(t.stats.int).toBe(v + 1);
  });

  it('talent caps growth at core + 3 (and 10)', () => {
    const t = fresh();
    grow(t, { nrv: 1e6, lck: 1e6 });
    expect(t.stats.nrv).toBe(talentCap(t, 'nrv'));
    expect(t.stats.nrv).toBe(Math.min(STATS.MAX, t.core.nrv + STATS.CEILING));
    expect(t.stats.lck).toBe(STATS.MAX);                         // rookie luck 8: capped by 10
    expect(t.progress.nrv).toBe(0);
  });

  it('a campaign run grows the survivors from what they did', () => {
    const p = newProfile('GROW');
    const r = result(p);
    r.troopers[0].usage = { acc: 400, per: 60 };
    r.troopers[1].alive = false;
    r.troopers[1].usage = { acc: 400 };
    const before = { ...p.roster[0].stats };
    const d = applyRun(p, r);
    const t0 = d.troopers.find((t) => t.id === p.roster[0].id);
    expect(t0.gains.acc).toBeGreaterThan(0);
    expect(p.roster[0].stats.acc).toBeGreaterThan(before.acc);
    expect(p.roster[0].stats.per).toBeGreaterThan(before.per);
    expect(d.troopers.find((t) => t.died)).toBeDefined();
  });

  it('a real run records practice for the troopers who did the work', () => {
    const world = new World(generateLevel('A1'), { params: { god: true }, squad: deployable(newProfile('PR')) });
    for (let i = 0; i < 60 * 600 && world.status === 'playing'; i++) world.step(1 / 60);
    const usage = world.results().troopers.map((t) => t.usage);
    expect(usage.some((u) => u.acc > 10)).toBe(true);
    expect(usage.some((u) => u.per > 1)).toBe(true);
    expect(usage.some((u) => u.int > 1)).toBe(true);
  });
});
