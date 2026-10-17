// Difficulty ladder: autoplay (mortal) across threat levels with random ship offers.
// Usage: node tools/dev/threat.mjs [runsPerLevel]
import { generateLevel } from '../../src/gen/level.js';
import { newProfile } from '../../src/meta/profile.js';
import { shipOffers } from '../../src/meta/ships.js';
import { initPhysics } from '../../src/physics/physics.js';
import { World } from '../../src/sim/world.js';
await initPhysics();
const N = Number(process.argv[2] ?? 8);
for (let threat = 0; threat <= 5; threat++) {
  let won = 0, dead = 0, kills = 0;
  for (let i = 0; i < N; i++) {
    const p = newProfile(`TL${threat}-${i}`);
    p.threat = threat;
    const offer = shipOffers(p)[i % 3];
    const w = new World(generateLevel(offer.seed, { threat, mods: offer.mods }), { params: { autoplay: true } });
    for (let k = 0; k < 60 * 1200 && w.status === 'playing'; k++) w.step(1 / 60);
    if (w.status === 'won') won++;
    dead += w.marines.filter((m) => !m.alive).length;
    kills += w.stats.kills;
  }
  console.log(`threat ${threat}: won ${won}/${N}  dead/run ${(dead / N).toFixed(2)}  kills/run ${(kills / N).toFixed(1)}`);
}
