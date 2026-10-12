import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, START_TEMPLATE, EXIT_TEMPLATE, ROOM_COLS, ROOM_ROWS } from '../src/data/rooms.js';

const ALL = [...TEMPLATES, START_TEMPLATE, EXIT_TEMPLATE];
const isSolid = (ch) => ch === '#';
const isStair = (ch) => ch === '/' || ch === '\\';
const isOpen = (ch) => ch !== '#' && !isStair(ch);

function at(rows, c, r) { return c < 0 || c >= ROOM_COLS || r < 0 || r >= ROOM_ROWS ? '#' : rows[r][c]; }

// Standing positions a walker can occupy: feet at the bottom of tile (c, r) on solid or stair support
// with two tiles of headroom, or on a stair tile itself. Moves: walk, chain along stairs, hop up one
// or two tiles onto a step, drop off an edge. Returns the set of reachable "c,r" keys.
function reach(rows, startC, startR) {
  const standing = (c, r) => isOpen(at(rows, c, r)) && isOpen(at(rows, c, r - 1)) && (isSolid(at(rows, c, r + 1)) || isStair(at(rows, c, r + 1)));
  const onStair = (c, r) => isStair(at(rows, c, r)) && isOpen(at(rows, c, r - 1)) && isOpen(at(rows, c, r - 2));
  const valid = (c, r) => standing(c, r) || onStair(c, r);
  const key = (c, r) => `${c},${r}`;
  const seen = new Set([key(startC, startR)]);
  const stack = [[startC, startR]];
  const push = (c, r) => { if (valid(c, r) && !seen.has(key(c, r))) { seen.add(key(c, r)); stack.push([c, r]); } };
  while (stack.length) {
    const [c, r] = stack.pop();
    const ch = at(rows, c, r);
    if (isStair(ch)) {
      const up = ch === '/' ? 1 : -1;
      push(c + up, r - 1); push(c - up, r + 1);            // along the slope
      push(c + up, r); push(c - up, r);                    // off either end onto level ground
      continue;
    }
    for (const d of [-1, 1]) {
      push(c + d, r);                                       // walk
      push(c + d, r - 1); push(c + d, r - 2);               // hop onto a step (<= 2 tiles)
      for (let k = 1; k < ROOM_ROWS; k++) {                 // drop off the edge to the first landing
        if (!isOpen(at(rows, c + d, r + k - 1))) break;
        if (valid(c + d, r + k)) { push(c + d, r + k); break; }
      }
    }
  }
  return seen;
}

test('templates have the fixed frame: 20x11, door rows open at the edges, no one-way platforms', () => {
  for (const t of ALL) {
    assert.equal(t.rows.length, ROOM_ROWS, t.name);
    for (const row of t.rows) { assert.equal(row.length, ROOM_COLS, `${t.name}: ${row}`); assert.ok(!row.includes('='), `${t.name}: no floating platforms`); }
    for (const r of [7, 8, 9]) assert.ok(t.rows[r][0] === '.' && t.rows[r][ROOM_COLS - 1] === '.', `${t.name}: door row ${r} open at both edges`);
    if (t.ladder) for (let r = 1; r <= 9; r++) assert.ok(isOpen(t.rows[r][9]) && isOpen(t.rows[r][10]), `${t.name}: ladder columns clear at row ${r}`);
  }
});

test('every solid tile is attached to the floor, a wall or the ceiling (nothing floats)', () => {
  for (const t of ALL) {
    const rows = t.rows;
    const anchored = new Set();
    const stack = [];
    for (let c = 0; c < ROOM_COLS; c++) for (let r = 0; r < ROOM_ROWS; r++) {
      if ((r === 0 || r === ROOM_ROWS - 1 || c === 0 || c === ROOM_COLS - 1) && !isOpen(rows[r][c])) { anchored.add(`${c},${r}`); stack.push([c, r]); }
    }
    while (stack.length) {
      const [c, r] = stack.pop();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nc >= ROOM_COLS || nr < 0 || nr >= ROOM_ROWS || isOpen(rows[nr][nc]) || anchored.has(`${nc},${nr}`)) continue;
        anchored.add(`${nc},${nr}`); stack.push([nc, nr]);
      }
    }
    for (let r = 1; r < ROOM_ROWS - 1; r++) for (let c = 1; c < ROOM_COLS - 1; c++) {
      if (!isOpen(rows[r][c])) assert.ok(anchored.has(`${c},${r}`), `${t.name}: tile ${c},${r} floats\n${rows.join('\n')}`);
    }
  }
});

test('stair runs end on a landing whose top matches the run and keep headroom', () => {
  for (const t of ALL) {
    const rows = t.rows;
    for (let r = 0; r < ROOM_ROWS; r++) for (let c = 0; c < ROOM_COLS; c++) {
      const ch = rows[r][c];
      if (!isStair(ch)) continue;
      const up = ch === '/' ? 1 : -1;
      if (at(rows, c + up, r - 1) === ch) continue;          // not the top tile of the run
      // top tile: the tile beside it is the landing (solid), with open space above the landing and above the step
      assert.ok(isSolid(at(rows, c + up, r)), `${t.name}: stair top ${c},${r} needs a solid landing beside it`);
      assert.ok(isOpen(at(rows, c + up, r - 1)) && isOpen(at(rows, c, r - 1)), `${t.name}: headroom above stair top ${c},${r}`);
      // masonry under the whole run
      let cc = c, rr = r;
      while (isStair(at(rows, cc, rr))) { for (let k = rr + 1; k < ROOM_ROWS; k++) assert.ok(!isOpen(at(rows, cc, k)), `${t.name}: hollow under stair ${cc},${rr}`); cc -= up; rr += 1; }
    }
  }
});

test('both doors, the ladder shaft and every slot are reachable from either door', () => {
  for (const t of ALL) {
    // the floor hole under the ladder shaft is sealed or covered by a trapdoor in the game
    const rows = t.rows.map((row, r) => (r === ROOM_ROWS - 1 ? row.slice(0, 9) + '##' + row.slice(11) : row));
    const fromL = reach(rows, 0, 9), fromR = reach(rows, ROOM_COLS - 1, 9);
    const want = [[ROOM_COLS - 1, 9], [0, 9]];
    if (t.ladder) want.push([9, 9]);
    for (let r = 0; r < ROOM_ROWS; r++) for (let c = 0; c < ROOM_COLS; c++) {
      if ('SCFTAX'.includes(rows[r][c])) {
        let k = r; while (k < ROOM_ROWS - 1 && !isSolid(rows[k + 1][c])) k++;
        want.push([c, k]);
      }
    }
    for (const [c, r] of want) {
      assert.ok(fromL.has(`${c},${r}`), `${t.name}: ${c},${r} unreachable from the left door\n${rows.join('\n')}`);
      assert.ok(fromR.has(`${c},${r}`), `${t.name}: ${c},${r} unreachable from the right door\n${rows.join('\n')}`);
    }
  }
});
