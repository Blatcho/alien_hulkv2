// Room modules and prop catalogue. Adding a room type = one entry here (+ optional art).
//
// Prop fields: w = footprint width (m); z = render depth; interact = lootable container;
// obstacle = 'jump' | 'crouch' (sits on the walking line and changes how bodies pass);
// wall = hangs on the back wall (doesn't take floor space).

export const PROPS = {
  crate:        { w: 1.2, z: -1.2, interact: true,  label: 'Supply crate' },
  locker:       { w: 1.0, z: -1.55, interact: true, label: 'Locker' },
  chest:        { w: 1.3, z: -1.2, interact: true,  label: 'Footlocker' },
  cabinet:      { w: 1.4, z: -1.6, interact: true,  label: 'Med cabinet' },
  ammo_rack:    { w: 1.6, z: -1.5, interact: true,  label: 'Ammo rack' },
  weapon_case:  { w: 1.4, z: -1.3, interact: true,  label: 'Weapons case' },
  safe:         { w: 1.0, z: -1.5, interact: true,  label: 'Strongbox' },
  barrel:       { w: 0.9, z: -1.1 },
  barrel_explosive: { w: 0.9, z: -0.75, hp: 20, h: 1.1, explosive: true, wreck: 'barrel_wreck' },
  bigcrate:     { w: 2.6, z: -1.1 },
  console:      { w: 1.8, z: -1.5, hp: 35, h: 1.3, wreck: 'console_broken' },
  bunk:         { w: 2.4, z: -1.4 },
  medbed:       { w: 2.4, z: -1.2 },
  shelf:        { w: 2.0, z: -1.65 },
  table:        { w: 2.2, z: -0.9 },
  reactor:      { w: 3.4, z: -1.0 },
  pilot_seat:   { w: 1.2, z: -0.6 },
  control_panel:{ w: 2.4, z: -1.1, objective: true, label: 'Navigation core' },
  debris:       { w: 1.5, z: 0, obstacle: 'jump' },
  beam:         { w: 1.8, z: 0, obstacle: 'crouch' },
  airlock_hatch:{ w: 1.0, z: -1.4 },
  // Deployed by the squad (sim/world.js deployBarricade): a steel shield on the walking line.
  barricade:    { w: 1.2, z: 0, obstacle: 'jump', label: 'Barricade' },
  // Set pieces (gen/populate.js placeOddities; sim/encounters.js).
  turret:       { w: 1.0, z: -1.3, label: 'Sentry turret' },
  eggs:         { w: 1.6, z: -0.9, label: 'Egg cluster' },
  cryopod:      { w: 1.3, z: -1.4, label: 'Cryo pod' },
  body:         { w: 2.0, z: -0.35, interact: true, label: 'Dead crewman' },
};

// backdrop: weights for back-wall panel variants the renderer tiles along the room.
// props: [kind, weight]; density: expected props per 10 m of floor.
// only: the hull classes (gen/classes.js) that have the room at all; the classes also weight the
// types they have (types) and cap them (quotas).
export const ROOM_TYPES = {
  airlock:     { weight: 0, label: 'Airlock', backdrop: { plain: 2, hazard: 3 }, props: [], density: 0, light: 'red' },
  cockpit:     { weight: 0, label: 'Command deck', backdrop: { screen: 3, window: 4 }, props: [['console', 1]], density: 0, light: 'normal' },
  corridor:    { weight: 3, minCells: 4, label: 'Corridor', backdrop: { plain: 3, pipes: 3, vent: 1, window: 1 }, props: [['barrel', 2], ['barrel_explosive', 0.8], ['crate', 1], ['debris', 1.2], ['beam', 0.8]], density: 1.4, light: 'dim' },
  quarters:    { weight: 3, label: 'Crew quarters', backdrop: { plain: 3, window: 1, screen: 1 }, props: [['bunk', 3], ['locker', 3], ['chest', 2], ['table', 1], ['safe', 0.5]], density: 3.2, light: 'dim' },
  storage:     { weight: 3, label: 'Storage', backdrop: { plain: 2, shelves: 3, pipes: 1 }, props: [['crate', 4], ['chest', 2], ['barrel', 2], ['barrel_explosive', 0.6], ['shelf', 2], ['bigcrate', 1], ['weapon_case', 0.5], ['safe', 0.3]], density: 3.6, light: 'flicker' },
  medbay:      { weight: 1.5, label: 'Medbay', backdrop: { plain: 2, screen: 2 }, props: [['medbed', 3], ['cabinet', 3], ['console', 1]], density: 3.0, light: 'normal' },
  cargo:       { weight: 2, minCells: 3, label: 'Cargo hold', backdrop: { hazard: 2, plain: 2, pipes: 1 }, props: [['bigcrate', 4], ['crate', 3], ['barrel', 2], ['barrel_explosive', 0.9], ['weapon_case', 0.6]], density: 2.6, light: 'dim' },
  armory:      { weight: 1, label: 'Armory', backdrop: { plain: 2, shelves: 2 }, props: [['ammo_rack', 3], ['weapon_case', 2.5], ['locker', 2], ['crate', 1]], density: 3.0, light: 'red' },
  engineering: { weight: 2, label: 'Engineering', backdrop: { pipes: 4, vent: 2, screen: 1 }, props: [['console', 3], ['barrel', 2], ['barrel_explosive', 0.9], ['crate', 1], ['weapon_case', 0.4], ['debris', 0.6]], density: 2.4, light: 'flicker' },
  reactor:     { weight: 0, minCells: 3, label: 'Reactor', backdrop: { pipes: 4, hazard: 2 }, props: [['console', 2], ['barrel', 1], ['barrel_explosive', 1.2]], density: 1.8, light: 'red' },
  // Class rooms.
  magazine:    { weight: 1.5, minCells: 3, only: ['corvette'], label: 'Missile magazine', backdrop: { hazard: 3, plain: 1, pipes: 1 }, props: [['barrel_explosive', 3], ['bigcrate', 2], ['ammo_rack', 1.5], ['crate', 1]], density: 2.8, light: 'red' },
  barracks:    { weight: 2, only: ['corvette'], label: 'Barracks', backdrop: { plain: 3, shelves: 1, screen: 0.5 }, props: [['bunk', 4], ['locker', 3], ['ammo_rack', 1], ['chest', 1.5]], density: 3.4, light: 'dim' },
  galley:      { weight: 1.5, only: ['liner', 'station', 'corvette'], label: 'Galley', backdrop: { plain: 2, shelves: 2, screen: 1 }, props: [['table', 3], ['shelf', 2], ['cabinet', 1], ['crate', 1], ['barrel', 1]], density: 3.0, light: 'normal' },
  hydroponics: { weight: 1.5, minCells: 3, only: ['liner', 'research', 'station'], label: 'Hydroponics', backdrop: { window: 3, plain: 1, pipes: 1 }, props: [['shelf', 4], ['barrel', 2], ['table', 1], ['crate', 1]], density: 3.0, light: 'normal' },
  lab:         { weight: 2, only: ['research'], label: 'Laboratory', backdrop: { screen: 3, plain: 1, window: 1 }, props: [['console', 2], ['cabinet', 2], ['table', 2], ['medbed', 1], ['safe', 0.4]], density: 3.0, light: 'normal' },
  specimens:   { weight: 1.5, minCells: 3, only: ['research'], label: 'Specimen bay', backdrop: { hazard: 2, screen: 1, plain: 1 }, props: [['medbed', 2], ['cabinet', 1], ['barrel', 1], ['console', 1], ['barrel_explosive', 0.4]], density: 2.6, light: 'flicker' },
  promenade:   { weight: 2, minCells: 3, only: ['station'], label: 'Promenade', backdrop: { window: 4, plain: 2, screen: 1 }, props: [['table', 2], ['shelf', 1], ['crate', 1], ['debris', 1], ['barrel', 1]], density: 2.2, light: 'dim' },
};

// Loot tables: [outcome, weight]. Containers roll once.
export const LOOT = {
  default:   [['credits', 5], ['ammo', 3], ['stim', 1], ['medkit', 1.2], ['weapon', 1.7], ['treasure', 1.2], ['empty', 2.2], ['ambush', 0.5]],
  ammo_rack: [['ammo', 6], ['weapon', 1.5], ['credits', 1], ['empty', 1]],
  cabinet:   [['medkit', 4], ['stim', 2], ['empty', 1.5]],
  weapon_case: [['weapon', 1]],
  safe:      [['treasure', 3], ['credits', 1]],
  body:      [['credits', 3], ['ammo', 3], ['stim', 1], ['medkit', 1], ['empty', 3]],
};
