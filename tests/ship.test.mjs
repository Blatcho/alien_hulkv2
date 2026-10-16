import test from 'node:test';
import assert from 'node:assert/strict';
import { generateShip, graphDistances, roomPath, shipToAscii, T, TILE, CELL_W, DECK_H } from '../src/gen/Ship.js';

const SEEDS = [1, 2, 3, 7, 42, 99, 2024, 777777];

test('generation is deterministic for a seed and differs across seeds', () => {
  const a = generateShip({ seed: 5 }), b = generateShip({ seed: 5 }), c = generateShip({ seed: 6 });
  assert.deepEqual(Array.from(a.grid), Array.from(b.grid));
  assert.notDeepEqual(Array.from(a.grid), Array.from(c.grid));
  assert.equal(a.rooms.length, b.rooms.length);
});

test('every room is reachable from the airlock through doors, ladders and stairs', () => {
  for (const seed of SEEDS) {
    const ship = generateShip({ seed });
    const dist = graphDistances(ship.rooms, ship.airlock);
    for (const room of ship.rooms) assert.ok(Number.isFinite(dist[room.id]), `seed ${seed}: room ${room.id} (${room.type}) unreachable\n${shipToAscii(ship)}`);
    assert.ok(roomPath(ship.rooms, ship.airlock, ship.bridge), 'a path to the bridge exists');
    // loops: more edges than a tree
    const edgeCount = ship.rooms.reduce((n, r) => n + r.edges.length, 0) / 2;
    assert.ok(edgeCount >= ship.rooms.length - 1, 'at least a spanning tree');
  }
});

test('fixed rooms: airlock at the stern on the middle deck, bridge at the bow on the top deck, hives far away', () => {
  for (const seed of SEEDS) {
    const ship = generateShip({ seed });
    const airlock = ship.rooms[ship.airlock], bridge = ship.rooms[ship.bridge];
    assert.equal(airlock.c1, ship.cols - 1); assert.equal(airlock.deck, 1);
    assert.equal(bridge.c0, 0); assert.equal(bridge.deck, ship.decks - 1);
    const hives = ship.rooms.filter((r) => r.type === 'hive');
    assert.ok(hives.length >= 2, 'hives exist');
    for (const h of hives) assert.ok(ship.dist[h.id] >= 3, `seed ${seed}: hive ${h.id} is ${ship.dist[h.id]} rooms from the airlock`);
    assert.ok(ship.survivors.length >= 2, 'survivors to rescue');
    for (const s of ship.survivors) assert.ok(ship.rooms[s.room].type !== 'hive');
    assert.equal(ship.rooms[ship.objective.room].id, ship.bridge);
    assert.ok(ship.events.some((e) => e.kind === 'blackout') && ship.events.some((e) => e.kind === 'fire'));
  }
});

test('doors sit in bulkheads at floor level, ladders and stairs fit between decks', () => {
  for (const seed of SEEDS) {
    const ship = generateShip({ seed });
    const at = ship.tileAt;
    for (const d of ship.doors) {
      assert.equal(d.col % CELL_W, 0, 'door in a bulkhead column');
      assert.equal(d.row % DECK_H, 1, 'door starts on the first interior row');
      for (let r = d.row; r < d.row + d.h; r++) assert.equal(at(d.col, r), T.DOOR);
      assert.equal(at(d.col, d.row - 1), T.SOLID, 'floor under the door');
      assert.equal(at(d.col - 1, d.row), T.EMPTY, 'open on the left'); assert.equal(at(d.col + 1, d.row), T.EMPTY, 'open on the right');
    }
    for (const l of ship.ladders) {
      for (let r = l.rBottom; r < l.rTop; r++) assert.equal(at(l.col, r), T.LADDER, `seed ${seed}: ladder tile ${l.col},${r}`);
      assert.equal(at(l.col, l.rTop), T.HATCH, 'hatch in the upper floor');
      assert.equal(at(l.col, l.rTop + 1), T.EMPTY, 'room above the hatch');
      assert.equal(at(l.col, l.rBottom - 1), T.SOLID, 'floor under the ladder');
    }
    for (const s of ship.stairs) {
      assert.equal(s.tiles.length, DECK_H);
      const top = s.tiles[s.tiles.length - 1];
      assert.equal(top.r % DECK_H, 0, 'the top step sits in the upper floor row');
      assert.ok([T.SOLID, T.VENT].includes(at(top.c + s.dir, top.r)), 'landing beyond the top step');
      assert.equal(at(top.c + s.dir, top.r + 1), T.EMPTY, 'headroom over the landing');
      for (const t of s.tiles.slice(0, -1)) assert.equal(at(t.c, t.r + 1), T.EMPTY, `seed ${seed}: headroom over step ${t.c},${t.r}`);
      assert.equal(at(s.tiles[0].c - s.dir, s.tiles[0].r), T.EMPTY, 'approach to the bottom step is open');
      assert.equal(at(s.tiles[0].c - s.dir, s.tiles[0].r - 1), T.SOLID, 'floor before the bottom step');
    }
    for (const v of ship.vents) { assert.equal(at(v.pa.c, v.pa.r), T.VENT); assert.equal(at(v.pb.c, v.pb.r), T.VENT); }
    // the airlock opening is in the rear hull at the start's floor level
    assert.equal(at(ship.W - 1, ship.rooms[ship.airlock].y0), T.AIRLOCK);
  }
});

test('props, loot and survivors stand on floor inside their rooms and never share a column', () => {
  for (const seed of SEEDS) {
    const ship = generateShip({ seed });
    const at = ship.tileAt;
    const seen = new Set();
    for (const p of [...ship.props, ...ship.loot, ...ship.survivors, ship.objective]) {
      const c = Math.floor(p.x / TILE), r = Math.floor(p.y / TILE);
      const room = ship.rooms[p.room];
      assert.ok(c >= room.x0 && c <= room.x1 && r === room.y0, `seed ${seed}: ${p.kind || 'survivor'} inside room ${room.id}`);
      assert.ok(at(c, r) === T.EMPTY, 'stands in open space');
      assert.ok(at(c, r - 1) === T.SOLID || at(c, r - 1) === T.HATCH, 'floor beneath');
      const key = `${c},${room.deck}`;
      assert.ok(!seen.has(key), `seed ${seed}: two things at column ${c} on deck ${room.deck}`);
      seen.add(key);
    }
  }
});
