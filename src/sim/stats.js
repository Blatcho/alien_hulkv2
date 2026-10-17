// Trooper stats: eight dimensions rated 1-10, with 5 = the baseline tuning, so a squad of
// all-5s plays exactly like the game did before stats existed. Everything the simulation
// needs from a trooper's stats is derived here - modifiers for the existing combat, sight and
// meter hooks, personal pace, stamina, luck - so raw stats aren't read all over the sim.
//
//   str  heavy/breacher control and stagger, claw damage taken, forcing (encounters)
//   spd  personal pace (the squad walks at its slowest man), climbing, reloads
//   sta  max HP, personal stamina pool and how fast running drains it
//   acc  weapon spread
//   per  reaction time, sight cone reach, awareness radius, spotting
//   int  searching, the uplink, stim healing (medic), hacking (encounters)
//   nrv  high-alert energy drain, composure
//   lck  critical hits, lucky escapes, weapon finds, encounter odds
import { STATS } from '../core/config.js';

export const STAT_KEYS = STATS.KEYS;
const d = (s, k) => (s?.[k] ?? STATS.BASE) - STATS.BASE;

export const baseStats = (v = STATS.BASE) => Object.fromEntries(STAT_KEYS.map((k) => [k, v]));
export const clampStat = (v) => Math.max(STATS.MIN, Math.min(STATS.MAX, Math.round(v)));

/** Neutral modifiers: what a trooper with every stat at 5 gets. */
export const NO_MODS = Object.freeze({
  spread: 1, acquire: 1, reload: 1, damage: 1, armor: 1, search: 1, credits: 1, sight: 0, hp: 0,
  medic: 1, focus: 1, stamina: 1, drain: 1, stagger: 1, aura: 0, crit: 0, escapes: 0, find: 0, climb: 1, uplink: 1,
});

/**
 * Modifiers read by the simulation hooks (combat.js, vis/sight.js, world.js, squad.js).
 * Multipliers are 1 and additive terms 0 at 5 in everything.
 */
export function statsToMods(s, weaponKey = 'carbine') {
  const heavy = weaponKey === 'heavy' || weaponKey === 'breacher' || weaponKey === 'minigun';
  const luck = d(s, 'lck');
  return {
    spread: (1 - 0.06 * d(s, 'acc')) * (heavy ? 1 - 0.03 * d(s, 'str') : 1),
    acquire: 1 - 0.07 * d(s, 'per'),
    reload: 1 - 0.04 * d(s, 'spd'),
    damage: 1,
    armor: 1 - 0.04 * d(s, 'str'),
    search: 1 - 0.07 * d(s, 'int'),
    credits: 1,
    sight: 0.8 * d(s, 'per'),                 // metres of flashlight cone
    hp: 6 * d(s, 'sta'),
    medic: 1 + 0.1 * d(s, 'int'),             // stims he gives heal this much more
    focus: 1 - 0.07 * d(s, 'nrv'),            // high-alert energy drain
    stamina: 1 + 0.1 * d(s, 'sta'),           // stamina pool size
    drain: 1 - 0.05 * d(s, 'sta'),            // stamina used while running
    stagger: heavy ? 1 + 0.06 * d(s, 'str') : 1,
    aura: 0.25 * d(s, 'per'),                 // metres of 360-degree awareness
    crit: 0.03 * Math.max(0, luck),           // chance a hit does double damage
    escapes: luck >= 2 ? 1 : 0,               // lethal blows survived per mission (luck 7+)
    find: 0.05 * Math.max(0, luck),           // chance a found weapon comes up one rarity
    climb: 1 + 0.035 * d(s, 'spd'),
    uplink: 1 - 0.05 * d(s, 'int'),
  };
}

/** Personal walking pace multiplier (the formation's rhythm on top comes from the gait). */
export const statPace = (s) => 1 + 0.035 * d(s, 'spd');

/** Chance a stat check succeeds: base odds at 5, +8% per point, luck nudges it. */
export function checkChance(s, key, base = 0.5) {
  return Math.max(0.05, Math.min(0.95, base + 0.08 * d(s, key) + 0.02 * d(s, 'lck')));
}

/**
 * Learning by doing: practice a trooper puts into a stat during a run. meta/growth.js turns
 * the totals into stat points at the debrief. (Bookkeeping only - never affects the run.)
 */
export function practice(m, key, amount = 1) {
  if (m?.use) m.use[key] = (m.use[key] ?? 0) + amount;
}

/** The squad member with the best `key` (ties go to the man earlier in the order). */
export function bestAt(marines, key) {
  let best = null;
  for (const m of marines) if (m.alive && (!best || (m.stats?.[key] ?? 5) > (best.stats?.[key] ?? 5))) best = m;
  return best;
}
