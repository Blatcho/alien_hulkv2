// Learning by doing: the practice a trooper put into each stat during a run (sim/stats.js
// practice - hits, first sightings, searches, stims, heavy work, punishment taken, running,
// close calls, lucky breaks) becomes stat points at the debrief.
//   - A point costs more the better the trooper already is (and less where he is weak).
//   - A stat can't grow past the trooper's core + STATS.CEILING (talent), nor past 10.
//   - Practice below a whole point is banked for next time.
import { STATS } from '../core/config.js';
import { STAT_KEYS } from '../sim/stats.js';

// Practice needed for one point at stat 5 (a busy mission earns a trooper ~1-2 points early on).
export const COST = { acc: 50, per: 12, int: 8, str: 4, sta: 3, spd: 4, nrv: 5, lck: 2 };

// What earns each stat, for the debrief.
export const EARNED_BY = {
  acc: 'hits on target', per: 'spotting first, checks', int: 'searches, stims, the uplink', str: 'heavy work',
  sta: 'punishment taken, running', spd: 'on the run, climbing', nrv: 'close calls', lck: 'lucky breaks',
};

export const costAt = (k, v) => COST[k] * Math.max(0.5, 1 + 0.3 * (v - STATS.BASE));
export const talentCap = (t, k) => Math.min(STATS.MAX, (t.core?.[k] ?? t.stats[k]) + STATS.CEILING);

/** Fold one run's practice into a trooper. Returns the points gained per stat ({acc: 1, ...}). */
export function grow(t, usage = {}) {
  t.progress ??= {};
  const gains = {};
  for (const k of STAT_KEYS) {
    const cap = talentCap(t, k);
    let bank = (t.progress[k] ?? 0) * costAt(k, t.stats[k]) + (usage[k] ?? 0);
    while (t.stats[k] < cap && bank >= costAt(k, t.stats[k])) {
      bank -= costAt(k, t.stats[k]);
      t.stats[k]++;
      gains[k] = (gains[k] ?? 0) + 1;
    }
    t.progress[k] = t.stats[k] >= cap ? 0 : +(bank / costAt(k, t.stats[k])).toFixed(3);
  }
  return gains;
}
