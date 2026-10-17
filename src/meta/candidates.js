// Troopers: archetypes, generated candidates and the original four. A trooper's `core` stats
// are who he is; `stats` start there and grow by learning by doing (meta/growth.js), up to
// core + STATS.CEILING. Every archetype spends the same points budget, so nobody is strictly
// better - each is good at two or three things and weak at others, which is what makes
// picking a squad for a particular ship matter. A rank (meta/ranks.js) adds to it: a Captain is
// simply better than a Private, by the points his rank brings.
import { LOADOUTS, SQUAD, STATS } from '../core/config.js';
import { Rng } from '../core/rng.js';
import { issueWeapon } from '../sim/loot.js';
import { STAT_KEYS, clampStat } from '../sim/stats.js';
import { rollTier } from './ranks.js';

const S = (str, spd, sta, acc, per, int, nrv, lck) => ({ str, spd, sta, acc, per, int, nrv, lck });
const L = (helmet, pads, pack, weapon, name) => ({ name, helmet, pads, pack, weapon });

export const BUDGET = 44; // stat points per archetype (average 5.5)

// Loadouts mix the four art kits (sim loadout slots toggle var_* meshes independently).
export const ARCHETYPES = {
  veteran:  { label: 'Veteran',  text: 'Steady all-rounder',                      core: S(6, 5, 6, 6, 6, 5, 6, 4), loadout: LOADOUTS[0] },
  heavy:    { label: 'Heavy',    text: 'Strong and tough, slow on his feet',      core: S(8, 3, 8, 5, 5, 4, 7, 4), loadout: LOADOUTS[1] },
  breacher: { label: 'Breacher', text: 'Close-quarters, forces doors, never flinches', core: S(7, 6, 6, 4, 5, 4, 8, 4), loadout: LOADOUTS[2] },
  marksman: { label: 'Marksman', text: 'Deadly aim, sharp eyes',                  core: S(4, 5, 5, 9, 7, 5, 5, 4), loadout: LOADOUTS[3] },
  scout:    { label: 'Scout',    text: 'Fast, first to spot anything',            core: S(4, 7, 6, 5, 7, 5, 5, 5), loadout: L('marksman', 'command', 'command', 'carbine', 'scout') },
  tech:     { label: 'Tech',     text: 'Locks, terminals, searches - fragile',   core: S(4, 5, 5, 5, 6, 9, 5, 5), loadout: L('command', 'marksman', 'breacher', 'carbine', 'tech') },
  medic:    { label: 'Medic',    text: 'Keeps the squad standing',                core: S(4, 5, 6, 4, 6, 8, 6, 5), loadout: L('command', 'command', 'heavy', 'carbine', 'medic') },
  rookie:   { label: 'Rookie',   text: 'Green and jumpy, but born lucky',         core: S(5, 6, 6, 5, 5, 5, 4, 8), loadout: L('breacher', 'command', 'command', 'carbine', 'rookie') },
  duelist:  { label: 'Duelist',  text: 'Bolt pistol and power sword: shoots, then cuts them down', core: S(6, 7, 5, 6, 6, 4, 6, 4), loadout: LOADOUTS[4] },
  brawler:  { label: 'Brawler',  text: 'Power fists, no gun: tough as nails, devastating up close', core: S(8, 6, 8, 3, 5, 3, 7, 4), loadout: LOADOUTS[5] },
  gunner:   { label: 'Gunner',   text: 'Minigun: a wall of lead once it spins up - slow and loud', core: S(8, 3, 7, 5, 5, 4, 7, 5), loadout: LOADOUTS[6] },
};

const FIRST = ['VOSS', 'REYES', 'OKAFOR', 'LINDQVIST', 'MARSH', 'IBARRA', 'KANE', 'DUBOIS', 'NAKAMURA', 'ADEYEMI', 'FROST', 'BECK', 'SOKOLOV', 'QUINN', 'HALE', 'MORENO', 'TAN', 'OKONJO', 'VRBA', 'WALSH', 'KERR', 'AZIZ', 'PARK', 'STROM'];
const TINTS = ['#c8a040', '#9a2f2a', '#3b6fa0', '#d0d0c8', '#4f7a3a', '#7a4a8a', '#b86a2a', '#2f7f7f'];
// The original four keep their names, looks and roles.
const STARTERS = ['veteran', 'heavy', 'breacher', 'marksman'];

/** Core stats for an archetype, nudged: two points moved between stats (budget kept). */
export function rollCore(rng, archetype, jitter = true) {
  const core = { ...ARCHETYPES[archetype].core };
  if (!jitter) return core;
  for (let i = 0; i < 2; i++) {
    const up = rng.pick(STAT_KEYS.filter((k) => core[k] < STATS.MAX - 1));
    const down = rng.pick(STAT_KEYS.filter((k) => k !== up && core[k] > STATS.MIN + 1));
    core[up]++;
    core[down]--;
  }
  return core;
}

/**
 * A rank's extra points on top of the archetype's core, one at a time - mostly into what he's
 * already good at (weighted by the stat squared), never past STATS.MAX.
 */
export function promoteCore(rng, core, points) {
  const out = { ...core };
  for (let i = 0; i < points; i++) {
    const open = STAT_KEYS.filter((k) => out[k] < STATS.MAX);
    if (!open.length) break;
    out[rng.weighted(open.map((k) => [k, out[k] * out[k]]))]++;
  }
  return out;
}

/** Body and walk follow the stats: strong men are big, fast men walk brisk. */
function looks(rng, core, jitter = true) {
  const j = (a, b) => (jitter ? rng.float(a, b) : 1);
  return {
    scale: +Math.max(0.92, Math.min(1.1, (0.92 + 0.025 * (core.str - 4)) * j(0.98, 1.02))).toFixed(3),
    gait: {
      cadence: +((0.84 + 0.05 * (core.spd - 3)) * j(0.97, 1.03)).toFixed(3),
      lean: +((2 + (core.spd - 4) * 1.2) * j(0.7, 1.3)).toFixed(2),
      sway: +((1 + (core.str - 4) * 0.7) * j(0.7, 1.3)).toFixed(2),
      bounce: +((0.012 + 0.003 * (core.spd - 4)) * j(0.7, 1.3)).toFixed(4),
      swagger: +((1 + (core.nrv - 4) * 0.8) * j(0.6, 1.4)).toFixed(2),
    },
  };
}

/**
 * A new trooper of the given (or a random) archetype - a Private unless given a rank tier
 * (meta/ranks.js), which brings its bonus points and the XP that rank stands for. Deterministic
 * for a given rng.
 */
export function makeCandidate(rng, { archetype = null, name = null, jitter = true, rank = null } = {}) {
  const arch = archetype ?? rng.pick(Object.keys(ARCHETYPES));
  const A = ARCHETYPES[arch];
  const core = rank?.bonus ? promoteCore(rng, rollCore(rng, arch, jitter), rank.bonus) : rollCore(rng, arch, jitter);
  const loadout = { ...A.loadout };
  return {
    id: `t${rng.int(0, 2 ** 30).toString(36)}${rng.int(0, 2 ** 30).toString(36)}`,
    name: name ?? rng.pick(FIRST),
    tint: rng.pick(TINTS),
    archetype: arch,
    loadout,
    weaponItem: issueWeapon(loadout.weapon),
    ...looks(rng, core, jitter),
    core,
    stats: { ...core },
    progress: {},
    xp: rank?.xp ?? 0, kills: 0, runs: 0, alive: true,
  };
}

/** The original four (fixed names, looks and archetypes) for a fresh campaign. */
export function starterSquad(seed) {
  const rng = new Rng(seed, 'starters');
  return SQUAD.NAMES.map(([, name], i) => {
    const t = makeCandidate(rng, { archetype: STARTERS[i], name, jitter: false });
    t.tint = SQUAD.TINTS[i];
    t.scale = SQUAD.PROFILES[i].scale;
    t.gait = { ...SQUAD.PROFILES[i].gait };
    if (i === 0) t.xp = 250; // Voss leads: starts as a corporal (profile.js LEVELS[2])
    return t;
  });
}

/**
 * Quick play: 8 candidates for a seed, one of each archetype in a seeded order, each of a rolled
 * rank. `roll` > 0: a fresh set for the same ship (the briefing's NEW RECRUITS).
 */
export function candidatePool(seed, n = 8, roll = 0) {
  const rng = new Rng(seed, roll ? `candidates-${roll}` : 'candidates');
  const archs = rng.shuffle(Object.keys(ARCHETYPES)).slice(0, n);
  const used = new Set();
  return archs.map((a, i) => {
    let t = makeCandidate(rng, { archetype: a, rank: rollTier(rng) });
    for (let k = 0; k < 8 && used.has(t.name); k++) t.name = rng.pick(FIRST);
    used.add(t.name);
    t.id = `c${i}`;
    return t;
  });
}

/** Clamp and sanity-check a stats object. */
export const normStats = (s) => Object.fromEntries(STAT_KEYS.map((k) => [k, clampStat(s?.[k] ?? STATS.BASE)]));
