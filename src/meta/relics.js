// Relics: squad-wide passives found aboard - in a storeroom's strongbox, a cryo pod's sealed
// cache, or off the queen - and kept by the campaign (profile.relics) for as long as the squad
// keeps coming home: a wipe loses them all. Each applies to a run as it starts (applyRelics),
// and the one found applies at once (sim/world.js resolveLoot 'relic').
import { Rng } from '../core/rng.js';

export const RELICS = {
  tracker_filter: { label: 'Scrubbed tracker', text: 'The motion tracker tells vermin from hostiles.', weight: 3 },
  captains_key: { label: "Dead captain's keycard", text: 'A keycard for the stores on every ship.', weight: 3, start: (w) => { w.kit.keycards++; } },
  ships_cat: { label: "Ship's cat", text: 'Nobody fires on vermin any more, whatever the orders.', weight: 2 },
  surgeons_bag: { label: "Field surgeon's bag", text: '+2 stim-packs every run.', weight: 3, start: (w) => { w.stims += 2; } },
  charge_case: { label: 'Breaching charges', text: '+2 welding charges every run.', weight: 3, start: (w) => { w.kit.charges += 2; } },
  flare_rack: { label: 'Flare rack', text: '+2 flares every run.', weight: 3, start: (w) => { w.kit.flares += 2; } },
  plating: { label: 'Salvaged plating', text: '+15 max health, everyone.', weight: 2, start: (w) => { for (const m of w.marines) { m.maxHp += 15; m.hp += 15; } } },
  lucky_coin: { label: 'Lucky coin', text: 'Everyone survives one blow that should have killed him.', weight: 2, start: (w) => { for (const m of w.marines) m.escapes = (m.escapes ?? 0) + 1; } },
  hive_scent: { label: 'Hive scent', text: 'Sleepers see the squad from only two thirds as far.', weight: 2 },
  queens_tooth: { label: "Queen's tooth", text: 'Morale never breaks: the squad holds whatever it sees.', weight: 0 },
};
export const RELIC_KEYS = Object.keys(RELICS);

/** A relic rolled for a seed's cache (never the queen's; none twice in one ship via `taken`). */
export function rollRelic(rng, taken = new Set()) {
  const pool = RELIC_KEYS.filter((k) => RELICS[k].weight > 0 && !taken.has(k));
  if (!pool.length) return null;
  const key = rng.weighted(pool.map((k) => [k, RELICS[k].weight]));
  taken.add(key);
  return key;
}

/** Apply a relic's standing effect to a run (the flags are read where they matter). */
export function applyRelic(world, key) {
  const r = RELICS[key];
  if (!r) return false;
  world.relics ??= new Set();
  if (world.relics.has(key)) return false;
  world.relics.add(key);
  r.start?.(world);
  return true;
}

/** The campaign's relics into a run as it starts. */
export function applyRelics(world, keys = []) {
  for (const k of keys) applyRelic(world, k);
}

export const relicRng = (bare) => new Rng(bare, 'relics');
