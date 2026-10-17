// Neutral vermin: wander their room, bolt away from marines. A squad on NORMAL (fire on
// anything that moves) shoots them - wasting ammo and making noise that wakes the real threat.
import { CRITTER } from '../core/config.js';
import { walkLimits } from '../gen/layout.js';

export function updateCritter(world, c, dt) {
  if (!c.alive) { c.deadT += dt; return; }
  const room = world.level.rooms[c.room];
  const [wl, wr] = walkLimits(room);
  let speed = CRITTER.SPEED;
  let threat = null;
  for (const m of world.squad.order) {
    if (m.room === c.room && Math.abs(m.x - c.x) < CRITTER.FLEE) { threat = m; break; }
  }
  if (threat) {
    c.goalX = threat.x > c.x ? wl : wr;
    speed = CRITTER.SPEED * 2.2;
    c.waitT = 0;
  } else if (c.waitT > 0) {
    c.waitT -= dt;
    c.moving = false;
    c.anim = 'idle';
    return;
  }
  const d = c.goalX - c.x;
  const v = speed * dt;
  if (Math.abs(d) <= v) {
    c.x = c.goalX;
    c.goalX = world.rng.float(wl, wr);
    c.waitT = world.rng.float(0.5, 4);
    c.moving = false;
  } else {
    c.x += Math.sign(d) * v;
    c.facing = Math.sign(d);
    c.moving = true;
  }
  c.y = room.y0;
  c.anim = c.moving ? 'scurry' : 'idle';
}
