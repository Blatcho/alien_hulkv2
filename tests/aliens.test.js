// Hostile breeds and the high road: aliens crawl up bulkheads and along ceilings and drop on
// the squad (sim/alien.js).
import { beforeAll, describe, expect, it } from 'vitest';
import { ALIEN_TYPES } from '../src/core/config.js';
import { Rng } from '../src/core/rng.js';
import { ceilingSpans, generateLevel, shaftOpening, wallFace } from '../src/gen/level.js';
import { initPhysics } from '../src/physics/physics.js';
import { makeAlien, pickAlienType } from '../src/sim/entities.js';
import { World } from '../src/sim/world.js';
import { bodyPoint } from '../src/vis/sight.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };

describe('alien breeds', () => {
  it('each breed has its own size, toughness, speed and claws', () => {
    const rng = new Rng('T', 't');
    const drone = makeAlien(rng, 0, 0, 0, 'hunt', { type: 'drone' });
    const brute = makeAlien(rng, 0, 0, 0, 'hunt', { type: 'brute' });
    const runner = makeAlien(rng, 0, 0, 0, 'hunt', { type: 'runner' });
    expect(brute.hp).toBeGreaterThan(drone.hp * 2);
    expect(brute.height).toBeGreaterThan(drone.height);
    expect(brute.speed).toBeLessThan(drone.speed);
    expect(brute.damage[0]).toBeGreaterThan(drone.damage[1]);
    expect(runner.speed).toBeGreaterThan(drone.speed);
    expect(runner.height).toBeLessThan(drone.height);
    expect(makeAlien(rng, 0, 0, 0, 'hunt', { type: 'nonsense' }).type).toBe('drone');
  });

  it('the big and nasty ones turn up more the deeper you go', () => {
    const count = (depth) => {
      const rng = new Rng('BREED', String(depth));
      let brutes = 0;
      for (let i = 0; i < 2000; i++) if (pickAlienType(rng, depth) === 'brute') brutes++;
      return brutes;
    };
    expect(count(1)).toBeGreaterThan(count(0) * 1.8);
    expect(Object.keys(ALIEN_TYPES)).toEqual(expect.arrayContaining(['drone', 'runner', 'creeper', 'brute']));
  });

  it('ships carry a mix, and some climbers sleep on ceilings and bulkheads', () => {
    const types = new Set();
    const high = { ceiling: 0, wall: 0 };
    for (let i = 0; i < 40; i++) {
      const L = generateLevel(`MIX${i}`);
      for (const s of L.spawns.aliens) {
        types.add(s.type);
        const room = L.rooms[s.room];
        if (s.surface === 'ceiling') {
          high.ceiling++;
          expect(s.y).toBe(room.y1);
          expect(ceilingSpans(L, room).some(([a, b]) => s.x > a && s.x < b)).toBe(true);
        }
        if (s.surface === 'wall') {
          high.wall++;
          expect(s.x).toBe(wallFace(room, s.side));
          expect(s.y).toBeGreaterThan(room.y0 + 1.5);
          expect(s.y).toBeLessThanOrEqual(room.y0 + 4);
          expect(ALIEN_TYPES[s.type].climb).toBeGreaterThan(0); // brutes never climb
        }
      }
    }
    // (The queen only ever sits in a boss hulk's nest - gen/contracts.js.)
    expect([...types].sort()).toEqual(Object.keys(ALIEN_TYPES).filter((k) => !ALIEN_TYPES[k].royal).sort());
    expect(high.ceiling).toBeGreaterThan(5);
    expect(high.wall).toBeGreaterThan(2);
  });
});

describe('walls and ceilings', () => {
  it('a ceiling runs wall to wall, broken where ladders and stairs go up through it', () => {
    let checked = 0;
    for (let i = 0; i < 20; i++) {
      const L = generateLevel(`CEIL${i}`);
      for (const p of L.portals.filter((q) => q.kind !== 'door')) {
        const room = L.rooms[p.a]; // the lower room: its ceiling has the opening
        const [h0, h1] = shaftOpening(p);
        for (const [a, b] of ceilingSpans(L, room)) expect(b <= h0 + 1e-6 || a >= h1 - 1e-6).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('their bodies hang from the ceiling and stand out from the bulkhead', () => {
    const a = { x: 10, y: 4.5, height: 1.5, surface: 'ceiling' };
    expect(bodyPoint(a, 0.5)).toEqual({ x: 10, y: 3.75 });
    expect(bodyPoint({ ...a, surface: 'wall', side: -1, y: 2 }, 0.5)).toEqual({ x: 10.75, y: 2 });
    expect(bodyPoint({ ...a, surface: 'wall', side: 1, y: 2 }, 0.5)).toEqual({ x: 9.25, y: 2 });
    expect(bodyPoint({ ...a, surface: 'floor', y: 0 }, 0.5)).toEqual({ x: 10, y: 0.75 });
  });

  it('in a real run they take the high road and drop on the squad - but only strike from the floor', () => {
    let drops = 0;
    let climbs = 0;
    let highs = 0;
    // (Ships with a bulkhead or two on the way: climbing is a matter of where the squad gets ambushed.)
    for (const seed of ['B2', 'E5', 'J9']) {
      const w = new World(generateLevel(seed), { params: { god: true } });
      w.on('alien-drop', () => drops++);
      w.on('alien-climb', () => climbs++);
      w.on('strike', ({ alien }) => expect(alien.surface).toBe('floor'));
      for (let i = 0; i < 600 * 60 && w.status === 'playing'; i++) {
        w.step(STEP);
        if (i % 30 === 0) highs += w.aliens.filter((a) => a.alive && a.surface === 'ceiling' && a.state === 'hunt').length;
      }
      expect(w.status).toBe('won');
    }
    expect(drops).toBeGreaterThan(5);
    expect(climbs).toBeGreaterThan(0);
    expect(highs).toBeGreaterThan(10);
  }, 120000);

  it('one shot dead on the ceiling falls to the floor', () => {
    const w = new World(generateLevel('A1'), { params: { god: true } });
    const room = w.level.rooms.find((r) => r.dist >= 2 && !r.exterior);
    const x = ceilingSpans(w.level, room)[0][0] + 1;
    const a = w.addAlien(makeAlien(w.rng, x, room.y1, room.id, 'hunt', { type: 'creeper', surface: 'ceiling' }));
    w.damage(a, 999, null);
    run(w, 2);
    expect(a.alive).toBe(false);
    expect(a.surface).toBe('floor');
    expect(a.y).toBeCloseTo(room.y0, 5);
  });

  it('a breacher blast knocks a crawler off the ceiling', () => {
    const w = new World(generateLevel('A1'), { params: { god: true } });
    const room = w.level.rooms.find((r) => r.dist >= 2 && !r.exterior);
    const x = ceilingSpans(w.level, room)[0][0] + 1;
    const a = w.addAlien(makeAlien(w.rng, x, room.y1, room.id, 'hunt', { type: 'creeper', surface: 'ceiling' }));
    w.damage(a, 5, null, { stagger: 0.35 });
    expect(a.state).toBe('drop');
    run(w, 1);
    expect(a.surface).toBe('floor');
  });
});
