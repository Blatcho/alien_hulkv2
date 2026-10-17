import { describe, expect, it } from 'vitest';
import { generateLevel, roomAt } from '../src/gen/level.js';
import { bfs, walkLimits } from '../src/gen/layout.js';
import { clearZones } from '../src/gen/populate.js';
import { NavGraph } from '../src/nav/graph.js';
import { Rng } from '../src/core/rng.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `T${i}`);

describe('rng', () => {
  it('is deterministic per seed and stream', () => {
    const a = new Rng('X', 's');
    const b = new Rng('X', 's');
    const c = new Rng('X', 't');
    const sa = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(sa);
    expect(c.next()).not.toEqual(sa[0]);
  });
});

describe('level generation', () => {
  it('is deterministic', () => {
    const a = generateLevel('SAME');
    const b = generateLevel('SAME');
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it.each(SEEDS)('seed %s: connected, long enough, well-formed', (seed) => {
    const L = generateLevel(seed);
    // every room reachable from the airlock
    const { dist } = bfs(L.rooms, L.portals, L.airlock);
    expect(dist.every(Number.isFinite)).toBe(true);
    expect(L.mainPath[0]).toBe(L.airlock);
    expect(L.mainPath[L.mainPath.length - 1]).toBe(L.cockpit);
    expect(L.mainPath.length).toBeGreaterThanOrEqual(9);
    expect(L.rooms[L.airlock].deck).toBe(0);
    expect(L.rooms[L.cockpit].deck).toBe(L.decks - 1);
    expect(L.objective).toBeTruthy();

    for (const r of L.rooms.filter((q) => !q.exterior)) {
      expect(r.c1 - r.c0 + 1).toBeGreaterThanOrEqual(2);
      const zones = clearZones(L, r);
      const [wl, wr] = walkLimits(r);
      for (const p of r.props) {
        expect(p.x).toBeGreaterThanOrEqual(wl - 0.01);
        expect(p.x).toBeLessThanOrEqual(wr + 0.01);
        if (r.type !== 'airlock' && r.type !== 'cockpit') {
          expect(zones.some(([u, v]) => p.x > u && p.x < v)).toBe(false);
        }
      }
    }
    for (const p of L.portals) {
      if (p.outer) continue;
      if (p.kind === 'door') expect(L.rooms[p.a].deck).toBe(L.rooms[p.b].deck);
      else {
        expect(L.rooms[p.b].deck).toBe(L.rooms[p.a].deck + 1);
        const xs = p.kind === 'ladder' ? [p.x] : [p.xb, p.xt];
        for (const x of xs) {
          for (const id of [p.a, p.b]) {
            const [wl, wr] = walkLimits(L.rooms[id]);
            expect(x).toBeGreaterThan(wl);
            expect(x).toBeLessThan(wr);
          }
        }
      }
    }
    // no enemies in the first two rooms
    for (const a of L.spawns.aliens) expect(L.rooms[a.room].dist).toBeGreaterThanOrEqual(2);
    // the squad spawns aboard the docked boarding ship, one door from the airlock
    expect(roomAt(L, L.spawns.squad.x, L.rooms[L.airlock].y0 + 1)).toBe(L.dock);
    const outer = L.portals.find((p) => p.outer);
    expect([outer.a, outer.b].sort()).toEqual([L.dock, L.airlock].sort());
  });
});

describe('navigation', () => {
  it.each(SEEDS.slice(0, 80))('seed %s: routes airlock -> cockpit', (seed) => {
    const L = generateLevel(seed);
    const nav = new NavGraph(L);
    const r = nav.route({ room: L.airlock, x: L.spawns.squad.x }, { room: L.cockpit, x: L.objective.x });
    expect(r).not.toBeNull();
    const portals = r.steps.filter((s) => s.type === 'portal');
    // consecutive portals chain rooms correctly
    let room = L.airlock;
    for (const s of portals) {
      expect(s.from).toBe(room);
      room = s.to;
    }
    expect(room).toBe(L.cockpit);
    // aliens with vents never need longer than marines
    const rv = nav.route({ room: L.airlock, x: L.spawns.squad.x }, { room: L.cockpit, x: L.objective.x }, { vents: true });
    expect(rv.cost).toBeLessThanOrEqual(r.cost + 1e-6);
  });
});
