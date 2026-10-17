// Shared test helpers (not a test file itself).

/** Compact fingerprint of a world: everything the simulation decides shows up in it. */
export function digest(w) {
  const f = (v) => v.toFixed(3);
  return JSON.stringify({
    t: f(w.time), status: w.status, stats: w.stats, credits: w.credits,
    marines: w.marines.map((m) => [m.name, f(m.x), f(m.y), Math.round(m.hp), m.alive, m.kills, m.shots, m.mag, m.reserve]),
    aliens: w.aliens.map((a) => [a.state, a.alive, f(a.x), f(a.y), Math.round(a.hp)]),
  });
}
