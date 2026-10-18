// Difficulty (set on the briefing, campaign and quick play alike): how many hostiles aboard, how
// hard they are, how big the ship, how often it brings a horde. It all folds into the ship's mods
// (gen/level.js), so a run is still just seed + mods and replays the same.

export const DIFFICULTY = {
  enemies: { label: 'Enemies', options: { few: 'Few', normal: 'Normal', many: 'Many', swarm: 'Swarm' } },
  strength: { label: 'Strength', options: { weak: 'Weak', normal: 'Normal', tough: 'Tough', brutal: 'Brutal' } },
  ship: { label: 'Ship size', options: { small: 'Small', medium: 'Medium', large: 'Large' } },
  hordes: { label: 'Hordes', options: { off: 'Off', rare: 'Rare', normal: 'Normal', often: 'Often' } },
};

export const DEFAULT_DIFFICULTY = { enemies: 'normal', strength: 'normal', ship: 'medium', hordes: 'normal' };

// x the ship's hostile budget
const ENEMIES = { few: 0.6, normal: 1, many: 1.4, swarm: 1.9 };
// x each hostile's health and the damage it does
const STRENGTH = { weak: { hp: 0.7, dmg: 0.7 }, normal: { hp: 1, dmg: 1 }, tough: { hp: 1.35, dmg: 1.25 }, brutal: { hp: 1.8, dmg: 1.5 } };
// The ship's length and decks scale within its hull class (gen/classes.js SHIP_SIZES, applied by
// the generator, which knows the class); the hostile budget grows with it so a bigger ship isn't
// an emptier one
const SHIPS = { small: { budget: 0.8 }, medium: { budget: 1 }, large: { budget: 1.3 } };
// x the chance noise brings the ship's horde (0: none aboard)
const HORDES = { off: 0, rare: 0.65, normal: 1, often: 2.5 };

/** Every setting known, unknown ones back to normal. */
export function fitDifficulty(d = {}) {
  const out = {};
  for (const [k, knob] of Object.entries(DIFFICULTY)) out[k] = d?.[k] in knob.options ? d[k] : DEFAULT_DIFFICULTY[k];
  return out;
}

export const isDefaultDifficulty = (d) => Object.keys(DIFFICULTY).every((k) => fitDifficulty(d)[k] === DEFAULT_DIFFICULTY[k]);

/** The ship's mods with the difficulty folded in (the default changes nothing). */
export function withDifficulty(mods = {}, d = DEFAULT_DIFFICULTY) {
  if (isDefaultDifficulty(d)) return mods;
  const f = fitDifficulty(d);
  const out = { ...mods };
  const ship = SHIPS[f.ship];
  if (f.ship !== 'medium') out.shipSize = f.ship;
  const budget = ENEMIES[f.enemies] * ship.budget;
  if (budget !== 1) out.hostiles = (mods.hostiles ?? 1) * budget;
  const s = STRENGTH[f.strength];
  if (s.hp !== 1) out.alienHp = (mods.alienHp ?? 1) * s.hp;
  if (s.dmg !== 1) out.alienDmg = (mods.alienDmg ?? 1) * s.dmg;
  if (HORDES[f.hordes] !== 1) out.hordes = HORDES[f.hordes];
  return out;
}

/** For the URL: 'many.tough.large.often'. */
export const difficultyString = (d) => Object.keys(DIFFICULTY).map((k) => fitDifficulty(d)[k]).join('.');
export function parseDifficulty(s) {
  if (!s) return { ...DEFAULT_DIFFICULTY };
  const parts = String(s).split('.');
  return fitDifficulty(Object.fromEntries(Object.keys(DIFFICULTY).map((k, i) => [k, parts[i]])));
}
