// URL parameters: ?seed=ABC123&autoplay=1&retro=0&debug=1&god=1&speed=4
const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

const flag = (k) => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';

export const params = {
  seed: q.get('seed') || null,
  autoplay: flag('autoplay'), // decisions answered automatically toward the objective (tests/demo)
  retro: q.has('retro') ? flag('retro') : null, // pixel mode; absent: the player's last choice
  debug: flag('debug'),       // nav/physics overlays + stats
  god: flag('god'),           // marines take no damage (tests)
  nofog: flag('nofog'),       // disable fog-of-war (debug)
  speed: Number(q.get('speed') || 1),
  skipIntro: flag('go'),      // skip the start screen (quick play)
  run: flag('run'),           // launch the campaign run saved by the Command screen
  command: flag('command'),   // open the campaign Command screen
  brief: q.get('brief') || null,                       // open the quick-play briefing for this seed
  squad: q.get('squad') ? q.get('squad').split(',') : null, // quick play: candidate ids, in order
  pool: Number(q.get('pool') || 0),                     // quick play: which set of candidates (rerolls)
  doc: q.get('doc') || null,                            // quick play: standing orders (sim/doctrine.js)
  diff: q.get('diff') || null,                          // quick play: difficulty (meta/difficulty.js)
  synthSfx: q.get('sfx') === 'synth',                   // procedural sound only (no recorded effects)
};
