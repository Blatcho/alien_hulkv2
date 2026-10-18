// Ship layout: decks -> rooms -> connections (doors, ladders, stairs).
//
// 1. Each deck spans a column range: the hull class's silhouette (gen/classes.js deckSpans),
//    dock side on the left (the level is mirrored afterwards for a starboard dock).
// 2. Decks are partitioned into rooms of 2-5 cells; the airlock is forced at the left end of the
//    docking deck, the cockpit at the far end of the bridge deck (or, on a station, in its core).
// 3. Candidate connections: a door between neighbours on a deck, a vertical link wherever
//    rooms on adjacent decks overlap by at least one cell.
// 4. A random spanning tree of the candidates guarantees every room is reachable; a fraction
//    of the leftover candidates are re-added as loops. Removing doors is what forces the
//    squad to climb and backtrack.
// 5. Vertical links become ladders or stairs and get non-overlapping positions.
// Returns null when the result is too linear/short so the caller can retry with a new stream.
import { SHIP, WORLD } from '../core/config.js';
import { HULL_CLASSES, bridgeFor, deckSpans, dockDeckFor } from './classes.js';

const { CELL_W, DECK_H, SLAB, WALL, STAIRS_RUN } = WORLD;

/** Room widths along a deck. first/last: fixed-width rooms at its ends; core: one in its middle. */
function partition(rng, c0, c1, { first = 0, last = 0, core = 0 } = {}) {
  if (core) {
    // A core room of `core` cells about the deck's centre; the halves partitioned on their own.
    const n = c1 - c0 + 1;
    const mid = Math.max(2, Math.floor(n / 2) - 1);
    return [...partition(rng, c0, c0 + mid - 1, { first }), core, ...partition(rng, c0 + mid + core, c1, { last })];
  }
  const widths = [];
  let remaining = c1 - c0 + 1;
  if (first) { widths.push(first); remaining -= first; }
  let tail = 0;
  if (last) { tail = last; remaining -= last; }
  while (remaining > 0) {
    let w = rng.weighted(SHIP.ROOM_WIDTHS);
    if (w > remaining) w = remaining;
    if (remaining - w === 1) w = w < 5 ? w + 1 : w - 1;
    if (w < 2) { widths[widths.length - 1] += w; remaining -= w; continue; }
    widths.push(w);
    remaining -= w;
  }
  if (tail) widths.push(tail);
  return widths;
}

export function makeRoom(id, deck, c0, c1) {
  const x0 = c0 * CELL_W;
  const x1 = (c1 + 1) * CELL_W;
  const y0 = deck * DECK_H;
  return { id, deck, c0, c1, x0, x1, y0, y1: y0 + DECK_H - SLAB, portals: [] };
}

class UnionFind {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i) { while (this.p[i] !== i) i = this.p[i] = this.p[this.p[i]]; return i; }
  union(a, b) { a = this.find(a); b = this.find(b); if (a === b) return false; this.p[a] = b; return true; }
}

/** BFS over the chosen connections. Returns {dist, prev}. */
export function bfs(rooms, portals, start) {
  const dist = new Array(rooms.length).fill(Infinity);
  const prev = new Array(rooms.length).fill(-1);
  dist[start] = 0;
  const queue = [start];
  while (queue.length) {
    const r = queue.shift();
    for (const pid of rooms[r].portals) {
      const p = portals[pid];
      const o = p.a === r ? p.b : p.a;
      if (dist[o] === Infinity) { dist[o] = dist[r] + 1; prev[o] = r; queue.push(o); }
    }
  }
  return { dist, prev };
}

/** Interior x-limits a body can stand in (inside hull/bulkheads). */
export function walkLimits(room) {
  return [room.x0 + WALL / 2 + 0.45, room.x1 - WALL / 2 - 0.45];
}

export function buildLayout(rng, { cols, decks, cls = 'freighter' } = {}) {
  cols ??= SHIP.COLS;
  decks ??= SHIP.DECKS;
  const C = HULL_CLASSES[cls] ?? HULL_CLASSES.freighter;
  const dockDeck = dockDeckFor(cls, decks);
  const bridge = bridgeFor(cls, rng, decks, dockDeck);
  const spans = deckSpans(cls, rng, cols, decks, dockDeck);
  const rooms = [];
  const byDeck = [];
  for (let d = 0; d < decks; d++) {
    const [c0, c1] = spans[d];
    if (c1 - c0 + 1 < 4) return null; // a deck too short for two rooms
    const widths = partition(rng, c0, c1, {
      first: d === dockDeck ? 2 : 0,
      last: d === bridge.deck && bridge.at === 'far' ? 2 : 0,
      core: d === bridge.deck && bridge.at === 'core' ? 2 : 0,
    });
    let c = c0;
    byDeck[d] = [];
    for (const w of widths) {
      const room = makeRoom(rooms.length, d, c, c + w - 1);
      rooms.push(room);
      byDeck[d].push(room);
      c += w;
    }
  }
  const airlock = byDeck[dockDeck][0].id;
  const bridgeRow = byDeck[bridge.deck];
  const centre = Math.floor((spans[bridge.deck][0] + spans[bridge.deck][1]) / 2);
  const cockpit = bridge.at === 'core' ? bridgeRow.find((r) => r.c0 <= centre && centre <= r.c1).id : bridgeRow[bridgeRow.length - 1].id;
  if (cockpit === airlock) return null;

  // Candidate connections.
  const cands = [];
  for (let d = 0; d < decks; d++) {
    const row = byDeck[d];
    for (let i = 0; i + 1 < row.length; i++) {
      cands.push({ kind: 'door', a: row[i].id, b: row[i + 1].id, w: rng.next() });
    }
    if (d + 1 >= decks) continue;
    for (const lo of row) {
      if (lo.id === airlock || lo.id === cockpit) continue; // the airlock and the bridge are reached by their doors
      for (const hi of byDeck[d + 1]) {
        if (hi.id === cockpit || hi.id === airlock) continue;
        const ov0 = Math.max(lo.x0, hi.x0);
        const ov1 = Math.min(lo.x1, hi.x1);
        if (ov1 - ov0 >= CELL_W) cands.push({ kind: 'vertical', a: lo.id, b: hi.id, ov0, ov1, w: rng.next() * 2.2 });
      }
    }
  }

  // Random spanning tree + loops.
  const uf = new UnionFind(rooms.length);
  const chosen = [];
  const rest = [];
  for (const c of [...cands].sort((x, y) => x.w - y.w)) {
    if (uf.union(c.a, c.b)) chosen.push(c);
    else rest.push(c);
  }
  for (const c of rest) if (rng.chance(SHIP.LOOP_CHANCE)) chosen.push(c);
  if (new Set(rooms.map((r) => uf.find(r.id))).size !== 1) return null;

  // Materialise portals with positions.
  const portals = [];
  const occupied = rooms.map(() => []); // x-intervals used by vertical links per room
  const free = (roomId, a, b) => occupied[roomId].every(([u, v]) => b < u - 0.6 || a > v + 0.6);
  for (const c of chosen) {
    const id = portals.length;
    if (c.kind === 'door') {
      portals.push({ id, kind: 'door', a: c.a, b: c.b, x: rooms[c.a].x1, y: rooms[c.a].y0, open: false });
    } else {
      const lo = rooms[c.a];
      const hi = rooms[c.b];
      const u0 = c.ov0 + 1.9;
      const u1 = c.ov1 - 1.9;
      let placed = null;
      const wantStairs = rng.chance(SHIP.STAIRS_CHANCE) && u1 - u0 >= STAIRS_RUN + 0.2;
      for (let attempt = 0; attempt < 8 && !placed; attempt++) {
        if (wantStairs && attempt < 5) {
          const dir = rng.chance(0.5) ? 1 : -1;
          const xa = rng.float(u0, u1 - STAIRS_RUN);
          const xb = dir > 0 ? xa : xa + STAIRS_RUN; // bottom end
          const xt = dir > 0 ? xa + STAIRS_RUN : xa; // top end
          const lo0 = xa - 0.5, hi0 = xa + STAIRS_RUN + 0.5;
          if (free(lo.id, lo0, hi0) && free(hi.id, lo0, hi0)) {
            placed = { kind: 'stairs', xb, xt, dir, span: [lo0, hi0] };
          }
        } else {
          const x = rng.float(u0, Math.max(u0, u1));
          const span = [x - 0.9, x + 0.9];
          if (free(lo.id, ...span) && free(hi.id, ...span)) placed = { kind: 'ladder', x, span };
        }
      }
      if (!placed) return null;
      occupied[lo.id].push(placed.span);
      occupied[hi.id].push(placed.span);
      portals.push({ id, ...placed, a: lo.id, b: hi.id, yLow: lo.y0, yHigh: hi.y0 });
    }
    rooms[c.a].portals.push(id);
    rooms[c.b].portals.push(id);
  }

  const { dist, prev } = bfs(rooms, portals, airlock);
  const mainPath = [];
  for (let r = cockpit; r !== -1; r = prev[r]) mainPath.unshift(r);
  if (mainPath.length < (C.minPath ?? SHIP.MIN_MAIN_PATH)) return null;
  rooms.forEach((r) => { r.dist = dist[r.id]; });

  const x0 = Math.min(...rooms.map((r) => r.x0));
  const x1 = Math.max(...rooms.map((r) => r.x1));
  return {
    cols, decks, cls, dockDeck, bridgeDeck: bridge.deck, spans, rooms, portals, airlock, cockpit, mainPath,
    bounds: { x0: x0 - WORLD.HULL - 2, x1: x1 + WORLD.HULL + 6, y0: -WORLD.SLAB - 1, y1: decks * DECK_H + 1 },
  };
}

/**
 * How good a layout is to play (gen/level.js keeps the best of several): a long way through,
 * some loops to double back by, dead ends for nests and storerooms, climbs and stairs on the way.
 */
export function layoutScore(L) {
  const loops = L.portals.length - (L.rooms.length - 1);
  const deadEnds = L.rooms.filter((r) => r.portals.length === 1).length;
  const at = new Map(L.mainPath.map((id, i) => [id, i]));
  let climbs = 0;
  let stairs = 0;
  for (const p of L.portals) {
    if (p.kind === 'stairs') stairs++;
    if (p.kind !== 'door' && at.has(p.a) && at.has(p.b) && Math.abs(at.get(p.a) - at.get(p.b)) === 1) climbs++;
  }
  return L.mainPath.length + Math.min(loops, 4) * 0.6 + Math.min(deadEnds, 5) * 0.35 + climbs * 0.5 + Math.min(stairs, 3) * 0.2;
}
