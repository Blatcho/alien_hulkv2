// Derelict offers: before each run the player picks one of three ships. Each has a size,
// 0-2 modifiers (risk/reward twists) and a reward multiplier - a small, meaningful choice
// every run. Modifiers are plain generator/sim knobs (level.mods).
import { Rng } from '../core/rng.js';

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

const SIZES = [
  { key: 'small', label: 'Corvette', cols: 20, decks: 3, reward: -0.15 },
  { key: 'medium', label: 'Freighter', cols: 24, decks: 3, reward: 0 },
  { key: 'large', label: 'Cruiser', cols: 28, decks: 4, reward: 0.3 },
];

const PREFIX = ['ISV', 'MCV', 'FTR', 'CSS', 'UMS'];
const NAMES = ["Morrow's Lament", 'Quiet Meridian', 'Cold Harvest', 'Saint Adair', 'Long Dark', 'Veritas Drift', 'Iron Orison', 'Pale Lantern', 'Hollow Crown', 'Kepler Widow', 'Ninth Ember', 'Grace Under Ice'];

/** Three offers for the profile's next run (stable until one is taken). */
export function shipOffers(profile) {
  const rng = new Rng(`${profile.seed}/${profile.seedCounter}`, 'ships');
  return [0, 1, 2].map((i) => {
    const size = i === 0 ? SIZES[0] : rng.pick(SIZES);
    const keys = rng.shuffle(Object.keys(MODIFIERS)).slice(0, rng.weighted([[0, 2], [1, 5], [2, 3]]));
    const mods = { cols: size.cols, decks: size.decks };
    let reward = 1 + size.reward;
    let danger = size.key === 'large' ? 1 : 0;
    for (const k of keys) {
      for (const [m, v] of Object.entries(MODIFIERS[k].mods)) mods[m] = typeof v === 'number' && typeof mods[m] === 'number' ? mods[m] * v : v;
      reward += MODIFIERS[k].reward;
      danger += MODIFIERS[k].danger;
    }
    return {
      seed: `${profile.seed.slice(0, 3).toUpperCase()}${profile.seedCounter}${'ABC'[i]}${rng.int(100, 999)}`,
      name: `${rng.pick(PREFIX)} ${rng.pick(NAMES)}`,
      size: size.label, modifiers: keys, mods, reward: +reward.toFixed(2), danger,
      threat: profile.threat,
    };
  });
}
