// Room modules and prop catalogue. Adding a room type = one entry here (+ optional art).
//
// Prop fields: w = footprint width (m); z = render depth; interact = lootable container;
// obstacle = 'jump' | 'crouch' (sits on the walking line and changes how bodies pass);
// wall = hangs on the back wall (doesn't take floor space); hp = breakable (sim/hazards.js), with
// h its hitbox height and wreck what is left of it; explosive props carry their own blast (or
// take the fuel barrel's); fuse = its room goes dark when it goes.

export const PROPS = {
  crate:        { w: 1.2, z: -1.2, interact: true,  label: 'Supply crate', hp: 24, h: 1.0, wreck: 'rubble' },
  locker:       { w: 1.0, z: -1.55, interact: true, label: 'Locker', hp: 30, h: 2.2, wreck: 'rubble' },
  chest:        { w: 1.3, z: -1.2, interact: true,  label: 'Footlocker', hp: 24, h: 0.8, wreck: 'rubble' },
  cabinet:      { w: 1.4, z: -1.6, interact: true,  label: 'Med cabinet', hp: 18, h: 2.0, wreck: 'rubble' },
  ammo_rack:    { w: 1.6, z: -1.5, interact: true,  label: 'Ammo rack', hp: 30, h: 1.9, wreck: 'rubble' },
  weapon_case:  { w: 1.4, z: -1.3, interact: true,  label: 'Weapons case', hp: 30, h: 1.0, wreck: 'rubble' },
  safe:         { w: 1.0, z: -1.5, interact: true,  label: 'Strongbox', hp: 80, h: 1.1 },
  barrel:       { w: 0.9, z: -1.1, hp: 20, h: 1.1, wreck: 'barrel_wreck' },
  barrel_explosive: { w: 0.9, z: -0.75, hp: 20, h: 1.1, explosive: true, wreck: 'barrel_wreck' },
  bigcrate:     { w: 2.6, z: -1.1, hp: 70, h: 2.2, wreck: 'rubble' },
  console:      { w: 1.8, z: -1.5, hp: 35, h: 1.3, wreck: 'console_broken' },
  bunk:         { w: 2.4, z: -1.4, hp: 32, h: 1.9, wreck: 'rubble' },
  medbed:       { w: 2.4, z: -1.2, hp: 26, h: 1.2, wreck: 'rubble' },
  shelf:        { w: 2.0, z: -1.65, hp: 24, h: 2.2, wreck: 'rubble' },
  table:        { w: 2.2, z: -0.9, hp: 18, h: 0.9, wreck: 'rubble' },
  reactor:      { w: 3.4, z: -1.0 },
  pilot_seat:   { w: 1.2, z: -0.6, hp: 20, h: 1.3, wreck: 'rubble' },
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
  // Contracts (gen/contracts.js): where the beacon goes, and the beacon once planted.
  beacon_site:  { w: 1.0, z: -0.9, h: 0.5, label: 'Beacon site' },
  beacon:       { w: 1.0, z: -0.9, h: 1.6, label: 'Beacon' },
  // Class rooms (gen/classes.js): a magazine's missiles, hydroponics troughs, specimen tanks, lab
  // benches, galley counters, promenade kiosks. h = the height of the box drawn without art.
  missile:      { w: 2.6, z: -1.0, h: 1.3, hp: 50, wreck: 'rubble' },
  planter:      { w: 2.0, z: -1.25, h: 1.7, hp: 20, wreck: 'rubble' },
  specimen_tank:{ w: 1.3, z: -1.4, h: 2.3, hp: 20, wreck: 'rubble' },
  lab_bench:    { w: 2.2, z: -1.0, h: 1.3, hp: 26, wreck: 'rubble' },
  galley_counter:{ w: 2.2, z: -1.2, h: 1.4, hp: 30, wreck: 'rubble' },
  kiosk:        { w: 1.4, z: -1.5, h: 2.3, hp: 34, wreck: 'rubble' },
  // Hazards (sim/hazards.js): a gas cylinder's smaller blast; a fuse box that takes the room's lights with it.
  gas_cylinder: { w: 0.6, z: -1.1, h: 1.5, hp: 14, explosive: true, blast: { r: 3.0, damage: 70, noise: 32 }, wreck: 'barrel_wreck' },
  fuse_box:     { w: 0.8, z: -1.6, h: 2.1, hp: 15, wall: true, fuse: true, wreck: 'fuse_box_broken' },
  fuse_box_broken: { w: 0.8, z: -1.6, h: 2.1, wall: true },
  // What is left of broken furniture.
  rubble:       { w: 1.2, z: -1.0, h: 0.5 },
};

// backdrop: weights for back-wall panel variants the renderer tiles along the room (a hull class
// can override a type's backdrop: gen/classes.js look.backdrops).
// props: [kind, weight]; density: expected props per 10 m of floor.
// only: the hull classes (gen/classes.js) that have the room at all; the classes also weight the
// types they have (types) and cap them (quotas).
export const ROOM_TYPES = {
  airlock:     { weight: 0, label: 'Airlock', backdrop: { plain: 2, hazard: 3 }, props: [], density: 0, light: 'red' },
  cockpit:     { weight: 0, label: 'Command deck', backdrop: { screen: 3, window: 4 }, props: [['console', 1]], density: 0, light: 'normal' },
  corridor:    { weight: 3, minCells: 4, label: 'Corridor', backdrop: { plain: 3, pipes: 3, vent: 1, window: 1 }, props: [['barrel', 2], ['barrel_explosive', 0.8], ['crate', 1], ['debris', 1.2], ['beam', 0.8], ['fuse_box', 0.7]], density: 1.4, light: 'dim' },
  quarters:    { weight: 3, label: 'Crew quarters', backdrop: { plain: 3, window: 1, screen: 1 }, props: [['bunk', 3], ['locker', 3], ['chest', 2], ['table', 1], ['safe', 0.5], ['fuse_box', 0.4]], density: 3.2, light: 'dim' },
  storage:     { weight: 3, label: 'Storage', backdrop: { plain: 2, shelves: 3, pipes: 1 }, props: [['crate', 4], ['chest', 2], ['barrel', 2], ['barrel_explosive', 0.6], ['gas_cylinder', 0.6], ['shelf', 2], ['bigcrate', 1], ['weapon_case', 0.5], ['safe', 0.3]], density: 3.6, light: 'flicker' },
  medbay:      { weight: 1.5, label: 'Medbay', backdrop: { plain: 2, screen: 2 }, props: [['medbed', 3], ['cabinet', 3], ['console', 1], ['gas_cylinder', 0.4]], density: 3.0, light: 'normal' },
  cargo:       { weight: 2, minCells: 3, label: 'Cargo hold', backdrop: { hazard: 2, plain: 2, pipes: 1 }, props: [['bigcrate', 4], ['crate', 3], ['barrel', 2], ['barrel_explosive', 0.9], ['gas_cylinder', 0.5], ['weapon_case', 0.6], ['fuse_box', 0.3]], density: 2.6, light: 'dim' },
  armory:      { weight: 1, label: 'Armory', backdrop: { plain: 2, shelves: 2 }, props: [['ammo_rack', 3], ['weapon_case', 2.5], ['locker', 2], ['crate', 1]], density: 3.0, light: 'red' },
  engineering: { weight: 2, label: 'Engineering', backdrop: { pipes: 4, vent: 2, screen: 1 }, props: [['console', 3], ['barrel', 2], ['barrel_explosive', 0.9], ['gas_cylinder', 1], ['fuse_box', 1], ['crate', 1], ['weapon_case', 0.4], ['debris', 0.6]], density: 2.4, light: 'flicker' },
  reactor:     { weight: 0, minCells: 3, label: 'Reactor', backdrop: { pipes: 4, hazard: 2 }, props: [['console', 2], ['barrel', 1], ['barrel_explosive', 1.2]], density: 1.8, light: 'red' },
  // Class rooms.
  magazine:    { weight: 1.5, minCells: 3, only: ['corvette'], label: 'Missile magazine', backdrop: { hazard: 2, rack: 2, plain: 1 }, props: [['missile', 3], ['barrel_explosive', 2], ['bigcrate', 1], ['ammo_rack', 1.5], ['crate', 1]], density: 2.8, light: 'red' },
  barracks:    { weight: 2, only: ['corvette'], label: 'Barracks', backdrop: { rack: 2, plain: 2, shelves: 1 }, props: [['bunk', 4], ['locker', 3], ['ammo_rack', 1], ['chest', 1.5], ['fuse_box', 0.4]], density: 3.4, light: 'dim' },
  galley:      { weight: 1.5, only: ['liner', 'station', 'corvette'], label: 'Galley', backdrop: { cabin: 2, shelves: 2, plain: 1 }, props: [['galley_counter', 3], ['table', 3], ['shelf', 1.5], ['cabinet', 0.8], ['crate', 1], ['barrel', 1], ['gas_cylinder', 1.2]], density: 3.0, light: 'normal' },
  hydroponics: { weight: 1.5, minCells: 3, only: ['liner', 'research', 'station'], label: 'Hydroponics', backdrop: { window: 3, lab: 1, plain: 1 }, props: [['planter', 4], ['shelf', 2], ['barrel', 1.5], ['table', 1], ['crate', 1], ['gas_cylinder', 0.8]], density: 3.0, light: 'normal' },
  lab:         { weight: 2, only: ['research'], label: 'Laboratory', backdrop: { lab: 3, screen: 2 }, props: [['lab_bench', 3], ['console', 2], ['cabinet', 2], ['specimen_tank', 1], ['medbed', 0.8], ['safe', 0.4], ['gas_cylinder', 0.6]], density: 3.0, light: 'normal' },
  specimens:   { weight: 1.5, minCells: 3, only: ['research'], label: 'Specimen bay', backdrop: { lab: 2, hazard: 1, screen: 1 }, props: [['specimen_tank', 3], ['medbed', 1.5], ['cabinet', 1], ['console', 1], ['barrel', 1], ['barrel_explosive', 0.4]], density: 2.6, light: 'flicker' },
  promenade:   { weight: 2, minCells: 3, only: ['station'], label: 'Promenade', backdrop: { promenade: 3, window: 3, plain: 1 }, props: [['kiosk', 2.5], ['table', 2], ['shelf', 1], ['crate', 1], ['debris', 1], ['barrel', 1], ['fuse_box', 0.5]], density: 2.2, light: 'dim' },
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
