// Trooper ranks: five tiers, Private to Captain. A rank says how good a trooper is, and like gear
// in a dungeon crawler each tier has its colour - grey, green, blue, purple, orange - on his card,
// his name and his portrait wherever he's shown. Quick-play candidates roll a rank and come with
// BONUS extra stat points to match, mostly into what their archetype is already good at; in the
// campaign troopers earn theirs with XP (meta/profile.js LEVELS: XP is each rank's threshold).
export const RANK_TIERS = [
  { key: 'pvt', abbr: 'PVT.', name: 'Private',    color: '#c4c8c0', bonus: 0,  xp: 0,    weight: 34 },
  { key: 'cpl', abbr: 'CPL.', name: 'Corporal',   color: '#5fd35a', bonus: 4,  xp: 250,  weight: 30 },
  { key: 'sgt', abbr: 'SGT.', name: 'Sergeant',   color: '#4f9dff', bonus: 8,  xp: 700,  weight: 20 },
  { key: 'lt',  abbr: 'LT.',  name: 'Lieutenant', color: '#b56dff', bonus: 12, xp: 1400, weight: 11 },
  { key: 'cpt', abbr: 'CPT.', name: 'Captain',    color: '#ff9a2e', bonus: 16, xp: 1900, weight: 5 },
];

// Campaign level (1-8, by XP) -> rank tier.
const LEVEL_TIER = [0, 0, 1, 1, 2, 2, 3, 4];

/** The rank tier for a campaign level. */
export const tierForLevel = (level) => RANK_TIERS[LEVEL_TIER[Math.max(0, Math.min(LEVEL_TIER.length - 1, level - 1))]];

/** The rank tier for an abbreviation ('SGT.'), a tier key ('sgt') or a tier; Private if unknown. */
export const tierOf = (rank) => RANK_TIERS.find((r) => r === rank || r.abbr === rank || r.key === rank) ?? RANK_TIERS[0];

/** A rank rolled for a candidate (rarer the higher). */
export const rollTier = (rng) => RANK_TIERS[rng.weighted(RANK_TIERS.map((r, i) => [i, r.weight]))];
