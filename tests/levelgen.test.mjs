import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel, levelToAscii, ROOM_W, ROOM_H, GROUND_Y } from '../src/systems/LevelGen.js';
const TILE = 64;

test('generation is deterministic for a seed and differs across seeds', () => {
  const a = generateLevel({ seed: 12345, cols: 5, rows: 4 });
  const b = generateLevel({ seed: 12345, cols: 5, rows: 4 });
  const c = generateLevel({ seed: 54321, cols: 5, rows: 4 });
  assert.deepEqual(a.cellInfo, b.cellInfo);
  assert.deepEqual(a.route, b.route);
  assert.notDeepEqual(a.cellInfo, c.cellInfo);
});

test('critical path starts bottom-left, ends on the top row with a gate, and doors match', () => {
  for (const seed of [1, 2, 3, 7, 99, 2024, 777777]) {
    const L = generateLevel({ seed, cols: 5, rows: 4 });
    const info = new Map(L.cellInfo.map((ci) => [`${ci.c},${ci.r}`, ci]));
    const start = info.get('0,0');
    assert.ok(start.onPath && start.template === 'start', `seed ${seed}: start\n${levelToAscii(L)}`);
    const exit = L.cellInfo.find((ci) => ci.template === 'exit');
    assert.ok(exit && exit.r === L.rows - 1, `seed ${seed}: exit on top row`);
    assert.ok(L.start && L.gate, 'start and gate slots exist');
    for (const ci of L.cellInfo) {
      if (ci.exits.includes('R')) assert.ok(info.get(`${ci.c + 1},${ci.r}`).exits.includes('L'), `seed ${seed}: R door at ${ci.c},${ci.r} has a matching L`);
      if (ci.exits.includes('U')) assert.ok(info.get(`${ci.c},${ci.r + 1}`).exits.includes('D'), `seed ${seed}: U door at ${ci.c},${ci.r} has a matching D`);
    }
    // every U exit has a ladder reaching the room above, and every ladder has a top platform
    const ups = L.cellInfo.filter((ci) => ci.exits.includes('U')).length;
    const tall = L.ladders.filter((l) => l.bottom - l.top >= ROOM_H - 64).length;
    assert.equal(tall, ups, `seed ${seed}: ladders for U exits`);
    assert.ok(L.route.length >= 3 && L.route[L.route.length - 1].type === 'gate');
    assert.ok(L.enemies.length >= 3);
  }
});

test('geometry sits inside the world and the start is on the moor', () => {
  const L = generateLevel({ seed: 42, cols: 6, rows: 5 });
  assert.equal(L.worldW, 6 * ROOM_W);
  assert.equal(L.topY, GROUND_Y + TILE - 5 * ROOM_H);
  for (const s of L.solids) { assert.ok(s.x >= 0 && s.x + s.w <= L.worldW); assert.ok(s.y >= L.topY && s.y + s.h <= GROUND_Y + TILE); }
  assert.equal(L.start.y, GROUND_Y);
  assert.ok(['ground', 'cloud', 'sky'].includes(L.bandOf(4)));
});

test('stair slopes end on a landing with headroom and never cross a ladder top', () => {
  for (const seed of [1, 2, 3, 7, 42, 99, 2024]) {
    for (const zone of [{ cols: 5, rows: 4, zoneIndex: 0 }, { cols: 6, rows: 6, cloudRow: 3, highRow: 5, zoneIndex: 2 }]) {
      const L = generateLevel({ seed, ...zone });
      const solidAt = (x, y) => L.solids.some((s) => !s.noBody && x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h);
      for (const st of L.stairs) {
        const topX = st.dir > 0 ? st.x1 : st.x0, topY = st.dir > 0 ? st.yAtRight : st.yAtLeft;
        const inward = st.dir > 0 ? 1 : -1;
        // the tile beside the top corner is the landing (solid), the tile above it is open
        assert.ok(solidAt(topX + inward * 32, topY + 32), `seed ${seed}: stair landing at ${topX},${topY} is solid\n${levelToAscii(L)}`);
        assert.ok(!solidAt(topX + inward * 32, topY - 32), `seed ${seed}: headroom above the landing at ${topX},${topY}`);
        assert.ok(!solidAt(topX - inward * 32, topY - 32), `seed ${seed}: headroom above the top step at ${topX},${topY}`);
      }
      for (const l of L.ladders) {
        const crossing = L.stairs.find((st) => l.x > st.x0 - 24 && l.x < st.x1 + 24 && Math.abs((st.dir > 0 ? st.yAtLeft : st.yAtRight) - l.top) < 70);
        assert.ok(!crossing, `seed ${seed}: a stair slope crosses the ladder landing at ${l.x},${l.top}`);
      }
    }
  }
});

test('every horizontal connection has a door or a breakable wall, arenas sit on the path with company', () => {
  for (const seed of [1, 2, 3, 7, 42, 99, 2024]) {
    const L = generateLevel({ seed, cols: 6, rows: 5, cloudRow: 2, highRow: 4, zoneIndex: 1 });
    const info = new Map(L.cellInfo.map((ci) => [`${ci.c},${ci.r}`, ci]));
    const rights = L.cellInfo.filter((ci) => ci.exits.includes('R')).length;
    assert.equal(L.doors.length, rights, `seed ${seed}: one door per R exit`);
    for (const d of L.doors) {
      assert.ok(['door', 'breakable'].includes(d.kind));
      const [a, b] = d.cells;
      assert.ok(info.get(`${a[0]},${a[1]}`).exits.includes('R') && info.get(`${b[0]},${b[1]}`).exits.includes('L'), `seed ${seed}: door joins two connected cells`);
      assert.equal(d.x, (a[0] + 1) * ROOM_W, 'door sits on the cell boundary');
      assert.equal(d.y, L.groundY - a[1] * ROOM_H, 'door foot is on the floor of its row');
      if (d.kind === 'breakable') assert.ok(info.get(`${a[0]},${a[1]}`).template !== 'start', 'the start room never opens with a wall to break');
    }
    const arenas = L.rooms.filter((r) => r.arena);
    for (const r of arenas) {
      assert.ok(r.onPath && !['start', 'exit', 'shrine'].includes(r.template), `seed ${seed}: arena on the path`);
      const fighters = L.enemies.filter((e) => e.cell[0] === r.c && e.cell[1] === r.r && e.type !== 'bat').length;
      assert.ok(fighters >= 2, `seed ${seed}: arena ${r.c},${r.r} has ${fighters} fighters`);
      for (const q of arenas) if (q !== r) assert.ok(Math.abs(q.c - r.c) + Math.abs(q.r - r.r) > 1, `seed ${seed}: arenas are not adjacent`);
    }
    // the generated level also obeys the template rules: nothing floats, everything stands on something
    assert.equal(L.platforms.filter((p) => !p.ladderTop).length, 0, `seed ${seed}: no floating platforms`);
  }
});

// Whole-level walkability: rebuild the tile grid from the generated geometry and walk it with the
// same movement model as the room tests (walk, stairs, 2-tile hops, drops) plus ladders and the
// trapdoor covers. The gate and every fighter, chest and shrine must be reachable from the start.
function levelGrid(L) {
  const W = L.cols * 20, H = L.rows * 11;
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const tc = (x) => Math.floor(x / TILE), tr = (y) => Math.floor((y - L.topY) / TILE);
  for (const s of L.solids) for (let c = tc(s.x); c < tc(s.x + s.w); c++) for (let r = tr(s.y); r < tr(s.y + s.h); r++) g[r][c] = '#';
  for (const st of L.stairs) for (const t of st.tiles) g[tr(t.y)][tc(t.x)] = st.dir > 0 ? '/' : '\\';
  for (const l of L.ladders) for (let r = tr(l.top); r < tr(l.bottom); r++) if (g[r][tc(l.x)] === '.') g[r][tc(l.x)] = 'H';
  // trapdoor covers over the ladder shafts (they overlap the ladder's top tile)
  for (const p of L.platforms) for (let c = tc(p.x + 1); c <= tc(p.x + p.w - 1); c++) if (g[tr(p.y)][c] !== '#') g[tr(p.y)][c] = '=';
  return { g, W, H, tc, tr };
}

function walkLevel(L) {
  const { g, W, H, tc, tr } = levelGrid(L);
  const at = (c, r) => (c < 0 || c >= W || r < 0 || r >= H ? '#' : r === H ? '#' : g[r][c]);
  const open = (ch) => ch === '.' || ch === 'H';
  const support = (ch) => ch === '#' || ch === '/' || ch === '\\' || ch === '=';
  const floorRow = tr(L.groundY);                         // row index of the moor surface (one below the last room row)
  const standing = (c, r) => open(at(c, r)) && open(at(c, r - 1)) && (r + 1 === floorRow || support(at(c, r + 1)));
  const onStair = (c, r) => (at(c, r) === '/' || at(c, r) === '\\') && open(at(c, r - 1)) && open(at(c, r - 2));
  const onLadder = (c, r) => at(c, r) === 'H';
  const valid = (c, r) => standing(c, r) || onStair(c, r) || onLadder(c, r);
  const key = (c, r) => `${c},${r}`;
  const startC = tc(L.start.x), startR = tr(L.start.y) - 1;
  const seen = new Set([key(startC, startR)]);
  const stack = [[startC, startR]];
  const push = (c, r) => { if (valid(c, r) && !seen.has(key(c, r))) { seen.add(key(c, r)); stack.push([c, r]); } };
  while (stack.length) {
    const [c, r] = stack.pop();
    const ch = at(c, r);
    if (ch === '/' || ch === '\\') {
      const up = ch === '/' ? 1 : -1;
      push(c + up, r - 1); push(c - up, r + 1); push(c + up, r); push(c - up, r);
      continue;
    }
    if (ch === 'H') {
      push(c, r + 1); push(c, r - 1);
      if (at(c, r - 1) === '=') push(c, r - 2);                                // top out onto the trapdoor cover
      if (at(c, r - 1) === '.' && standing(c, r - 1)) push(c, r - 1);
      push(c - 1, r); push(c + 1, r);                                          // step off sideways
      continue;
    }
    if (at(c, r + 1) === '=' && at(c, r + 2) === 'H') push(c, r + 2);          // climb down through the cover
    for (const d of [-1, 1]) {
      push(c + d, r); push(c + d, r - 1); push(c + d, r - 2);
      for (let k = 1; k < 12; k++) {
        if (!open(at(c + d, r + k - 1))) break;
        if (valid(c + d, r + k)) { push(c + d, r + k); break; }
      }
    }
    if (at(c, r + 1) === 'H') push(c, r + 1);
  }
  return { seen, tc, tr, key };
}

test('every generated level can be walked from the start to the gate and to every foe, chest and shrine', () => {
  for (const seed of [1, 2, 3, 4, 5, 7, 9, 42, 99, 2024]) {
    for (const zone of [{ cols: 5, rows: 4, zoneIndex: 0 }, { cols: 6, rows: 5, cloudRow: 2, highRow: 4, zoneIndex: 1 }, { cols: 6, rows: 6, cloudRow: 3, highRow: 5, zoneIndex: 2 }]) {
      const L = generateLevel({ seed, ...zone });
      const { seen, tc, tr, key } = walkLevel(L);
      const reach = (x, y, what) => assert.ok(seen.has(key(tc(x), tr(y) - 1)), `seed ${seed} zone ${zone.zoneIndex}: ${what} at ${x},${y} unreachable\n${levelToAscii(L)}`);
      reach(L.gate.x, L.gate.y, 'gate');
      for (const e of L.enemies) if (e.type !== 'bat') reach(e.x, e.y, `enemy ${e.type}`);
      for (const c of L.chests) reach(c.x, c.y, 'chest');
      for (const s of L.shrines) reach(s.x, s.y, 'shrine');
    }
  }
});
