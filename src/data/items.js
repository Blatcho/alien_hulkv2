// Gear data: slots, rarity tiers, naming tables and per-mod scaling. Pure data, consumed by
// systems/Loot.js. Names only use characters present in the generated bitmap fonts
// (letters, digits, space, apostrophe, hyphen, +, %, /) so they render in the HUD and pause screen.

export const SLOTS = ['claws', 'hide', 'charm'];

export const RARITIES = ['common', 'rare', 'epic', 'legendary'];

export const RARITY = {
  common:    { rank: 0, weight: 62,  mods: [1, 1], mult: 1.0,  color: '#d0c8b8', tint: 0xd0c8b8, label: 'Common' },
  rare:      { rank: 1, weight: 26,  mods: [2, 2], mult: 1.25, color: '#5aa0ff', tint: 0x5aa0ff, label: 'Rare' },
  epic:      { rank: 2, weight: 9.5, mods: [3, 3], mult: 1.5,  color: '#c060ff', tint: 0xc060ff, label: 'Epic' },
  legendary: { rank: 3, weight: 2.5, mods: [3, 4], mult: 1.9,  color: '#ffa030', tint: 0xffa030, label: 'Legendary' },
};

export const RARITY_COLORS = {
  common: RARITY.common.color, rare: RARITY.rare.color, epic: RARITY.epic.color, legendary: RARITY.legendary.color,
};

// Base nouns per slot.
export const BASES = {
  claws: ['Claws', 'Talons', 'Fangs', 'Rakes', 'Barbs', 'Hooks'],
  hide:  ['Hide', 'Pelt', 'Mantle', 'Shroud', 'Cloak', 'Furs'],
  charm: ['Charm', 'Amulet', 'Idol', 'Talisman', 'Relic', 'Fetish'],
};

export const PREFIXES = [
  'Thornbane', 'Gravewarden', 'Hollow', 'Moonlit', 'Ashen', 'Blackthorn', 'Howling', 'Sorrowful',
  'Ironbound', 'Wraithtouched', 'Bonecarved', 'Embered', 'Dusken', 'Mourning', 'Gallows', 'Bramble',
  'Wolfmoon', 'Rusted', 'Crowfeather', 'Marrow',
];

export const SUFFIXES = [
  'of the Moor', 'of the Gravewarden', 'of Hollow Bells', 'of the Drowned Chapel', 'of the Black Gate',
  'of Old Thorns', 'of the Wolf Moon', 'of Quiet Graves', 'of the Last Watch', 'of Cinders',
  'of the Marsh King', 'of the Hanged', 'of Bitter Frost', 'of the Lantern Road', 'of the Warden',
];

// Hand-written legendary names per slot; a legendary roll takes one of these half the time.
export const LEGENDARY_NAMES = {
  claws: ['Thornbane', 'Widowmaker Talons', 'The Warden\'s Reckoning', 'Gravedigger\'s Rakes'],
  hide:  ['Hide of the Gravewarden', 'Mantle of Hollow Bells', 'The Marsh King\'s Pelt', 'Shroud of the Last Watch'],
  charm: ['Charm of Hollow Bells', 'Heart of the Black Gate', 'The Hanged Man\'s Coin', 'Lantern of Quiet Graves'],
};

// Which mods may roll on which slot, with relative weights. The first entry of each slot is the
// "signature" mod and is always present on that slot's items.
export const SLOT_MODS = {
  claws: { damage: 10, crit: 5, reach: 3, lifesteal: 3, speed: 2 },
  hide:  { hp: 10, armor: 6, regen: 3, stamina: 3 },
  charm: { goldFind: 6, crit: 3, regen: 3, stamina: 3, speed: 3, lifesteal: 2, hp: 2, damage: 2 },
};

export const MOD_KEYS = ['damage', 'hp', 'stamina', 'regen', 'crit', 'speed', 'reach', 'armor', 'lifesteal', 'goldFind'];

// Mod scaling: value = (base + perLevel * level) * rarityMult * roll(0.85..1.15), clamped to max,
// rounded to `decimals`. Flat mods are integers; fractions keep 3 decimals.
export const MOD_SCALE = {
  damage:    { base: 2,    perLevel: 1.2,   max: 80,   decimals: 0, label: 'DMG',   pct: false },
  hp:        { base: 10,   perLevel: 6,     max: 400,  decimals: 0, label: 'HP',    pct: false },
  stamina:   { base: 6,    perLevel: 2,     max: 120,  decimals: 0, label: 'STA',   pct: false },
  regen:     { base: 2,    perLevel: 0.6,   max: 30,   decimals: 1, label: 'REGEN', pct: false },
  crit:      { base: 0.02, perLevel: 0.004, max: 0.25, decimals: 3, label: 'CRIT',  pct: true },
  speed:     { base: 0.03, perLevel: 0.004, max: 0.25, decimals: 3, label: 'SPD',   pct: true },
  reach:     { base: 0.04, perLevel: 0.004, max: 0.3,  decimals: 3, label: 'REACH', pct: true },
  armor:     { base: 4,    perLevel: 1.2,   max: 45,   decimals: 0, label: 'ARMOR', pct: true },
  lifesteal: { base: 0.02, perLevel: 0.003, max: 0.2,  decimals: 3, label: 'LEECH', pct: true },
  goldFind:  { base: 0.08, perLevel: 0.01,  max: 0.8,  decimals: 3, label: 'GOLD',  pct: true },
};

// Drop tuning. Tiers: 1 fodder, 2 elite, 3 champion; 'boss' (or any tier >= 4) is a boss.
export const DROP = {
  goldChance: 0.85,
  goldBase: 8,
  goldPerLevel: 4,
  potionChance: 0.08,
  itemChancePerTier: 0.12,
  boss: { goldMult: 8, potionChance: 0.5, extraItemChance: 0.35, minRarity: 'epic' },
};

export const INVENTORY_SIZE = 12;
