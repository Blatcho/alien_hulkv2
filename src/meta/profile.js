// Campaign profile: everything that survives between runs. Pure data + rules (no DOM), so it
// is unit-testable; storage is a thin localStorage wrapper at the bottom.
//
// Loop: Command (spend, recruit, equip, pick a derelict) -> run -> Debrief (credits, XP and
// rank, stats grown by learning by doing, permadeath) -> Command. Extraction raises the threat.
// Troopers and their stats live in meta/candidates.js.
import { Rng } from '../core/rng.js';
import { ARCHETYPES, makeCandidate, normStats, starterSquad } from './candidates.js';
import { grow } from './growth.js';
import { tierForLevel } from './ranks.js';
import { statsToMods } from '../sim/stats.js';

export { starterSquad };
export const PROFILE_VERSION = 2;
const STORE_KEY = 'hullbreach.profile.v1';
const RUN_KEY = 'hullbreach.run.v1';

// ------------------------------------------------------------------ progression tables

export const LEVELS = [0, 100, 250, 450, 700, 1000, 1400, 1900]; // XP needed for level i+1
// Ranks by level (meta/ranks.js): PVT. PVT. CPL. CPL. SGT. SGT. LT. CPT.

export const XP = { KILL: 12, SURVIVE: 60, OBJECTIVE: 90, RESCUE: 40, CLEAR: 60 };

export const UPGRADES = {
  armor:   { label: 'Armour plating', text: '+10 max HP per tier (all troopers)', costs: [150, 320, 600] },
  stims:   { label: 'Stim supply', text: '+1 stim-pack per tier', costs: [120, 260, 480] },
  cooling: { label: 'Suit cooling', text: '+20% stamina per tier', costs: [100, 220, 420] },
  neural:  { label: 'Neural link', text: 'High alert burns energy 15% slower per tier', costs: [140, 300, 560] },
  tracker: { label: 'Tracker boost', text: '+5 m motion-tracker range per tier', costs: [90, 200, 380] },
  salvage: { label: 'Salvage crew', text: '+15% salvage value per tier', costs: [160, 340, 640] },
};

// ------------------------------------------------------------------ troopers

export function levelFor(xp) {
  let lvl = 1;
  for (let i = 1; i < LEVELS.length; i++) if (xp >= LEVELS[i]) lvl = i + 1;
  return lvl;
}

export function rankFor(level) { return tierForLevel(level).abbr; }

/** A new random trooper (any archetype). */
export const makeTrooper = (rng, opts) => makeCandidate(rng, opts);

/** Simulation modifiers for a roster entry (sim/stats.js). */
export const trooperMods = (t) => statsToMods(t.stats, t.loadout?.weapon);

// ------------------------------------------------------------------ profile

export function newProfile(seed = Date.now().toString(36)) {
  return {
    version: PROFILE_VERSION, seed, credits: 150, threat: 0, runs: 0, wins: 0, bestThreat: 0,
    roster: starterSquad(seed), squad: null, memorial: [], stash: [],
    upgrades: { armor: 0, stims: 0, cooling: 0, neural: 0, tracker: 0, salvage: 0 },
    totals: { kills: 0, rescued: 0, salvage: 0, credits: 0 }, seedCounter: 0,
  };
}

export function deployable(profile) {
  const alive = profile.roster.filter((t) => t.alive);
  const chosen = (profile.squad ?? []).map((id) => alive.find((t) => t.id === id)).filter(Boolean);
  for (const t of alive) if (chosen.length < 4 && !chosen.includes(t)) chosen.push(t);
  return chosen.slice(0, 4);
}

export function recruitCost(profile) { return 90 + 30 * profile.roster.filter((t) => t.alive).length; }

/** Three volunteers to choose from (stable until one of them signs on). */
export function recruitOffers(profile) {
  const rng = new Rng(`${profile.seed}/${profile.recruits ?? 0}`, 'recruit');
  const taken = new Set(profile.roster.map((t) => t.name));
  return [0, 1, 2].map(() => {
    const t = makeCandidate(rng);
    for (let k = 0; k < 10 && taken.has(t.name); k++) t.name = makeCandidate(rng).name;
    taken.add(t.name);
    return t;
  });
}

/** Sign on a recruit: one of recruitOffers(), or a random one from an Rng. */
export function recruit(profile, pick) {
  const cost = recruitCost(profile);
  const free = profile.roster.filter((t) => t.alive).length < 4; // never soft-lock a campaign
  if (!free && profile.credits < cost) return null;
  if (!free) profile.credits -= cost;
  const t = typeof pick?.next === 'function' ? makeCandidate(pick) : pick;
  profile.roster.push(t);
  profile.recruits = (profile.recruits ?? 0) + 1;
  return t;
}

export function upgradeCost(profile, key) {
  const tier = profile.upgrades[key];
  return UPGRADES[key].costs[tier] ?? null;
}

export function buyUpgrade(profile, key) {
  const cost = upgradeCost(profile, key);
  if (cost === null || profile.credits < cost) return false;
  profile.credits -= cost;
  profile.upgrades[key]++;
  return true;
}

/** Swap a stashed weapon onto a trooper (their old one goes to the stash). */
export function equipFromStash(profile, trooperId, stashIndex) {
  const t = profile.roster.find((q) => q.id === trooperId);
  const item = profile.stash[stashIndex];
  if (!t || !item) return false;
  profile.stash.splice(stashIndex, 1);
  if (t.weaponItem && t.weaponItem.rarity !== 'common') profile.stash.push(t.weaponItem);
  t.weaponItem = item;
  t.loadout.weapon = item.cls;
  return true;
}

/**
 * Fold a finished run into the profile. `result` comes from World.results().
 * Returns a debrief: credit lines, per-trooper XP/level changes, deaths.
 */
export function applyRun(profile, result) {
  const won = result.status === 'won';
  const lines = [];
  const add = (label, value) => { if (value) lines.push({ label, value: Math.round(value) }); };
  const mult = result.rewardMult ?? 1;
  add('Credits recovered', result.credits);
  if (won) {
    add('Salvage sold', result.salvage * (1 + 0.15 * profile.upgrades.salvage));
    add('Contract payout', (250 + 120 * profile.threat) * mult);
    add('Civilians rescued', result.rescued * 200);
    if (result.cleared) add('Ship cleared bonus', 0); // (already paid into credits during the run)
  } else {
    add('Insurance (25%)', -(result.credits * 0.75));
  }
  const earned = lines.reduce((s, l) => s + l.value, 0);
  profile.credits = Math.max(0, profile.credits + earned);
  profile.totals.credits += Math.max(0, earned);
  profile.totals.kills += result.kills;
  profile.totals.rescued += won ? result.rescued : 0;
  profile.runs++;
  if (won) {
    profile.wins++;
    profile.threat++;
    profile.bestThreat = Math.max(profile.bestThreat, profile.threat);
    profile.stash.push(...result.stash);
  }

  const troopers = [];
  for (const r of result.troopers) {
    const t = profile.roster.find((q) => q.id === r.id);
    if (!t) continue;
    const before = levelFor(t.xp);
    let xp = r.kills * XP.KILL;
    if (r.alive) xp += XP.SURVIVE;
    if (won && r.alive) xp += XP.OBJECTIVE + XP.RESCUE * result.rescued + (result.cleared ? XP.CLEAR : 0);
    t.kills += r.kills;
    t.runs++;
    if (!r.alive) {
      t.alive = false;
      profile.memorial.push({ name: t.name, rank: rankFor(before), kills: t.kills, runs: t.runs, threat: profile.threat - (won ? 1 : 0), cause: r.cause ?? 'KIA' });
      troopers.push({ id: t.id, name: t.name, died: true, xp: 0 });
      continue;
    }
    t.xp += xp;
    if (won && r.weaponItem) t.weaponItem = r.weaponItem; // keep what they carried home
    const after = levelFor(t.xp);
    const gains = grow(t, r.usage);               // learning by doing (meta/growth.js)
    troopers.push({ id: t.id, name: t.name, xp, before, after, gains, usage: r.usage ?? {} });
  }
  profile.roster = profile.roster.filter((t) => t.alive);
  return { won, lines, earned, troopers };
}

// ------------------------------------------------------------------ migration

// Version 1 troopers had a trait and perks instead of stats: rebuild them on the archetype
// their weapon implies, trait -> core stats, perks -> stats earned on top.
const LEGACY_TRAIT = {
  veteran: { nrv: 1, acc: 1 }, twitchy: { per: 1, acc: -1 }, big: { str: 1, sta: 1, spd: -1 },
  nimble: { spd: 1, str: -1 }, eagle: { per: 1 }, steady: { acc: 1 },
};
const LEGACY_PERK = {
  steady: 'acc', quickdraw: 'per', tough: 'sta', reload: 'spd', hunter: 'str', bulwark: 'str',
  scavenger: 'int', pointman: 'per', medic: 'int', cool: 'nrv', lungs: 'sta',
};
const ARCH_BY_WEAPON = { carbine: 'veteran', heavy: 'heavy', breacher: 'breacher', marksman: 'marksman' };

export function migrate(p) {
  if (!p) return null;
  if (p.version === 1) {
    for (const t of p.roster ?? []) {
      const arch = ARCH_BY_WEAPON[t.loadout?.weapon] ?? 'veteran';
      const core = { ...ARCHETYPES[arch].core };
      for (const [k, v] of Object.entries(LEGACY_TRAIT[t.trait] ?? {})) core[k] += v;
      const stats = { ...core };
      for (const perk of t.perks ?? []) if (LEGACY_PERK[perk]) stats[LEGACY_PERK[perk]]++;
      t.archetype = arch;
      t.core = normStats(core);
      t.stats = normStats(stats);
      t.progress = {};
      delete t.trait;
      delete t.perks;
    }
    delete p.pendingPromotions;
    p.version = 2;
  }
  return p.version === PROFILE_VERSION ? p : null;
}

// ------------------------------------------------------------------ storage

const storage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

export function loadProfile() {
  try {
    const raw = storage()?.getItem(STORE_KEY);
    return migrate(raw ? JSON.parse(raw) : null);
  } catch { return null; }
}

export function saveProfile(p) {
  try { storage()?.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* private mode: play on without saving */ }
}

export function clearProfile() {
  try { storage()?.removeItem(STORE_KEY); storage()?.removeItem(RUN_KEY); } catch { /* ignore */ }
}

/** The run the Command screen launched (read once by the game page). */
export function saveRun(run) { try { storage()?.setItem(RUN_KEY, JSON.stringify(run)); } catch { /* ignore */ } }
export function loadRun() { try { return JSON.parse(storage()?.getItem(RUN_KEY) ?? 'null'); } catch { return null; } }
