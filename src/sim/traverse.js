// Scripted traversals as polylines: doors, ladders, stairs, jumps, crouch-passes.
// Each point's `mode` describes the segment arriving at it (same convention as Trail).
import { WORLD, SQUAD } from '../core/config.js';
import { portalEnds } from '../gen/level.js';

export function portalPath(level, p, fromRoom) {
  const ends = portalEnds(level, p);
  const toRoom = p.a === fromRoom ? p.b : p.a;
  const A = ends[fromRoom];
  const B = ends[toRoom];
  const P = (x, y, z, mode) => ({ x, y, z, mode });
  let pts;
  if (p.kind === 'door') pts = [P(A.x, A.y, 0, 'walk'), P(B.x, B.y, 0, 'walk')];
  else {
    const z = p.kind === 'ladder' ? WORLD.LADDER_Z : WORLD.STAIRS_Z;
    const mode = p.kind === 'ladder' ? 'climb' : 'stairs';
    pts = [P(A.x, A.y, 0, 'walk'), P(A.x, A.y, z, 'step'), P(B.x, B.y, z, mode), P(B.x, B.y, 0, 'step')];
  }
  return { kind: p.kind, portal: p.id, toRoom, pts, i: 0 };
}

export function jumpPath(x, y, dir, width) {
  const pts = [];
  const len = width + 1.1;
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    pts.push({ x: x + dir * len * t, y: y + 4 * 0.95 * t * (1 - t), z: 0, mode: k ? 'jump' : 'walk' });
  }
  return { kind: 'jump', pts, i: 0, dur: SQUAD.JUMP_TIME, len };
}

export function crouchPath(x, y, dir, width) {
  return { kind: 'crouch', pts: [{ x, y, z: 0, mode: 'walk' }, { x: x + dir * (width + 1.0), y, z: 0, mode: 'crouch' }], i: 0 };
}

export function modeSpeed(mode, walkSpeed) {
  switch (mode) {
    case 'climb': return SQUAD.CLIMB;
    case 'stairs': return SQUAD.STAIRS;
    case 'step': return 1.6;
    case 'crouch': return SQUAD.CROUCH;
    case 'jump': return 5.2;
    default: return walkSpeed;
  }
}

/**
 * Move `ent` along traversal `tr` by up to `dt` seconds. Calls onPoint(pt) for every vertex
 * reached (for trail recording). Returns true when the traversal is complete.
 */
export function advance(ent, tr, dt, speedOf, onPoint) {
  let time = dt;
  while (time > 0 && tr.i < tr.pts.length - 1) {
    const b = tr.pts[tr.i + 1];
    const dx = b.x - ent.x;
    const dy = b.y - ent.y;
    const dz = b.z - ent.z;
    const d = Math.hypot(dx, dy, dz);
    const v = tr.kind === 'jump' ? tr.len / tr.dur * 1.15 : speedOf(b.mode);
    const reach = v * time;
    ent.mode = b.mode;
    if (d <= reach || d < 1e-6) {
      ent.x = b.x; ent.y = b.y; ent.z = b.z;
      time -= d / Math.max(v, 1e-6);
      tr.i++;
      onPoint?.(b);
    } else {
      const k = reach / d;
      ent.x += dx * k; ent.y += dy * k; ent.z += dz * k;
      time = 0;
      onPoint?.({ x: ent.x, y: ent.y, z: ent.z, mode: b.mode });
    }
    if (Math.abs(dx) > 1e-4) ent.facing = Math.sign(dx);
  }
  return tr.i >= tr.pts.length - 1;
}
