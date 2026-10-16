// Seeded derelict generator. The ship is a cut-away grid of COLS columns x DECKS decks of room cells.
// Horizontally adjacent cells merge into rooms (1-3 cells wide). Rooms are the nodes of a graph: a
// randomised spanning tree keeps every room reachable, extra edges add loops. Horizontal edges are
// doors through the bulkhead, vertical edges are ladders or stairs through the deck. Vents are an
// alien-only second graph. The result is plain data: a tile grid plus lists of everything placed.
//
// Tiles are 32 px. World y grows upward: tile row r spans y in [r*32, r*32+32). Deck d has its floor
// at row d*DECK_H and interior rows d*DECK_H+1 .. d*DECK_H+DECK_H-1. Cell c has its bulkhead at
// column c*CELL_W and interior columns c*CELL_W+1 .. c*CELL_W+CELL_W-1.

export const TILE = 32;
export const CELL_W = 8;          // tiles per column (1 bulkhead + 7 interior)
export const DECK_H = 6;          // tiles per deck (1 floor + 5 interior)

export const T = { EMPTY: 0, SOLID: 1, LADDER: 2, STAIR_R: 3, STAIR_L: 4, DOOR: 5, VENT: 6, HATCH: 7, AIRLOCK: 8 };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() { return Math.floor(Math.random() * 0x7fffffff); }

const ROOM_TYPES = ['corridor', 'quarters', 'medbay', 'armory', 'cargo', 'mess', 'lab', 'hydroponics', 'generator', 'storage', 'reactor', 'workshop'];

const PROPS = {
  corridor: ['pipe', 'locker', 'debris', 'crate'],
  quarters: ['bunk', 'locker', 'locker', 'debris', 'crate'],
  medbay: ['cryopod', 'cryopod', 'console', 'locker', 'cabinet'],
  armory: ['locker', 'locker', 'crate', 'console', 'rack'],
  cargo: ['crate', 'crate', 'crate', 'barrel', 'barrel', 'debris'],
  mess: ['table', 'table', 'locker', 'debris'],
  lab: ['console', 'console', 'cryopod', 'cabinet', 'debris'],
  hydroponics: ['planter', 'planter', 'barrel', 'pipe'],
  generator: ['generator', 'console', 'barrel', 'pipe', 'pipe'],
  storage: ['crate', 'barrel', 'locker', 'debris', 'crate'],
  reactor: ['reactor', 'console', 'pipe', 'pipe', 'barrel'],
  workshop: ['console', 'crate', 'barrel', 'debris', 'rack'],
  airlock: ['locker', 'crate', 'console'],
  bridge: ['console', 'console', 'console', 'chair', 'chair'],
  engine: ['engine', 'pipe', 'pipe', 'barrel', 'console'],
  hive: ['resin', 'resin', 'egg', 'egg', 'egg', 'resin', 'debris'],
};

export function generateShip({ seed, cols = 24, decks = 3 } = {}) {
  const rng = mulberry32(seed);
  const W = cols * CELL_W + 1, H = decks * DECK_H + 1;
  const grid = new Uint8Array(W * H);
  const at = (c, r) => grid[r * W + c];
  const set = (c, r, v) => { grid[r * W + c] = v; };

  // ---- hull, floors and bulkheads -------------------------------------------------------------
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const floorRow = r % DECK_H === 0;
    const bulkhead = c % CELL_W === 0;
    if (floorRow || bulkhead || c === W - 1 || r === H - 1) set(c, r, T.SOLID);
  }

  // ---- rooms: merge runs of cells on each deck ------------------------------------------------
  const rooms = [];
  const cellRoom = new Map();          // "c,d" -> room
  for (let d = 0; d < decks; d++) {
    let c = 0;
    while (c < cols) {
      const maxW = Math.min(3, cols - c);
      const w = 1 + Math.floor(rng() * maxW);
      const room = { id: rooms.length, deck: d, c0: c, c1: c + w - 1, type: 'corridor', edges: [], vents: [], props: [], loot: [], survivors: [], lights: [], events: [] };
      for (let k = c; k < c + w; k++) cellRoom.set(`${k},${d}`, room);
      rooms.push(room);
      c += w;
    }
  }
  for (const room of rooms) {
    room.x0 = room.c0 * CELL_W + 1;                 // first interior tile column
    room.x1 = (room.c1 + 1) * CELL_W - 1;           // last interior tile column
    room.y0 = room.deck * DECK_H + 1;               // first interior row
    room.y1 = room.deck * DECK_H + DECK_H - 1;      // last interior row
    // open the bulkheads inside the room
    for (let c = room.c0 + 1; c <= room.c1; c++) for (let r = room.y0; r <= room.y1; r++) set(c * CELL_W, r, T.EMPTY);
  }

  // ---- fixed rooms: the airlock (start), the bridge (objective), the engine room ----------------
  const airlock = cellRoom.get(`${cols - 1},${Math.min(1, decks - 1)}`);
  airlock.type = 'airlock';
  const bridge = cellRoom.get(`0,${decks - 1}`);
  bridge.type = 'bridge';
  const engine = cellRoom.get(`0,0`);
  if (engine !== bridge) engine.type = 'engine';

  // ---- candidate edges --------------------------------------------------------------------------
  const cand = [];
  for (const a of rooms) {
    const right = cellRoom.get(`${a.c1 + 1},${a.deck}`);
    if (right) cand.push({ a, b: right, kind: 'door' });
    const above = new Set();
    for (let c = a.c0; c <= a.c1; c++) { const b = cellRoom.get(`${c},${a.deck + 1}`); if (b) above.add(b); }
    for (const b of above) cand.push({ a, b, kind: 'vertical' });
  }
  // randomised Kruskal for the spanning tree
  const parent = rooms.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const shuffled = cand.slice().sort(() => rng() - 0.5);
  const edges = [];
  const rest = [];
  for (const e of shuffled) {
    const ra = find(e.a.id), rb = find(e.b.id);
    if (ra !== rb) { parent[ra] = rb; edges.push(e); } else rest.push(e);
  }
  // loops
  for (const e of rest) if (rng() < 0.3) edges.push(e);

  // ---- realise edges as doors, ladders and stairs -------------------------------------------------
  const doors = [], ladders = [], stairs = [];
  for (const e of edges) {
    if (e.kind === 'door') {
      const col = (e.a.c1 + 1) * CELL_W;
      const rows = [e.a.y0, e.a.y0 + 1, e.a.y0 + 2];           // 3 tiles tall from the floor
      for (const r of rows) set(col, r, T.DOOR);
      const door = { id: doors.length, col, row: e.a.y0, h: 3, a: e.a.id, b: e.b.id, locked: false };
      doors.push(door);
      e.a.edges.push({ to: e.b.id, via: 'door', door: door.id, x: col * TILE + TILE / 2, y: e.a.y0 * TILE });
      e.b.edges.push({ to: e.a.id, via: 'door', door: door.id, x: col * TILE + TILE / 2, y: e.b.y0 * TILE });
    } else {
      // overlap of the two rooms' interior columns
      const lo = Math.max(e.a.x0, e.b.x0), hi = Math.min(e.a.x1, e.b.x1);
      const span = hi - lo + 1;
      const floorRow = (e.a.deck + 1) * DECK_H;
      // a stair run and its floor opening must not cross anything already placed (a ladder from the
      // room above, another run, a hatch)
      const stairFits = (dir, c0) => {
        for (let k = 0; k < DECK_H; k++) {
          const c = c0 + dir * k, r = e.a.y0 + k;
          if (c < lo || c > hi || at(c, r) !== T.EMPTY) return false;
          if (k >= 3 && (at(c, floorRow) !== T.SOLID || at(c, floorRow + 1) !== T.EMPTY)) return false;
        }
        if (at(c0 + dir * DECK_H, floorRow) !== T.SOLID || at(c0 + dir * DECK_H, floorRow + 1) !== T.EMPTY) return false;
        if (at(c0 - dir, e.a.y0) !== T.EMPTY || at(c0 - dir, e.a.y0 - 1) !== T.SOLID) return false;
        return true;
      };
      let stairPlan = null;
      if (span >= 9 && rng() < 0.5) {
        const dir = rng() < 0.5 ? 1 : -1;
        for (const c0 of [dir > 0 ? lo + 1 : hi - 1, dir > 0 ? lo + 2 : hi - 2]) if (stairFits(dir, c0)) { stairPlan = { dir, c0 }; break; }
      }
      if (stairPlan) {
        const { dir, c0 } = stairPlan;
        // a 6-tile run rising from the lower floor to the upper floor; the upper floor opens over the
        // last three tiles so there is headroom on the way up; the landing beyond stays solid
        const r0 = e.a.y0;
        const tiles = [];
        for (let k = 0; k < DECK_H; k++) {
          const c = c0 + dir * k, r = r0 + k;
          set(c, r, dir > 0 ? T.STAIR_R : T.STAIR_L);
          tiles.push({ c, r });
        }
        for (let k = 3; k < DECK_H - 1; k++) set(c0 + dir * k, floorRow, T.EMPTY);
        // remove any bulkhead the run crosses inside a wide room (already open) and clear props space
        const st = { id: stairs.length, dir, c0, r0, n: DECK_H, a: e.a.id, b: e.b.id, tiles,
          x0: Math.min(c0, c0 + dir * (DECK_H - 1)) * TILE + (dir > 0 ? 0 : 0), x1: 0, yBottom: r0 * TILE, yTop: (r0 + DECK_H) * TILE };
        st.x0 = (dir > 0 ? c0 : c0 - (DECK_H - 1)) * TILE;
        st.x1 = st.x0 + DECK_H * TILE;
        stairs.push(st);
        const topX = (c0 + dir * DECK_H) * TILE + TILE / 2, botX = (c0 - dir) * TILE + TILE / 2;
        e.a.edges.push({ to: e.b.id, via: 'stairs', stairs: st.id, x: botX, y: e.a.y0 * TILE, exitX: topX });
        e.b.edges.push({ to: e.a.id, via: 'stairs', stairs: st.id, x: topX, y: e.b.y0 * TILE, exitX: botX });
      } else {
        const rTop = floorRow;                             // the upper floor row (hole with a hatch)
        const order = []; for (let c = lo + 1; c <= hi - 1; c++) order.push(c);
        order.sort(() => rng() - 0.5);
        let col = order[0];
        for (const c of order) {
          let ok = at(c, e.a.y0 - 1) === T.SOLID && at(c, rTop) === T.SOLID && at(c, rTop + 1) === T.EMPTY;
          for (let r = e.a.y0; r < rTop && ok; r++) if (at(c, r) !== T.EMPTY) ok = false;
          if (ok) { col = c; break; }
        }
        for (let r = e.a.y0; r < rTop; r++) set(col, r, T.LADDER);
        set(col, rTop, T.HATCH);
        const lad = { id: ladders.length, col, rBottom: e.a.y0, rTop, a: e.a.id, b: e.b.id, x: col * TILE + TILE / 2, yBottom: e.a.y0 * TILE, yTop: (rTop + 1) * TILE };
        ladders.push(lad);
        e.a.edges.push({ to: e.b.id, via: 'ladder', ladder: lad.id, x: lad.x, y: e.a.y0 * TILE });
        e.b.edges.push({ to: e.a.id, via: 'ladder', ladder: lad.id, x: lad.x, y: e.b.y0 * TILE });
      }
    }
  }

  // ---- the airlock: an opening in the rear hull to the dropship ------------------------------------
  const airlockCol = W - 1;
  for (let r = airlock.y0; r < airlock.y0 + 3; r++) set(airlockCol, r, T.AIRLOCK);
  const start = { x: (airlock.x1 - 1) * TILE + TILE / 2, y: airlock.y0 * TILE, room: airlock.id };
  const dock = { x: W * TILE, y: airlock.y0 * TILE, deck: airlock.deck };

  // ---- room types and distances from the airlock -------------------------------------------------
  const dist = graphDistances(rooms, airlock.id);
  for (const room of rooms) {
    if (room.type !== 'corridor') continue;
    room.type = ROOM_TYPES[Math.floor(rng() * ROOM_TYPES.length)];
  }
  // hive rooms: the two or three rooms farthest from the airlock that are not fixed rooms
  const far = rooms.filter((r) => !['airlock', 'bridge', 'engine'].includes(r.type)).sort((p, q) => dist[q.id] - dist[p.id]);
  const hiveCount = Math.min(3, Math.max(2, Math.floor(rooms.length / 10)));
  for (let i = 0; i < hiveCount && i < far.length; i++) far[i].type = 'hive';

  // ---- vents: alien-only shortcuts between rooms two or more steps apart ----------------------------
  const vents = [];
  const ventCount = Math.max(4, Math.floor(rooms.length / 3));
  let guard = 0;
  while (vents.length < ventCount && guard++ < 400) {
    const a = rooms[Math.floor(rng() * rooms.length)], b = rooms[Math.floor(rng() * rooms.length)];
    if (a === b || a.type === 'airlock' || b.type === 'airlock') continue;
    if (a.vents.length >= 2 || b.vents.length >= 2) continue;
    if (Math.abs(a.deck - b.deck) + Math.abs(a.c0 - b.c0) < 2) continue;
    const pa = ventSpot(a, rng, at), pb = ventSpot(b, rng, at);
    if (!pa || !pb) continue;
    set(pa.c, pa.r, T.VENT); set(pb.c, pb.r, T.VENT);
    const v = { id: vents.length, a: a.id, b: b.id, pa, pb };
    vents.push(v);
    a.vents.push(v.id); b.vents.push(v.id);
  }

  // ---- contents: props, loot, lights, survivors, events ------------------------------------------
  const props = [], loot = [], survivors = [], lights = [], events = [];
  const occupied = new Set();
  const free = (room) => {
    // interior floor columns not taken by ladders, stair runs, doors' approaches or other props
    const list = [];
    for (let c = room.x0; c <= room.x1; c++) {
      if (occupied.has(`${c},${room.deck}`)) continue;
      if (at(c, room.y0) !== T.EMPTY || at(c, room.y0 + 1) !== T.EMPTY) continue;
      if (at(c, room.y0 - 1) !== T.SOLID && at(c, room.y0 - 1) !== T.HATCH) continue;      // needs floor under it
      if (at(c - 1, room.y0) === T.DOOR || at(c + 1, room.y0) === T.DOOR) continue;
      if (at(c - 1, room.y0) === T.AIRLOCK || at(c + 1, room.y0) === T.AIRLOCK) continue;
      if (at(c, room.y0) === T.LADDER || at(c - 1, room.y0) === T.LADDER || at(c + 1, room.y0) === T.LADDER) continue;
      list.push(c);
    }
    return list;
  };
  const take = (room, cols_) => { const c = cols_[Math.floor(rng() * cols_.length)]; occupied.add(`${c},${room.deck}`); return c; };
  for (const room of rooms) {
    const list = PROPS[room.type] || PROPS.corridor;
    const n = Math.min(room.c1 - room.c0 + 2, 1 + Math.floor(rng() * 3) + (room.type === 'hive' ? 2 : 0));
    for (let i = 0; i < n; i++) {
      const cols_ = free(room);
      if (!cols_.length) break;
      const c = take(room, cols_);
      props.push({ kind: list[Math.floor(rng() * list.length)], room: room.id, c, x: c * TILE + TILE / 2, y: room.y0 * TILE });
    }
    // lights: one per cell, hives dim and red, dead rooms sometimes dark
    for (let cc = room.c0; cc <= room.c1; cc++) {
      const x = (cc * CELL_W + 4) * TILE + TILE / 2, y = (room.y1 + 1) * TILE - 6;
      const broken = room.type === 'hive' ? rng() < 0.6 : rng() < 0.18;
      lights.push({ room: room.id, x, y, color: room.type === 'hive' ? 0x6a1e14 : room.type === 'medbay' ? 0x9fe0ff : room.type === 'reactor' ? 0xffa040 : 0xa8c4ff, flicker: rng() < 0.35, broken });
    }
    // loot
    const lootKinds = room.type === 'armory' ? ['ammo', 'ammo', 'weapon', 'medkit'] : room.type === 'medbay' ? ['medkit', 'medkit', 'ammo'] : ['ammo', 'medkit', 'ammo', 'scrap'];
    const ln = room.type === 'armory' || room.type === 'medbay' ? 2 + Math.floor(rng() * 2) : rng() < 0.6 ? 1 : 0;
    for (let i = 0; i < ln; i++) {
      const cols_ = free(room);
      if (!cols_.length) break;
      const c = take(room, cols_);
      loot.push({ kind: lootKinds[Math.floor(rng() * lootKinds.length)], room: room.id, x: c * TILE + TILE / 2, y: room.y0 * TILE });
    }
  }
  // survivors: in rooms a few steps from the airlock, never in hives
  const survivorRooms = rooms.filter((r) => dist[r.id] >= 3 && !['hive', 'airlock'].includes(r.type)).sort(() => rng() - 0.5).slice(0, 4);
  for (const room of survivorRooms) {
    const cols_ = free(room);
    if (!cols_.length) continue;
    const c = take(room, cols_);
    survivors.push({ id: survivors.length, room: room.id, x: c * TILE + TILE / 2, y: room.y0 * TILE, name: ['Okafor', 'Reyes', 'Lindqvist', 'Tanaka', 'Moreau', 'Ibarra'][survivors.length % 6] });
  }
  // the objective: the ship's log on the bridge
  const objCols = free(bridge);
  const objC = objCols.length ? take(bridge, objCols) : bridge.x0 + 2;
  const objective = { room: bridge.id, x: objC * TILE + TILE / 2, y: bridge.y0 * TILE, kind: 'log' };
  // events: a fire in the engine or a generator room, a blackout triggered by entering a room mid-way
  const fireRooms = rooms.filter((r) => ['engine', 'generator', 'reactor', 'workshop'].includes(r.type)).sort(() => rng() - 0.5).slice(0, 2);
  for (const room of fireRooms) {
    const cols_ = free(room);
    if (!cols_.length) continue;
    const c = take(room, cols_);
    events.push({ kind: 'fire', room: room.id, x: c * TILE + TILE / 2, y: room.y0 * TILE });
  }
  const mid = rooms.filter((r) => dist[r.id] >= 2 && dist[r.id] <= 5 && r.type !== 'hive');
  if (mid.length) events.push({ kind: 'blackout', room: mid[Math.floor(rng() * mid.length)].id, duration: 24000 });
  // alien eggs are props in hives; aliens themselves come from the director

  return {
    seed, cols, decks, W, H, grid, rooms, doors, ladders, stairs, vents, props, loot, survivors, lights, events,
    start, dock, airlock: airlock.id, bridge: bridge.id, objective, dist,
    tileAt: (c, r) => (c < 0 || c >= W || r < 0 || r >= H ? T.SOLID : grid[r * W + c]),
  };
}

function ventSpot(room, rng, at) {
  // a grille in the ceiling of the room over a free interior column
  for (let i = 0; i < 12; i++) {
    const c = room.x0 + 1 + Math.floor(rng() * Math.max(1, room.x1 - room.x0 - 1));
    const r = room.y1 + 1;                       // the ceiling (upper floor) row
    if (at(c, r) !== T.SOLID) continue;
    if (at(c, r - 1) !== T.EMPTY) continue;             // open below (the grille faces into the room)
    if (at(c, r + 1) !== T.EMPTY) continue;             // nothing stands on that floor tile above
    return { c, r };
  }
  return null;
}

export function graphDistances(rooms, fromId) {
  const dist = rooms.map(() => Infinity);
  dist[fromId] = 0;
  const q = [fromId];
  while (q.length) {
    const i = q.shift();
    for (const e of rooms[i].edges) if (dist[e.to] === Infinity) { dist[e.to] = dist[i] + 1; q.push(e.to); }
  }
  return dist;
}

// Shortest path (room ids) between two rooms along doors, ladders and stairs.
export function roomPath(rooms, fromId, toId) {
  const prev = new Map([[fromId, null]]);
  const q = [fromId];
  while (q.length) {
    const i = q.shift();
    if (i === toId) break;
    for (const e of rooms[i].edges) if (!prev.has(e.to)) { prev.set(e.to, i); q.push(e.to); }
  }
  if (!prev.has(toId)) return null;
  const path = [];
  for (let i = toId; i !== null; i = prev.get(i)) path.unshift(i);
  return path;
}

export function shipToAscii(ship) {
  const chars = { [T.EMPTY]: '.', [T.SOLID]: '#', [T.LADDER]: 'H', [T.STAIR_R]: '/', [T.STAIR_L]: '\\', [T.DOOR]: 'D', [T.VENT]: 'V', [T.HATCH]: '=', [T.AIRLOCK]: 'A' };
  const lines = [];
  for (let r = ship.H - 1; r >= 0; r--) {
    let line = '';
    for (let c = 0; c < ship.W; c++) line += chars[ship.grid[r * ship.W + c]] || '?';
    lines.push(line);
  }
  return lines.join('\n');
}
