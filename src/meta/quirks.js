// Quirks: traits a trooper picks up from what happens to him on a run (earnQuirk, at the
// debrief), for better or worse, shown on his card and read into his modifiers (quirkMods ->
// meta/profile.js trooperMods). Up to three; a bad one can be treated at the Kestrel for
// credits (meta/profile.js treatQuirk).
export const QUIRK_MAX = 3;
export const TREAT_COST = 60;

export const QUIRKS = {
  steady_hands: { label: 'Steady hands', good: true, text: 'Fifteen kills on one run: -8% spread.', mods: { spread: 0.92 } },
  grudge: { label: 'Grudge', good: true, text: 'Saw a mate dragged off: +10% damage.', mods: { damage: 1.1 } },
  lucky: { label: 'Lucky', good: true, text: 'Walked away from a killing blow: +3% criticals.', mods: { crit: 0.03 } },
  scrounger: { label: 'Scrounger', good: true, text: 'Searched the ship bare: searches 15% quicker, better finds.', mods: { search: 0.85, find: 0.05 } },
  hardened: { label: 'Hardened', good: true, text: 'Three runs on his feet: takes 8% less.', mods: { armor: 0.92 } },
  shaky: { label: 'Shaky', good: false, text: 'Went down on the deck: slower on the reload and the draw.', mods: { reload: 1.12, acquire: 1.12 } },
  claustrophobic: { label: 'Claustrophobic', good: false, text: 'Survived a horde by a thread: high alert burns him 20% faster.', mods: { focus: 1.2 } },
  nightmares: { label: 'Nightmares', good: false, text: 'Saw the brood: wild aim when it matters (+10% spread).', mods: { spread: 1.1 } },
  flinch: { label: 'Flinch', good: false, text: 'Dragged off once: aura shrinks a metre.', mods: { aura: -1 } },
};
export const QUIRK_KEYS = Object.keys(QUIRKS);

/** Multiply (or add, for additive terms) a trooper's quirks into his modifiers. */
export function quirkMods(mods, quirks = []) {
  const out = { ...mods };
  for (const k of quirks) {
    const q = QUIRKS[k];
    if (!q) continue;
    for (const [m, v] of Object.entries(q.mods)) {
      if (m === 'crit' || m === 'find' || m === 'aura' || m === 'sight' || m === 'hp' || m === 'escapes') out[m] = (out[m] ?? 0) + v;
      else out[m] = (out[m] ?? 1) * v;
    }
  }
  return out;
}

/**
 * What a run might leave on a trooper: the candidates its record earns (r: his line of the
 * results - kills, alive, downs, dragged, escapesUsed, searches; `w` the whole run's flags:
 * horde, brood). One at most, rolled, never one he has, never past the cap.
 */
export function earnQuirk(t, r, w, rng) {
  const have = new Set(t.quirks ?? []);
  if (have.size >= QUIRK_MAX || !r.alive) return null;
  const could = [];
  if (r.kills >= 15) could.push(['steady_hands', 0.6]);
  if (w.dragged && !r.dragged) could.push(['grudge', 0.5]);
  if (r.escapesUsed > 0) could.push(['lucky', 0.7]);
  if (r.searches >= 6) could.push(['scrounger', 0.5]);
  if ((t.runs ?? 0) >= 3 && (t.downsEver ?? 0) === 0) could.push(['hardened', 0.4]);
  if (r.downs > 0) could.push(['shaky', 0.45]);
  if (w.horde && r.lowAfterHorde) could.push(['claustrophobic', 0.5]);
  if (w.brood) could.push(['nightmares', 0.3]);
  if (r.dragged > 0) could.push(['flinch', 0.5]);
  const open = could.filter(([k]) => !have.has(k));
  if (!open.length) return null;
  const [key, chance] = open[rng.int(0, open.length - 1)];
  return rng.chance(chance) ? key : null;
}

/** The chips on a card: [{key, label, good}]. */
export const quirkChips = (t) => (t.quirks ?? []).filter((k) => QUIRKS[k]).map((k) => ({ key: k, label: QUIRKS[k].label, good: QUIRKS[k].good, text: QUIRKS[k].text }));
