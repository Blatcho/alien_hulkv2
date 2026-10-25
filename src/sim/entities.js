// Plain-data entity factories. Entities carry state only; behaviour lives in the systems
// (squad.js, alien.js, critter.js, combat.js). `prev*` fields feed render interpolation.
import { SQUAD, LOADOUTS, ALIEN, ALIEN_TYPES, CRITTER } from '../core/config.js';
import { issueWeapon, weaponStats } from './loot.js';
import { baseStats, statPace, statsToMods } from './stats.js';

let nextId = 1;
// The original four (no archetype of their own) by their kit (sim/melee.js specialists).
const ROLE_OF = { carbine: 'veteran', heavy: 'heavy', breacher: 'breacher', marksman: 'marksman' };
export const resetIds = () => { nextId = 1; };

const base = (kind, x, y, room) => ({
  id: nextId++, kind, x, y, z: 0, room, facing: 1, alive: true,
  prevX: x, prevY: y, prevZ: 0, anim: 'idle', hitT: 0, moving: false, visible: false,
});

/**
 * A trooper on the board. `t` (optional) is a roster entry or candidate (meta/candidates.js)
 * with its own name, looks, weapon and stats; without it the default squad is used (all
 * stats at 5). Stats become modifiers here (sim/stats.js) unless `t.mods` is given.
 */
export function makeMarine(index, x, y, room, t = null, { hpBonus = 0 } = {}) {
  const [defRank, defName] = SQUAD.NAMES[index % SQUAD.NAMES.length];
  const loadout = t?.loadout ?? LOADOUTS[index % LOADOUTS.length];
  const profile = t ?? SQUAD.PROFILES[index % SQUAD.PROFILES.length];
  const weaponItem = t?.weaponItem ?? issueWeapon(loadout.weapon);
  const weapon = weaponStats(weaponItem);
  const stats = { ...(t?.stats ?? baseStats()) };
  const mods = t?.mods ?? statsToMods(stats, loadout.weapon);
  const hp = SQUAD.HP + mods.hp + hpBonus;
  return {
    ...base('marine', x, y, room),
    index, rank: t?.rank ?? defRank, name: t?.name ?? defName, tint: t?.tint ?? SQUAD.TINTS[index % SQUAD.TINTS.length],
    trooperId: t?.id ?? null, archetype: t?.archetype ?? null, role: t?.archetype ?? ROLE_OF[loadout.weapon] ?? null,
    stats, mods, escapes: mods.escapes ?? 0, shoveCool: 0, bashT: 0,
    use: {}, // practice per stat this run (sim/stats.js practice -> meta/growth.js)
    panicT: 0, offX: 0,
    stamina: 0, staminaMax: 0, // set by World (depends on ship upgrades)
    hp, maxHp: hp,
    s: 0,                 // arclength position on the squad trail
    mode: 'walk',
    loadout: { ...loadout }, weapon, weaponItem, weaponKey: loadout.weapon,
    mag: weapon.mag, reserve: weapon.reserve,
    // Stance / choreography (set by sim/tactics.js each step).
    stance: 'casual', crouch: false, cover: null, face: 0, signalT: 0, lastKillT: -99,
    reloadT: 0, burst: 0, shotT: 0, pauseT: 0, target: null, targetT: 0, turnT: 0,
    kills: 0, shots: 0,
    controlled: false, aiming: false, aimSet: false, // the player's own marine (sim/squad.js steer, sim/combat.js)
    bark: null, barkT: 0,
    // Movement + awareness (sim/squad.js, sim/awareness.js). pace: brisk walkers push ahead,
    // heavy ones lag. pitch: weapon/torch elevation (rad, + up) - also the sight cone's.
    v: 0, pace: (1 + ((profile.gait?.cadence ?? 1) - 1) * 0.5) * statPace(stats), slack: 0, slackGoal: 0, slackT: 0,
    pitch: 0, prevPitch: 0, aimPitch: 0, glance: 0, look: null, lookT: 0,
    checkT: 0, checkOn: null, checkCool: 4, sixT: 0, sixCool: 8, sixMode: null, backpedal: false, watchT: 0, watchDir: 0,
    holdT: 0, slowT: 0, bound: false, kneelUntil: 0,
    scale: profile.scale, gait: profile.gait,
    height: 2.1 * profile.scale,
  };
}

/**
 * A hostile of one of the ALIEN_TYPES. (x, y) is where its feet are: on the floor, on the
 * ceiling (surface 'ceiling', y = the ceiling) or on a bulkhead (surface 'wall', x = the wall's
 * face, side -1 = the room's left wall, +1 = its right) - see sim/alien.js.
 */
export function makeAlien(rng, x, y, room, state = 'dormant', { type = 'drone', surface = 'floor', side = 0 } = {}) {
  const T = ALIEN_TYPES[type] ?? ALIEN_TYPES.drone;
  return {
    ...base('alien', x, y, room),
    type: ALIEN_TYPES[type] ? type : 'drone', hp: T.hp, maxHp: T.hp, state,
    target: null, steps: null, stepI: 0, repathT: rng.next() * ALIEN.REPATH,
    trav: null, vent: null, attackT: 0, leap: null, staggerT: 0, wakeT: 0,
    deadT: 0, scale: T.scale, height: 1.5 * T.scale, lane: (rng.next() - 0.5) * 0.9,
    model: T.model ?? null, modelScale: T.modelScale ?? null, // its own GLB (the queen), drawn at this scale instead of `scale`
    speed: ALIEN.SPEED * T.speed, damage: T.damage, attackTime: T.attackTime, leapRange: T.leap,
    climbs: T.climb, staggerMul: T.stagger, force: T.force, tint: T.tint, ranged: !!T.ranged, spitT: 0.5,
    surface, side, climbCool: 0, toWall: 0,
    // Habits (config PACK): stalking, hit-and-run, dragging, hearing, torch-shy; screamer, brood.
    stalks: T.stalk ?? 0, flees: T.flee ?? 0, drags: T.drag ?? 0, hear: T.hear ?? 1, shy: !!T.shy,
    screams: !!T.screams, screamT: 0, screamed: 0, births: T.births ?? false, birthT: 2, born: 0, royal: !!T.royal,
    prey: null, stalk: null, flee: null, drag: null, shyT: 0, suppressT: 0,
  };
}

/** A kind of hostile for a spot `depth` (0 airlock .. 1 bow, more with threat) into the ship. */
export function pickAlienType(rng, depth) {
  const k = Math.min(1, Math.max(0, depth));
  return rng.weighted(Object.entries(ALIEN_TYPES).map(([key, t]) => [key, t.weight + (t.deep - t.weight) * k]));
}

export const CREW = ['HALLORAN', 'MBEKI', 'SATO', 'VARGA', 'OYELARAN', 'KOWALSKI', 'DUARTE', 'NYGARD', 'PRICE', 'ESTRADA'];
const JUMPSUITS = ['#c46a2a', '#6a7f8f', '#8a8a3a', '#7a4a6a', '#3f7a6a'];

export function makeSurvivor(rng, x, y, room) {
  return {
    ...base('survivor', x, y, room),
    name: rng.pick(CREW), rank: 'CREW', tint: rng.pick(JUMPSUITS),
    hp: 45, maxHp: 45, state: 'hiding', identified: false, stateT: 0,
    height: 1.75, lane: -0.2 + rng.next() * 0.6, steps: null, trav: null, repathT: 0, mode: 'walk', anim: 'cower',
  };
}

export function makeCritter(rng, x, y, room) {
  return {
    ...base('critter', x, y, room),
    hp: CRITTER.HP, goalX: x, waitT: rng.next() * 3, height: 0.3, deadT: 0,
    lane: -0.3 + rng.next() * 0.9,
  };
}
