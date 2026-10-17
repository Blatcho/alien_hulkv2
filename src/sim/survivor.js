// Stranded crew. States:
//   hiding     cowering in a corner (not moving - safe even from a trigger-happy squad)
//   fleeing    panicking when fighting gets close; RUNNING, and while unidentified a squad on
//              NORMAL ("fire on anything that moves") may gun them down
//   greeting   identified by the squad: waves, then
//   evacuating makes their own way back to the boarding ship along the nav graph
//   rescued    reached the ship - paid out at the end of a successful run
import { walkLimits } from '../gen/layout.js';
import { advance, portalPath } from './traverse.js';

export const SURVIVOR = { HP: 45, WALK: 1.7, RUN: 3.3, IDENTIFY: 6, PANIC: 10 };

const speedOf = (mode) => (mode === 'climb' ? 1.2 : mode === 'step' ? 1.4 : SURVIVOR.RUN * 0.8);

function nearestAwakeAlien(world, s) {
  let best = null;
  let bestD = Infinity;
  for (const a of world.aliens) {
    if (!a.alive || a.state === 'dormant' || a.state === 'vent') continue;
    const d = Math.hypot(a.x - s.x, a.y - s.y);
    if (d < bestD) { bestD = d; best = a; }
  }
  return { alien: best, d: bestD };
}

export function updateSurvivor(world, s, dt) {
  if (!s.alive || s.state === 'rescued') return;
  s.moving = false;
  const room = world.level.rooms[s.room];

  // Identification: a trooper gets close enough to see it's a person.
  if (!s.identified) {
    for (const m of world.squad.order) {
      const d = Math.hypot(m.x - s.x, m.y - s.y);
      if (d < SURVIVOR.IDENTIFY && world.physics.los(m.x, m.y + 1.5, s.x, s.y + 1.2)) {
        s.identified = true;
        s.state = 'greeting';
        s.stateT = 1.6;
        world.emit('survivor-found', { survivor: s, marine: m });
        world.emit('bark', { marine: m, text: 'Survivor! Hold your fire!' });
        world.emit('bark', { marine: s, text: 'Don\'t shoot! Please - get me out of here!' });
        break;
      }
    }
  }

  switch (s.state) {
    case 'hiding': {
      s.anim = 'cower';
      const { d } = nearestAwakeAlien(world, s);
      if (d < SURVIVOR.PANIC || world.noises.some((n) => Math.hypot(n.x - s.x, n.y - s.y) < 12 && world.rng.chance(0.02))) {
        s.state = 'fleeing';
        s.stateT = world.rng.float(2.5, 4.5);
        s.fleeDir = world.rng.chance(0.5) ? 1 : -1;
      }
      return;
    }
    case 'fleeing': {
      const { alien, d } = nearestAwakeAlien(world, s);
      if (alien && d < SURVIVOR.PANIC && alien.room === s.room) s.fleeDir = Math.sign(s.x - alien.x) || s.fleeDir;
      const [wl, wr] = walkLimits(room);
      const nx = s.x + s.fleeDir * SURVIVOR.RUN * dt;
      if (nx < wl || nx > wr) s.fleeDir = -s.fleeDir;
      else { s.x = nx; s.moving = true; }
      s.facing = s.fleeDir;
      s.anim = 'run';
      s.stateT -= dt;
      if (s.stateT <= 0 && d > SURVIVOR.PANIC) s.state = s.identified ? 'evacuating' : 'hiding';
      return;
    }
    case 'greeting':
      s.anim = 'wave';
      s.stateT -= dt;
      if (s.stateT <= 0) s.state = 'evacuating';
      return;
    case 'evacuating': {
      evacuate(world, s, dt);
      return;
    }
    default:
  }
}

function evacuate(world, s, dt) {
  const L = world.level;
  const home = L.dock ?? L.airlock;
  if (s.room === home) {
    s.state = 'rescued';
    s.visible = false;
    world.physics.setHitboxEnabled(s, false);
    world.emit('survivor-rescued', { survivor: s });
    return;
  }
  if (s.trav) {
    s.moving = true;
    s.anim = s.mode === 'climb' ? 'walk' : 'run';
    if (advance(s, s.trav, dt, speedOf)) {
      s.room = s.trav.toRoom;
      s.trav = null;
      s.mode = 'walk';
      s.z = s.lane;
    }
    return;
  }
  if (!s.steps || (s.repathT -= dt) <= 0) {
    s.repathT = 1;
    const target = L.rooms[home];
    const r = world.nav.route({ room: s.room, x: s.x }, { room: home, x: (target.x0 + target.x1) / 2 }, { speed: SURVIVOR.RUN });
    s.steps = r?.steps ?? null;
  }
  const step = s.steps?.[0];
  if (!step) { s.anim = 'idle'; return; }
  if (step.type === 'walk') {
    const d = step.x - s.x;
    const v = SURVIVOR.RUN * 0.8 * dt;
    if (Math.abs(d) <= v) { s.x = step.x; s.steps.shift(); } else s.x += Math.sign(d) * v;
    if (Math.abs(d) > 1e-3) s.facing = Math.sign(d);
    s.y = L.rooms[s.room].y0;
    s.moving = true;
    s.anim = 'run';
  } else if (step.type === 'portal') {
    const p = L.portals[step.portal];
    if (p.kind === 'door' && !p.open) world.setDoor(p, true, s); // crew know the door codes
    s.trav = portalPath(L, p, s.room);
    s.steps.shift();
  } else s.steps.shift();
}
