// generateLevel(seed) -> plain-data Level (no three.js, no Rapier): rooms, portals, props,
// vents, spawns, plus `solids` - axis-aligned boxes that physics and line-of-sight share.
//
// The seed may carry its hull class ('STN-A1B2C3' - gen/classes.js); a bare seed rolls one.
// The ship is generated dock side on the left, then mirrored for a starboard dock: everything
// in it is in world x, so the sim, navigation and render never need to know - except the
// squad's starting heading (level.heading) and the render's dock pieces (level.mirror).
import { Rng } from '../core/rng.js';
import { WORLD } from '../core/config.js';
import { HULL_CLASSES, classFor, parseSeed, seedCode, shipSize } from './classes.js';
import { contractFor } from './contracts.js';
import { storyFor } from './stories.js';
import { buildLayout, layoutScore } from './layout.js';
import { populate } from './populate.js';

const { DECK_H, SLAB, WALL, HULL, DOOR_H, DOOR_W, SHAFT_W, CELL_W } = WORLD;
const CANDIDATES = 5; // valid layouts tried per seed; the best (layoutScore) is the ship

export function generateLevel(seed, opts = {}) {
  const code = parseSeed(seed);
  const bare = code.seed;
  const mods = opts.mods ?? {};
  const cls = classFor(bare, mods.cls ?? opts.cls ?? code.cls);
  const size = shipSize(cls, new Rng(bare, 'size'), { cols: mods.cols ?? opts.cols, decks: mods.decks ?? opts.decks, shipSize: mods.shipSize });
  let best = null;
  let found = 0;
  for (let attempt = 0; attempt < 200 && found < CANDIDATES; attempt++) {
    const L = buildLayout(new Rng(bare, `layout-${attempt}`), { ...size, cls, hallRng: new Rng(bare, `hall-${attempt}`) });
    if (!L) continue;
    found++;
    // (A boss hulk wants a hall two decks tall for the queen's nest.)
    const score = layoutScore(L) + (mods.boss && L.rooms.some((r) => r.tall) ? 50 : 0);
    if (!best || score > best.score) best = { L, score, attempt };
  }
  if (!best) throw new Error(`no valid layout for seed ${seed}`);
  // threat = campaign difficulty tier; mods = ship modifiers (see meta/ships.js)
  const level = { seed: seedCode(cls, bare), bare, attempt: best.attempt, threat: opts.threat ?? 0, mods, heading: 1, mirror: false, story: storyFor(bare, cls), ...best.L };
  // The job aboard (gen/contracts.js): named by the offer (a sector node) or quick play's roll;
  // the nav-lock when nobody names one (tools, tests, old links).
  level.contract = contractFor(bare, { want: mods.contract ?? opts.contract ?? 'uplink', boss: !!mods.boss, threat: level.threat });
  populate(level, (name) => new Rng(bare, name));
  addDock(level);
  if (HULL_CLASSES[cls].dockSide === 'either' && new Rng(bare, 'mirror').chance(0.5)) mirrorLevel(level);
  level.solids = buildSolids(level);
  return level;
}

/**
 * Flip the ship about its length (dock on the right). Doors keep room `a` on their left; stairs
 * run the other way; everything with an x moves. The squad then starts out heading left.
 */
function mirrorLevel(level) {
  const X = level.cols * CELL_W;
  const mx = (x) => X - x;
  for (const r of level.rooms) {
    [r.x0, r.x1] = [mx(r.x1), mx(r.x0)];
    [r.c0, r.c1] = [level.cols - 1 - r.c1, level.cols - 1 - r.c0];
    if (r.collar !== undefined) r.collar = mx(r.collar);
    for (const p of r.props) {
      p.x = mx(p.x);
      if (p.obstacle) [p.x0, p.x1] = [mx(p.x1), mx(p.x0)];
    }
  }
  for (const p of level.portals) {
    if (p.kind === 'door') { p.x = mx(p.x); [p.a, p.b] = [p.b, p.a]; } else if (p.kind === 'ladder') { p.x = mx(p.x); p.span = [mx(p.span[1]), mx(p.span[0])]; } else { [p.xb, p.xt] = [mx(p.xb), mx(p.xt)]; p.dir = -p.dir; p.span = [mx(p.span[1]), mx(p.span[0])]; }
  }
  for (const v of level.vents ?? []) v.x = mx(v.x);
  const sp = level.spawns;
  sp.squad.x = mx(sp.squad.x);
  for (const list of [sp.aliens, sp.critters, sp.survivors]) {
    for (const a of list ?? []) {
      a.x = mx(a.x);
      if (a.side) { a.side = -a.side; a.x = wallFace(level.rooms[a.room], a.side); } // a sleeper on a bulkhead: the other wall now, exactly
    }
  }
  if (level.objective) level.objective.x = mx(level.objective.x);
  if (level.boss) level.boss.x = mx(level.boss.x);
  for (const e of level.events ?? []) if (e.x !== undefined) e.x = mx(e.x);
  for (const b of level.breaches ?? []) { b.x = mx(b.x); [b.a, b.b] = [b.b, b.a]; }
  level.spans = level.spans.map(([c0, c1]) => [level.cols - 1 - c1, level.cols - 1 - c0]);
  level.bounds = { ...level.bounds, x0: mx(level.bounds.x1), x1: mx(level.bounds.x0) };
  level.heading = -1;
  level.mirror = true;
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
    id: level.rooms.length, deck: air.deck, c0: -1, c1: -1, x0: collar - DOCK.BAY, x1, y0: air.y0, y1: air.y0 + DOCK.CEIL,
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
    // Openings in this slab: the shafts of ladders and stairs, and the halls two decks tall below it.
    const holes = [
      ...level.portals.filter((p) => p.kind !== 'door' && Math.abs(p.yHigh - y) < 0.01).map(shaftOpening),
      ...level.rooms.filter((r) => r.tall && r.deck === k - 1).map((r) => [r.x0, r.x1]),
    ].sort((a, b) => a[0] - b[0]);
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
    const left = rooms[0];
    const right = rooms[rooms.length - 1];
    // The hull at each end of the deck - with the outer airlock door cut through it where the
    // boarding tube meets it (either end: the dock may be to starboard).
    const outerAt = (room, x) => level.portals.find((p) => p.outer && (p.a === room.id || p.b === room.id) && Math.abs(p.x - x) < 0.01);
    for (const [x0, x1, outer] of [[left.x0 - HULL, left.x0, outerAt(left, left.x0 - HULL / 2)], [right.x1, right.x1 + HULL, outerAt(right, right.x1 + HULL / 2)]]) {
      if (outer) {
        solids.push({ kind: 'hull', x0, x1, y0: y0 + DOOR_H, y1 });
        solids.push({ kind: 'door', portal: outer.id, x0: outer.x - DOOR_W / 2, x1: outer.x + DOOR_W / 2, y0, y1: y0 + DOOR_H });
      } else solids.push({ kind: 'hull', x0, x1, y0, y1 });
    }
    for (let i = 0; i + 1 < rooms.length; i++) {
      const xb = rooms[i].x1;
      if (rooms[i + 1].x0 - xb > 0.01) {
        // A hall two decks tall from the deck below sits between them: a solid wall on each side of it.
        solids.push({ kind: 'bulkhead', x0: xb - WALL / 2, x1: xb + WALL / 2, y0, y1 });
        solids.push({ kind: 'bulkhead', x0: rooms[i + 1].x0 - WALL / 2, x1: rooms[i + 1].x0 + WALL / 2, y0, y1 });
        continue;
      }
      const door = level.portals.find((p) => p.kind === 'door' && p.a === rooms[i].id && p.b === rooms[i + 1].id);
      const weak = level.breaches?.find((b) => b.a === rooms[i].id && b.b === rooms[i + 1].id);
      solids.push({ kind: 'bulkhead', x0: xb - WALL / 2, x1: xb + WALL / 2, y0: door || weak ? y0 + DOOR_H : y0, y1 });
      if (door) solids.push({ kind: 'door', portal: door.id, x0: xb - DOOR_W / 2, x1: xb + DOOR_W / 2, y0, y1: y0 + DOOR_H });
      // A weak bulkhead (gen/populate.js placeBreaches): its lower part is a collider of its own, gone once blown.
      if (weak) solids.push({ kind: 'breach', breach: weak.id, x0: xb - WALL / 2, x1: xb + WALL / 2, y0, y1: y0 + DOOR_H });
    }
  }
  // Boarding ship + tube: floor, ceiling and back wall (the art covers them visually). The bay
  // is beyond the collar, away from the hull; the tube between the collar and the hull.
  for (const r of level.rooms.filter((q) => q.exterior)) {
    const m = level.mirror;
    const [bay0, bay1] = m ? [r.collar, r.x1 + 1] : [r.x0 - 1, r.collar];
    const [tube0, tube1] = m ? [r.x0, r.collar] : [r.collar, r.x1];
    solids.push({ kind: 'dock', x0: Math.min(bay0, tube0), x1: Math.max(bay1, tube1), y0: r.y0 - SLAB, y1: r.y0 });
    solids.push({ kind: 'dock', x0: bay0, x1: bay1, y0: r.y1, y1: r.y1 + SLAB });
    solids.push({ kind: 'dock', x0: tube0, x1: tube1, y0: r.y0 + 3.2, y1: r.y0 + 3.2 + SLAB });
    solids.push(m ? { kind: 'dock', x0: r.x1, x1: r.x1 + 1, y0: r.y0, y1: r.y1 } : { kind: 'dock', x0: r.x0 - 1, x1: r.x0, y0: r.y0, y1: r.y1 });
  }
  return solids;
}

/** Room containing a point (by floor band - a hall two decks tall owns both of its), or -1. */
export function roomAt(level, x, y) {
  for (const r of level.rooms) {
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 - 0.3 && y <= r.y1 + SLAB - 0.3) return r.id;
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
