// Who can see whom. One rule set for gameplay AND rendering, so the player sees exactly
// what the marines see: a 360-degree awareness radius plus a forward flashlight cone,
// both blocked by walls and closed doors (Rapier raycast).
import { FLARE, SIGHT, ALIEN } from '../core/config.js';

export function eye(m) {
  const crouched = m.anim?.startsWith('crouch');
  return { x: m.x + m.facing * 0.15, y: m.y + (crouched ? 1.15 : 1.65) * (m.scale ?? 1) };
}

/** Flashlight reach: a scoped weapon (marksman) sees further down its cone. */
export function coneRange(m) {
  return (m.weapon?.sight ?? SIGHT.CONE_RANGE) + (m.mods?.sight ?? 0);
}

/** 360-degree awareness radius: Perception widens it; a room with its power out shrinks it. */
export function aura(m, dark = false) {
  return (SIGHT.AURA + (m.mods?.aura ?? 0)) * (dark ? SIGHT.POWERLESS_AURA : 1);
}

/** How far a trooper sees all round in his room: Perception; power out shrinks it, a flare widens it. */
export function roomAura(m, room) {
  return room?.flare ? aura(m) * FLARE.AURA : aura(m, room?.powerOut);
}

/** Flashlight cone/aura test without the raycast. `glare` widens the aura (a flare's light). */
export function inView(m, tx, ty, flashlight, dark = false, glare = 1) {
  const e = eye(m);
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  if (d < aura(m, dark) * glare) return true;
  if (m.mode === 'climb' || (m.mode === 'step' && Math.abs(m.z) > 1.25)) return false; // facing the ladder (not stairs)
  return inBeam(m, tx, ty, flashlight ? coneRange(m) : SIGHT.DARK_CONE_RANGE);
}

/** In the cone itself (the torch beam - not the awareness radius), out to `range`? */
export function inBeam(m, tx, ty, range = coneRange(m)) {
  if (m.mode === 'climb') return false;
  const e = eye(m);
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  if (d > range || d < 1e-6) return false;
  // The cone points where the weapon/torch does: facing, pitched up or down (awareness.js).
  const p = m.pitch ?? 0;
  const cos = (dx * m.facing * Math.cos(p) + dy * Math.sin(p)) / d;
  return cos > Math.cos(SIGHT.CONE_HALF * Math.PI / 180);
}

/**
 * A point `k` of the way up an entity's body, from the surface it stands on: up from the floor,
 * down from the ceiling, out from a bulkhead (aliens crawl on all three - sim/alien.js).
 * Sight, aim and hitboxes all use it.
 */
export function bodyPoint(t, k = 0.55) {
  const h = (t.height ?? 1) * k;
  if (t.surface === 'ceiling') return { x: t.x, y: t.y - h };
  if (t.surface === 'wall') return { x: t.x - t.side * h, y: t.y };
  return { x: t.x, y: t.y + h };
}

/** Can marine m see entity t? */
export function canSee(world, m, t) {
  if (!m.alive) return false;
  const { x: tx, y: ty } = bodyPoint(t);
  const room = world.level.rooms[m.room];
  if (!inView(m, tx, ty, world.settings.flashlight, room?.powerOut && !room.flare, room?.flare ? FLARE.AURA : 1)) return false;
  const e = eye(m);
  return world.physics.los(e.x, e.y, tx, ty);
}

/** Can alien a notice marine m? Flashlights give the squad away from further off. */
export function alienSees(world, a, m) {
  const range = (world.settings.flashlight ? ALIEN.SIGHT : ALIEN.SIGHT * 0.5) * (world.relics?.has('hive_scent') ? 0.67 : 1); // (meta/relics.js)
  const head = bodyPoint(a, 0.65);
  const d = Math.hypot(m.x - head.x, m.y + 1.5 - head.y);
  if (d > range) return false;
  return world.physics.los(head.x, head.y, m.x, m.y + 1.5);
}
