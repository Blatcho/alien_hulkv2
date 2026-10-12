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
