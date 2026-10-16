// Whole-ship walkability: a navigation agent with the same physics as the characters walks from
// the airlock to the bridge (the log) and back to the airlock, on many seeds, within a time budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateShip, TILE } from '../src/gen/Ship.js';
import { World } from '../src/world/World.js';
import { Physics, Body } from '../src/core/Physics.js';
import { NavAgent, walk } from '../src/systems/Nav.js';

function walkTo(ship, world, physics, body, goal, budget = 240) {
  const nav = new NavAgent(world, physics);
  nav.setGoal(goal.x, goal.y, goal.room);
  const dt = 1 / 120;
  let t = 0;
  let best = Infinity;
  while (t < budget) {
    world.update(dt);
    const it = nav.update(body, dt);
    // open doors near the walker the way characters do
    for (const d of world.doors) if (Math.abs(d.x - body.x) < 44 && body.y >= d.y - 40 && body.y <= d.y + 70) world.requestOpen(d, 0.5);
    walk(body, it, dt, physics, { speed: 200, climb: 140 });
    t += dt;
    const d = Math.hypot(body.x - goal.x, body.y - goal.y);
    best = Math.min(best, d);
    if (d < 24 && body.onGround) return { ok: true, t };
    assert.ok(body.y > -10 && body.y < ship.H * TILE + 10, `walker left the ship at ${body.x},${body.y}`);
  }
  return { ok: false, t, best, at: [Math.round(body.x), Math.round(body.y)], room: world.roomIdAt(body.x, body.y + 4), goalRoom: goal.room, path: nav.path };
}

for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 33, 77, 1234, 99999]) {
  test(`seed ${seed}: airlock -> bridge log -> airlock`, () => {
    const ship = generateShip({ seed });
    const world = new World(ship);
    const physics = new Physics(ship, world);
    const body = new Body(ship.start.x, ship.start.y, 20, 58);
    const objective = { x: ship.objective.x, y: ship.objective.y, room: ship.objective.room };
    const r1 = walkTo(ship, world, physics, body, objective);
    assert.ok(r1.ok, `could not reach the bridge: ${JSON.stringify(r1)}`);
    const r2 = walkTo(ship, world, physics, body, { x: ship.start.x, y: ship.start.y, room: ship.start.room });
    assert.ok(r2.ok, `could not return to the airlock: ${JSON.stringify(r2)}`);
    // every survivor is reachable too
    for (const s of ship.survivors) {
      const r = walkTo(ship, world, physics, body, { x: s.x, y: s.y, room: s.room }, 200);
      assert.ok(r.ok, `could not reach survivor ${s.name}: ${JSON.stringify(r)}`);
    }
  });
}
