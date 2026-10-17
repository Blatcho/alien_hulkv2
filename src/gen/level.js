// generateLevel(seed) -> plain-data Level (no three.js, no Rapier): rooms, portals, props,
// vents, spawns, plus `solids` - axis-aligned boxes that physics and line-of-sight share.
import { Rng } from '../core/rng.js';
import { WORLD } from '../core/config.js';
import { buildLayout } from './layout.js';
import { populate } from './populate.js';

const { DECK_H, SLAB, WALL, HULL, DOOR_H, DOOR_W, SHAFT_W } = WORLD;

export function generateLevel(seed, opts = {}) {
  let layout = null;
  let attempt = 0;
  const size = { cols: opts.mods?.cols ?? opts.cols, decks: opts.mods?.decks ?? opts.decks };
  for (; attempt < 200 && !layout; attempt++) layout = buildLayout(new Rng(seed, `layout-${attempt}`), size);
  if (!layout) throw new Error(`no valid layout for seed ${seed}`);
  // threat = campaign difficulty tier; mods = ship modifiers (see meta/ships.js)
  const level = { seed: String(seed), attempt, threat: opts.threat ?? 0, mods: opts.mods ?? {}, ...layout };
  populate(level, (name) => new Rng(seed, name));
  addDock(level);
  level.solids = buildSolids(level);
  return level;
}

export const DOCK = { TUBE: 4, BAY: 12.4, NOSE: 19, CEIL: 4.2 };

/**
 * The squad's boarding ship, docked at the airlock's outer door by a boarding tube. It is an
 * `exterior` room: not part of the derelict's decks, always visible, and where survivors run to.
 */
function addDock(level) {
  const air = level.rooms[level.airlock];
  const x1 = air.x0 - HULL;                 // tube meets the hull
  const collar = x1 - DOCK.TUBE;            // dropship's open collar
  const dock = {
    id: level.rooms.length, deck: 0, c0: -1, c1: -1, x0: collar - DOCK.BAY, x1, y0: air.y0, y1: air.y0 + DOCK.CEIL,
    portals: [], type: 'dock', exterior: true, dist: -1, props: [], vents: [], light: 'normal', explored: true, seen: true, seed: 1, collar,
  };
  level.rooms.push(dock);
  const door = { id: level.portals.length, kind: 'door', a: dock.id, b: air.id, x: air.x0 - HULL / 2, y: air.y0, open: false, outer: true, thick: HULL };
  level.portals.push(door);
  dock.portals.push(door.id);
  air.portals.push(door.id);
  level.dock = dock.id;
  // Leader far enough forward that the whole file fits inside the bay behind him.
  level.spawns.squad = { room: dock.id, x: dock.x0 + 1.2 + 4 * 1.5 };
  level.bounds.x0 = Math.min(level.bounds.x0, collar - DOCK.NOSE - 2);
}

/** Floor opening (x-range) a vertical portal cuts into the slab above its lower room. */
export function shaftOpening(p) {
  if (p.kind === 'ladder') return [p.x - SHAFT_W / 2, p.x + SHAFT_W / 2];
  return p.dir > 0 ? [p.xt - 2.2, p.xt] : [p.xt, p.xt + 2.2];
}

/** The inner face of a room's bulkhead: side -1 = its left (low x) wall, +1 = its right. */
export function wallFace(room, side) {
  return side < 0 ? room.x0 + WALL / 2 : room.x1 - WALL / 2;
}

/** Is there a door in that bulkhead (an alien can't climb the doorway)? */
export function doorInWall(level, room, side) {
  const x = side < 0 ? room.x0 : room.x1;
  return level.portals.some((p) => p.kind === 'door' && (p.a === room.id || p.b === room.id) && Math.abs(p.x - x) < 0.5);
}

/**
 * The stretches of a room's ceiling an alien can crawl along: wall to wall, minus the openings
 * where ladders and stairs go up through it. Sorted [x0, x1] pairs.
 */
export function ceilingSpans(level, room) {
  const holes = level.portals.filter((p) => p.kind !== 'door' && p.a === room.id).map(shaftOpening).sort((a, b) => a[0] - b[0]);
  const spans = [];
  let cursor = wallFace(room, -1);
  const end = wallFace(room, 1);
  for (const [h0, h1] of holes) {
    if (h0 > cursor + 0.6) spans.push([cursor, Math.min(h0, end)]);
    cursor = Math.max(cursor, h1);
  }
  if (end > cursor + 0.6) spans.push([cursor, end]);
  return spans;
}

/**
 * Static geometry as boxes {x0, y0, x1, y1, kind}. Doors are separate boxes tagged with
 * their portal id so they can be toggled. Slabs at each deck line span the union of the
 * decks above and below, with openings where ladders/stairs pass through.
 */
export function buildSolids(level) {
  const solids = [];
  const deckExtent = (d) => {
    const rs = level.rooms.filter((r) => r.deck === d && !r.exterior);
    return rs.length ? [Math.min(...rs.map((r) => r.x0)), Math.max(...rs.map((r) => r.x1))] : null;
  };
  for (let k = 0; k <= level.decks; k++) {
    const below = k > 0 ? deckExtent(k - 1) : null;
    const above = k < level.decks ? deckExtent(k) : null;
    const ext = [below, above].filter(Boolean);
    const x0 = Math.min(...ext.map((e) => e[0])) - HULL;
    const x1 = Math.max(...ext.map((e) => e[1])) + HULL;
    const y = k * DECK_H;
    const holes = level.portals
      .filter((p) => p.kind !== 'door' && Math.abs(p.yHigh - y) < 0.01)
      .map(shaftOpening)
      .sort((a, b) => a[0] - b[0]);
    let cursor = x0;
    for (const [h0, h1] of holes) {
      if (h0 > cursor) solids.push({ kind: 'slab', x0: cursor, x1: h0, y0: y - SLAB, y1: y });
      cursor = Math.max(cursor, h1);
    }
    solids.push({ kind: 'slab', x0: cursor, x1, y0: y - SLAB, y1: y });
  }
  for (let d = 0; d < level.decks; d++) {
    const rooms = level.rooms.filter((r) => r.deck === d && !r.exterior).sort((a, b) => a.x0 - b.x0);
    const y0 = d * DECK_H;
    const y1 = y0 + DECK_H - SLAB;
    const outer = level.portals.find((p) => p.outer && p.b === rooms[0].id);
    if (outer) {
      // Outer airlock door through the hull, into the boarding tube.
      solids.push({ kind: 'hull', x0: rooms[0].x0 - HULL, x1: rooms[0].x0, y0: y0 + DOOR_H, y1 });
      solids.push({ kind: 'door', portal: outer.id, x0: outer.x - DOOR_W / 2, x1: outer.x + DOOR_W / 2, y0, y1: y0 + DOOR_H });
    } else solids.push({ kind: 'hull', x0: rooms[0].x0 - HULL, x1: rooms[0].x0, y0, y1 });
    solids.push({ kind: 'hull', x0: rooms[rooms.length - 1].x1, x1: rooms[rooms.length - 1].x1 + HULL, y0, y1 });
    for (let i = 0; i + 1 < rooms.length; i++) {
      const xb = rooms[i].x1;
      const door = level.portals.find((p) => p.kind === 'door' && p.a === rooms[i].id && p.b === rooms[i + 1].id);
      solids.push({ kind: 'bulkhead', x0: xb - WALL / 2, x1: xb + WALL / 2, y0: door ? y0 + DOOR_H : y0, y1 });
      if (door) solids.push({ kind: 'door', portal: door.id, x0: xb - DOOR_W / 2, x1: xb + DOOR_W / 2, y0, y1: y0 + DOOR_H });
    }
  }
  // Boarding ship + tube: floor, ceiling and back wall (the art covers them visually).
  for (const r of level.rooms.filter((q) => q.exterior)) {
    solids.push({ kind: 'dock', x0: r.x0 - 1, x1: r.x1, y0: r.y0 - SLAB, y1: r.y0 });
    solids.push({ kind: 'dock', x0: r.x0 - 1, x1: r.collar, y0: r.y1, y1: r.y1 + SLAB });
    solids.push({ kind: 'dock', x0: r.collar, x1: r.x1, y0: r.y0 + 3.2, y1: r.y0 + 3.2 + SLAB });
    solids.push({ kind: 'dock', x0: r.x0 - 1, x1: r.x0, y0: r.y0, y1: r.y1 });
  }
  return solids;
}

/** Room containing a point (by floor band), or -1. */
export function roomAt(level, x, y) {
  for (const r of level.rooms) {
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 - 0.3 && y <= r.y0 + DECK_H - 0.3) return r.id;
  }
  return -1;
}

/** The two floor endpoints of a portal: {[roomId]: {x, y}}. */
export function portalEnds(level, p) {
  const A = level.rooms[p.a];
  const B = level.rooms[p.b];
  if (p.kind === 'door') {
    const t = (p.thick ?? WALL) / 2 + 0.2;
    return { [p.a]: { x: p.x - t, y: A.y0 }, [p.b]: { x: p.x + t, y: B.y0 } };
  }
  if (p.kind === 'ladder') return { [p.a]: { x: p.x, y: A.y0 }, [p.b]: { x: p.x, y: B.y0 } };
  return { [p.a]: { x: p.xb, y: A.y0 }, [p.b]: { x: p.xt, y: B.y0 } };
}
