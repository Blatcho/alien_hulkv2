// Loot: rarity rolls, gear generation with gothic names, enemy drop tables and item comparison.
// Every function takes an injectable rng (0..1) so tests and replays are deterministic.
import {
  SLOTS, RARITIES, RARITY, RARITY_COLORS, BASES, PREFIXES, SUFFIXES, LEGENDARY_NAMES,
  SLOT_MODS, MOD_KEYS, MOD_SCALE, DROP,
} from '../data/items.js';

export { RARITY_COLORS, SLOTS, RARITIES };

const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d) => { const m = Math.pow(10, d); return Math.round(v * m) / m; };

// Rarity weights, shifted toward the good end by luck (0 = none, 1 = double rare odds).
export function rarityWeights(luck = 0) {
  const L = Math.max(0, luck);
  return {
    common: RARITY.common.weight,
    rare: RARITY.rare.weight * (1 + L),
    epic: RARITY.epic.weight * (1 + L * 1.5),
    legendary: RARITY.legendary.weight * (1 + L * 2),
  };
}

export function rollRarity(luck = 0, rng = Math.random, minRarity = 'common') {
  const w = rarityWeights(luck);
  const minRank = RARITY[minRarity] ? RARITY[minRarity].rank : 0;
  const pool = RARITIES.filter((r) => RARITY[r].rank >= minRank);
  const total = pool.reduce((s, r) => s + w[r], 0);
  let t = rng() * total;
  for (const r of pool) { t -= w[r]; if (t < 0) return r; }
  return pool[pool.length - 1];
}

function weightedKey(weights, rng, exclude) {
  const entries = Object.entries(weights).filter(([k]) => !exclude.has(k));
  if (!entries.length) return null;
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let t = rng() * total;
  for (const [k, v] of entries) { t -= v; if (t < 0) return k; }
  return entries[entries.length - 1][0];
}

export function rollModValue(key, level, rarity, rng = Math.random) {
  const s = MOD_SCALE[key];
  const mult = RARITY[rarity].mult;
  const raw = (s.base + s.perLevel * Math.max(1, level)) * mult * (0.85 + rng() * 0.3);
  const v = round(clamp(raw, 0, s.max), s.decimals);
  // flat mods are never zero after rounding
  return s.decimals === 0 ? Math.max(1, v) : Math.max(Math.pow(10, -s.decimals), v);
}

export function rollName(slot, rarity, rng = Math.random) {
  const base = pick(BASES[slot], rng);
  if (rarity === 'legendary' && rng() < 0.5) return pick(LEGENDARY_NAMES[slot], rng);
  if (rarity === 'common') {
    return rng() < 0.4 ? `${pick(PREFIXES, rng)} ${base}` : `${base} ${pick(SUFFIXES, rng)}`;
  }
  if (rarity === 'rare') {
    return rng() < 0.5 ? `${pick(PREFIXES, rng)} ${base}` : `${base} ${pick(SUFFIXES, rng)}`;
  }
  return `${pick(PREFIXES, rng)} ${base} ${pick(SUFFIXES, rng)}`;
}

// Roll one piece of gear. Options: luck (0..), rng, slot (force a slot), rarity (force), minRarity.
export function rollItem(level, { luck = 0, rng = Math.random, slot, rarity, minRarity = 'common' } = {}) {
  const lvl = Math.max(1, Math.round(level || 1));
  const sl = SLOTS.includes(slot) ? slot : pick(SLOTS, rng);
  const rar = RARITY[rarity] ? rarity : rollRarity(luck, rng, minRarity);
  const [minMods, maxMods] = RARITY[rar].mods;
  const count = minMods + Math.floor(rng() * (maxMods - minMods + 1));
  const table = SLOT_MODS[sl];
  const keys = Object.keys(table);
  const chosen = [keys[0]]; // signature mod first
  const used = new Set(chosen);
  while (chosen.length < Math.min(count, keys.length)) {
    const k = weightedKey(table, rng, used);
    if (!k) break;
    used.add(k); chosen.push(k);
  }
  const mods = {};
  for (const k of chosen) mods[k] = rollModValue(k, lvl, rar, rng);
  const id = `${sl}-${lvl}-${Math.floor(rng() * 0x7fffffff).toString(36)}${Math.floor(rng() * 0x7fffffff).toString(36)}`;
  return { id, slot: sl, name: rollName(sl, rar, rng), rarity: rar, level: lvl, mods };
}

// Enemy drop table. Returns an array of drops; several can appear from one kill.
export function rollDrops(enemyTier = 1, level = 1, { luck = 0, rng = Math.random } = {}) {
  const boss = enemyTier === 'boss' || (typeof enemyTier === 'number' && enemyTier >= 4);
  const tier = boss ? 4 : clamp(Math.round(enemyTier) || 1, 1, 3);
  const lvl = Math.max(1, Math.round(level || 1));
  const drops = [];
  const goldAmount = () => {
    const base = (DROP.goldBase + DROP.goldPerLevel * lvl) * tier * (0.7 + rng() * 0.6);
    return Math.max(1, Math.round(base * (1 + Math.max(0, luck)) * (boss ? DROP.boss.goldMult : 1)));
  };
  if (boss) {
    drops.push({ type: 'gold', amount: goldAmount() });
    if (rng() < DROP.boss.potionChance) drops.push({ type: 'potion' });
    drops.push({ type: 'item', item: rollItem(lvl + 1, { luck, rng, minRarity: DROP.boss.minRarity }) });
    if (rng() < DROP.boss.extraItemChance) drops.push({ type: 'item', item: rollItem(lvl, { luck, rng }) });
    return drops;
  }
  if (rng() < DROP.goldChance) drops.push({ type: 'gold', amount: goldAmount() });
  if (rng() < DROP.potionChance) drops.push({ type: 'potion' });
  if (rng() < Math.min(0.6, DROP.itemChancePerTier * tier * (1 + Math.max(0, luck) * 0.5))) {
    drops.push({ type: 'item', item: rollItem(lvl, { luck, rng }) });
  }
  return drops;
}

// "DMG +4" / "CRIT 5%" style mod formatting shared by HUD and pause screen.
export function formatMod(key, value, { signed = true } = {}) {
  const s = MOD_SCALE[key];
  if (!s) return `${key} ${value}`;
  let v = value;
  if (s.pct && key !== 'armor') v = Math.round(v * 100);
  else if (s.decimals > 0) v = round(v, s.decimals);
  else v = Math.round(v);
  const sign = signed ? (v > 0 ? '+' : v < 0 ? '-' : '') : '';
  return `${s.label} ${sign}${Math.abs(v)}${s.pct ? '%' : ''}`;
}

export function describeItem(item) {
  if (!item) return '';
  return MOD_KEYS.filter((k) => item.mods && item.mods[k] !== undefined).map((k) => formatMod(k, item.mods[k])).join('  ');
}

// Short human string of how `a` differs from `b` (b = currently equipped, may be null).
export function compareItems(a, b) {
  if (!a) return '';
  if (!b) return `New: ${describeItem(a)}`;
  if (a.slot !== b.slot) return 'Different slot';
  const parts = [];
  for (const k of MOD_KEYS) {
    const av = (a.mods && a.mods[k]) || 0;
    const bv = (b.mods && b.mods[k]) || 0;
    const d = av - bv;
    if (Math.abs(d) < 1e-9) continue;
    parts.push(formatMod(k, d));
  }
  return parts.length ? parts.join('  ') : 'No change';
}

// Returns a list of problems with an item (empty when it is well formed).
export function itemProblems(item) {
  const e = [];
  if (!item || typeof item !== 'object') return ['not an object'];
  if (typeof item.id !== 'string' || !item.id) e.push('missing id');
  if (!SLOTS.includes(item.slot)) e.push(`bad slot ${item.slot}`);
  if (typeof item.name !== 'string' || !item.name.trim()) e.push('missing name');
  if (!RARITY[item.rarity]) e.push(`bad rarity ${item.rarity}`);
  if (!Number.isFinite(item.level) || item.level < 1) e.push('bad level');
  if (!item.mods || typeof item.mods !== 'object') { e.push('missing mods'); return e; }
  const keys = Object.keys(item.mods);
  if (!keys.length) e.push('no mods');
  for (const k of keys) {
    if (!MOD_KEYS.includes(k)) e.push(`unknown mod ${k}`);
    else {
      const v = item.mods[k];
      if (!Number.isFinite(v) || v <= 0) e.push(`bad value for ${k}`);
      else if (v > MOD_SCALE[k].max + 1e-9) e.push(`${k} over cap`);
    }
  }
  if (RARITY[item.rarity]) {
    const [lo, hi] = RARITY[item.rarity].mods;
    if (keys.length < lo || keys.length > hi) e.push(`mod count ${keys.length} outside ${lo}-${hi} for ${item.rarity}`);
  }
  return e;
}

export function validateItem(item) { return itemProblems(item).length === 0; }
