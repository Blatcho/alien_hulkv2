// Room templates for the procedural level generator. Each room is 20 x 11 tiles of 64 px.
// Legend:  # solid   = one-way platform   H ladder   / stairs rising to the right   \ stairs rising to the left
//          . empty   S enemy slot   B bat slot   C chest   F shrine   T torch   P decoration   R railing
// Conventions the generator relies on:
//  * row 10 is the floor, row 0 the ceiling, columns 0 and 19 the walls.
//  * Horizontal doors are rows 7-9 at the edge columns; vertical connections use columns 9-10:
//    a ladder in column 9 from row 9 up to row 0 (U exit) and a hole in the floor at columns 9-10 (D exit).
//  * Templates are authored with every door OPEN; the generator seals the ones a cell does not use.
//  * `ladder: true` means columns 9-10 are kept clear so the U ladder fits and the D hole can open.
//    Templates without it are only used for cells that need no vertical exit.
//  * No floating platforms: every solid tile is attached to the floor, a wall or the ceiling, and
//    every raised floor is reached by stairs or single-tile steps. Both doors, the ladder shaft and
//    every slot must be reachable from either door (tests/rooms.test.mjs walks each template).
export const ROOM_COLS = 20;
export const ROOM_ROWS = 11;
export const TILE = 64;

// Rows are padded on the right with their last character (door rows end in '.', wall rows in '#').
const norm = (rows) => rows.map((r) => (r.length >= ROOM_COLS ? r.slice(0, ROOM_COLS) : r + r[r.length - 1].repeat(ROOM_COLS - r.length)));
const T = (name, ladder, rows, opts = {}) => ({ name, ladder, rows: norm(rows), ...opts });

export const TEMPLATES = [
  // a plain hall
  T('open', true, [
    '#########..#########',
    '#..................#',
    '#..................#',
    '#..................#',
    '#.......T..........#',
    '#..................#',
    '#..................#',
    '........S..........',
    '...................',
    '...................',
    '#########..#########',
  ]),
  // a three-tile terrace across the middle, stairs up both sides, a chest on top
  T('terrace', false, [
    '####################',
    '#..................#',
    '#..................#',
    '#..................#',
    '#.....T......C.....#',
    '#.........S........#',
    '#.................S#',
    '..../##########\\...',
    '.../############\\..',
    '../##############\\.',
    '####################',
  ]),
  // two low terraces either side of the ladder shaft, stairs on every face
  T('split', true, [
    '#########..#########',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#....C.......T.....#',
    '#....S........S....#',
    '....................',
    '../####\\..../####\\..',
    './######\\../######\\.',
    '#########..#########',
  ]),
  // stepped blocks up to a landing, stairs down into the shaft, mirrored on the far side
  T('steps', true, [
    '#########..#########',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#...............T..#',
    '#...C.....S....S...#',
    '....##\\....../##....',
    '...####\\..../####...',
    '..######\\../######..',
    '#########..#########',
  ]),
  // a tomb in the middle of the floor with a chest on its lid
  T('crypt', false, [
    '####################',
    '#..................#',
    '#..................#',
    '#..................#',
    '#....T.......T.....#',
    '#..................#',
    '#..S............S..#',
    '.........C..........',
    '......./####\\.......',
    '....../######\\......',
    '####################',
  ]),
  // ceiling ribs and bats
  T('pillars', true, [
    '#########..#########',
    '#..##..........##..#',
    '#..##.....B....##..#',
    '#..##......T...##..#',
    '#..##..........##..#',
    '#..................#',
    '#..................#',
    '........S..........',
    '...................',
    '...................',
    '#########..#########',
  ]),
  // a dark hall with bats and a few props
  T('belfry', true, [
    '#########..#########',
    '#....B.............#',
    '#..................#',
    '#..........B.......#',
    '#..................#',
    '#.......P.......P..#',
    '#..................#',
    '....S..............',
    '...................',
    '...................',
    '#########..#########',
  ]),
  // low plinths either side, each carrying a chest
  T('vault', true, [
    '#########..#########',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..........T.......#',
    '#..................#',
    '#..................#',
    '....S.......S......',
    '...C...........C...',
    '..###..........###..',
    '#########..#########',
  ]),
  // stairs up to a raised floor on the right, a step down to the far door
  T('overlook', false, [
    '####################',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..T...............#',
    '#..................#',
    '..S..........S.C....',
    '........../######...',
    '........./########..',
    '####################',
  ]),
  T('shrine', true, [
    '#########..#########',
    '#..................#',
    '#..................#',
    '#..................#',
    '#.....T.......T....#',
    '#..................#',
    '#..................#',
    '........F..........',
    '...................',
    '...................',
    '#########..#########',
  ]),
];

// The first and last rooms of a zone.
export const START_TEMPLATE = T('start', true, [
  '#########..#########',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#......T...........#',
  '#..................#',
  '....A..............',
  '...................',
  '...................',
  '#########..#########',
]);

export const EXIT_TEMPLATE = T('exit', true, [
  '#########..#########',
  '#..................#',
  '#..................#',
  '#..................#',
  '#....T.......T.....#',
  '#..................#',
  '#..................#',
  '......S.....X......',
  '...................',
  '...................',
  '#########..#########',
]);

export const FILLER_TEMPLATE = T('filler', false, Array.from({ length: 11 }, () => '#'.repeat(20)));
