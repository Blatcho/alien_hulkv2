import { beforeAll, describe, expect, it } from 'vitest';
import { generateLevel } from '../src/gen/level.js';
import { initPhysics } from '../src/physics/physics.js';
import { World } from '../src/sim/world.js';
import { digest } from './helpers.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };

/** Step until pred() holds (true) or time runs out (false). */
function until(w, pred, s) {
  for (let i = 0; i < s * 60 && w.status === 'playing'; i++) { w.step(STEP); if (pred()) return true; }
  return false;
}

describe('in-world nudges', () => {
  it('a nudged side door gets breached and the squad goes through it', () => {
    let tested = 0;
    for (const seed of ['A1', 'B2', 'C3', 'D4']) {
      const w = new World(generateLevel(seed), { params: { god: true } });
      // Wait for a closed side door (off the direct route) to come into view.
      const sideDoor = () => {
        const lead = w.squad.leader;
        const route = w.nav.route({ room: lead.room, x: lead.x }, w.level.objective);
        const onRoute = new Set(route?.steps.filter((s) => s.type === 'portal').map((s) => s.portal));
        return w.interactables().find((t) => t.kind === 'door' && !onRoute.has(t.portal) && !w.level.portals[t.portal].open);
      };
      let door = null;
      until(w, () => w.squad.state === 'advance' && (door = sideDoor()), 150);
      if (!door) continue;
      tested++;
      w.nudge(door.id);
      run(w, 1);
      const goal = w.doctrine.override?.goal;
      expect(goal).toBeTruthy();
      expect(until(w, () => w.level.portals[door.portal].open && w.squad.leader.room === goal.room, 90)).toBe(true);
    }
    expect(tested).toBeGreaterThan(0);
  }, 120000);

  it('a nudged crate is searched even under "leave it" orders', () => {
    let tested = 0;
    for (const seed of ['A1', 'B2', 'C3', 'D4', 'E5']) {
      const w = new World(generateLevel(seed), { params: { god: true }, doctrine: { loot: 'leave' } });
      // Nothing hunting: a long fight on the way would outlast the order (it stands for 90 s).
      for (const a of [...w.aliens, ...w.critters]) { a.alive = false; w.physics.removeHitbox(a); }
      w.reserve = 0;
      w.director.hordeSize = 0;
      let crate = null;
      until(w, () => (crate = w.interactables().find((t) => t.kind === 'crate')), 120);
      if (!crate) continue;
      tested++;
      w.nudge(crate.id);
      const prop = w.level.rooms[crate.room].props.find((p) => p.id === crate.prop);
      expect(until(w, () => prop.searched, 120)).toBe(true);
    }
    expect(tested).toBeGreaterThan(0);
  }, 120000);

  it('a nudged fuel barrel is shot once nobody is in the blast', () => {
    let tested = 0;
    for (let i = 0; i < 40 && tested < 2; i++) {
      const w = new World(generateLevel(`BARREL${i}`, { mods: { barrels: 3 } }), { params: { god: true } });
      let barrel = null;
      until(w, () => (barrel = w.interactables().find((t) => t.kind === 'barrel')), 90);
      if (!barrel) continue;
      tested++;
      const b = w.props.find((p) => p.id === barrel.barrel);
      let blastHitSquad = false;
      w.on('explosion', ({ x, y }) => { if (w.squad.order.some((m) => Math.hypot(m.x - x, m.y - y) < 4.2)) blastHitSquad = true; });
      w.nudge(barrel.id);
      expect(until(w, () => !b.alive, 60)).toBe(true);
      expect(blastHitSquad).toBe(false);
    }
    expect(tested).toBeGreaterThan(0);
  }, 120000);

  it('the same nudges at the same moments replay identically', () => {
    const play = () => {
      const w = new World(generateLevel('A1'), { params: { god: true } });
      run(w, 25);
      const t = w.interactables().find((q) => q.kind === 'door' || q.kind === 'crate');
      w.nudge(t.id);
      run(w, 60);
      return digest(w);
    };
    expect(play()).toBe(play());
  }, 60000);
});
