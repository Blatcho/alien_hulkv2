// Hull classes: what kind of derelict a seed becomes. A class sets the ship's shape (decks,
// length, silhouette), where the Kestrel docks (which deck, which side), where the command deck
// is, which rooms it has and where they sit (zones, quotas), and which ship modifiers suit it.
// Everything downstream - layout, population, the dock, the look - reads the class off the level.
//
// A seed code names its class: 'CRV-A1B2C3' is corvette A1B2C3; a bare seed rolls one.
import { Rng } from '../core/rng.js';

export const HULL_CLASSES = {
  corvette: {
    label: 'Corvette', code: 'CRV', weight: 1,
    blurb: 'A small warship: two long decks, the bridge forward, engines aft and a magazine amidships. Quick to clear, and it bites.',
    decks: [2, 2], cols: [22, 26], silhouette: 'wedge', dockDeck: 'bottom', dockSide: 'either', bridge: 'far-top', minPath: 8,
    types: { magazine: 1.5, barracks: 2.5, armory: 2, quarters: 1, medbay: 1, cargo: 0.5, storage: 1.5, galley: 0.6 },
    quotas: { magazine: 1, medbay: 1, armory: 2, reactor: 1, barracks: 2 },
    zones: { aft: { engineering: 3, reactor: 2, storage: 1.5 }, mid: { magazine: 3, barracks: 2, armory: 1.5 }, fore: { quarters: 2, medbay: 2, corridor: 1.5 } },
    reward: -0.1, danger: 1, modifiers: { bias: { restless: 1.5, armory: 1.5, volatile: 1.3 }, never: ['treasure', 'refugees'] },
    hints: ['acc', 'nrv'],
  },
  freighter: {
    label: 'Freighter', code: 'FRT', weight: 1.2,
    blurb: 'A bulk hauler: three decks, the holds amidships, the bridge up forward. Containers everywhere, and whatever came aboard with them.',
    decks: [3, 3], cols: [24, 28], silhouette: 'stepped', dockDeck: 'bottom', dockSide: 'either', bridge: 'far-top', minPath: 9,
    types: { cargo: 2.5, storage: 1.5 },
    quotas: { medbay: 1, armory: 1, reactor: 1 },
    zones: { aft: { engineering: 3, reactor: 2 }, mid: { cargo: 3, storage: 2 }, fore: { quarters: 2, medbay: 1.5 }, low: { cargo: 2, storage: 1.5 }, high: { quarters: 2, corridor: 1 } },
    reward: 0, danger: 0, modifiers: { bias: { treasure: 1.6, volatile: 1.3 } },
    hints: ['sta', 'spd'],
  },
  liner: {
    label: 'Liner', code: 'LNR', weight: 1,
    blurb: 'A passenger ship: cabins, galleys, hydroponics and a medbay or two - and the people who never got off.',
    decks: [3, 4], cols: [24, 28], silhouette: 'block', dockDeck: 'bottom', dockSide: 'either', bridge: 'far-top', minPath: 9,
    types: { quarters: 2, galley: 2.2, hydroponics: 1.8, medbay: 2, armory: 0.3, cargo: 0.7, storage: 0.7 },
    quotas: { medbay: 2, armory: 1, galley: 2, hydroponics: 2, reactor: 1 },
    zones: { aft: { engineering: 3, reactor: 2, storage: 1.5 }, mid: { quarters: 2, galley: 2 }, fore: { medbay: 2, quarters: 1.5 }, low: { cargo: 2, storage: 2, hydroponics: 1.5 }, high: { quarters: 2, galley: 1.5 } },
    reward: 0.1, danger: 0, modifiers: { bias: { refugees: 2.5, blackout: 1.2 }, never: ['armory'] },
    hints: ['nrv', 'per'],
  },
  research: {
    label: 'Research vessel', code: 'RSV', weight: 0.9,
    blurb: 'Labs and specimen bays along a long spine, docked at the waist. Whatever they were studying got out.',
    decks: [3, 4], cols: [22, 26], silhouette: 'spindle', dockDeck: 'middle', dockSide: 'either', bridge: 'far-other', minPath: 8,
    types: { lab: 3, specimens: 1.5, medbay: 1.5, cargo: 0.6, armory: 0.5 },
    quotas: { lab: 3, specimens: 2, medbay: 1, armory: 1, reactor: 1 },
    zones: { aft: { engineering: 3, reactor: 2 }, mid: { lab: 3, specimens: 2 }, fore: { lab: 2, medbay: 2, quarters: 1.5 } },
    reward: 0.15, danger: 1, modifiers: { bias: { hive: 2.5, restless: 1.3 } },
    hints: ['int', 'per'],
  },
  station: {
    label: 'Station', code: 'STN', weight: 0.8,
    blurb: 'An orbital: a stack of short decks round a core, docked at the ring. Command is at the heart of it, and so is everything else.',
    decks: [5, 6], cols: [14, 18], silhouette: 'tower', dockDeck: 'middle', dockSide: 'either', bridge: 'core-top', minPath: 7,
    types: { promenade: 2.5, storage: 0.8, cargo: 1.5, quarters: 1.2, medbay: 1, galley: 1.2, hydroponics: 1 },
    quotas: { medbay: 1, armory: 1, reactor: 1, promenade: 3 },
    zones: { low: { engineering: 3, reactor: 2, cargo: 2, storage: 1.5 }, high: { quarters: 2, promenade: 2, medbay: 1.5, galley: 1.5 } },
    reward: 0.2, danger: 1, modifiers: { bias: { blackout: 1.5, refugees: 1.5 } },
    hints: ['sta', 'spd'],
  },
};

export const CLASS_KEYS = Object.keys(HULL_CLASSES);
const BY_CODE = Object.fromEntries(CLASS_KEYS.map((k) => [HULL_CLASSES[k].code, k]));

/** 'CRV-A1B2C3' -> { cls: 'corvette', seed: 'A1B2C3' }; a bare seed -> { cls: null, seed }. */
export function parseSeed(code) {
  const s = String(code).toUpperCase();
  const m = /^([A-Z]{3})-(.+)$/.exec(s);
  if (m && BY_CODE[m[1]]) return { cls: BY_CODE[m[1]], seed: m[2] };
  return { cls: null, seed: s };
}

/** The seed code for a class and bare seed: 'STN-A1B2C3'. */
export const seedCode = (cls, seed) => `${HULL_CLASSES[cls].code}-${String(seed).toUpperCase()}`;

/** The class a bare seed becomes: the one asked for, else one rolled from the seed (its own stream). */
export function classFor(seed, cls = null) {
  if (cls && HULL_CLASSES[cls]) return cls;
  return new Rng(seed, 'class').weighted(CLASS_KEYS.map((k) => [k, HULL_CLASSES[k].weight ?? 1]));
}

// The difficulty's ship-size knob (meta/difficulty.js), applied to a class's own length and decks.
export const SHIP_SIZES = { small: { cols: 0.78, decks: 0 }, medium: { cols: 1, decks: 0 }, large: { cols: 1.25, decks: 1 } };
export const MAX_DECKS = 6;

/** Length and deck count for a class: rolled from the seed, or the ones given, then sized. */
export function shipSize(cls, rng, { cols, decks, shipSize: size } = {}) {
  const C = HULL_CLASSES[cls];
  let c = cols ?? rng.int(C.cols[0], C.cols[1]);
  let d = decks ?? rng.int(C.decks[0], C.decks[1]);
  const k = SHIP_SIZES[size] ?? SHIP_SIZES.medium;
  c = Math.max(12, Math.min(36, Math.round(c * k.cols)));
  d = Math.min(MAX_DECKS, d + k.decks);
  return { cols: c, decks: d };
}

/** Which deck the Kestrel docks at (the airlock's deck). */
export function dockDeckFor(cls, decks) {
  const C = HULL_CLASSES[cls];
  return C.dockDeck === 'middle' ? Math.floor(decks / 2) : 0;
}

/**
 * Deck spans [c0, c1] per deck, dock side on the left: the docking deck always reaches furthest
 * left (the boarding tube meets its hull with nothing in the way).
 */
export function deckSpans(cls, rng, cols, decks, dockDeck) {
  const C = HULL_CLASSES[cls];
  const spans = [];
  for (let d = 0; d < decks; d++) {
    const t = decks === 1 ? 0 : d / (decks - 1);
    const k = Math.abs(d - dockDeck);
    let c0;
    let c1;
    switch (C.silhouette) {
      case 'wedge':   // a long keel deck; the upper deck shorter and forward
        c0 = d === 0 ? 0 : 3 + rng.int(0, 2);
        c1 = cols - 1 - (d === 0 ? rng.int(1, 2) : 0);
        break;
      case 'block':   // full-width decks; the top one a short superstructure forward
        c0 = d === decks - 1 ? 2 + rng.int(0, 2) : d > 0 ? rng.int(0, 1) : 0;
        c1 = cols - 1 - (d === decks - 1 ? 0 : rng.int(0, 1));
        break;
      case 'tower':   // short decks stacked; the ring deck (the dock's) widest, both sides
        c0 = Math.min(k, 3) + (k ? rng.int(0, 1) : 0);
        c1 = cols - 1 - Math.min(k, 3) - (k ? rng.int(0, 1) : 0);
        break;
      case 'spindle': // the waist deck (the dock's) longest; the decks above and below pulled in
        c0 = k * 2 + (k ? rng.int(0, 1) : 0);
        c1 = cols - 1 - k;
        break;
      default:        // 'stepped': rear-left to bow-right
        c0 = Math.round(t * 4) + rng.int(0, 1);
        c1 = cols - 1 - Math.round((1 - t) * 4) + (d === decks - 1 ? 0 : rng.int(-1, 0));
    }
    spans.push([c0, c1]);
  }
  // The docking deck must stick out alone on the dock side.
  for (let d = 0; d < decks; d++) if (d !== dockDeck && spans[d][0] <= spans[dockDeck][0]) spans[d][0] = spans[dockDeck][0] + 1;
  return spans;
}

/** Where the command deck goes: { deck, at: 'far' | 'core' } (never the docking deck when it can be helped). */
export function bridgeFor(cls, rng, decks, dockDeck) {
  const C = HULL_CLASSES[cls];
  if (C.bridge === 'core-top') return { deck: decks - 1, at: 'core' };
  if (C.bridge === 'far-other') {
    const others = [...Array(decks).keys()].filter((d) => d !== dockDeck);
    return { deck: others.length ? rng.pick(others) : decks - 1, at: 'far' };
  }
  return { deck: decks - 1, at: 'far' };
}

/**
 * Which part of the ship a room is in, dock side on the left: x 'aft' (near the dock), 'mid' or
 * 'fore', and y 'low' or 'high'. Zone affinities (HULL_CLASSES[].zones) read these.
 */
export function sectionOf(level, room) {
  const inside = level.rooms.filter((r) => !r.exterior);
  const x0 = Math.min(...inside.map((r) => r.x0));
  const x1 = Math.max(...inside.map((r) => r.x1));
  const f = ((room.x0 + room.x1) / 2 - x0) / Math.max(1, x1 - x0);
  const x = f < 0.35 ? 'aft' : f > 0.65 ? 'fore' : 'mid';
  const y = level.decks <= 1 ? 'low' : room.deck < level.decks / 2 ? 'low' : 'high';
  return { x, y };
}

/** How much a class wants room type `k` in a section (1 = no opinion). */
export function zoneWeight(cls, section, k) {
  const z = HULL_CLASSES[cls]?.zones ?? {};
  return (z[section.x]?.[k] ?? 1) * (z[section.y]?.[k] ?? 1);
}
