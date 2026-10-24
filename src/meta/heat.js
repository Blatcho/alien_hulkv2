// Heat: conditions the player switches on for a run, each paid for - the roguelike's heat.
// Lights out, short rations, thin air, a dead tracker, a ship that never settles, three
// troopers instead of four. Every one on makes the job worse and the pay (the campaign's
// contract, or the daily's score) better, and shows as a pip of danger. Like the difficulty
// (meta/difficulty.js) it folds into the ship's mods, so a run is still seed + mods and
// replays the same; `mods.heat` names what was on, for the debrief and the service record
// (meta/record.js).

export const HEAT = {
  lights_out:    { label: 'Lights out', text: 'Main power is dead: flashlights only', pay: 0.2, danger: 1, mods: { blackout: true } },
  short_rations: { label: 'Short rations', text: 'Half the stims, charges, grenades and flares', pay: 0.15, danger: 1, mods: { rations: 0.5 } },
  thin_air:      { label: 'Thin air', text: 'Everyone is winded at 60% of their breath', pay: 0.15, danger: 1, mods: { breath: 0.6 } },
  tracker_dead:  { label: 'Tracker dead', text: 'No motion tracker: what you see is what you know', pay: 0.25, danger: 1, mods: { tracker: 0 } },
  wide_awake:    { label: 'Wide awake', text: 'The ship never settles: ambushes come twice as often', pay: 0.2, danger: 1, mods: { calm: 0.5 } },
  skeleton_crew: { label: 'Skeleton crew', text: 'Three troopers board, not four', pay: 0.3, danger: 2, squad: 3 },
};
export const HEAT_KEYS = Object.keys(HEAT);

/** The conditions known, in the table's order, each once: from an array or a 'a.b.c' string. */
export function fitHeat(keys) {
  const list = Array.isArray(keys) ? keys : keys ? String(keys).split('.') : [];
  const set = new Set(list.filter((k) => HEAT[k]));
  return HEAT_KEYS.filter((k) => set.has(k));
}

/** x the pay (or the score): 1 with nothing on. */
export const heatPay = (keys) => +(1 + fitHeat(keys).reduce((s, k) => s + HEAT[k].pay, 0)).toFixed(2);
/** Pips of danger added. */
export const heatDanger = (keys) => fitHeat(keys).reduce((s, k) => s + HEAT[k].danger, 0);
/** How many board: four, or what the smallest condition allows. */
export const heatSquad = (keys) => fitHeat(keys).reduce((n, k) => Math.min(n, HEAT[k].squad ?? n), 4);

/** The ship's mods with the heat folded in (nothing on changes nothing). */
export function withHeat(mods = {}, keys = []) {
  const h = fitHeat(keys);
  if (!h.length) return mods;
  const out = { ...mods };
  for (const k of h) {
    for (const [m, v] of Object.entries(HEAT[k].mods ?? {})) out[m] = typeof v === 'number' && typeof out[m] === 'number' ? out[m] * v : v;
  }
  out.heat = h;
  return out;
}

/** For the URL: 'lights_out.thin_air'. */
export const heatString = (keys) => fitHeat(keys).join('.');
export const parseHeat = (s) => fitHeat(s);

/** The chips' text: "+20% pay". */
export const heatPayText = (key, what = 'pay') => `+${Math.round(HEAT[key].pay * 100)}% ${what}`;
