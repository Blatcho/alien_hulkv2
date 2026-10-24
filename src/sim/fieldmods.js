// Field mods: at a field workshop aboard (gen/populate.js placeOddities 'workbench'; the
// 'workbench' encounter, sim/encounters.js) the squad fits one modification to every weapon
// for the rest of the run - one of three the bench can do, rolled from the seed. Nothing goes
// home: the campaign stays about the troopers.
import { Rng } from '../core/rng.js';

export const FIELD_MODS = {
  scope: { label: 'Scopes', text: '+20% range, +10% sight', apply: (w) => { w.range *= 1.2; if (w.sight) w.sight *= 1.1; } },
  drum: { label: 'Drum magazines', text: '+40% magazine', apply: (w) => { w.mag = Math.round(w.mag * 1.4); } },
  bipod: { label: 'Bipods', text: '-15% spread', apply: (w) => { w.spread *= 0.85; } },
  hollow: { label: 'Hollow points', text: '+15% damage', apply: (w) => { w.damage = w.damage.map((d) => Math.round(d * 1.15)); } },
  quickmag: { label: 'Quick-release mags', text: '-25% reload time', apply: (w) => { w.reload *= 0.75; } },
  suppressor: { label: 'Suppressors', text: '-40% noise: the ship hears less', apply: (w) => { w.noise *= 0.6; } },
};
export const FIELD_MOD_KEYS = Object.keys(FIELD_MODS);

/** Three the bench can do, from the seed. */
export function benchOffer(bare, n = 3) {
  const rng = new Rng(bare, 'workbench');
  const pool = [...FIELD_MOD_KEYS];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
  return out;
}

/** Fit a mod to every marine's weapon (and the magazine in hand grows with a drum). */
export function applyFieldMod(world, key) {
  const m = FIELD_MODS[key];
  if (!m) return false;
  world.fieldMods ??= [];
  if (world.fieldMods.includes(key)) return false;
  world.fieldMods.push(key);
  for (const t of world.marines) {
    if (!t.weapon || t.weapon.melee) continue;
    const before = t.weapon.mag;
    m.apply(t.weapon);
    if (t.weapon.mag > before) t.mag += t.weapon.mag - before;
  }
  world.emit('field-mod', { key, label: m.label });
  return true;
}
