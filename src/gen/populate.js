// Fills a layout with content: room types, props & loot, obstacles, vents and actors.
// Difficulty scales with a room's BFS distance from the airlock (0 near spawn -> 1 at the bow).
import { ALIEN_TYPES, BROOD, CRAWL, DEFEND, HORDE, HOSTILES, POD, SHIP, WORLD } from '../core/config.js';
import { LOOT, PROPS, ROOM_TYPES } from './templates.js';
import { HULL_CLASSES, sectionOf, zoneWeight } from './classes.js';
import { bfs, walkLimits } from './layout.js';
import { ceilingSpans, doorInWall, portalEnds, wallFace } from './level.js';
import { pickAlienType } from '../sim/entities.js';
import { rollTreasure, rollWeapon } from '../sim/loot.js';
import { NavGraph } from '../nav/graph.js';

function cells(room) { return room.c1 - room.c0 + 1; }

// At most this many of a type per ship unless the hull class says otherwise (gen/classes.js quotas).
const DEFAULT_QUOTAS = { medbay: 2, armory: 2 };

/**
 * What each room is: its hull class's rooms, weighted by where in the ship it sits (zones:
 * engineering aft, cargo low, crew high...), capped by quotas (one medbay, one reactor), and
 * with dead ends favouring armouries and storerooms.
 */
function assignTypes(level, rng) {
  const { rooms, portals, airlock, cockpit, cls } = level;
  const C = HULL_CLASSES[cls] ?? {};
  const quota = { ...DEFAULT_QUOTAS, ...(C.quotas ?? {}) };
  const counts = {};
  const degree = (r) => r.portals.length;
  // Reactor: a big room on the main path, away from both ends - aft, for preference.
  const mids = level.mainPath.slice(3, -3).filter((id) => cells(rooms[id]) >= 3);
  const reactorPick = mids.length ? rng.weighted(mids.map((id) => [id, zoneWeight(cls, sectionOf(level, rooms[id]), 'reactor')])) : undefined;
  const pool = Object.entries(ROOM_TYPES).filter(([, t]) => t.weight > 0 && (!t.only || t.only.includes(cls)));
  for (const room of rooms) {
    room.seed = rng.int(0, 2 ** 30);
    if (room.id === airlock) room.type = 'airlock';
    else if (room.id === cockpit) room.type = 'cockpit';
    else if (room.id === reactorPick) room.type = 'reactor';
    else {
      const deadEnd = degree(room) === 1;
      const sec = sectionOf(level, room);
      const options = pool
        .filter(([k, t]) => (!t.minCells || cells(room) >= t.minCells) && (quota[k] === undefined || (counts[k] ?? 0) < quota[k]))
        .map(([k, t]) => [k, t.weight * (C.types?.[k] ?? 1) * zoneWeight(cls, sec, k) * (deadEnd && (k === 'armory' || k === 'storage') ? 3 : 1)]);
      room.type = options.length ? rng.weighted(options) : 'corridor';
    }
    counts[room.type] = (counts[room.type] ?? 0) + 1;
    room.light = ROOM_TYPES[room.type].light;
    room.onMainPath = level.mainPath.includes(room.id);
    room.nest = room.type !== 'airlock' && room.type !== 'cockpit' && degree(room) === 1 && room.dist >= 3 && rng.chance(Math.min(0.95, 0.55 * (level.mods?.nests ?? 1)));
    if (level.mods?.blackout && room.type !== 'airlock') room.light = rng.chance(0.7) ? 'dim' : 'flicker';
    room.explored = false;
    room.seen = false;
  }
  for (const p of portals) if (p.kind === 'door' && (p.a === airlock)) p.airlock = true;
}

/** Floor intervals that must stay clear (door approaches, ladder/stair footprints). */
export function clearZones(level, room) {
  const zones = [];
  const c = SHIP.PORTAL_CLEAR;
  const [wl, wr] = walkLimits(room);
  zones.push([room.x0, wl + 0.4], [wr - 0.4, room.x1]);
  for (const pid of room.portals) {
    const p = level.portals[pid];
    if (p.kind === 'door') {
      if (Math.abs(p.x - room.x0) < 0.01) zones.push([room.x0, room.x0 + c + 0.6]);
      else zones.push([room.x1 - c - 0.6, room.x1]);
    } else if (p.kind === 'ladder') zones.push([p.x - 1.3, p.x + 1.3]);
    else zones.push([Math.min(p.xb, p.xt) - 1.2, Math.max(p.xb, p.xt) + 1.2]);
  }
  return zones;
}

const overlaps = (zones, a, b) => zones.some(([u, v]) => a < v && b > u);

function rollLoot(rng, kind, threat = 0, mods = {}) {
  const boost = { weapon: mods.weapons ?? 1, treasure: mods.treasure ?? 1 };
  const table = (LOOT[kind] ?? LOOT.default).map(([k, w]) => [k, w * (boost[k] ?? 1)]);
  const outcome = rng.weighted(table);
  const luck = (kind === 'weapon_case' ? 0.9 : kind === 'ammo_rack' ? 0.5 : 0.15) + threat * 0.15 + (mods.luck ?? 0);
  switch (outcome) {
    case 'weapon': return { type: 'weapon', item: rollWeapon(rng, { luck }) };
    case 'treasure': return { type: 'treasure', item: rollTreasure(rng, threat) };
    case 'credits': return { type: 'credits', amount: rng.int(2, 12) * 5 };
    case 'ammo': return { type: 'ammo', amount: rng.int(3, 8) * 10 };
    case 'medkit': return { type: 'medkit', amount: 35 };
    case 'stim': return { type: 'stim', amount: 1 };
    case 'ambush': return { type: 'ambush' };
    default: return { type: 'empty' };
  }
}

function placeProps(level, rng) {
  let nextId = 0;
  for (const room of level.rooms) {
    room.props = [];
    const tpl = { ...ROOM_TYPES[room.type] };
    const m = level.mods ?? {};
    tpl.props = tpl.props.map(([k, w]) => [k, w * (k === 'barrel_explosive' ? m.barrels ?? 1 : k === 'safe' ? m.treasure ?? 1 : k === 'weapon_case' ? m.weapons ?? 1 : 1)]);
    const zones = clearZones(level, room);
    const [wl, wr] = walkLimits(room);

    if (room.type === 'airlock') {
      room.props.push({ id: nextId++, kind: 'airlock_hatch', x: wl + 0.6, z: PROPS.airlock_hatch.z, room: room.id });
      continue;
    }
    if (room.type === 'cockpit') {
      const x = wr - 1.8;
      room.props.push({ id: nextId++, kind: 'control_panel', x, z: PROPS.control_panel.z, room: room.id, objective: true });
      room.props.push({ id: nextId++, kind: 'pilot_seat', x: x - 2.2, z: PROPS.pilot_seat.z, room: room.id });
      level.objective = { room: room.id, x: x - 0.4 };
      continue;
    }

    const len = wr - wl;
    const target = Math.round((len / 10) * tpl.density * rng.float(0.7, 1.3));
    const placed = [];
    let obstacles = 0;
    let loot = 0;
    const maxLoot = rng.weighted([[0, 3], [1, 5], [2, 2]]);
    for (let tries = 0; placed.length < target && tries < target * 12; tries++) {
      const kind = rng.weighted(tpl.props);
      const def = PROPS[kind];
      if (def.obstacle && (obstacles >= 1 || room.dist < 2 || cells(room) < 3)) continue;
      if (def.interact && loot >= maxLoot) continue;
      const x = rng.float(wl + def.w / 2, wr - def.w / 2);
      const pad = def.obstacle ? 2.2 : 0.25;
      const a = x - def.w / 2 - pad;
      const b = x + def.w / 2 + pad;
      if (overlaps(zones, a, b)) continue;
      // Obstacles live on the walking line and only clash with other obstacles; others share the back.
      const clash = placed.filter((p) => !!PROPS[p.kind].obstacle === !!def.obstacle);
      if (clash.some((p) => Math.abs(p.x - x) < (PROPS[p.kind].w + def.w) / 2 + (def.obstacle ? 4 : 0.3))) continue;
      const prop = { id: nextId++, kind, x, z: def.z, room: room.id };
      if (def.interact) { prop.loot = rollLoot(rng, kind, level.threat ?? 0, level.mods); loot++; }
      if (def.obstacle) { prop.obstacle = def.obstacle; prop.x0 = x - def.w / 2; prop.x1 = x + def.w / 2; obstacles++; }
      placed.push(prop);
    }
    room.props = placed.sort((p, q) => p.x - q.x);
  }
}

function placeVents(level, rng) {
  const vents = [];
  for (const room of level.rooms) {
    room.vents = [];
    if (room.type === 'airlock' || room.type === 'cockpit') continue;
    const n = cells(room) >= 4 ? rng.int(1, 2) : 1;
    const zones = clearZones(level, room);
    const [wl, wr] = walkLimits(room);
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < 10; t++) {
        const x = rng.float(wl + 1, wr - 1);
        if (overlaps(zones, x - 0.8, x + 0.8) || room.vents.some((v) => Math.abs(vents[v].x - x) < 3)) continue;
        const ceiling = rng.chance(0.45);
        const vent = { id: vents.length, room: room.id, x, y: ceiling ? room.y1 - 0.25 : room.y0 + 0.45, ceiling, links: [] };
        vents.push(vent);
        room.vents.push(vent.id);
        break;
      }
    }
  }
  // Duct network: each vent links to its two nearest vents in other rooms (within reach).
  for (const v of vents) {
    const near = vents
      .filter((o) => o.room !== v.room)
      .map((o) => ({ o, d: Math.hypot(o.x - v.x, o.y - v.y) }))
      .filter(({ d }) => d < 30)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2);
    for (const { o } of near) {
      if (!v.links.includes(o.id)) v.links.push(o.id);
      if (!o.links.includes(v.id)) o.links.push(v.id);
    }
  }
  level.vents = vents;
}

function placeActors(level, rng) {
  const maxDist = Math.max(...level.rooms.map((r) => r.dist));
  const aliens = [];
  const critters = [];
  for (const room of level.rooms) {
    if (room.type === 'airlock' || room.type === 'cockpit') continue;
    const p = room.dist / maxDist;
    const [wl, wr] = walkLimits(room);
    let n = room.dist < 2 ? 0 : Math.floor(rng.next() * 0.9 + p * 1.5);
    if (room.nest) n = 2 + Math.floor(p * 2.5 + rng.next());
    for (let i = 0; i < n; i++) aliens.push({ room: room.id, x: rng.float(wl + 1, wr - 1), state: 'dormant', nest: room.nest });
    if (rng.chance(0.4)) {
      const k = rng.int(1, 3);
      for (let i = 0; i < k; i++) critters.push({ room: room.id, x: rng.float(wl + 0.5, wr - 0.5) });
    }
  }
  // Fixed hostile budget: trim or top up the sleepers, the rest become the vent reserve.
  const total = Math.round((HOSTILES.BASE + HOSTILES.PER_THREAT * (level.threat ?? 0)) * (level.mods?.hostiles ?? 1));
  const dormantCap = Math.max(0, total - Math.max(HOSTILES.MIN_RESERVE, Math.round(total * (1 - HOSTILES.DORMANT_SHARE))));
  rng.shuffle(aliens);
  aliens.sort((a, b) => Number(b.nest) - Number(a.nest)); // nests keep their sleepers
  aliens.length = Math.min(aliens.length, dormantCap);
  const candidates = level.rooms.filter((r) => r.dist >= 2 && r.type !== 'cockpit');
  while (aliens.length < dormantCap && candidates.length) {
    const room = rng.pick(candidates);
    const [wl, wr] = walkLimits(room);
    aliens.push({ room: room.id, x: rng.float(wl + 1, wr - 1), state: 'dormant' });
  }
  level.hostiles = { total, dormant: aliens.length, reserve: total - aliens.length };
  // Stranded crew hiding deeper in the ship.
  const survivors = [];
  const hideouts = rng.shuffle(level.rooms.filter((r) => r.dist >= 3 && !r.nest && r.type !== 'cockpit' && r.type !== 'reactor'));
  const nSurv = rng.weighted([[1, 5], [2, 3], [0, 1]]) + (level.mods?.survivors ?? 0);
  for (const room of hideouts.slice(0, nSurv)) {
    const [wl, wr] = walkLimits(room);
    survivors.push({ room: room.id, x: rng.float(wl + 0.8, wr - 0.8) });
  }
  const air = level.rooms[level.airlock];
  level.spawns = { squad: { room: air.id, x: walkLimits(air)[0] + 1.2 }, aliens, critters, survivors };
}

/**
 * Set pieces for the choose-your-own-adventure moments (sim/encounters.js): a sealed weapons
 * locker and a live crew terminal, on existing props. Own RNG stream: the rest of the ship is
 * generated exactly as before. (Lockers with something inside are found out at runtime.)
 */
function placeEncounters(level, rng) {
  const props = level.rooms.filter((r) => !r.exterior && r.type !== 'airlock' && r.type !== 'cockpit' && r.dist >= 1).flatMap((r) => r.props);
  const cases = rng.shuffle(props.filter((p) => (p.kind === 'weapon_case' || p.kind === 'safe') && p.loot && p.loot.type !== 'ambush'));
  if (cases.length && rng.chance(0.85)) cases[0].encounter = 'armoury';
  const consoles = rng.shuffle(props.filter((p) => p.kind === 'console'));
  if (consoles.length && rng.chance(0.75)) consoles[0].encounter = 'terminal';
}

/**
 * What kind each sleeper is (config ALIEN_TYPES: more of the big and nasty ones deeper in), and
 * where climbers sleep: some up on the ceiling, some on a bulkhead (above the door frame if it has one).
 * Own RNG stream: the rest of the ship is generated exactly as before.
 */
function placeBreeds(level, rng) {
  const maxDist = Math.max(1, ...level.rooms.map((r) => r.dist));
  for (const s of level.spawns.aliens) {
    const room = level.rooms[s.room];
    s.type = pickAlienType(rng, room.dist / maxDist + (level.threat ?? 0) * 0.15);
    const climb = ALIEN_TYPES[s.type].climb;
    if (climb <= 0 || !rng.chance(CRAWL.SLEEP_HIGH * climb)) continue;
    const side = s.x - room.x0 < room.x1 - s.x ? -1 : 1;
    if (rng.chance(0.45)) {
      // On the bulkhead - above the door frame if there's a door in it.
      const low = doorInWall(level, room, side) ? WORLD.DOOR_H + 0.4 : 1.8;
      Object.assign(s, { surface: 'wall', side, x: wallFace(room, side), y: room.y0 + rng.float(low, 4) });
    } else if (ceilingSpans(level, room).some(([a, b]) => s.x > a + 0.5 && s.x < b - 0.5)) {
      Object.assign(s, { surface: 'ceiling', y: room.y1 });
    }
  }
}

/**
 * Now and then a brood mother: one of the sleepers in the deepest nest (on the floor - she's far
 * too heavy for the ceiling). Own RNG stream.
 */
function placeBrood(level, rng) {
  if (!rng.chance(Math.min(0.8, BROOD.CHANCE + (level.threat ?? 0) * 0.12))) return;
  const nests = level.rooms.filter((r) => r.nest && level.spawns.aliens.some((s) => s.room === r.id)).sort((a, b) => b.dist - a.dist);
  if (!nests.length) return;
  const room = nests[0];
  const s = level.spawns.aliens.find((q) => q.room === room.id);
  const [wl, wr] = walkLimits(room);
  Object.assign(s, { type: 'brood', surface: 'floor', side: 0, x: Math.min(wr - 1.5, Math.max(wl + 1.5, s.x)), y: room.y0 });
}

/**
 * A clear stretch of floor w metres wide (clear of door approaches and ladder feet), or null. Along
 * the back wall it has to miss the other props; a body on the deck in front only the wreckage on
 * the walking line and the other bodies.
 */
function freeSpot(level, room, w, rng, front = false, span = null) {
  const zones = clearZones(level, room);
  let [wl, wr] = walkLimits(room);
  if (span) { wl = Math.max(wl, span[0] - w / 2); wr = Math.min(wr, span[1] + w / 2); } // only within [from x, to x]
  if (wr - wl < w + 1) return null;
  for (let t = 0; t < 24; t++) {
    const x = rng.float(wl + w / 2 + 0.3, wr - w / 2 - 0.3);
    if (overlaps(zones, x - w / 2 - 0.25, x + w / 2 + 0.25)) continue;
    if (room.props.some((p) => (!front || PROPS[p.kind].obstacle || p.kind === 'body') && Math.abs(p.x - x) < (PROPS[p.kind].w + w) / 2 + 0.3)) continue;
    return x;
  }
  return null;
}

// Back-wall clutter a set piece can stand in place of when a room has no space left.
const FILLER = ['barrel', 'bigcrate', 'shelf', 'bunk', 'table'];

/**
 * The rest of the ship's set pieces (sim/encounters.js): a sentry turret to hack, the medbay
 * autodoc, egg clusters in nests, a cryo pod, dead crew - one of them carrying the keycard to a
 * locked storeroom off the route, with something worth the trouble inside (a door that can always
 * be cut through instead). Own RNG stream.
 */
function placeOddities(level, rng) {
  let id = Math.max(0, ...level.rooms.flatMap((r) => r.props.map((p) => p.id))) + 1;
  const threat = level.threat ?? 0;
  const add = (room, kind, extra = {}) => {
    const front = kind === 'body';
    const x = freeSpot(level, room, PROPS[kind].w, rng, front);
    if (x === null) {
      // A crowded room: it takes the place of some clutter.
      const filler = !front && room.props.find((p) => FILLER.includes(p.kind) && PROPS[p.kind].w >= PROPS[kind].w * 0.8);
      if (!filler) return null;
      Object.assign(filler, { kind, z: PROPS[kind].z, ...extra });
      return filler;
    }
    const p = { id: id++, kind, x, z: PROPS[kind].z, room: room.id, ...extra };
    room.props.push(p);
    room.props.sort((a, b) => a.x - b.x);
    return p;
  };
  const inside = level.rooms.filter((r) => !r.exterior && r.type !== 'airlock' && r.type !== 'cockpit');
  const pick = (rooms) => (rooms.length ? rng.pick(rooms) : null);
  // A sentry gun on standby.
  if (rng.chance(0.55)) {
    const room = pick(inside.filter((r) => r.dist >= 2 && !r.nest && ['armory', 'engineering', 'storage', 'cargo', 'corridor', 'barracks', 'magazine', 'promenade'].includes(r.type)));
    if (room) add(room, 'turret', { encounter: 'turret' });
  }
  // Every medbay's first bed is an autodoc.
  for (const r of inside.filter((q) => q.type === 'medbay')) {
    const bed = r.props.find((p) => p.kind === 'medbed');
    if (bed) bed.encounter = 'autodoc';
  }
  // Eggs in the nests.
  for (const r of inside.filter((q) => q.nest)) if (rng.chance(0.7)) add(r, 'eggs', { encounter: 'eggs' });
  // A cryo pod: someone (or something) put on ice.
  if (rng.chance(0.45)) {
    const room = pick(inside.filter((r) => r.dist >= 2 && !r.nest && ['medbay', 'quarters', 'storage', 'lab', 'specimens', 'barracks'].includes(r.type)));
    const pod = rng.weighted(Object.entries(POD));
    if (room) add(room, 'cryopod', { encounter: 'cryopod', pod, ...(pod === 'cache' ? { loot: { type: 'treasure', item: rollTreasure(rng, threat) } } : {}) });
  }
  // A locked storeroom off the route, and the dead crewman with its keycard on the way there.
  if (rng.chance(0.6)) {
    const side = pick(inside.filter((r) => r.dist >= 2 && !r.nest && r.type !== 'reactor' && !level.mainPath.includes(r.id)
      && r.portals.length === 1 && level.portals[r.portals[0]].kind === 'door'));
    const before = side && pick(inside.filter((r) => level.mainPath.includes(r.id) && r.dist >= 1 && r.dist < side.dist));
    if (side && before && add(before, 'body', { loot: { type: 'keycard' } })) {
      const door = level.portals[side.portals[0]];
      door.locked = true;
      side.locked = door.id;
      const prize = rng.chance(0.5) ? { type: 'weapon', item: rollWeapon(rng, { luck: 1.1 + threat * 0.15 }) } : { type: 'treasure', item: rollTreasure(rng, threat + 1) };
      const box = side.props.find((p) => p.loot && p.loot.type !== 'ambush');
      if (box) box.loot = prize; else add(side, 'safe', { loot: prize });
    }
  }
  // More of the crew who didn't make it.
  for (let i = rng.int(1, 3); i > 0; i--) {
    const room = pick(inside.filter((r) => r.dist >= 1 && !r.nest));
    if (room) add(room, 'body', { loot: rollLoot(rng, 'body', threat, level.mods) });
  }
}

/**
 * Food and energy drinks (refill the squad's energy for high alert): some of the containers
 * that would have been empty, a few credit stashes and medicine cabinets. Own RNG stream.
 */
function placeRations(level, rng) {
  for (const room of level.rooms) {
    for (const p of room.props) {
      const t = p.loot?.type;
      const odds = t === 'empty' ? 0.75 : t === 'credits' ? 0.3 : p.kind === 'cabinet' && t === 'medkit' ? 0.3 : 0;
      if (odds && rng.chance(odds)) p.loot = { type: rng.chance(0.55) ? 'food' : 'drink' };
    }
  }
}

/**
 * Ship events (sim/shipevents.js): things that go wrong aboard while the squad is there. None
 * of them runs on a clock - each starts when the squad gets somewhere and then waits for them:
 *   power     a deck's power fails when the squad first reaches it; a console on that deck is
 *             the junction that brings it back
 *   fire      a door on the way catches fire when the squad enters a room next to it
 *   distress  a survivor radios in from deep in the ship once the squad has seen a few rooms
 * Own RNG stream. Ships with a matching modifier lean toward their event.
 */
function placeEvents(level, rng) {
  level.events = [];
  const m = level.mods ?? {};
  const want = rng.weighted([[0, 2], [1, 5], [2, 3]]);
  const pool = [['power', m.blackout ? 0.3 : 1.2], ['fire', m.volatile ? 2 : 1], ['distress', m.refugees ? 2 : 1]];
  const maxDist = Math.max(...level.rooms.map((r) => r.dist));
  const deep = (r) => !r.exterior && r.dist >= 2 && r.type !== 'cockpit' && r.type !== 'airlock';
  for (let i = 0; i < want && pool.length; i++) {
    const kind = rng.weighted(pool);
    pool.splice(pool.findIndex(([k]) => k === kind), 1);
    if (kind === 'power') {
      const decks = [...new Set(level.rooms.filter(deep).map((r) => r.deck))];
      const options = decks.map((d) => {
        const rooms = level.rooms.filter((r) => r.deck === d && !r.exterior && r.type !== 'airlock');
        const consoles = rooms.filter(deep).flatMap((r) => r.props.filter((p) => p.kind === 'console' && !p.encounter));
        return { d, rooms, consoles };
      }).filter((o) => o.consoles.length && o.rooms.filter(deep).length >= 2);
      if (!options.length) continue;
      const o = rng.pick(options);
      const junction = rng.pick(o.consoles);
      junction.junction = true;
      level.events.push({ kind: 'power', deck: o.d, rooms: o.rooms.map((r) => r.id), junction: { room: junction.room, prop: junction.id } });
    } else if (kind === 'fire') {
      const onPath = (p) => level.mainPath.some((r, j) => (r === p.a && level.mainPath[j + 1] === p.b) || (r === p.b && level.mainPath[j + 1] === p.a));
      const doors = level.portals.filter((p) => p.kind === 'door' && !p.outer && !p.airlock && deep(level.rooms[p.a]) && deep(level.rooms[p.b]));
      if (!doors.length) continue;
      const p = rng.weighted(doors.map((q) => [q, onPath(q) ? 3 : 1]));
      level.events.push({ kind: 'fire', portal: p.id, rooms: [p.a, p.b] });
    } else {
      const rooms = level.rooms.filter((r) => deep(r) && !r.nest && r.dist >= Math.max(3, maxDist - 3));
      if (!rooms.length) continue;
      const r = rng.pick(rooms);
      const [wl, wr] = walkLimits(r);
      level.events.push({ kind: 'distress', room: r.id, x: rng.float(wl + 0.8, wr - 0.8), after: rng.int(3, 5) });
    }
  }
}

/**
 * The ship's horde (sim/director.js - noise brings it, if anything does): how many. On top of the
 * ship's usual hostile budget and apart from the vent reserve (the ambushes never draw on it), but
 * the life signs count it from the start. Scaled with the Enemies difficulty; none with hordes
 * off. Own RNG stream.
 */
function placeHorde(level, rng) {
  const roll = (HORDE.SIZE + HORDE.PER_THREAT * (level.threat ?? 0) + rng.int(0, 4)) * (level.mods?.hostiles ?? 1);
  const size = level.mods?.hordes === 0 ? 0 : Math.min(HORDE.MAX, Math.round(roll)); // hordes off (meta/difficulty.js)
  level.horde = { size };
  level.hostiles.total += size;
}

// Containers that held nothing much give way to a Defend kit (rations stay: high alert needs them).
const SPARE = new Set(['empty', 'credits', 'ammo']);

/**
 * Where the squad walks on the straight way from the airlock to the command deck (the route its
 * orders take - nav/graph.js, locked doors avoided): for each room on it, the stretch of floor
 * crossed, [from x, to x].
 */
function wayThrough(level) {
  const start = level.spawns.squad;
  const route = new NavGraph(level).route(start, level.objective, { blocked: (pid) => level.portals[pid].locked });
  const stretch = new Map();
  let room = start.room;
  let x = start.x;
  const cover = (r, a, b) => {
    const [u, v] = stretch.get(r) ?? [Infinity, -Infinity];
    stretch.set(r, [Math.min(u, a, b), Math.max(v, a, b)]);
  };
  for (const step of route?.steps ?? []) {
    if (step.type === 'walk') { cover(step.room, x, step.x); room = step.room; x = step.x; }
    else if (step.type === 'portal') { room = step.to; x = portalEnds(level, level.portals[step.portal])[room].x; cover(room, x, x); }
  }
  return stretch;
}

/**
 * Defend kits (sim/world.js deployDefence) beyond the one the squad carries: DEFEND.WAY in
 * containers beside its way to the command deck (so it passes them whatever its orders) - in a
 * supply crate set down there if nothing on the way has room - and DEFEND.EXTRA anywhere aboard.
 * Own RNG stream.
 */
function placeDefences(level, rng) {
  const way = wayThrough(level);
  const passed = (r, p) => way.has(r.id) && p.x >= way.get(r.id)[0] - 0.8 && p.x <= way.get(r.id)[1] + 0.8;
  const taken = new Set();
  const boxes = (ok) => level.rooms.filter((r) => r.dist >= 1)
    .flatMap((r) => r.props.filter((p) => SPARE.has(p.loot?.type) && !taken.has(p) && ok(r, p)));
  const put = (list) => {
    if (!list.length) return false;
    const p = rng.pick(list);
    p.loot = { type: 'defend' };
    taken.add(p);
    return true;
  };
  let id = Math.max(0, ...level.rooms.flatMap((r) => r.props.map((p) => p.id))) + 1;
  const crate = (ok) => {
    for (const r of rng.shuffle(level.rooms.filter((q) => q.dist >= 1 && way.has(q.id) && q.type !== 'airlock' && q.type !== 'cockpit' && ok(q)))) {
      const x = freeSpot(level, r, PROPS.crate.w, rng, false, way.get(r.id));
      if (x === null) continue;
      const p = { id: id++, kind: 'crate', x, z: PROPS.crate.z, room: r.id, loot: { type: 'defend' } };
      r.props.push(p);
      r.props.sort((a, b) => a.x - b.x);
      taken.add(p);
      return true;
    }
    return false;
  };
  for (let i = 0; i < DEFEND.WAY; i++) if (!put(boxes(passed)) && !crate(() => true)) put(boxes(() => true));
  for (let i = 0; i < DEFEND.EXTRA; i++) put(boxes(() => true));
}

/**
 * Weak bulkheads (sim/hazards.js, encounter 'breach'): a solid wall between two neighbouring rooms
 * that are a long way apart by the doors - a charge (or a blast against it) opens a shortcut the
 * ship never had. One or two per ship, the longest detours favoured; never into the airlock or
 * the command deck.
 */
function placeBreaches(level, rng) {
  level.breaches = [];
  const cands = [];
  for (let d = 0; d < level.decks; d++) {
    const rooms = level.rooms.filter((r) => r.deck === d && !r.exterior).sort((p, q) => p.x0 - q.x0);
    for (let i = 0; i + 1 < rooms.length; i++) {
      const a = rooms[i];
      const b = rooms[i + 1];
      if (a.type === 'airlock' || b.type === 'airlock' || a.id === level.objective.room || b.id === level.objective.room) continue;
      if (level.portals.some((p) => p.kind === 'door' && p.a === a.id && p.b === b.id)) continue;
      const far = bfs(level.rooms, level.portals, a.id).dist[b.id];
      if (far >= 4) cands.push({ a: a.id, b: b.id, x: a.x1, deck: d, far });
    }
  }
  const want = Math.min(cands.length, level.rooms.length > 20 ? 2 : 1);
  for (let k = 0; k < want; k++) {
    const pick = rng.weighted(cands.map((c, i) => [i, c.far * c.far]));
    const c = cands.splice(pick, 1)[0];
    level.breaches.push({ id: k, a: c.a, b: c.b, x: c.x, deck: c.deck, far: c.far, open: false });
  }
}

export function populate(level, rngFor) {
  assignTypes(level, rngFor('types'));
  placeProps(level, rngFor('props'));
  placeVents(level, rngFor('vents'));
  placeActors(level, rngFor('actors'));
  placeEncounters(level, rngFor('encounters'));
  placeBreeds(level, rngFor('breeds'));
  placeBrood(level, rngFor('brood'));
  placeRations(level, rngFor('rations'));
  placeOddities(level, rngFor('oddities'));
  placeEvents(level, rngFor('events'));
  placeBreaches(level, rngFor('breaches'));
  placeHorde(level, rngFor('horde'));
  placeDefences(level, rngFor('defences'));
  return level;
}
