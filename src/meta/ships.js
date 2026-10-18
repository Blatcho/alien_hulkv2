// Derelict offers: before each run the player picks one of three ships. Each has a hull class
// (gen/classes.js: its shape, dock, rooms and look), a size within the class, 0-2 modifiers
// (risk/reward twists) and a reward multiplier - a small, meaningful choice every run.
// Modifiers are plain generator/sim knobs (level.mods). The seed code names the class.
import { Rng } from '../core/rng.js';
import { CLASS_KEYS, HULL_CLASSES, parseSeed, seedCode } from '../gen/classes.js';
import { storyFor } from '../gen/stories.js';

export const MODIFIERS = {
  infested: { label: 'Infested', text: '+40% hostiles, +35% contract pay', mods: { hostiles: 1.4 }, reward: 0.35, danger: 2 },
  blackout: { label: 'Blackout', text: 'Main power is dead - flashlights only', mods: { blackout: true }, reward: 0.2, danger: 1 },
  treasure: { label: 'Treasure hauler', text: 'More strongboxes and salvage', mods: { treasure: 2.2 }, reward: 0, danger: 0 },
  armory:   { label: 'Armoury ship', text: 'More weapons, better rarity', mods: { weapons: 2, luck: 0.6 }, reward: 0, danger: 0 },
  refugees: { label: 'Distress call', text: '+2 survivors aboard', mods: { survivors: 2 }, reward: 0.1, danger: 0 },
  hive:     { label: 'Hive ship', text: 'More nests, hostiles sleep deeper', mods: { nests: 1.8, hostiles: 1.15 }, reward: 0.25, danger: 1 },
  restless: { label: 'Restless', text: 'Ambushes come far more often', mods: { calm: 0.55 }, reward: 0.25, danger: 1 },
  volatile: { label: 'Fuel leak', text: 'Fuel drums everywhere', mods: { barrels: 2.2 }, reward: 0.1, danger: 1 },
};

const PREFIX = { corvette: ['UMS', 'CSS', 'FTR'], freighter: ['MCV', 'ISV', 'FTR'], liner: ['ISV', 'CSS', 'MCV'], research: ['ISV', 'UMS', 'RSV'], station: ['OSP', 'ISV', 'CSS'] };
const NAMES = ["Morrow's Lament", 'Quiet Meridian', 'Cold Harvest', 'Saint Adair', 'Long Dark', 'Veritas Drift', 'Iron Orison', 'Pale Lantern', 'Hollow Crown', 'Kepler Widow', 'Ninth Ember', 'Grace Under Ice',
  'Anselm Reach', 'Tollan Spire', 'Deep Furrow', 'Caldera Station', 'Hesper Ring', 'Brightwater', 'Second Dawn', 'Nocturne'];

/** Weighted picks without replacement. */
function draw(rng, entries, n) {
  const pool = entries.filter(([, w]) => w > 0);
  const out = [];
  while (out.length < n && pool.length) {
    const k = rng.weighted(pool);
    out.push(k);
    pool.splice(pool.findIndex(([q]) => q === k), 1);
  }
  return out;
}

/**
 * Three offers for the profile's next run (stable until one is taken): three different hull
 * classes, each sized within its class and twisted by the modifiers that suit it. No streaks:
 * the classes and modifiers of the last few runs (profile.recent, meta/profile.js) come up
 * less, and the three offers always differ in how twisted they are (one plain, one with a
 * twist, one with two). Each carries the story its seed tells (gen/stories.js).
 */
export function shipOffers(profile) {
  const rng = new Rng(`${profile.seed}/${profile.seedCounter}`, 'ships');
  const recent = profile.recent ?? [];
  const lately = (k, n) => recent.slice(-n).some((r) => r.cls === k);
  const classes = draw(rng, CLASS_KEYS.map((k) => [k, (HULL_CLASSES[k].weight ?? 1) * (lately(k, 2) ? 0.3 : lately(k, 4) ? 0.6 : 1)]), 3);
  const lastMods = recent.length ? recent[recent.length - 1].modifiers ?? [] : [];
  const twists = rng.shuffle([0, 1, 2]);
  return classes.map((cls, i) => {
    const C = HULL_CLASSES[cls];
    const cols = rng.int(C.cols[0], C.cols[1]);
    const decks = rng.int(C.decks[0], C.decks[1]);
    const n = twists[i];
    const keys = draw(rng, Object.keys(MODIFIERS).filter((k) => !C.modifiers?.never?.includes(k)).map((k) => [k, (C.modifiers?.bias?.[k] ?? 1) * (lastMods.includes(k) ? 0.4 : 1)]), n);
    const mods = { cls, cols, decks };
    let reward = 1 + C.reward;
    let danger = C.danger;
    for (const k of keys) {
      for (const [m, v] of Object.entries(MODIFIERS[k].mods)) mods[m] = typeof v === 'number' && typeof mods[m] === 'number' ? mods[m] * v : v;
      reward += MODIFIERS[k].reward;
      danger += MODIFIERS[k].danger;
    }
    const seed = seedCode(cls, `${profile.seed.slice(0, 3).toUpperCase()}${profile.seedCounter}${'ABC'[i]}${rng.int(100, 999)}`);
    const story = storyFor(parseSeed(seed).seed, cls);
    return {
      seed,
      name: `${rng.pick(PREFIX[cls])} ${rng.pick(NAMES)}`,
      cls, size: C.label, blurb: C.blurb, story: { key: story.key, title: story.title, blurb: story.blurb }, modifiers: keys, mods, reward: +reward.toFixed(2), danger,
      threat: profile.threat,
    };
  });
}
