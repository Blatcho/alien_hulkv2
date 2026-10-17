// Alien AI. States:
//   dormant  hidden and still - on the floor, or up on the ceiling or a bulkhead; wakes on
//            sight, footsteps, gunfire or being shot
//   vent     travelling inside the duct network (invisible; shows on the motion tracker)
//   emerge   dropping from a ceiling vent / crawling out of a wall vent
//   hunt     pathing to the nearest marine (vents + doors, which it can force open). In the
//            marines' room a climber may take the high road: up the nearest bulkhead (or a spring
//            straight up) and along the ceiling, to drop on them from above
//   spring   jumping from the floor onto the ceiling
//   drop     falling off the ceiling / a bulkhead onto (or next to) its prey
//   leap     pounce arc onto a marine on the same floor
//   attack   claw swipes while adjacent
//   scream   a screamer rearing up to scream (wakes the deck, calls more from the vents)
// Habits while hunting (config PACK): a climber goes over the squad for the rear man while a
// packmate keeps them busy (flank); one that woke unseen shadows the rear and strikes when they
// slip (stalk); a badly hurt one bolts for a vent and comes back healed (flee); a creeper backs
// off from torchlight (shy); one that reaches a man down may drag him off to a vent (drag); the
// brood mother births runners.
// Surfaces: an alien's (x, y) is where its feet are - on the floor, on the ceiling (y = the
// ceiling, hanging), or on a bulkhead (x = the wall's face; side -1 left wall, +1 right).
// Types (config ALIEN_TYPES) differ in size, speed, toughness, damage and their love of heights.
import { ABILITY, ALIEN, COVER, CRAWL, PACE, PACK, SCREAM, SPIT, SUPPRESS } from '../core/config.js';
import { walkLimits } from '../gen/layout.js';
import { ceilingSpans, wallFace } from '../gen/level.js';
import { alienSees, bodyPoint, inBeam } from '../vis/sight.js';
import { advance, portalPath } from './traverse.js';

const speedOf = (a) => (mode) => (mode === 'climb' ? ALIEN.CLIMB * (a.speed / ALIEN.SPEED) : mode === 'stairs' ? a.speed * 0.8 : mode === 'step' ? 3 : a.speed);
/** Claw reach: big ones reach further. */
const reach = (a) => ALIEN.ATTACK_RANGE + (a.scale - 1) * 0.6;
/** Where it holds off its prey's centre while striking / closing in. */
const standOff = (a) => 0.7 + 0.25 * a.scale;

const spans = new WeakMap();
/** The ceiling stretch above x in this room (between shafts and walls), or null over an opening. */
function ceilingAt(level, room, x) {
  if (!spans.has(room)) spans.set(room, ceilingSpans(level, room));
  return spans.get(room).find(([a, b]) => x >= a - 0.01 && x <= b + 0.01) ?? null;
}

/**
 * Can this alien actually reach its prey with a claw right now? Needs to be on the floor, a
 * clear line (closed doors, walls and floors block it) and roughly the same height - no strikes
 * through a door or up through a deck. Blocked aliens go back to hunting: path around, or force
 * the door.
 */
export function canReach(world, a, m) {
  if (a.surface && a.surface !== 'floor') return false;
  if (Math.abs(a.y - m.y) > 2.2) return false;
  return world.physics.los(a.x, a.y + 0.9, m.x, m.y + 1.0);
}

export function wake(world, a, reason) {
  if (a.state !== 'dormant' || !a.alive) return;
  a.state = 'hunt';
  a.wakeT = 0.55;
  a.repathT = 0;
  // Woken by footsteps or a noise, and nobody's seen it: some shadow the squad instead of charging.
  if (a.stalks > 0 && (reason === 'steps' || reason === 'noise') && !a.visible && world.hive.chance(a.stalks)) a.stalk = { t: 0 };
  world.emit('alien-wake', { alien: a, reason });
}

function nearestMarine(world, a) {
  // Picked out (flanking for the rear man, a stalker's mark): that one, while he's on his feet.
  const p = a.prey;
  if (p && p.alive && !p.down && world.squad.order.includes(p)) return p;
  a.prey = null;
  let best = null;
  let bestD = Infinity;
  const y = a.surface === 'floor' ? a.y : world.level.rooms[a.room].y0;
  const prey = [...world.squad.order, ...world.marines.filter((m) => m.alive && m.down && (!m.dragged || m.dragged === a)),
    ...(world.survivors ?? []).filter((s) => s.alive && s.state !== 'rescued')];
  for (const m of prey) {
    // A man down is easy prey, but one still fighting is the threat it goes for first.
    const d = Math.abs(m.x - a.x) + Math.abs(m.y - y) * 3 + (m.room === a.room ? 0 : 6) + (m.down ? 4 : 0);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

function sense(world, a) {
  // Up on a ceiling or a bulkhead it listens to the floor below it.
  const y = a.surface === 'floor' ? a.y : world.level.rooms[a.room].y0;
  for (const m of world.squad.order) {
    const d = Math.hypot(m.x - a.x, m.y - y);
    // In the dark (power out) they hear a long way.
    const hear = ALIEN.HEAR_STEPS * PACE.HEARING[world.squad.pace] * (world.level.rooms[a.room].powerOut ? 1.5 : 1) * (1 + (a.hear - 1) * 0.4);
    if (d < hear && m.moving && m.room === a.room) return wake(world, a, 'steps');
    if (d < 3.2) return wake(world, a, 'close');
    if (alienSees(world, a, m) && Math.abs(m.y - y) < 1) return wake(world, a, 'sight');
  }
  for (const n of world.noises) {
    if (Math.hypot(n.x - a.x, n.y - a.y) < n.r * a.hear) return wake(world, a, 'noise'); // runners come to gunfire from further off
  }
}

export function enterVent(world, a, fromVent, toVent) {
  const v0 = world.level.vents[fromVent];
  const v1 = world.level.vents[toVent];
  a.state = 'vent';
  a.surface = 'floor';
  a.vent = { from: fromVent, to: toVent, t: 0, dur: (Math.hypot(v1.x - v0.x, v1.y - v0.y) + 2) / ALIEN.VENT_SPEED };
  a.x = v0.x; a.y = v0.y;
  world.physics.setHitboxEnabled(a, false);
  world.emit('vent-enter', { alien: a, vent: v0 });
}

/** Back out of the ducts after licking its wounds: healed, and through a vent near the squad. */
function resurface(world, a) {
  a.hp = a.maxHp;
  a.flee = null;
  const lead = world.squad.leader;
  const near = lead ? world.director.ventsNear(lead.room, 0, 1) : [];
  const v = near.length ? world.hive.pick(near) : world.level.vents[a.vent.to];
  a.vent = { from: a.vent.to, to: v.id, t: 0, dur: 0 };
  world.emit('alien-return', { alien: a });
  emerge(world, a);
}

/** Into the ducts to lurk (fled, or with a man it dragged off): out again near the squad later. */
function lurk(world, a, v) {
  const out = v.links.filter((id) => !world.level.vents[id].welded);
  enterVent(world, a, v.id, out.length ? world.hive.pick(out) : v.id);
  a.vent.dur = world.hive.float(PACK.FLEE.LURK[0], PACK.FLEE.LURK[1]);
  a.vent.lurk = true;
  a.prey = null;
  a.stalk = null;
}

function emerge(world, a) {
  let v = world.level.vents[a.vent.to];
  if (v.welded) {
    // Welded shut while it crawled: out through another vent - or back into the dark.
    const open = world.level.vents.filter((o) => !o.welded);
    const near = open.filter((o) => v.links.includes(o.id));
    const next = near[0] ?? open.sort((p, q) => Math.abs(p.x - v.x) - Math.abs(q.x - v.x))[0];
    if (!next) { a.alive = false; world.physics.removeHitbox(a); world.reserve++; return; }
    a.vent = { from: v.id, to: next.id, t: 0, dur: (Math.hypot(next.x - v.x, next.y - v.y) + 2) / ALIEN.VENT_SPEED };
    return;
  }
  const room = world.level.rooms[v.room];
  a.room = v.room;
  a.x = v.x;
  a.vent = null;
  a.steps = null;
  world.physics.setHitboxEnabled(a, true);
  if (v.ceiling && a.climbs > 0 && ceilingAt(world.level, room, v.x) && world.crawl.chance(a.climbs)) {
    // A climber stays up there: out of the duct and along the ceiling.
    a.surface = 'ceiling';
    a.y = room.y1;
    a.z = a.lane;
    a.state = 'hunt';
    a.wakeT = 0.3;
    a.climbCool = world.crawl.float(CRAWL.COOL[0], CRAWL.COOL[1]);
  } else {
    a.surface = 'floor';
    a.y = v.ceiling ? v.y - 0.6 : room.y0;
    a.z = v.ceiling ? -0.6 : -1.7;
    a.state = 'emerge';
    a.emerge = { t: 0, dur: v.ceiling ? 0.45 : 0.6, y0: a.y, y1: room.y0, z0: a.z };
  }
  world.emit('vent-emerge', { alien: a, vent: v });
}

function followSteps(world, a, dt, target) {
  if (!a.steps || a.repathT <= 0) {
    a.repathT = ALIEN.REPATH;
    const r = world.nav.route({ room: a.room, x: a.x }, { room: target.room, x: target.x },
      { vents: true, speed: a.speed, blocked: (pid) => world.level.portals[pid].fire || world.level.portals[pid].welded }); // round a fire / a welded door, by the vents
    a.steps = r ? r.steps : null;
  }
  const step = a.steps?.[0];
  if (!step) return;
  const room = world.level.rooms[a.room];
  if (step.type === 'walk') {
    const d = step.x - a.x;
    const v = a.speed * dt;
    a.y = room.y0;
    const nx = Math.abs(d) <= v ? step.x : a.x + Math.sign(d) * v;
    if (overObstacle(world, a, nx)) return;
    if (Math.abs(d) <= v) { a.x = step.x; a.steps.shift(); } else a.x += Math.sign(d) * v;
    if (Math.abs(d) > 1e-3) a.facing = Math.sign(d);
    a.moving = true;
    a.mode = 'walk';
  } else if (step.type === 'portal') {
    const p = world.level.portals[step.portal];
    if (p.fire || p.welded) { a.steps = null; a.repathT = 0; return; } // it went up / got welded since: find another way
    // A doorway is a chokepoint: one at a time through it.
    if (p.kind === 'door' && world.aliens.some((o) => o !== a && o.alive && o.trav?.kind === 'door' && o.trav.portal === p.id)) { a.moving = false; return; }
    if (p.kind === 'door' && !p.open) {
      a.trav = { kind: 'force', t: 0, portal: p };
      world.emit('door-forced', { portal: p, alien: a });
      return;
    }
    a.trav = portalPath(world.level, p, a.room);
    a.steps.shift();
  } else if (step.type === 'vent') {
    a.steps.shift();
    enterVent(world, a, step.from, step.to);
  }
}

function stepTraversal(world, a, dt) {
  const tr = a.trav;
  if (tr.kind === 'force') {
    if (tr.portal.welded) { a.trav = null; a.steps = null; a.repathT = 0; return; } // welded in its face
    tr.t += dt;
    a.moving = false;
    if (tr.t > 1.1 / (a.force ?? 1)) { tr.portal.locked = false; world.setDoor(tr.portal, true, a); a.trav = null; } // (a lock doesn't survive it)
    return;
  }
  a.moving = true;
  const done = advance(a, tr, dt, speedOf(a));
  if (done) {
    a.trav = null;
    a.mode = 'walk';
    a.z = a.lane;
    a.room = tr.toRoom;
  }
}

function startLeap(world, a, m) {
  const dir = Math.sign(m.x - a.x) || 1;
  a.state = 'leap';
  a.leap = { x0: a.x, x1: m.x - dir * standOff(a), y: a.y, t: 0 };
  a.facing = dir;
  world.emit('alien-leap', { alien: a });
}

// ------------------------------------------------------------------ cover: vaulting, smashing

/**
 * About to step onto something on the walking line (debris, a beam, the squad's barricade)? Vault
 * it - a slow, exposed moment - or, a brute at a barricade, smash it. Returns true if it started.
 */
function overObstacle(world, a, nx) {
  if (a.surface !== 'floor') return false;
  const room = world.level.rooms[a.room];
  const dir = Math.sign(nx - a.x);
  if (!dir) return false;
  const ob = room.props.find((p) => p.obstacle && !p.destroyed
    && (dir > 0 ? a.x <= p.x0 - 0.15 && nx > p.x0 - 0.15 : a.x >= p.x1 + 0.15 && nx < p.x1 + 0.15));
  if (!ob) return false;
  if (ob.barricade && a.type === 'brute') {
    a.state = 'smash';
    a.smash = { t: 0, ob };
    a.facing = dir;
    return true;
  }
  const dur = ob.barricade ? COVER.VAULT.barricade : COVER.VAULT[ob.obstacle] ?? 0.6;
  a.state = 'vault';
  a.vault = { t: 0, dur: dur / Math.max(0.6, a.speed / ALIEN.SPEED), x0: a.x, x1: dir > 0 ? ob.x1 + 0.3 : ob.x0 - 0.3, y: room.y0, low: ob.obstacle === 'crouch' };
  a.facing = dir;
  world.emit('alien-vault', { alien: a, prop: ob });
  return true;
}

/**
 * A spitter with its prey in sight at range: keep the distance and spit. Too close - back off;
 * too far - close in (the caller's normal movement). Returns true if it took its turn here.
 */
function spitter(world, a, m, dx, dt) {
  // In sight on the same deck - through an open doorway too. Not at a man already down.
  if (!a.ranged || m.down || Math.abs(m.y - world.level.rooms[a.room].y0) > 1) return false;
  const head = a.surface === 'ceiling' ? a.y - a.height * 0.6 : a.y + a.height * 0.7;
  if (!world.physics.los(a.x, head, m.x, m.y + 1.2)) return false;
  const d = Math.abs(dx);
  a.facing = Math.sign(dx) || a.facing;
  if (d < SPIT.RANGE[0] && a.surface === 'floor') {
    const [wl, wr] = walkLimits(world.level.rooms[a.room]);
    const nx = Math.min(wr, Math.max(wl, a.x - Math.sign(dx) * a.speed * 0.8 * dt));
    if (Math.abs(nx - a.x) < 1e-4) return false; // backed into a wall: it fights
    a.x = nx;
    a.moving = true;
    return true;
  }
  if (d > SPIT.RANGE[1]) return false;
  a.spitT -= dt;
  if (a.spitT <= 0) {
    a.spitT = SPIT.EVERY;
    a.state = 'spit';
    a.spit = { t: 0, target: m };
  }
  return true;
}

// ------------------------------------------------------------------ walls and ceilings

/** Off the floor and up: a spring straight onto the ceiling. */
function startSpring(world, a) {
  const room = world.level.rooms[a.room];
  a.state = 'spring';
  a.spring = { t: 0, y0: a.y, y1: room.y1 };
  world.emit('alien-leap', { alien: a });
}

/** Let go of the ceiling / bulkhead: fall onto (or next to) `onto`, or just down. */
export function startDrop(world, a, onto = null) {
  if (a.surface === 'floor' || !a.alive) return;
  const room = world.level.rooms[a.room];
  const [wl, wr] = walkLimits(room);
  const x1 = a.surface === 'wall' ? a.x - a.side * 0.9 : a.x; // off a bulkhead: out into the room
  a.drop = { t: 0, x0: a.x, y0: a.y, x1: Math.min(wr, Math.max(wl, x1)), y1: room.y0 };
  a.state = 'drop';
  a.toWall = 0;
  world.emit('alien-drop', { alien: a, onto });
}

/**
 * Worth taking the high road to this prey? A climber far enough from it, now and then, if one
 * stretch of ceiling runs from here to above the prey. Then: over to a bulkhead close by and up
 * it - or a spring straight up.
 */
function highRoad(world, a, m, dx) {
  if (a.climbs <= 0 || a.climbCool > 0 || Math.abs(dx) < CRAWL.MIN_DX) return false;
  a.climbCool = world.crawl.float(CRAWL.COOL[0], CRAWL.COOL[1]);
  if (!world.crawl.chance(a.climbs)) return false;
  const room = world.level.rooms[a.room];
  const span = ceilingAt(world.level, room, a.x);
  if (!span || m.x < span[0] || m.x > span[1]) return false; // a stairwell or shaft in between
  goUp(world, a, room, span);
  return true;
}

/** Up: over to a bulkhead close by (door frame and all) and up it - or a spring straight up. */
function goUp(world, a, room, span) {
  for (const side of [-1, 1]) {
    const face = wallFace(room, side);
    if (Math.abs(face - a.x) < CRAWL.WALL_REACH && face >= span[0] - 0.01 && face <= span[1] + 0.01) { a.toWall = side; return; }
  }
  startSpring(world, a);
}

// ------------------------------------------------------------------ pack habits

/**
 * Flanking: a packmate is already closing on the squad from this side, so this one goes over
 * them on the ceiling for the man at the far end of the line.
 */
function flank(world, a, m, dx) {
  if (a.climbs <= 0 || a.climbCool > 0 || a.prey) return false;
  const side = Math.sign(dx);
  const mate = world.aliens.some((o) => o !== a && o.alive && o.room === a.room && o.surface === 'floor' && !o.stalk && !o.flee
    && (o.state === 'hunt' || o.state === 'attack' || o.state === 'leap') && Math.sign(m.x - o.x) === side && Math.abs(m.x - o.x) < Math.abs(dx));
  if (!mate) return false;
  let far = null;
  for (const o of world.squad.order) {
    if (o.room === a.room && (o.mode === 'walk' || o.mode === 'crouch') && (!far || Math.abs(o.x - a.x) > Math.abs(far.x - a.x))) far = o;
  }
  if (!far || Math.abs(far.x - m.x) < PACK.FLANK.DX) return false;
  const room = world.level.rooms[a.room];
  const span = ceilingAt(world.level, room, a.x);
  a.climbCool = world.crawl.float(CRAWL.COOL[0], CRAWL.COOL[1]);
  if (!span || far.x < span[0] || far.x > span[1] || !world.hive.chance(Math.min(1, a.climbs * 1.5))) return false;
  a.prey = far;
  goUp(world, a, room, span);
  world.emit('flank', { alien: a, marine: far });
  return true;
}

/**
 * Stalking: shadow the rear man from DIST back, out of sight - and close the moment the squad
 * slips: a man near it reloading, a gap in the line, being seen or hurt, or its patience gone.
 * Returns true while it's still only shadowing.
 */
function stalk(world, a, dt) {
  const s = a.stalk;
  s.t += dt;
  const line = world.squad.order;
  const rear = line[line.length - 1];
  if (!rear) { a.stalk = null; return false; }
  let mark = line.find((o) => o.reloadT > 0 && Math.hypot(o.x - a.x, o.y - a.y) < PACK.STALK.NEAR);
  // A scout's eyes: nothing shadows the squad close to him without being picked out.
  const scout = line.find((o) => o.role === 'scout' && Math.hypot(o.x - a.x, o.y - a.y) < ABILITY.SPOT && world.physics.los(o.x, o.y + 1.6, a.x, a.y + 0.8));
  if (!mark && scout) {
    world.emit('stalker-spotted', { alien: a, marine: scout });
    world.barks.say(scout, 'spotted');
    mark = rear;
  }
  for (let i = 1; !mark && i < line.length; i++) if (line[i - 1].s - line[i].s > PACK.STALK.GAP) mark = line[i];
  if (!mark && (a.visible || a.hp < a.maxHp || s.t > PACK.STALK.PATIENCE)) mark = rear;
  if (mark) {
    a.stalk = null;
    a.prey = mark;
    a.repathT = 0;
    world.emit('stalker', { alien: a, marine: mark });
    return false;
  }
  if (a.room === rear.room && Math.abs(rear.x - a.x) <= PACK.STALK.DIST) {
    a.facing = Math.sign(rear.x - a.x) || a.facing; // still, watching
    return true;
  }
  followSteps(world, a, dt, rear); // after them: through the doors, the vents
  return true;
}

/** In a torch beam? (Or a flare's glare - the squad's kit.) */
export function lit(world, a) {
  const room = world.level.rooms[a.room];
  if (room.flare) return true;
  if (!world.settings.flashlight) return false;
  const c = bodyPoint(a, 0.5);
  return world.squad.order.some((o) => o.room === a.room && Math.abs(c.x - o.x) < PACK.SHY.RANGE && inBeam(o, c.x, c.y));
}

/**
 * Torch-shy: held in a beam it won't come on - it goes up out of the light if it can, or backs
 * off into the dark - for a few seconds, then it's past caring. Returns true if it took its turn.
 */
function shy(world, a, m, dx, dt) {
  if (Math.abs(dx) < reach(a) + 1.2 || !lit(world, a)) { a.shyT = Math.max(0, a.shyT - dt); return false; }
  a.shyT += dt;
  if (a.shyT > PACK.SHY.BRAVE) return false;
  if (!a.shied) { a.shied = true; world.emit('alien-shy', { alien: a }); }
  const room = world.level.rooms[a.room];
  if (a.climbs > 0 && a.climbCool <= 0) {
    a.climbCool = world.crawl.float(CRAWL.COOL[0], CRAWL.COOL[1]);
    const span = ceilingAt(world.level, room, a.x);
    if (span && m.x >= span[0] && m.x <= span[1]) { goUp(world, a, room, span); return true; }
  }
  const [wl, wr] = walkLimits(room);
  const nx = Math.min(wr, Math.max(wl, a.x - Math.sign(dx) * a.speed * 0.6 * dt));
  a.facing = Math.sign(dx) || a.facing; // backing off, still facing the light
  a.moving = Math.abs(nx - a.x) > 1e-4;
  a.x = nx;
  return true;
}

/** Hit and run: badly hurt, it bolts for the nearest open vent (this room or next door). */
export function bolt(world, a) {
  let best = null;
  let bestD = Infinity;
  for (const v of world.director.ventsNear(a.room, 0, 1)) {
    const d = Math.abs(v.x - a.x) + (v.room === a.room ? 0 : 8);
    if (d < bestD) { bestD = d; best = v; }
  }
  if (!best) return false;
  a.flee = { vent: best.id };
  a.state = 'hunt';
  a.attackT = 0;
  a.stalk = null;
  a.prey = null;
  a.toWall = 0;
  a.steps = null;
  a.repathT = 0;
  world.emit('alien-flee', { alien: a });
  return true;
}

function flee(world, a, dt) {
  const v = world.level.vents[a.flee.vent];
  if (v.welded) { a.flee = null; return; } // welded in its face: cornered, it fights
  if (a.room === v.room && Math.abs(a.x - v.x) < 0.5) { lurk(world, a, v); return; }
  followSteps(world, a, dt * 1.15, { room: v.room, x: v.x });
}

/**
 * Reached a man down: rather than finish him, it may drag him off to a floor-level vent in the
 * room. Returns true if it took hold of him.
 */
export function startDrag(world, a, m) {
  let v = null;
  for (const o of world.level.vents) {
    if (o.room === m.room && !o.ceiling && !o.welded && (!v || Math.abs(o.x - m.x) < Math.abs(v.x - m.x))) v = o;
  }
  if (!v || !world.hive.chance(a.drags)) return false;
  a.drag = { m, vent: v.id, hurt: 0 };
  m.dragged = a;
  a.state = 'hunt';
  a.attackT = 0;
  a.prey = null;
  a.stalk = null;
  world.emit('dragged', { alien: a, marine: m });
  return true;
}

/** Lets go of the man it was dragging (shot, or he's no longer there to drag). */
export function letGo(world, a) {
  const m = a.drag?.m;
  a.drag = null;
  if (!m) return;
  m.dragged = null;
  world.emit('drag-dropped', { alien: a, marine: m });
}

function drag(world, a, dt) {
  const { m } = a.drag;
  const v = world.level.vents[a.drag.vent];
  if (!m.alive || !m.down || m.room !== a.room || v.welded) { letGo(world, a); return; }
  const room = world.level.rooms[a.room];
  const [wl, wr] = walkLimits(room);
  const gx = Math.min(wr, Math.max(wl, v.x));
  const dir = Math.sign(gx - m.x) || a.facing;
  a.facing = dir;
  a.moving = true;
  // First round to the vent side of him to get a grip; then haul him along behind it.
  const grip = Math.min(wr, Math.max(wl, m.x + dir * 0.9));
  if (Math.abs(grip - a.x) > 0.15) { a.x += Math.sign(grip - a.x) * Math.min(a.speed * dt, Math.abs(grip - a.x)); return; }
  m.x += dir * Math.min(a.speed * PACK.DRAG.SPEED * dt, Math.abs(gx - m.x));
  a.x = Math.min(wr, Math.max(wl, m.x + dir * 0.9));
  if (Math.abs(gx - m.x) > 0.05) return;
  // Into the duct with him.
  a.drag = null;
  m.dragged = null;
  world.taken(m, a);
  lurk(world, a, v);
}

/** The screamer: once it knows where they are, it rears up and screams (updateAlien 'scream'). */
function scream(world, a, m) {
  if (a.screamed >= SCREAM.MAX || a.screamT > 0) return false;
  if (m.room !== a.room && !alienSees(world, a, m)) return false;
  a.state = 'scream';
  a.scream = { t: 0, hurt: 0 };
  a.facing = Math.sign(m.x - a.x) || a.facing;
  world.attackedAt = world.time; // it's seen them: weapons free, even on cautious - cut it off
  world.emit('scream-start', { alien: a });
  return true;
}

/** Scuttle over to the bulkhead it picked, then onto it. */
function toWall(world, a, room, dt) {
  const [wl, wr] = walkLimits(room);
  const edge = a.toWall < 0 ? wl : wr;
  const d = edge - a.x;
  const v = a.speed * dt;
  a.facing = a.toWall;
  a.moving = true;
  if (Math.abs(d) > v) { a.x += Math.sign(d) * v; return; }
  a.surface = 'wall';
  a.side = a.toWall;
  a.toWall = 0;
  a.x = wallFace(room, a.side);
  a.y = room.y0 + 0.2;
  world.emit('alien-climb', { alien: a });
}

/**
 * On a bulkhead: head up it and over onto the ceiling (or let go onto prey right below).
 * On the ceiling: stalk the prey from above and drop on it; prey gone from the room, or the
 * ceiling ends before it - come down.
 */
function crawl(world, a, m, dt) {
  const room = world.level.rooms[a.room];
  if (a.flee) { startDrop(world, a); return; } // down, and away
  const prey = m.room === a.room && (m.mode === 'walk' || m.mode === 'crouch');
  if (a.surface === 'wall') {
    if (!prey || Math.abs(m.x - a.x) < 2.2) { startDrop(world, a, prey ? m : null); return; }
    a.facing = a.side; // head first, up the wall
    a.moving = true;
    a.y += a.speed * CRAWL.WALL * dt;
    if (a.y >= room.y1) { a.y = room.y1; a.surface = 'ceiling'; a.facing = -a.side; }
    return;
  }
  const span = ceilingAt(world.level, room, a.x);
  if (!span || !prey) { startDrop(world, a); return; }
  if (spitter(world, a, m, m.x - a.x, dt)) return;
  if (Math.abs(m.x - a.x) < standOff(a) + 0.35) { startDrop(world, a, m); return; }
  const gx = Math.min(span[1] - 0.3, Math.max(span[0] + 0.3, m.x));
  const d = gx - a.x;
  if (Math.abs(d) < 0.05) { startDrop(world, a, m); return; } // as close as the ceiling goes
  const v = a.speed * CRAWL.CEILING * dt;
  a.x += Math.sign(d) * Math.min(v, Math.abs(d));
  a.facing = Math.sign(d);
  a.moving = true;
}

/** Shot dead up there: it peels off and falls. */
function fall(world, a, dt) {
  const room = world.level.rooms[a.room];
  if (a.surface === 'wall') a.x -= a.side * 0.8;
  a.surface = 'floor';
  a.drop = null;
  a.spring = null;
  a.vy = (a.vy ?? 0) - 20 * dt;
  a.y = Math.max(room.y0, a.y + a.vy * dt);
  if (a.y <= room.y0) a.falling = false;
}

// ------------------------------------------------------------------ update

export function updateAlien(world, a, dt) {
  if (!a.alive) {
    a.deadT += dt;
    a.falling ??= a.surface !== 'floor' || !!a.drop || !!a.spring;
    if (a.falling) fall(world, a, dt);
    return;
  }
  a.staggerT = Math.max(0, a.staggerT - dt);
  a.suppressT = Math.max(0, a.suppressT - dt);
  // Staggered by a hit: slower to move and swing. Pinned down by sustained fire (combat drills):
  // slower to move (and no pouncing) - but its claws are as quick as ever.
  const slow = a.staggerT > 0 ? 0.25 : 1;
  const pinned = a.suppressT > SUPPRESS.MIN ? SUPPRESS.SLOW : 1;
  a.moving = false;
  const high = a.surface !== 'floor';

  switch (a.state) {
    case 'dormant':
      a.anim = 'lurk';
      if ((world.tick + a.id) % 6 === 0) sense(world, a);
      return;
    case 'vent':
      a.vent.t += dt;
      if (a.vent.t >= a.vent.dur) { if (a.vent.lurk) resurface(world, a); else emerge(world, a); }
      return;
    case 'emerge': {
      const e = a.emerge;
      e.t += dt;
      const k = Math.min(1, e.t / e.dur);
      a.y = e.y0 + (e.y1 - e.y0) * k * k;
      a.z = e.z0 + (a.lane - e.z0) * k;
      a.anim = 'leap';
      if (k >= 1) { a.state = 'hunt'; a.y = e.y1; a.emerge = null; }
      return;
    }
    case 'leap': {
      const l = a.leap;
      l.t += dt;
      const k = Math.min(1, l.t / ALIEN.LEAP_TIME);
      a.x = l.x0 + (l.x1 - l.x0) * k;
      a.y = l.y + 4 * 1.0 * k * (1 - k);
      a.anim = 'leap';
      a.moving = true;
      if (k >= 1) { a.y = l.y; a.state = 'attack'; a.attackT = a.attackTime * 0.55; a.leap = null; }
      return;
    }
    case 'spring': {
      const s = a.spring;
      s.t += dt;
      const k = Math.min(1, s.t / CRAWL.SPRING);
      a.y = s.y0 + (s.y1 - s.y0) * (1 - (1 - k) * (1 - k));
      if (k > 0.5) a.surface = 'ceiling'; // flips over in the air
      a.anim = 'leap';
      a.moving = true;
      if (k >= 1) { a.y = s.y1; a.surface = 'ceiling'; a.state = 'hunt'; a.spring = null; }
      return;
    }
    case 'vault': {
      const v = a.vault;
      v.t += dt;
      const k = Math.min(1, v.t / v.dur);
      a.x = v.x0 + (v.x1 - v.x0) * k;
      a.y = v.y + (v.low ? 0 : Math.sin(Math.PI * k) * 0.9);
      a.anim = v.low ? 'skitter' : 'leap';
      a.moving = true;
      if (k >= 1) { a.state = 'hunt'; a.y = v.y; a.vault = null; a.steps = null; a.repathT = 0; }
      return;
    }
    case 'smash': {
      const s = a.smash;
      s.t += dt;
      a.anim = 'attack';
      if (s.ob.destroyed || s.t >= COVER.SMASH) { world.breakBarricade(s.ob); a.state = 'hunt'; a.smash = null; }
      return;
    }
    case 'scream': {
      const s = a.scream;
      s.t += dt;
      a.anim = 'scream';
      if (s.t >= SCREAM.WINDUP) {
        a.state = 'hunt';
        a.scream = null;
        a.screamed++;
        a.screamT = SCREAM.EVERY;
        world.scream(a);
      }
      return;
    }
    case 'spit': {
      const s = a.spit;
      s.t += dt;
      a.anim = 'attack';
      if (s.t >= SPIT.WINDUP) {
        if (s.target.alive) world.spit(a, s.target);
        a.state = 'hunt';
        a.spit = null;
      }
      return;
    }
    case 'drop': {
      const d = a.drop;
      d.t += dt;
      const k = Math.min(1, d.t / CRAWL.DROP);
      a.x = d.x0 + (d.x1 - d.x0) * k;
      a.y = d.y0 + (d.y1 - d.y0) * k * k;
      if (k > 0.35) a.surface = 'floor'; // twists round to land on its feet
      a.anim = 'leap';
      a.moving = true;
      if (k >= 1) {
        a.y = d.y1;
        a.surface = 'floor';
        a.drop = null;
        a.climbCool = world.crawl.float(CRAWL.COOL[0], CRAWL.COOL[1]);
        const m = nearestMarine(world, a);
        const close = m && Math.hypot(m.x - a.x, m.y - a.y) < reach(a) + 0.8 && canReach(world, a, m);
        a.state = close ? 'attack' : 'hunt';
        a.attackT = a.attackTime * 0.6; // lands swinging
        a.repathT = 0;
      }
      return;
    }
    default:
  }

  if (a.wakeT > 0) { a.wakeT -= dt; a.anim = high ? 'lurk' : 'idle'; return; }
  if (a.births) world.birth(a, dt); // the brood mother: hunting or fighting, she keeps birthing
  const m = nearestMarine(world, a);
  if (!m) { a.anim = high ? 'lurk' : 'idle'; return; }
  a.target = m;
  const dx = m.x - a.x;
  const dist = Math.hypot(dx, m.y - a.y);

  if (a.state === 'attack') {
    if (dist > reach(a) + 0.9 || !canReach(world, a, m)) { a.state = 'hunt'; a.repathT = 0; return; }
    a.facing = Math.sign(dx) || a.facing;
    // Hold a striking position just in front of the target.
    const want = m.x - a.facing * standOff(a);
    const v = a.speed * 0.5 * dt;
    if (Math.abs(want - a.x) > v) a.x += Math.sign(want - a.x) * v; else a.x = want;
    if (m.mode === 'walk' || m.mode === 'crouch') a.y = m.y;
    a.anim = 'attack';
    a.attackT += dt * slow;
    if (a.attackT >= a.attackTime) {
      a.attackT = 0;
      world.alienStrike(a, m);
    }
    return;
  }

  hunt(world, a, m, dx, dist, dt, slow * pinned);
  a.anim = a.trav?.kind === 'force' ? 'attack' : a.mode === 'climb' ? 'climb' : a.moving ? 'skitter' : a.surface !== 'floor' ? 'lurk' : 'idle';
}

function hunt(world, a, m, dx, dist, dt, slow) {
  if (a.trav) { stepTraversal(world, a, dt * slow); return; }
  if (a.surface !== 'floor') { crawl(world, a, m, dt * slow); return; }
  a.repathT -= dt;
  a.climbCool -= dt;
  a.screamT -= dt;
  if (a.drag) { drag(world, a, dt * slow); return; }
  if (a.flee) { flee(world, a, dt * slow); return; }
  if (a.screams && scream(world, a, m)) return;
  if (a.stalk && stalk(world, a, dt * slow)) return;
  const room = world.level.rooms[a.room];
  const sameFloor = m.room === a.room && Math.abs(m.y - a.y) < 0.4 && (m.mode === 'walk' || m.mode === 'crouch');
  if ((m.mode === 'walk' || m.mode === 'crouch') && spitter(world, a, m, dx, dt)) return; // fire doesn't stop it spitting
  if (dist < reach(a) + 0.2 && canReach(world, a, m)) { a.state = 'attack'; a.attackT = a.attackTime * 0.4; a.toWall = 0; return; }
  if (sameFloor && a.toWall) { toWall(world, a, room, dt * slow); return; }
  if (sameFloor && a.shy && shy(world, a, m, dx, dt * slow)) return;
  if (sameFloor && flank(world, a, m, dx)) return;
  if (sameFloor && a.leapRange > 0 && a.suppressT <= SUPPRESS.MIN && Math.abs(dx) < a.leapRange && Math.abs(dx) > 2.2 && world.physics.los(a.x, a.y + 0.8, m.x, m.y + 1)) {
    startLeap(world, a, m);
    return;
  }
  if (sameFloor && highRoad(world, a, m, dx)) return;
  if (sameFloor) {
    const [wl, wr] = walkLimits(room);
    const v = a.speed * dt * slow;
    const nx = Math.min(wr, Math.max(wl, a.x + Math.sign(dx) * Math.min(v, Math.abs(dx) - standOff(a))));
    if (overObstacle(world, a, nx)) return;
    a.x = nx;
    a.facing = Math.sign(dx) || a.facing;
    a.moving = true;
    a.steps = null;
    a.z += (a.lane - a.z) * Math.min(1, dt * 4);
    return;
  }
  a.toWall = 0;
  // Marine on a ladder/stairs right next to us: strike from below/above.
  if (dist < 1.8 && canReach(world, a, m)) { a.state = 'attack'; return; }
  followSteps(world, a, dt * slow, m);
  a.z += (a.lane - a.z) * Math.min(1, dt * 4);
}
