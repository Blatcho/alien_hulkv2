// Loot: weapons with rarity tiers and rolled affixes, treasure salvage.
// Items are plain data so they can be stashed and carried between runs (meta layer).
import { WEAPONS } from '../core/config.js';

export const RARITY = {
  common: { label: 'Standard', color: '#b8c0b0', weight: 58, affixes: 0 },
  rare: { label: 'Rare', color: '#4aa3ff', weight: 29, affixes: 1 },
  epic: { label: 'Epic', color: '#b45cff', weight: 11, affixes: 2 },
  legendary: { label: 'Legendary', color: '#ff9a2a', weight: 2.5, affixes: 3 },
};

const pct = (v) => `${Math.round(v * 100)}%`;

// Each affix: roll range and how it modifies the weapon's stat block.
export const AFFIXES = {
  dmg: { range: [0.12, 0.32], text: (v) => `+${pct(v)} damage`, apply: (w, v) => { w.damage = w.damage.map((d) => Math.round(d * (1 + v))); } },
  rate: { range: [0.1, 0.25], text: (v) => `+${pct(v)} fire rate`, apply: (w, v) => { w.rate *= 1 + v; } },
  mag: { range: [0.25, 0.6], text: (v) => `+${pct(v)} magazine`, apply: (w, v) => { w.mag = Math.round(w.mag * (1 + v)); w.reserve = Math.round(w.reserve * (1 + v)); } },
  acc: { range: [0.15, 0.35], text: (v) => `-${pct(v)} spread`, apply: (w, v) => { w.spread *= 1 - v; } },
  reload: { range: [0.15, 0.35], text: (v) => `-${pct(v)} reload time`, apply: (w, v) => { w.reload *= 1 - v; } },
  range: { range: [0.12, 0.25], text: (v) => `+${pct(v)} range`, apply: (w, v) => { w.range *= 1 + v; if (w.sight) w.sight *= 1 + v * 0.5; } },
  stagger: { range: [0.2, 0.4], text: () => 'staggering rounds', apply: (w, v) => { w.stagger = Math.max(w.stagger ?? 0.12, v); } },
};

const NAMES = {
  carbine: ['Kestrel', 'Warden', 'Sentinel', 'Longshift', 'Vigil'],
  heavy: ['Hellstorm', 'Grinder', 'Bulwark', 'Thunderhead', 'Deckclearer'],
  breacher: ['Doorkicker', 'Knockback', 'Hullbuster', 'Short Answer', 'Bruiser'],
  marksman: ['Longreach', 'Needle', 'Farsight', 'Last Word', 'Stillwater'],
  pistol: ['Oathkeeper', 'Judgement', 'Final Mercy', 'Penitent', 'Sidewinder'],
  minigun: ['Buzzsaw', 'Lead Rain', 'Widowmaker', 'Grinder Mk', 'Sweeper'],
};
const MARKS = { common: '', rare: 'Mk.II ', epic: 'Mk.III ', legendary: '' };

const TREASURES = [
  ["Captain's chronometer", 180], ['Encrypted data core', 260], ['Xeno-crystal shard', 340],
  ["Officer's medal", 140], ['Nav-logs of a lost fleet', 420], ['Gold-plated sidearm', 300],
  ['Sealed medical research', 380], ['Prototype power cell', 280],
];

export function rollRarity(rng, luck = 0) {
  const table = Object.entries(RARITY).map(([k, r]) => [k, r.weight * (k === 'common' ? 1 : 1 + luck)]);
  return rng.weighted(table);
}

/** A random weapon item. `luck` (0..1) shifts rarity up (armories, deeper ships). */
export function rollWeapon(rng, { luck = 0, cls = null, rarity: forced = null } = {}) {
  const klass = cls ?? rng.pick(Object.keys(WEAPONS).filter((k) => !WEAPONS[k].melee)); // (fists aren't found lying about)
  const rarity = forced ?? rollRarity(rng, luck);
  const pool = rng.shuffle(Object.keys(AFFIXES));
  const affixes = pool.slice(0, RARITY[rarity].affixes).map((key) => {
    const [a, b] = AFFIXES[key].range;
    return { key, v: +rng.float(a, b).toFixed(3) };
  });
  const base = WEAPONS[klass].label;
  const name = rarity === 'common' ? `Standard ${base}` : rarity === 'legendary'
    ? `"${rng.pick(NAMES[klass])}" ${base}` : `${MARKS[rarity]}${rng.pick(NAMES[klass])} ${base}`;
  const value = { common: 40, rare: 120, epic: 300, legendary: 700 }[rarity];
  return { type: 'weapon', cls: klass, rarity, name, affixes, value };
}

/** The same class of weapon, one rarity grade better (a lucky find). */
export function upgradeWeapon(rng, item) {
  const order = Object.keys(RARITY);
  const next = order[Math.min(order.length - 1, order.indexOf(item.rarity) + 1)];
  return rollWeapon(rng, { cls: item.cls, rarity: next });
}

/** The full stat block for an item (base weapon + affixes). */
export function weaponStats(item) {
  const w = structuredClone(WEAPONS[item.cls]);
  for (const a of item.affixes ?? []) AFFIXES[a.key].apply(w, a.v);
  w.label = item.name;
  w.rarity = item.rarity;
  return w;
}

export function affixText(item) {
  return (item.affixes ?? []).map((a) => AFFIXES[a.key].text(a.v)).join(', ');
}

export function rollTreasure(rng, threat = 0) {
  const [name, value] = rng.pick(TREASURES);
  return { type: 'treasure', name, value: Math.round(value * (1 + threat * 0.25) * rng.float(0.85, 1.2)) };
}

/** The default issue weapon for a loadout slot (as an item, so it can be stashed/swapped). */
export function issueWeapon(cls) {
  return { type: 'weapon', cls, rarity: 'common', name: `Standard ${WEAPONS[cls].label}`, affixes: [], value: 40 };
}
