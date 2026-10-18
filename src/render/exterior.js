// Exterior dressing: the derelict seen from outside, by hull class (gen/classes.js look.exterior).
// Drives, cargo pods, a bridge house, fins, a dish, a boom, solar arrays and running lights beyond
// the hull - all box geometry with vertex colours (render/batch.js boxGeo), so no art has to be
// built for a class to have its own silhouette against the stars. Lit parts are emissive boxes
// (the bloom picks them up). The fog-of-war treats everything outside the hull as space, so the
// whole silhouette is seen from the start.
//
// exteriorPieces() is pure level data in, boxes out: tests check the boxes clear the hull, the
// plating and the boarding ship (tests/exterior.test.js); levelView.js draws them.
import { WORLD } from '../core/config.js';
import { HULL_CLASSES } from '../gen/classes.js';

const { DECK_H, HULL, SLAB } = WORLD;
const Z = [-2.3, -0.3];               // depth band: within the plating's depth, behind its front face
const FACE = WORLD.FRONT_Z - 0.5;     // the plating's front face (levelView.js buildStructure)

// A shade lighter than the plating (0x1d2024): seen against space, under the fill light only.
const C = {
  plating: 0x2a2f35, hull: 0x30363c, steel: 0x4a5056, dark: 0x1c2024, nacelle: 0x383e45, burner: 0x101214,
  container: 0x5e3024, olive: 0x4c5440, solar: 0x1c2c4a, dish: 0x565d64,
};
export const GLOW = { blue: 0x3d7cff, orange: 0xff7a2a, warm: 0xc9955a, cold: 0x5ff0d8, red: 0xff3a22, green: 0x3aff6a, white: 0xd8e8ff };

/** Interior x-extent of a deck's rooms, halls from the deck below included (the hull adds HULL beyond each end). */
function extent(level, d) {
  const rs = level.rooms.filter((r) => !r.exterior && (r.deck === d || (r.tall && r.deck === d - 1)));
  return [Math.min(...rs.map((r) => r.x0)), Math.max(...rs.map((r) => r.x1))];
}

/**
 * The pieces for a level: [{ x0, x1, y0, y1, z0, z1, color, glow }]. glow = an emissive colour
 * (the piece is a light), else color is its vertex colour. Everything is placed from the level's
 * own geometry and heading, so a mirrored (starboard-docked) ship comes out mirrored.
 */
export function exteriorPieces(level) {
  const kind = HULL_CLASSES[level.cls]?.look?.exterior;
  const out = [];
  if (!kind) return out;
  const H = level.heading ?? 1;
  const D = level.decks;
  const ext = Array.from({ length: D }, (_, d) => extent(level, d));
  const aft = (d) => (H > 0 ? ext[d][0] - HULL : ext[d][1] + HULL);   // outer face of the aft hull
  const fore = (d) => (H > 0 ? ext[d][1] + HULL : ext[d][0] - HULL);
  const len = (d) => (fore(d) - aft(d)) * H;
  const at = (d, s) => aft(d) + H * s;                                // s metres fore of deck d's aft face
  const band = (d) => [d * DECK_H, (d + 1) * DECK_H - SLAB];          // a deck's interior height
  const roof = D * DECK_H + 1.4;                                      // top of the roof plating
  const keel = -SLAB - 1.6;                                           // underside of the keel plating
  const top = D - 1;
  const box = (xa, xb, y0, y1, color, o = {}) => out.push({
    x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0, y1, z0: o.z0 ?? Z[0], z1: o.z1 ?? Z[1], color, glow: o.glow ?? null,
  });
  const lit = (xa, xb, y0, y1, glow) => box(xa, xb, y0, y1, 0, { glow, z0: FACE, z1: FACE + 0.1 }); // a light on a plating face
  const beacon = (x, y, glow) => box(x - 0.12, x + 0.12, y - 0.12, y + 0.12, 0, { glow, z0: -1.45, z1: -1.15 });
  /** A drive aft of deck d: a nacelle L long with its burner lit. Never on the dock deck (the tube is there). */
  const drive = (d, L, glow, inset = 0.6) => {
    if (d < 0 || d === level.dockDeck) return;
    const [y0, y1] = band(d);
    box(aft(d), at(d, -L), y0 + inset, y1 - inset, C.nacelle);
    box(at(d, -L), at(d, -L - 0.35), y0 + inset + 0.6, y1 - inset - 0.6, C.burner, { glow });
    box(at(d, -0.8), at(d, -L + 0.6), y1 - inset, y1 - inset + 0.35, C.steel);
  };

  switch (kind) {
    case 'warship': {
      drive(top, 4.2, GLOW.blue);
      // A dorsal turret amidships, its barrels trained on the bow.
      const tx = at(top, len(top) * 0.62);
      box(tx - 1.3, tx + 1.3, roof, roof + 0.9, C.steel);
      box(tx - 0.6, tx + 0.6, roof + 0.9, roof + 1.5, C.dark);
      box(tx + H * 0.6, tx + H * 3.6, roof + 1.0, roof + 1.25, C.dark);
      // The prow: stepped plating beyond the bridge, narrowing to the ram.
      const [b0, b1] = band(top);
      for (let i = 0; i < 3; i++) {
        box(at(top, len(top) + i * 1.3), at(top, len(top) + (i + 1) * 1.3), b0 + 0.3 + i * 1.0, b1 - 0.2 - i * 0.9, C.plating);
      }
      // A ventral fin under the keel, forward; running lights on the ram and the turret.
      box(at(0, len(0) * 0.72), at(0, len(0) * 0.92), keel - 1.3, keel, C.plating);
      beacon(at(top, len(top) + 4.1), (b0 + b1) / 2, GLOW.red);
      beacon(tx, roof + 1.7, GLOW.white);
      break;
    }
    case 'hauler': {
      drive(top, 5, GLOW.orange);
      drive(top - 1, 4.2, GLOW.orange);
      // Cargo pods slung under the keel.
      const cols = [C.container, C.olive, C.steel];
      for (let s = 2, i = 0; s + 4.4 <= len(0) - 2; s += 6, i++) {
        box(at(0, s), at(0, s + 4.4), keel - 2.0, keel - 0.25, cols[i % 3]);
        box(at(0, s + 0.5), at(0, s + 1.1), keel - 0.25, keel, C.dark);
        box(at(0, s + 3.3), at(0, s + 3.9), keel - 0.25, keel, C.dark);
      }
      // A gantry crane along the roof, and the bridge house over the bow end with its windows lit.
      const L = len(top);
      box(at(top, 2), at(top, L - 7), roof + 1.7, roof + 2.0, C.steel);
      for (const s of [2.5, (L - 7) / 2 + 1, L - 7.5]) box(at(top, s - 0.2), at(top, s + 0.2), roof, roof + 1.7, C.steel);
      box(at(top, L - 6), at(top, L - 0.3), roof, roof + 2.2, C.plating);
      lit(at(top, L - 5.5), at(top, L - 0.8), roof + 1.2, roof + 1.7, GLOW.warm);
      beacon(at(top, L - 3), roof + 2.5, GLOW.red);
      break;
    }
    case 'liner': {
      drive(top, 4.5, GLOW.white, 0.8);
      // A long dorsal fin with a funnel, lit portholes along the keel, a promenade bulge beneath.
      const L = len(top);
      box(at(top, L * 0.2), at(top, L * 0.78), roof, roof + 0.9, C.plating);
      box(at(top, L * 0.36), at(top, L * 0.58), roof + 0.9, roof + 2.3, C.plating);
      box(at(top, L * 0.4), at(top, L * 0.54), roof + 2.3, roof + 2.6, C.dark);
      for (let s = 2.5; s + 0.5 <= len(0) - 2; s += 3.2) lit(at(0, s), at(0, s + 0.5), keel + 0.65, keel + 0.95, GLOW.warm);
      box(at(0, len(0) * 0.28), at(0, len(0) * 0.72), keel - 1.1, keel, C.plating);
      for (let s = len(0) * 0.3; s + 1.2 <= len(0) * 0.7; s += 2.0) lit(at(0, s), at(0, s + 1.2), keel - 0.7, keel - 0.5, GLOW.warm);
      beacon(at(top, L * 0.47), roof + 2.8, GLOW.red);
      break;
    }
    case 'research': {
      drive(0, 3.6, GLOW.cold, 0.7);
      // The dish amidships on a mast, a boom beyond the bow with its beacon, lab pods under the keel.
      const mx = at(top, len(top) * 0.5);
      box(mx - 0.2, mx + 0.2, roof, roof + 2.2, C.steel);
      box(mx - 2.6, mx + 2.6, roof + 2.2, roof + 2.55, C.dish);
      box(mx - 1.4, mx + 1.4, roof + 2.55, roof + 2.8, C.dish);
      box(mx - 0.15, mx + 0.15, roof + 2.8, roof + 3.6, C.dark);
      const [b0, b1] = band(top);
      const my = (b0 + b1) / 2;
      box(fore(top), at(top, len(top) + 7), my - 0.25, my + 0.25, C.steel);
      beacon(at(top, len(top) + 7.2), my, GLOW.red);
      for (const s of [0.22, 0.62]) {
        box(at(0, len(0) * s), at(0, len(0) * s + 5), keel - 1.6, keel - 0.2, C.plating);
        lit(at(0, len(0) * s + 0.4), at(0, len(0) * s + 4.6), keel - 1.05, keel - 0.75, GLOW.cold);
      }
      break;
    }
    case 'station': {
      // Solar arrays on arms above and below, an antenna mast, a berth opposite the Kestrel.
      const cx = at(top, len(top) * 0.5);
      box(cx - 0.25, cx + 0.25, roof, roof + 1.6, C.steel);
      box(cx - 9, cx + 9, roof + 1.6, roof + 1.95, C.solar);
      box(cx - 9, cx + 9, roof + 1.95, roof + 2.05, C.steel);
      const kx = at(0, len(0) * 0.5);
      box(kx - 0.25, kx + 0.25, keel - 1.6, keel, C.steel);
      box(kx - 9, kx + 9, keel - 1.95, keel - 1.6, C.solar);
      box(cx + H * 3 - 0.12, cx + H * 3 + 0.12, roof + 2.05, roof + 5.5, C.dark);
      beacon(cx + H * 3, roof + 5.7, GLOW.red);
      const dk = level.dockDeck;
      const [d0, d1] = band(dk);
      box(fore(dk), at(dk, len(dk) + 5), d0 + 1.4, d1 - 1.4, C.hull);
      box(at(dk, len(dk) + 5), at(dk, len(dk) + 5.6), d0 + 0.8, d1 - 0.8, C.steel);
      beacon(at(dk, len(dk) + 5.3), d1 - 0.4, GLOW.green);
      beacon(at(top, 0.5), roof + 0.3, GLOW.white);
      beacon(at(top, len(top) - 0.5), roof + 0.3, GLOW.white);
      break;
    }
    default:
  }
  return out;
}
