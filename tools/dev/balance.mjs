// Balance probe: play N seeds with god mode on/off and print win/loss/death stats.
// Usage: node tools/dev/balance.mjs [N] [--json] [--doctrine=direct|recon|assault|salvage]
//                                   [--squad=all5|starters|random] [--mortal]
//   --json      also print one machine-readable line per mode (compare before/after a change)
//   --doctrine  an autonomous preset from sim/doctrine.js, or 'direct' (default: straight to the
//               cockpit). Standard is point-and-click: it never moves without a player.
//   --squad     all5 = every stat 5 (baseline), starters = Voss/Reyes/Okafor/Lindqvist,
//               random = 4 of the seed's quick-play candidates
//   --mortal    skip the god-mode pass
import { generateLevel } from '../../src/gen/level.js';
import { candidatePool, starterSquad } from '../../src/meta/candidates.js';
import { initPhysics } from '../../src/physics/physics.js';
import { DEFAULT_DOCTRINE, PRESETS } from '../../src/sim/doctrine.js';
import { World } from '../../src/sim/world.js';
await initPhysics();
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const N = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 40);
const json = process.argv.includes('--json');
const preset = arg('doctrine', 'direct');
const squadKind = arg('squad', 'all5');
const doctrine = preset === 'direct' ? DEFAULT_DOCTRINE : PRESETS[preset]?.doctrine;
if (doctrine?.route === 'manual') { console.log('Standard orders only move when a player clicks - pick an autonomous preset.'); process.exit(1); }
const squadFor = (seed) => (squadKind === 'starters' ? starterSquad('BAL') : squadKind === 'random' ? candidatePool(seed).slice(0, 4) : null);
for (const god of process.argv.includes('--mortal') ? [false] : [true, false]) {
  const res = { won: 0, lost: 0, playing: 0, t: 0, kills: 0, dead: 0, rooms: 0, searches: 0, credits: 0, stuck: [] };
  for (let i = 0; i < N; i++) {
    const seed = 'BAL' + i;
    const w = new World(generateLevel(seed), { params: { god }, doctrine, squad: squadFor(seed) });
    for (let k = 0; k < 60 * 1200 && w.status === 'playing'; k++) w.step(1 / 60);
    res[w.status]++;
    if (w.status === 'playing') res.stuck.push(`${seed}@room${w.squad.leader.room}:${w.squad.state}:eng${w.squad.engaged}`);
    if (w.status === 'won') res.t += w.time;
    res.kills += w.stats.kills;
    res.dead += w.marines.filter(m => !m.alive).length;
    res.rooms += w.stats.rooms ?? 0;
    res.searches += w.stats.loot ?? 0;
    res.credits += w.credits;
  }
  console.log(`${god ? 'GOD ' : 'MORTAL'} [${preset}/${squadKind}]`, 'won', res.won, 'lost', res.lost, 'stuck', res.playing, 'avg win time', (res.t / Math.max(1, res.won)).toFixed(0) + 's', 'kills/run', (res.kills / N).toFixed(1), 'dead/run', (res.dead / N).toFixed(2), 'rooms/run', (res.rooms / N).toFixed(1), 'loot/run', (res.searches / N).toFixed(1));
  if (res.stuck.length) console.log('  stuck:', res.stuck.join(' '));
  if (json) {
    const per = (k) => +(res[k] / N).toFixed(3);
    console.log(JSON.stringify({ mode: god ? 'god' : 'mortal', preset, squad: squadKind, n: N, won: res.won, lost: res.lost, stuck: res.playing,
      winTime: +(res.t / Math.max(1, res.won)).toFixed(1), kills: per('kills'), dead: per('dead'), rooms: per('rooms'), loot: per('searches'), credits: per('credits') }));
  }
}
