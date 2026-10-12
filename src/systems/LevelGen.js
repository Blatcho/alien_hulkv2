// Seeded procedural level generator. A zone is a grid of rooms (see data/rooms.js); a random walk
// carves the critical path from the bottom-left room to an exit on the top row, climbing as it
// goes, side rooms hang off the path, and every cell gets a template whose doors are sealed to
// match. The output is plain world-space geometry the Game scene builds and the autopilot follows.
import { ROOM_COLS, ROOM_ROWS, TILE, TEMPLATES, START_TEMPLATE, EXIT_TEMPLATE, FILLER_TEMPLATE } from '../data/rooms.js';

export const ROOM_W = ROOM_COLS * TILE;   // 1280
export const ROOM_H = ROOM_ROWS * TILE;   // 704
export const GROUND_Y = 600;               // world y of the moor floor (bottom of row 0)
const DOOR_ROWS = [7, 8, 9];
const LADDER_COL = 9;

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

export function hashSeed(seed, salt) {
  let h = (seed ^ Math.imul(salt + 1, 0x9E3779B1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function randomSeed() { return Math.floor(Math.random() * 0x7fffffff); }

// World origin of a room cell. Row 0 sits on the moor: the TOP of its floor row is the ground line.
export function cellOrigin(c, r) { return { x: c * ROOM_W, y: GROUND_Y + TILE - (r + 1) * ROOM_H }; }

function carve(cols, rows, rng) {
  const cells = {};
  const key = (c, r) => `${c},${r}`;
  const get = (c, r) => cells[key(c, r)] || (cells[key(c, r)] = { c, r, exits: new Set(), onPath: false, branch: false, order: -1 });
  const path = [];
  let c = 0, r = 0, dir = 1;
  let order = 0;
  const start = get(c, r); start.onPath = true; start.order = order++; path.push(start);
  let guard = 0;
  while (guard++ < 500) {
    const cur = get(c, r);
    const atTop = r === rows - 1;
    const canUp = !atTop;
    // how far along the row we are (so climbs are spread out, not stacked in one column)
    const stepsOnRow = path.filter((p) => p.r === r).length;
    const pUp = canUp ? Math.min(0.75, 0.12 + stepsOnRow * 0.17) : 0;
    const nextC = c + dir;
    const blocked = nextC < 0 || nextC >= cols;
    if (atTop && stepsOnRow >= 2 && (blocked || rng() < 0.3)) break;       // exit here
    if (blocked && !canUp) break;
    if (blocked || (canUp && rng() < pUp)) {
      cur.exits.add('U');
      r += 1;
      const up = get(c, r); up.exits.add('D'); up.onPath = true; up.order = order++; path.push(up);
      if (blocked) dir = -dir;
      else if (rng() < 0.35) dir = -dir;
      continue;
    }
    cur.exits.add(dir > 0 ? 'R' : 'L');
    c = nextC;
    const nxt = get(c, r); nxt.exits.add(dir > 0 ? 'L' : 'R'); nxt.onPath = true; nxt.order = order++; path.push(nxt);
  }
  // side rooms: hang off path cells horizontally where the neighbour is unused
  for (const p of path) {
    if (p.order === 0 || p === path[path.length - 1]) continue;
    for (const d of [-1, 1]) {
      const nc = p.c + d;
      if (nc < 0 || nc >= cols || cells[key(nc, p.r)]) continue;
      if (rng() < 0.28) {
        const b = get(nc, p.r); b.branch = true;
        p.exits.add(d > 0 ? 'R' : 'L'); b.exits.add(d > 0 ? 'L' : 'R');
      }
    }
  }
  return { cells, path };
}

function pickTemplate(cell, rng, prev, wantShrine) {
  // a vertical exit either way needs columns 9-10 clear: the U ladder runs up them and the D hole opens the floor there
  const needLadder = cell.exits.has('U') || cell.exits.has('D');
  let pool = TEMPLATES.filter((t) => (!needLadder || t.ladder) && t.name !== 'shrine');
  if (cell.branch) pool = pool.filter((t) => t.rows.some((row) => row.includes('C'))).concat(pool.filter((t) => t.name === 'crypt' || t.name === 'vault'));
  if (wantShrine) { const s = TEMPLATES.find((t) => t.name === 'shrine'); if (s && (!needLadder || s.ladder)) return s; }
  if (prev) { const p2 = pool.filter((t) => t.name !== prev.name); if (p2.length) pool = p2; }
  return pool[Math.floor(rng() * pool.length)] || TEMPLATES[0];
}

// Copy a template and seal unused doors / install the ladder for U exits.
function sealTemplate(tpl, exits) {
  const rows = tpl.rows.map((r) => r.split(''));
  for (const rr of DOOR_ROWS) {
    if (!exits.has('L')) rows[rr][0] = '#';
    if (!exits.has('R')) rows[rr][ROOM_COLS - 1] = '#';
  }
  if (exits.has('U')) {
    rows[0][LADDER_COL] = '.'; rows[0][LADDER_COL + 1] = '.';
    for (let rr = 1; rr <= 9; rr++) if (rows[rr][LADDER_COL] !== '#' && rows[rr][LADDER_COL] !== '=') rows[rr][LADDER_COL] = 'H';
  } else {
    rows[0][LADDER_COL] = '#'; rows[0][LADDER_COL + 1] = '#';
    for (let rr = 1; rr <= 9; rr++) if (rows[rr][LADDER_COL] === 'H') rows[rr][LADDER_COL] = '.';
  }
  if (exits.has('D')) { rows[ROOM_ROWS - 1][LADDER_COL] = '.'; rows[ROOM_ROWS - 1][LADDER_COL + 1] = '.'; }
  else { rows[ROOM_ROWS - 1][LADDER_COL] = '#'; rows[ROOM_ROWS - 1][LADDER_COL + 1] = '#'; }
  return rows;
}

export function generateLevel({ seed, zoneIndex = 0, cols = 5, rows = 4, cloudRow = 2, highRow = 3, enemyTypes = ['skeleton', 'knight', 'spearman'], level = 1 }) {
  const rng = mulberry32(hashSeed(seed, zoneIndex));
  const { cells, path } = carve(cols, rows, rng);
  const out = {
    seed, cols, rows, worldW: cols * ROOM_W, topY: GROUND_Y + TILE - rows * ROOM_H, groundY: GROUND_Y,
    solids: [], platforms: [], ladders: [], stairs: [], enemies: [], chests: [], shrines: [], torches: [], props: [], rails: [],
    doors: [], rooms: [],
    start: null, gate: null, route: [], cellInfo: [], bandOf: (r) => (r >= highRow ? 'sky' : r >= cloudRow ? 'cloud' : 'ground'),
    cloudRow, highRow,
  };
  const grid = {};
  let prevTpl = null;
  let sinceShrine = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[`${c},${r}`];
      let tpl;
      if (!cell) tpl = FILLER_TEMPLATE;
      else if (cell.order === 0) tpl = START_TEMPLATE;
      else if (cell === path[path.length - 1]) tpl = EXIT_TEMPLATE;
      else {
        sinceShrine += 1;
        const wantShrine = cell.onPath && sinceShrine >= 4 && rng() < 0.6;
        tpl = pickTemplate(cell, rng, prevTpl, wantShrine);
        if (tpl.name === 'shrine') sinceShrine = 0;
      }
      if (cell) prevTpl = tpl;
      const chars = cell ? sealTemplate(tpl, cell.exits) : tpl.rows.map((x) => x.split(''));
      grid[`${c},${r}`] = chars;
      out.cellInfo.push({ c, r, template: tpl.name, exits: cell ? [...cell.exits].sort().join('') : '', onPath: !!(cell && cell.onPath), branch: !!(cell && cell.branch) });
      extractGeometry(out, chars, c, r, rng, enemyTypes, level);
    }
  }
  buildRooms(out, cells, rng);
  buildRoute(out, path);
  out.enemyCount = out.enemies.length;
  return out;
}

// Rooms (with the arenas whose doors lock until the room is cleared) and the doors between them:
// an iron portcullis that opens as the player nears, or a cracked wall that must be broken through.
function buildRooms(out, cells, rng) {
  const arenas = new Set();
  for (const ci of out.cellInfo) {
    const cell = cells[`${ci.c},${ci.r}`];
    if (!cell) continue;
    const o = cellOrigin(ci.c, ci.r);
    const fighters = out.enemies.filter((e) => e.cell[0] === ci.c && e.cell[1] === ci.r && e.type !== 'bat').length;
    const neighbourArena = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => arenas.has(`${ci.c + dc},${ci.r + dr}`));
    const arena = ci.onPath && !['start', 'exit', 'shrine'].includes(ci.template) && fighters >= 2 && !neighbourArena && rng() < 0.6;
    if (arena) arenas.add(`${ci.c},${ci.r}`);
    out.rooms.push({ c: ci.c, r: ci.r, x: o.x, y: o.y, w: ROOM_W, h: ROOM_H, template: ci.template, arena, onPath: ci.onPath, branch: ci.branch, order: cell.order });
  }
  for (const ci of out.cellInfo) {
    const cell = cells[`${ci.c},${ci.r}`];
    if (!cell || !cell.exits.has('R')) continue;
    const nb = cells[`${ci.c + 1},${ci.r}`];
    if (!nb) continue;
    const o = cellOrigin(ci.c, ci.r);
    const side = cell.branch || nb.branch;
    // a side room usually hides behind a cracked wall; now and then one bars the path itself
    const breakable = cell.order !== 0 && rng() < (side ? 0.7 : 0.15);
    out.doors.push({ x: o.x + ROOM_W, y: o.y + (ROOM_ROWS - 1) * TILE, w: 2 * TILE, h: 3 * TILE, kind: breakable ? 'breakable' : 'door',
      band: out.bandOf(ci.r), cells: [[ci.c, ci.r], [ci.c + 1, ci.r]] });
  }
}

function extractGeometry(out, chars, c, r, rng, enemyTypes, level) {
  const o = cellOrigin(c, r);
  const band = out.bandOf(r);
  const wx = (tc) => o.x + tc * TILE;
  const wy = (tr) => o.y + tr * TILE;
  const isGroundFloor = (tr) => r === 0 && tr === ROOM_ROWS - 1;      // the moor itself
  // stairs: diagonal runs of '/' (up-right) and '\' (up-left)
  const seen = new Set();
  const underStair = new Set();   // masonry below a slope: drawn but not collidable (the slope line carries the walker)
  for (let tr = ROOM_ROWS - 1; tr >= 0; tr--) {
    for (let tc = 0; tc < ROOM_COLS; tc++) {
      const ch = chars[tr][tc];
      if ((ch !== '/' && ch !== '\\') || seen.has(`${tc},${tr}`)) continue;
      const dir = ch === '/' ? 1 : -1;
      let n = 0;
      while (tr - n >= 0 && tc + dir * n >= 0 && tc + dir * n < ROOM_COLS && chars[tr - n][tc + dir * n] === ch) {
        seen.add(`${tc + dir * n},${tr - n}`);
        for (let rr = tr - n + 1; rr < ROOM_ROWS; rr++) if (chars[rr][tc + dir * n] === '#') underStair.add(`${tc + dir * n},${rr}`);
        n++;
      }
      // walkable line from the bottom corner to the top corner
      const x0 = dir > 0 ? wx(tc) : wx(tc) + TILE, y0 = wy(tr) + TILE;
      const x1 = dir > 0 ? wx(tc) + n * TILE : wx(tc) + TILE - n * TILE, y1 = wy(tr) + TILE - n * TILE;
      out.stairs.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), yAtLeft: dir > 0 ? y0 : y1, yAtRight: dir > 0 ? y1 : y0, tiles: Array.from({ length: n }, (_, i) => ({ x: wx(tc + dir * i), y: wy(tr - i) })), dir, band });
    }
  }
  // solids and one-way platforms: merge horizontal runs
  for (let tr = 0; tr < ROOM_ROWS; tr++) {
    if (isGroundFloor(tr)) continue;
    for (const [ch, list] of [['#', out.solids], ['=', out.platforms]]) {
      let tc = 0;
      while (tc < ROOM_COLS) {
        if (chars[tr][tc] !== ch) { tc++; continue; }
        let n = 0;
        const noBody = ch === '#' && underStair.has(`${tc},${tr}`);
        while (tc + n < ROOM_COLS && chars[tr][tc + n] === ch && (ch !== '#' || underStair.has(`${tc + n},${tr}`) === noBody)) n++;
        const above = tr > 0 ? chars[tr - 1].slice(tc, tc + n) : null;
        const exposedTop = tr === 0 ? false : above.some((a) => a !== '#');
        list.push({ x: wx(tc), y: wy(tr), w: n * TILE, h: ch === '#' ? TILE : 20, band, top: ch === '#' ? exposedTop : true, noBody,
          capL: ch === '#' && (tc === 0 || chars[tr][tc - 1] !== '#'), capR: ch === '#' && (tc + n >= ROOM_COLS || chars[tr][tc + n] !== '#') });
        tc += n;
      }
    }
  }
  // ladders: vertical runs per column
  for (let tc = 0; tc < ROOM_COLS; tc++) {
    let tr = 0;
    while (tr < ROOM_ROWS) {
      if (chars[tr][tc] !== 'H') { tr++; continue; }
      let n = 0;
      while (tr + n < ROOM_ROWS && chars[tr + n][tc] === 'H') n++;
      // a ladder that reaches the ceiling continues up through the hole into the room above
      const reachesTop = tr === 0 || (tr === 1 && chars[0][tc] === '.');
      const top = reachesTop ? wy(0) - TILE : wy(tr);
      const bottom = wy(tr + n);
      out.ladders.push({ x: wx(tc) + TILE / 2, top, bottom, band });
      if (reachesTop) out.platforms.push({ x: wx(tc) - TILE / 2, y: wy(0) - TILE, w: TILE * 2, h: 14, band, top: true, ladderTop: true });
      tr += n;
    }
  }
  // slots
  for (let tr = 0; tr < ROOM_ROWS; tr++) {
    for (let tc = 0; tc < ROOM_COLS; tc++) {
      const ch = chars[tr][tc];
      if ('SBCFTPRAX'.indexOf(ch) < 0) continue;
      const x = wx(tc) + TILE / 2;
      const floorY = floorBelow(chars, tc, tr, wy);
      if (ch === 'S') {
        const type = band === 'sky' && rng() < 0.4 ? 'bat' : enemyTypes[Math.floor(rng() * enemyTypes.length)];
        out.enemies.push({ type, x, y: type === 'bat' ? floorY - 160 : floorY, band, level, cell: [c, r] });
      } else if (ch === 'B') out.enemies.push({ type: 'bat', x, y: floorY - 140, band, level, cell: [c, r] });
      else if (ch === 'C') out.chests.push({ x, y: floorY, band });
      else if (ch === 'F') out.shrines.push({ x, y: floorY, band });
      else if (ch === 'T') out.torches.push({ x, y: floorY, band });
      else if (ch === 'P') out.props.push({ x, y: floorY, band, kind: ['pillar', 'gravestone1', 'gravestone2', 'gravestone3', 'skull'][Math.floor(rng() * 5)] });
      else if (ch === 'R') out.rails.push({ x, y: floorY, band });
      else if (ch === 'A') out.start = { x, y: floorY };
      else if (ch === 'X') out.gate = { x, y: floorY };
    }
  }
}

function floorBelow(chars, tc, tr, wy) {
  for (let rr = tr + 1; rr < ROOM_ROWS; rr++) if (chars[rr][tc] === '#' || chars[rr][tc] === '=') return wy(rr);
  return wy(ROOM_ROWS);
}

function buildRoute(out, path) {
  const floorOf = (cell) => cellOrigin(cell.c, cell.r).y + (ROOM_ROWS - 1) * TILE;   // top of the floor row
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (b.r > a.r) {
      const o = cellOrigin(a.c, a.r);
      out.route.push({ type: 'ladder', x: o.x + LADDER_COL * TILE + TILE / 2, topY: floorOf(b), cell: [b.c, b.r] });
    } else {
      const o = cellOrigin(b.c, b.r);
      out.route.push({ type: 'walk', x: o.x + ROOM_W / 2, y: floorOf(b), cell: [b.c, b.r] });
    }
  }
  if (out.gate) out.route.push({ type: 'gate', x: out.gate.x, y: out.gate.y });
}

// Debug: ASCII map of the whole level (rows top to bottom).
export function levelToAscii(level) {
  const lines = [];
  for (let r = level.rows - 1; r >= 0; r--) {
    const row = level.cellInfo.filter((ci) => ci.r === r).sort((a, b) => a.c - b.c);
    lines.push(row.map((ci) => `${(ci.onPath ? '*' : ci.branch ? '+' : ' ')}${ci.template.padEnd(8)}${ci.exits.padEnd(4)}`).join(' | '));
  }
  return lines.join('\n');
}
