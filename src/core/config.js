// Tunables in one place. Units: metres, seconds, degrees where noted.
// World axes: x = along the ship (airlock at low x, cockpit at high x), y = up.
// z is only render depth: back wall -2, walking plane 0, floor front edge +1.

export const WORLD = {
  CELL_W: 6,        // procedural grid cell width
  DECK_H: 5,        // floor-to-floor height
  SLAB: 0.5,        // floor/ceiling slab thickness
  WALL: 0.6,        // bulkhead thickness
  HULL: 1.2,        // outer hull thickness
  DOOR_H: 3.0,
  DOOR_W: 0.5,      // door panel thickness (in x)
  BACK_Z: -2.0,
  FRONT_Z: 1.0,
  LADDER_Z: -1.45,
  STAIRS_Z: -1.1,
  STAIRS_RUN: 5.0,  // horizontal length of a staircase
  SHAFT_W: 1.3,     // floor opening width above a ladder
};

export const SHIP = {
  COLS: 24,
  DECKS: 3,
  ROOM_WIDTHS: [[2, 4], [3, 4], [4, 2], [5, 1]], // [cells, weight]
  LOOP_CHANCE: 0.2,  // fraction of non-tree connections re-added as loops
  STAIRS_CHANCE: 0.55, // vertical connection is stairs (if it fits) rather than a ladder
  MIN_MAIN_PATH: 9,   // rooms on the airlock->cockpit path
  PORTAL_CLEAR: 1.6,  // no props within this distance of a door/ladder/stairs endpoint
};

export const SQUAD = {
  SIZE: 4,
  SPACING: 1.5,
  WALK: 1.7,
  RUN: 3.3,
  CROUCH: 0.9,
  CLIMB: 1.4,
  STAIRS: 1.6,
  JUMP_TIME: 0.65,
  SEARCH_TIME: 1.8,
  DOOR_TIME: 0.9,
  HP: 100,
  NAMES: [
    ['SGT.', 'VOSS'], ['CPL.', 'REYES'], ['PVT.', 'OKAFOR'], ['PVT.', 'LINDQVIST'],
  ],
  TINTS: ['#c8a040', '#9a2f2a', '#3b6fa0', '#d0d0c8'],
  // Individuality: height scale and gait (cadence x, forward lean deg, hip sway deg,
  // vertical bounce m, shoulder swagger deg). Recruits get random profiles (meta/roster.js).
  PROFILES: [
    { scale: 1.03, gait: { cadence: 0.95, lean: 3, sway: 2.0, bounce: 0.018, swagger: 3 } },   // steady sergeant
    { scale: 1.08, gait: { cadence: 0.86, lean: 6, sway: 4.5, bounce: 0.03, swagger: 5 } },    // lumbering heavy
    { scale: 0.97, gait: { cadence: 1.1, lean: 9, sway: 1.5, bounce: 0.022, swagger: 1 } },    // pushy breacher
    { scale: 0.94, gait: { cadence: 1.0, lean: 1.5, sway: 0.8, bounce: 0.006, swagger: 0.5 } }, // gliding marksman
  ],
  STIMS: 3,
  STIM_HEAL: 45,
};

// Weapons. rate = rounds (trigger pulls) per second while bursting; spread in degrees
// (crouch x0.6, running x1.8); noise = radius that wakes aliens; pellets > 1 = shotgun.
export const WEAPONS = {
  carbine: {
    label: 'Carbine', mag: 40, reserve: 160, rate: 8, burst: [3, 6], pause: 0.35, reload: 2.2,
    damage: [9, 14], range: 26, spread: 3.6, noise: 30, pellets: 1,
  },
  heavy: {
    label: 'Heavy repeater', mag: 90, reserve: 270, rate: 10, burst: [8, 14], pause: 0.55, reload: 3.6,
    damage: [7, 11], range: 24, spread: 5.6, noise: 40, pellets: 1,
  },
  breacher: {
    label: 'Breacher', mag: 8, reserve: 48, rate: 1.7, burst: [1, 2], pause: 0.25, reload: 2.8,
    damage: [6, 9], range: 12, spread: 8, noise: 32, pellets: 7, falloff: true, stagger: 0.35,
  },
  marksman: {
    label: 'Marksman rifle', mag: 10, reserve: 50, rate: 1.4, burst: [1, 1], pause: 0.15, reload: 2.6,
    damage: [36, 46], range: 34, spread: 0.6, noise: 34, pellets: 1, sight: 30,
  },
  // The duelist's sidearm: few, heavy explosive bolts (his power sword is in MELEE).
  pistol: {
    label: 'Bolt pistol', mag: 10, reserve: 70, rate: 2.6, burst: [1, 3], pause: 0.3, reload: 1.7,
    damage: [18, 26], range: 20, spread: 2.8, noise: 32, pellets: 1, stagger: 0.25,
  },
  // Spins up for SPIN seconds before it fires, then a wall of lead; slows its bearer (PACE x).
  minigun: {
    label: 'Minigun', mag: 300, reserve: 600, rate: 20, burst: [24, 48], pause: 0.6, reload: 5,
    damage: [6, 9], range: 24, spread: 7, noise: 48, pellets: 1, spin: 0.7, pace: 0.88, heavy: true,
  },
  // No gun at all (MELEE.fists does the work): RANGE is only how far he tracks a target to face
  // it; ARMOR x the damage he takes (he blocks with them).
  fists: {
    label: 'Power fists', melee: true, mag: 0, reserve: 0, rate: 0, burst: [0, 0], pause: 0, reload: 0,
    damage: [0, 0], range: 12, spread: 0, noise: 0, pellets: 0, armor: 0.8,
  },
};

// Close-combat weapons (sim/melee.js): anything awake within REACH metres (it can be clawing the man
// ahead) takes a blow every EVERY seconds - DAMAGE, x STR a Strength point over 5 - landing HIT
// seconds into the swing (CLIP, the trooper's animation). It staggers, gets driven back PUSH metres
// and loses its swing; CLEAVE: how many one blow can hit. HEAVY: even brutes and the brood mother
// get knocked back.
export const MELEE = {
  sword: { label: 'Power sword', reach: 2.6, every: 0.7, damage: [42, 60], stagger: 0.6, push: 0.8, cleave: 2, hit: 0.3, clip: 'slash', anim: 0.6 },
  fists: { label: 'Power fists', reach: 2.4, every: 0.8, damage: [70, 95], stagger: 1.0, push: 2.2, cleave: 1, hit: 0.18, clip: 'punch', anim: 0.47, heavy: true },
  STR: 0.07,
};

// Loadouts (the first four: one per squad slot of the default squad); names match the var_* parts in
// marine.glb. `melee`: a close-combat weapon carried as well (MELEE).
export const LOADOUTS = [
  { name: 'command', helmet: 'command', pads: 'command', pack: 'command', weapon: 'carbine' },
  { name: 'heavy', helmet: 'heavy', pads: 'heavy', pack: 'heavy', weapon: 'heavy' },
  { name: 'breacher', helmet: 'breacher', pads: 'breacher', pack: 'breacher', weapon: 'breacher' },
  { name: 'marksman', helmet: 'marksman', pads: 'marksman', pack: 'marksman', weapon: 'marksman' },
  { name: 'duelist', helmet: 'command', pads: 'breacher', pack: 'marksman', weapon: 'pistol', melee: 'sword' },
  { name: 'brawler', helmet: 'breacher', pads: 'heavy', pack: 'breacher', weapon: 'fists' },
  { name: 'gunner', helmet: 'heavy', pads: 'heavy', pack: 'heavy', weapon: 'minigun' },
];

// Stance choreography timings.
export const STANCE = {
  POST_COMBAT: 2.6,   // stay weapons-up after the last target before calling "clear"
  ALERT_AFTER: 9,     // alert (hip level) this long after "clear" or a scare
  MOTION_RANGE: 14,   // unseen movement this close puts the squad on alert
  SIGNAL_TIME: 1.2,
};

// Trooper stats, rated 1-10; 5 is the baseline tuning (sim/stats.js turns them into effects).
export const STATS = {
  KEYS: ['str', 'spd', 'sta', 'acc', 'per', 'int', 'nrv', 'lck'],
  LABEL: { str: 'Strength', spd: 'Speed', sta: 'Stamina', acc: 'Accuracy', per: 'Perception', int: 'Intelligence', nrv: 'Nerve', lck: 'Luck' },
  SHORT: { str: 'STR', spd: 'SPD', sta: 'STA', acc: 'ACC', per: 'PER', int: 'INT', nrv: 'NRV', lck: 'LCK' },
  TEXT: {
    str: 'Heavy weapons, forcing locks, shrugging off claws',
    spd: 'Walking pace (the squad moves at its slowest), climbing, reloads',
    sta: 'Health and breath - the squad only runs while everyone can',
    acc: 'Weapon spread',
    per: 'Reaction time, sight range, spotting sleepers and traps',
    int: 'Searching, hacking, the uplink, stim healing',
    nrv: 'Making energy last on high alert, composure under attack',
    lck: 'Critical hits, lucky escapes, better finds, the odds',
  },
  BASE: 5, MIN: 1, MAX: 10,
  CEILING: 3,   // learning by doing can raise a stat this far above the trooper's core
};

// How troopers move and look around inside the formation (sim/awareness.js, sim/squad.js).
export const AWARE = {
  MIN_GAP: 0.8,           // trail metres a trooper always keeps behind the man ahead
  SLACK: [-0.25, 0.9],    // personal spacing drift while walking, x the drill gap
  ACCEL: 2.4, DECEL: 6,   // m/s^2 - nobody starts or stops dead
  CATCH_UP: 1.5,          // x pace when well behind (a jog)
  SCAN: [1.1, 2.8],       // seconds before looking at something new
  PITCH_RATE: 2.4,        // rad/s a weapon + torch swings up/down (x2 onto a target)
  PITCH_MAX: 0.75,         // up; down stops at PITCH_MIN unless checking something / covering a shaft
  PITCH_MIN: -0.55,
  PITCH_BASE: { casual: -0.2, alert: -0.07, engaged: -0.02 }, // weapon lowered -> torch on the floor ahead
  CHECK: [0.7, 1.4],      // a stop to look at a vent / body / hatch
  CHECK_COOL: [5, 10],
  SIX_EVERY: [9, 16],     // the rear man checks behind this often while moving
  SIX_TIME: [1.4, 2.6],
  BOUND: [4, 6.5],        // nervous point man advances this far, then kneels to cover
  BOUND_HOLD: [0.7, 1.3],
  ENTRY_PAUSE: 0.8,       // point man stops at the threshold of an unexplored room
  KNEEL: 1.5,             // front rank stays down this long once it kneels in a firefight
  WATCH: 1.6,             // a reaction (contact behind) holds the rear man round at least this long
};

export const SIGHT = {
  CONE_RANGE: 22,     // flashlight cone reach
  CONE_HALF: 32,      // degrees
  AURA: 6.5,          // 360 deg awareness radius without light
  DARK_CONE_RANGE: 9, // cone reach with flashlight off
  POWERLESS_AURA: 0.4, // x awareness radius in a room with its power out (ship events)
};

// Squad mental state (rules of engagement).
export const ROE = {
  CAUTIOUS: 'cautious', // fire only after the squad is attacked; never on non-hostiles
  NORMAL: 'normal',     // fire on anything that moves - vermin and unidentified survivors included
  ALERT: 'alert',       // high alert: weapons up, fastest reactions, hostiles only; burns energy
  ATTACKED_WINDOW: 5,   // seconds cautious squads keep returning fire
};

// The squad's energy: high alert burns it. Kills bring it back - every alien (PER_KILL) and
// every animal they shoot (PER_CRITTER) - and so do food and energy drinks found in containers
// (loot 'food' / 'drink').
export const ENERGY = { MAX: 100, DRAIN: 1.5, PER_KILL: 12, PER_CRITTER: 20, FOOD: 25, DRINK: 40, MIN_TO_ENTER: 10 };

// Movement pace (m/s): stealthy (cautious) sneaks, steady (normal) moves at a jog, fast (run)
// sprints. Sprinting slowly drains each trooper's stamina (~33 s from full at Stamina 5); the
// jog gets it back, and so does standing still - but only a little while the squad is on a
// fast pace (no real rest between the sprints).
export const PACE = {
  SPEED: { cautious: 0.95, normal: 3.3, run: 4.6 },
  HEARING: { cautious: 0.45, normal: 1, run: 1.8 }, // x alien hearing radius
  STAMINA_MAX: 100, DRAIN: 3, REGEN_FAST: 1.2, REGEN_MOVING: 2.5, REGEN_RESTING: 6, MIN_TO_RUN: 25,
};

export const ALIEN = {
  HP: 90,
  SPEED: 6.2,
  CLIMB: 3.2,
  VENT_SPEED: 6.5,
  LEAP_RANGE: 5,
  LEAP_TIME: 0.45,
  ATTACK_RANGE: 1.25,
  ATTACK_TIME: 0.85,
  DAMAGE: [16, 25],
  SIGHT: 18,
  HEAR_STEPS: 6,
  REPATH: 0.5,
};

// Hostile variants, relative to the baseline drone (ALIEN): model scale, hit points, speed and
// claw damage, swing time, leap reach (0 = never leaps), how readily it takes the high road (up
// a bulkhead or onto the ceiling to drop on the squad), stagger taken, door forcing, a tint over
// the chitin, and its share of the ship's hostiles near the airlock (weight) and at the bow (deep).
// Habits (PACK): `stalk` the chance one that wakes unseen shadows the squad instead of charging,
// `flee` the chance a badly hurt one breaks off into the vents (and comes back healed), `drag` the
// chance one that reaches a man down drags him off rather than finish him, `hear` x hearing (noise
// draws runners from further off), `shy` - backs off from torchlight.
export const ALIEN_TYPES = {
  drone:   { label: 'Drone',   scale: 1,    hp: 90,  speed: 1,    damage: [16, 25], attackTime: 0.85, leap: 5,   climb: 0.35, stagger: 1,    force: 1,   tint: null,      weight: 56, deep: 42, drag: 0.5 },
  runner:  { label: 'Runner',  scale: 0.76, hp: 48,  speed: 1.3,  damage: [9, 15],  attackTime: 0.6,  leap: 6.5, climb: 0.55, stagger: 1.3,  force: 0.8, tint: '#c8d4a0', weight: 24, deep: 20, stalk: 0.3, flee: 0.35, hear: 1.8 },
  creeper: { label: 'Creeper', scale: 0.9,  hp: 70,  speed: 0.95, damage: [18, 27], attackTime: 0.8,  leap: 4,   climb: 0.95, stagger: 1,    force: 1,   tint: '#8f9cc8', weight: 14, deep: 20, stalk: 0.6, flee: 0.3, drag: 0.4, shy: true },
  brute:   { label: 'Brute',   scale: 1.4,  hp: 230, speed: 0.7,  damage: [28, 40], attackTime: 1.15, leap: 0,   climb: 0,    stagger: 0.35, force: 2,   tint: '#c88070', weight: 6,  deep: 18, drag: 0.7 },
  // Spits acid from range (SPIT) instead of closing in; only deeper in the ship.
  spitter: { label: 'Spitter', scale: 0.85, hp: 80,  speed: 0.9,  damage: [8, 12],  attackTime: 0.9,  leap: 0,   climb: 0.5,  stagger: 1.1,  force: 0.8, tint: '#b0c848', weight: 0,  deep: 12, ranged: true },
  // Screams (SCREAM): wakes every sleeper in earshot and calls more out of the vents. Weak claws.
  screamer: { label: 'Screamer', scale: 0.95, hp: 75, speed: 0.85, damage: [8, 13],  attackTime: 0.8,  leap: 0,   climb: 0.15, stagger: 1.2,  force: 0.8, tint: '#d89ab0', weight: 0,  deep: 5,  screams: true },
  // The brood mother (BROOD): never picked at random - one at most, in a nest deep in the ship.
  brood:   { label: 'Brood mother', scale: 1.75, hp: 480, speed: 0.5, damage: [30, 44], attackTime: 1.3, leap: 0, climb: 0,    stagger: 0.22, force: 2.5, tint: '#7a5a8e', weight: 0,  deep: 0,  births: true },
  // The queen (gen/contracts.js 'queen'): the boss hulk's brood mother, twice the size, births faster and longer, dies hard.
  // Her own art (queen.glb, tools/blender/queen.py), built at her true size: drawn at scale 1 while the sim keeps the 2.3.
  queen:   { label: 'Queen',        scale: 2.3,  hp: 1150, speed: 0.42, damage: [40, 58], attackTime: 1.45, leap: 0, climb: 0,   stagger: 0.1,  force: 3,   tint: null,      weight: 0,  deep: 0,  births: { every: 5, max: 16 }, royal: true, model: 'queen', modelScale: 1 },
};

// Pack habits (sim/alien.js). FLANK: a climber whose packmate is already closing on the squad
// goes over them on the ceiling for the man at the far end, if he's DX or more past the nearest.
// STALK: one that woke unseen shadows the rear man DIST metres back, out of sight, and closes the
// moment someone near it reloads (within NEAR), the line strings out (a GAP between two men),
// it's seen, or after PATIENCE. FLEE: hurt below HP of its health it breaks for a vent, lurks in
// the ducts LURK seconds and comes out near the squad healed. SHY: held in a torch beam within
// RANGE it backs off (or goes up), for BRAVE seconds at most. DRAG: it pulls a man down toward a
// floor-level vent in the room at SPEED x its own; DROP damage makes it let go.
export const PACK = {
  FLANK: { DX: 3 },
  STALK: { DIST: 9, NEAR: 14, GAP: 5.5, PATIENCE: 35 },
  FLEE: { HP: 0.3, LURK: [10, 18] },
  SHY: { RANGE: 9, BRAVE: 4 },
  DRAG: { SPEED: 0.42, DROP: 22 },
};

// The screamer: a WINDUP, then everything asleep within RANGE wakes and CALL hostiles come out of
// the vents near it (from the reserve); again every EVERY seconds, MAX times. A heavy hit (stagger
// CUT or more) cuts the scream off.
export const SCREAM = { RANGE: 24, WINDUP: 1.1, CALL: [1, 2], EVERY: 14, MAX: 3, CUT: 0.3 };

// The brood mother: placed (CHANCE, more with threat) in the deepest nest. Awake, she births a
// runner from the ship's reserve every EVERY seconds, MAX in all. BONUS credits for killing her.
export const BROOD = { CHANCE: 0.3, EVERY: 8, MAX: 6, BONUS: 120, QUEEN_BONUS: 400 };

// The spitter's acid: it keeps to RANGE, spits every EVERY seconds (a WINDUP, then a lob that
// lands FLIGHT seconds later), DAMAGE to whoever it hits and a POOL that burns anyone standing in
// it. A trooper crouched (Cover, or kneeling) with cover between him and the spitter - a debris
// pile or a barricade within COVER metres - takes it on the cover instead.
export const SPIT = {
  RANGE: [5, 16], EVERY: 2.6, WINDUP: 0.4, FLIGHT: 0.6, GRAVITY: 12, DAMAGE: [9, 14], SPLASH: 0.9, COVER: 2.6,
  POOL: { R: 1.1, TIME: 6, DPS: 4 },
};

// Cover and chokepoints: aliens vault what's on the walking line (seconds per obstacle), go through
// a doorway one at a time, and a brute smashes a barricade rather than climb it.
export const COVER = { VAULT: { jump: 0.6, crouch: 0.5, barricade: 0.9 }, SMASH: 1.4, BARRICADE: { W: 1.2, H: 1.15 } };

// Walls and ceilings (sim/alien.js): crawl speed x the alien's own, the spring up / drop down
// times, how far a target must be before it bothers going up, the rethink cooldown, how close a
// bulkhead must be to climb it rather than spring, and the share of climbers sleeping up high.
export const CRAWL = { CEILING: 0.7, WALL: 0.6, SPRING: 0.42, DROP: 0.36, MIN_DX: 5.5, COOL: [3, 7], WALL_REACH: 3.5, SLEEP_HIGH: 0.55 };

export const CRITTER = { HP: 6, SPEED: 1.8, FLEE: 4.2 };

// The squad's kit, per mission: welding charges (seal a door or a vent for good, or cut a welded
// door open), frag grenades, flares and one Defend kit (DEFEND) - more of those are found aboard.
export const KIT = { CHARGES: 3, GRENADES: 3, FLARES: 3, DEFEND: 1 };

// The Defend kit (sim/world.js deployDefence): two sentry guns set down either side of the squad,
// GAP metres beyond the outermost man on each side, Z back from the walking line. They stay where
// they're put and keep firing whoever is near: each at hostiles within RANGE, RATE rounds a second
// for DAMAGE, HIT of them on target, AMMO in all, as loud as NOISE. The squad carries one (KIT);
// more are found in containers (gen/populate.js placeDefences): WAY beside the squad's way to the
// command deck, EXTRA anywhere. Under the Kit order 'use' the squad sets one up by itself AUTO
// seconds before a horde hits.
export const DEFEND = { GAP: 1.6, Z: -1.0, RANGE: 14, RATE: 6, DAMAGE: [10, 16], HIT: 0.85, AMMO: 90, NOISE: 24, WAY: 1, EXTRA: 1, AUTO: 6 };

// The horde (sim/director.js): at most one a ship, and maybe none - noise draws it. Every sound
// the squad makes (gunfire, blasts, doors, its sentries) adds NOISE x its radius to the ship's
// HEAT, and EVENTS add theirs; the heat halves every HALF seconds. Past START, each second there's
// a chance - (heat - START) / PER, at most CHANCE - that it comes: WARN seconds of warning while
// the squad holds, then a swarm - SIZE hostiles (+PER_THREAT a threat level, x the Enemies
// difficulty, MAX), mostly runners and drones (TYPES weights) - pouring out of the vents on both
// sides of the squad, EMERGE seconds apart. It's over when they're all dead (or OVER seconds on).
// Never in the first rooms off the airlock, on the command deck or during the uplink. Its
// hostiles are its own: in the ship's count (life signs) from the start, but never drawn on for
// the usual ambushes (gen/populate.js placeHorde).
export const HORDE = {
  WARN: 10, SIZE: 20, PER_THREAT: 3, MAX: 45, EMERGE: 0.15, OVER: 90,
  TYPES: { runner: 55, drone: 35, creeper: 10 },
  NOISE: 0.1, HALF: 45, START: 175, PER: 4000, CHANCE: 0.05,
  EVENTS: { scream: 40, 'power-out': 30, fire: 20, ambush: 15, hatch: 15, explosion: 15, 'door-forced': 8, 'sentry-online': 10 },
};

// Interaction points (gen/populate.js placeOddities, sim/encounters.js). A hacked SENTRY turret
// fights for the squad (sim/sentry.js): RANGE metres, RATE rounds a second for DAMAGE, HIT of them
// on target, AMMO in all, as loud as NOISE. The AUTODOC heals every man HEAL hp and mends the worst
// wound (a botched cycle: FAIL x the healing). Eggs blundered past hatch HATCH of the ship's reserve
// (shooting them lets one out SHOOT of the time). A cryo pod holds a survivor, a hostile or a cache
// (POD weights).
export const SENTRY = { RANGE: 14, RATE: 5, DAMAGE: [10, 16], HIT: 0.85, AMMO: 160, NOISE: 24 };
export const AUTODOC = { HEAL: 45, FAIL: 0.35 };
export const EGGS = { HATCH: [1, 2], SHOOT: 0.35 };
export const POD = { survivor: 35, alien: 35, cache: 30 };

// Kit in use (sim/kit.js). A GRENADE is thrown RANGE metres, lands FLIGHT seconds later and
// bursts R metres wide for DAMAGE at the centre (falling off), loud enough to wake NOISE metres
// round - never with one of ours within R + SAFE of it. The squad throws its own at CLUSTER or
// more of them together (a BIG one counts double), COOL seconds apart.
export const GRENADE = { RANGE: [4.5, 14], FLIGHT: 0.75, R: 3.4, SAFE: 1.5, DAMAGE: 120, NOISE: 32, CLUSTER: 2, BIG: 200, COOL: 4 };
// A flare burns on the deck for the rest of the mission: the squad's awareness radius in its room
// x AURA, dark or not.
export const FLARE = { AURA: 1.8 };

// Firing drills (combat.js): a man LOW on rounds changes mags while the others are still firing -
// one at a time, so they never all run dry together - and tops up a magazine under TOPUP in a
// lull. While a squad-mate reloads, works on a man down, or is down, the rest cover him: COVER x
// the pause between bursts. Rounds into a hostile pin it down (SUPPRESS): HIT each (a heavy's
// count double), draining 1 a second; past MIN it's pinned - SLOW x its speed, no pouncing.
export const DRILL = { LOW: 0.3, TOPUP: 0.6, COVER: 0.5 };
export const SUPPRESS = { HIT: 0.2, MAX: 1.5, MIN: 0.5, SLOW: 0.6 };

// The shove (sim/melee.js): within REACH of one clawing at him, a trooper may drive it back PUSH
// metres, staggered STAGGER seconds: BASE chance, +PRESSED when reloading or dry, +BREACHER for a
// breacher; COOL seconds between tries.
export const SHOVE = { REACH: 1.8, PUSH: 1.5, STAGGER: 0.7, DAMAGE: 6, BASE: 0.3, PRESSED: 0.3, BREACHER: 0.25, COOL: 3 };

// Specialists (sim/melee.js): the marksman's SNIPE (x damage on something that hasn't noticed the
// squad), the scout's SPOT radius, the heavy holding the line in Cover (HOLD: rate x, spread x),
// the breacher's DOOR time x, the medic's DRESSINGS (DRESSING hp each, for a man under HURT of
// his health within REACH, DRESS_EVERY seconds apart).
export const ABILITY = {
  SNIPE: 2.5, SPOT: 12, HOLD: { rate: 1.3, spread: 0.8 }, DOOR: 0.5,
  DRESSINGS: 3, DRESSING: 22, HURT: 0.5, REACH: 4.5, DRESS_EVERY: 6,
};

// Squad morale (sim/morale.js): START, settling to REST at DRIFT a second out of a fight; what
// moves it; the floor a veteran on his feet holds it at (shaken, never breaking); and what each
// level does to their aim (spread x), reactions (acquire x) and nerve (added panic chance).
export const MORALE = {
  START: 65, REST: 60, DRIFT: 0.4, VETERAN: 15,
  KILL: 1.5, BIG_KILL: 6, LOST: -22, DOWNED: -12, TAKEN: -10, REVIVED: 8, SCREAM: -5, AMBUSH: -4, DARK: -4, BROOD: 20, CLEAR: 15, RESCUED: 4,
  HORDE: -6, HORDE_DOWN: 10, BROKE: -4,
  LEVELS: [
    { name: 'steady', min: 80, spread: 0.92, acquire: 0.9, nerve: 0 },
    { name: 'holding', min: 35, spread: 1, acquire: 1, nerve: 0 },
    { name: 'shaken', min: 15, spread: 1.15, acquire: 1.12, nerve: 0.1 },
    { name: 'breaking', min: 0, spread: 1.3, acquire: 1.25, nerve: 0.2 },
  ],
};

// Breaking point (sim/breakdown.js): clawed below HP of his health, a trooper on his feet breaks -
// once, until he's patched up past REARM. Which way depends on the man (his stats weigh it):
//   freeze   hunkers down where he is: won't fire, won't move - and the squad won't leave him
//   flee     drops to the rear and bolts back the way they came (at a sprint, up to DIST metres,
//            or until nothing's within SAFE of him), hides there, and falls back in after
//   berserk  loses it the other way: RATE x fire rate, SPREAD x spread, ACQUIRE x reaction time,
//            shoots every hostile in sight, and SHOVE more likely to drive back what gets close
// It passes once nothing awake has been within CALM_R metres of him for CALM seconds (after MIN,
// at most MAX), or as soon as he's healed past REARM.
export const BREAK = {
  HP: 0.3, REARM: 0.5, CALM: 3, CALM_R: 16, MIN: 4, MAX: 30,
  FLEE: { DIST: 14, SAFE: 12 },
  BERSERK: { RATE: 1.6, SPREAD: 1.3, ACQUIRE: 0.5, SHOVE: 0.5 },
};

// Down, not dead: a lethal blow puts a trooper on the deck. There is no clock - he stays down
// until a squad-mate gets him up (REVIVE seconds; the medic quicker, a stim gets him up stronger)
// or until something finishes him. Up again, he carries a wound for the rest of the mission.
export const DOWN = {
  REVIVE: 3.2, HP: 0.2, STIM_HP: 0.45, HITBOX: 0.5,
  WOUNDS: { leg: { pace: 0.8, climb: 0.8 }, arm: { spread: 1.35, reload: 1.25 } },
};

// Every ship carries a FIXED number of hostiles: some sleep in rooms, the rest are the
// director's reserve (vent ambushes, finale waves). Kill them all and the ship is clear.
export const HOSTILES = { BASE: 22, PER_THREAT: 5, DORMANT_SHARE: 0.55, MIN_RESERVE: 4, CLEAR_BONUS: 150 };
