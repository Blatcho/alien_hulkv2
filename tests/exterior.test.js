// The hull classes' looks (gen/classes.js look) and their silhouettes beyond the hull
// (render/exterior.js): every class dresses, and nothing it hangs outside sits in a room, in the
// hull, the slabs or the plating, or where the boarding ship is.
import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/config.js';
import { CLASS_KEYS, HULL_CLASSES, seedCode } from '../src/gen/classes.js';
import { DOCK, generateLevel } from '../src/gen/level.js';
import { ROOM_TYPES } from '../src/gen/templates.js';
import { exteriorPieces, GLOW } from '../src/render/exterior.js';

const { DECK_H, SLAB } = WORLD;
const overlaps = (a, b) => a.x0 < b.x1 - 1e-6 && a.x1 > b.x0 + 1e-6 && a.y0 < b.y1 - 1e-6 && a.y1 > b.y0 + 1e-6;

describe('the classes\' looks', () => {
  it('every class has a tint, lamp and sky colour, a wear level and a silhouette', () => {
    for (const k of CLASS_KEYS) {
      const L = HULL_CLASSES[k].look;
      expect(L.tint).toHaveLength(3);
      for (const c of L.tint) expect(c).toBeGreaterThan(0.7);
      expect(L.wear).toBeGreaterThanOrEqual(0);
      expect(L.wear).toBeLessThanOrEqual(1);
      expect(L.lamp).toBeGreaterThan(0);
      expect(L.sky).toBeGreaterThan(0);
      expect(typeof L.exterior).toBe('string');
      // Backdrop overrides name room types and wall variants that exist (or that the kit will have).
      for (const [type, bd] of Object.entries(L.backdrops ?? {})) {
        expect(ROOM_TYPES[type]).toBeTruthy();
        for (const w of Object.values(bd)) expect(w).toBeGreaterThan(0);
      }
    }
  });
});

describe('the silhouette beyond the hull', () => {
  const seeds = CLASS_KEYS.flatMap((k) => Array.from({ length: 8 }, (_, i) => seedCode(k, `X${i}`)));

  it('every class hangs pieces outside, some of them lit, and none of them in the way', () => {
    const kinds = new Set();
    for (const seed of seeds) {
      const L = generateLevel(seed);
      const pieces = exteriorPieces(L);
      kinds.add(HULL_CLASSES[L.cls].look.exterior);
      expect(pieces.length).toBeGreaterThan(3);
      expect(pieces.some((p) => p.glow)).toBe(true);
      // Where the ship is: its rooms, the hull box of each deck (hull walls and slabs), the plating
      // above the roof and below the keel - and the Kestrel with its boarding tube.
      const solid = [
        ...L.rooms.filter((r) => !r.exterior).map((r) => ({ x0: r.x0 - WORLD.HULL, x1: r.x1 + WORLD.HULL, y0: r.y0 - SLAB, y1: r.y1 + SLAB })),
        ...L.solids.filter((s) => s.kind !== 'dock'),
      ];
      const dock = L.rooms[L.dock];
      const nose = L.mirror ? dock.x1 + (DOCK.NOSE - DOCK.BAY) : dock.x0 - (DOCK.NOSE - DOCK.BAY);
      const kestrel = { x0: Math.min(nose, dock.x0), x1: Math.max(nose, dock.x1), y0: dock.y0 - 1.5, y1: dock.y0 + 5.6 };
      for (const p of pieces) {
        expect(p.x1).toBeGreaterThan(p.x0);
        expect(p.y1).toBeGreaterThan(p.y0);
        expect(p.z1).toBeGreaterThan(p.z0);
        const lightOnPlating = p.glow && p.z0 >= WORLD.FRONT_Z - 0.5 - 1e-6; // windows sit on the plating's face
        for (const s of solid) {
          if (overlaps(p, s)) {
            // Only a light on a plating face may lie within the plating's own band.
            const onPlating = lightOnPlating && (p.y1 <= -SLAB + 1e-6 || p.y0 >= L.decks * DECK_H - 1e-6);
            expect(onPlating, `${seed} ${L.cls}: piece ${JSON.stringify(p)} overlaps ${JSON.stringify(s)}`).toBe(true);
          }
        }
        expect(overlaps(p, kestrel), `${seed} ${L.cls}: piece ${JSON.stringify(p)} is where the Kestrel docks`).toBe(false);
      }
    }
    expect([...kinds].sort()).toEqual(['hauler', 'liner', 'research', 'station', 'warship']);
  });

  it('a starboard dock mirrors the silhouette', () => {
    // The same bare seed never mirrors differently, so compare a mirrored ship with its own geometry:
    // the drives sit aft (the dock side), the bow pieces fore, whichever way the ship faces.
    let seen = 0;
    for (const seed of seeds) {
      const L = generateLevel(seed);
      if (!L.mirror) continue;
      seen++;
      const pieces = exteriorPieces(L);
      const burner = pieces.find((p) => p.glow === GLOW.blue || p.glow === GLOW.orange || p.glow === GLOW.white || p.glow === GLOW.cold);
      if (!burner) continue; // stations have no drives
      expect(burner.x0).toBeGreaterThan(L.cols * WORLD.CELL_W / 2); // aft is to the right on a mirrored ship
    }
    expect(seen).toBeGreaterThan(0);
  });
});
