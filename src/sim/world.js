// The simulation: owns the level, entities, physics and systems, advances them in a fixed
// order each step, and exposes the player's commands. No three.js / DOM in here, so the
// whole game runs headless in tests.
//
// Step order: squad movement -> aliens -> critters -> hitboxes + physics -> visibility ->
//             combat -> director -> win/lose.
import { ABILITY, BROOD, COVER, DEFEND, DOWN, ENERGY, HOSTILES, KIT, PACE, PACK, ROE, SCREAM, SENTRY, SPIT, SQUAD, STANCE, SUPPRESS } from '../core/config.js';
import { EventBus } from '../core/events.js';
import { Rng } from '../core/rng.js';
import { walkLimits } from '../gen/layout.js';
import { portalEnds, wallFace } from '../gen/level.js';
import { PROPS } from '../gen/templates.js';
import { NavGraph } from '../nav/graph.js';
import { G, Physics } from '../physics/physics.js';
import { bodyPoint, canSee } from '../vis/sight.js';
import { bolt, canReach, letGo, startDrag, startDrop, updateAlien, wake } from './alien.js';
import { updateMarineCombat } from './combat.js';
import { updateCritter } from './critter.js';
import { Director } from './director.js';
import { Doctrine } from './doctrine.js';
import { Encounters } from './encounters.js';
import { ShipEvents } from './shipevents.js';
import { bestAt, practice } from './stats.js';
import { makeAlien, makeCritter, makeMarine, makeSurvivor, pickAlienType, resetIds } from './entities.js';
import { RARITY, affixText, upgradeWeapon, weaponStats } from './loot.js';
import { updateSurvivor } from './survivor.js';
import { Squad } from './squad.js';
import { Tactics } from './tactics.js';
import { Barks } from './barks.js';
import { breakingPoint, updateBreakdowns } from './breakdown.js';
import { Hazards, makeDestructibles } from './hazards.js';
import { Kit } from './kit.js';
import { updateMedic, updateMelee } from './melee.js';
import { Contract } from './contract.js';
import { Journal } from './journal.js';
import { Morale } from './morale.js';
import { RELICS, applyRelic, applyRelics } from '../meta/relics.js';
import { updateSentries } from './sentry.js';

// Lead mode: how far (m) the player reaches to use something, and what he'd use first when two
// things sit together (a man down before a crate beside him).
const USE_REACH = 2.4;
const USE_RANK = { downed: 0, objective: 1, crate: 2, terminal: 2, door: 3, fire: 3, ladder: 4, stairs: 4, doorctl: 6, vent: 6 };

// Labels for the set pieces in the scene (interactables).
const ODDITY = { turret: 'Hack the sentry', autodoc: 'Use the autodoc', eggs: 'Deal with the eggs', cryopod: 'Check the cryo pod', workbench: 'Use the workshop' };

export const TUNING = {
  uplinkTime: 14,
  waveEvery: 4.5,
  calm: [22, 40],
  ambushBonus: 1.8,
};

export class World {
  /**
   * @param level   generated ship
   * @param params  URL/test flags (autoplay, god...)
   * @param squad   campaign troopers to deploy (meta/profile.js), else the default four
   * @param upgrades campaign upgrade tiers
   * @param control 'squad': the four run themselves under the doctrine (the player gives orders);
   *                'lead': the player steers one of them with a controller (world.pad, squad.js
   *                steer) and the rest follow him; the doctrine still runs the followers.
   * @param player  lead: which of `squad` the player is (index; default the first)
   */
  constructor(level, { params = {}, events = new EventBus(), tuning = {}, squad = null, upgrades = {}, rewardMult = 1, doctrine = null, control = 'squad', player = 0, relics = [] } = {}) {
    resetIds();
    this.level = level;
    this.params = params;
    this.events = events;
    this.tuning = { ...TUNING, ...tuning };
    if (level.mods?.calm) this.tuning.calm = this.tuning.calm.map((c) => c * level.mods.calm);
    this.upgrades = { armor: 0, stims: 0, cooling: 0, neural: 0, tracker: 0, salvage: 0, ...upgrades };
    this.rewardMult = rewardMult;
    this.rng = new Rng(level.seed, 'sim');
    this.luck = new Rng(level.seed, 'luck'); // stat luck: crits, escapes, finds (never perturbs 'sim')
    this.nerve = new Rng(level.seed, 'nerve'); // panic checks (Nerve stat)
    this.crawl = new Rng(level.seed, 'crawl'); // aliens taking to the walls and ceilings
    this.breeds = new Rng(level.seed, 'breeds'); // the kind of each hostile the director brings in
    this.wounds = new Rng(level.seed, 'wounds'); // which wound a trooper got up from the deck carries
    this.hive = new Rng(level.seed, 'hive'); // pack habits: stalking, bolting, dragging, screams
    this.melee = new Rng(level.seed, 'melee'); // shoves and power-weapon blows
    this.sentryRng = new Rng(level.seed, 'sentry'); // hacked turrets' aim
    this.breakRng = new Rng(level.seed, 'breakdown'); // which way a man breaks (sim/breakdown.js)
    this.time = 0;
    this.tick = 0;
    this.status = 'playing';
    this.settings = { roe: ROE.NORMAL, flashlight: true };
    this.credits = 0;
    this.stims = SQUAD.STIMS;
    this.kit = { charges: KIT.CHARGES, grenades: KIT.GRENADES, flares: KIT.FLARES, defend: KIT.DEFEND, keycards: 0 };
    this.sentries = []; // hacked turrets and the squad's own Defend guns, fighting for it (sim/sentry.js)
    this.stimT = 0;
    this.reserve = level.hostiles?.reserve ?? 0; // hostiles not yet on the board
    this.cleared = false;
    this.energy = ENERGY.MAX; // burnt by high alert; kills, vermin, food and drinks top it up
    this.attackedAt = -99;
    this.noises = [];
    this.uplink = null;
    this.stats = { kills: 0, critters: 0, shots: 0, loot: 0, rooms: 0, civilians: 0, rescued: 0 };
    this.commands = []; // player input, applied at the start of the next step (replayable)
    this.control = control === 'lead' ? 'lead' : 'squad';
    // Lead: the controller's state, read by the sim each step (sticks -1..1, buttons held).
    this.pad = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, cover: false };
    this.player = null;
    this.projectiles = []; // spitter acid in flight
    this.pools = [];       // acid on the deck
    this.nextGun = 1;

    this.physics = new Physics(level);
    this.nav = new NavGraph(level);

    const spawn = level.spawns.squad;
    const y0 = level.rooms[spawn.room].y0;
    const troopers = squad?.length ? squad : null;
    this.marines = Array.from({ length: troopers ? troopers.length : SQUAD.SIZE },
      (_, i) => makeMarine(i, spawn.x, y0, spawn.room, troopers?.[i], { hpBonus: 10 * this.upgrades.armor }));
    this.stims += this.upgrades.stims;
    this.staminaMax = PACE.STAMINA_MAX * (1 + 0.2 * this.upgrades.cooling);
    this.stamina = this.staminaMax; // the squad's breath = its most winded man (updateMeters)
    for (const m of this.marines) { m.staminaMax = this.staminaMax * m.mods.stamina; m.stamina = m.staminaMax; m.facing = level.heading ?? 1; }
    for (const m of this.marines) this.physics.addHitbox(m, 0.8, m.height, G.MARINE);
    if (this.lead) {
      this.player = this.marines[player] ?? this.marines[0];
      this.player.controlled = true;
    }
    // Lead: the player's marine takes point whichever of them he is.
    this.squad = new Squad(this, this.player ? [this.player, ...this.marines.filter((m) => m !== this.player)] : this.marines);

    this.aliens = [];
    for (const s of level.spawns.aliens) {
      this.addAlien(makeAlien(this.rng, s.x, s.y ?? level.rooms[s.room].y0, s.room, s.state, { type: s.type, surface: s.surface, side: s.side }));
    }
    this.critters = [];
    for (const s of level.spawns.critters) {
      const c = makeCritter(this.rng, s.x, level.rooms[s.room].y0, s.room);
      this.critters.push(c);
      this.physics.addHitbox(c, 0.5, c.height, G.CRITTER);
    }
    this.survivors = (level.spawns.survivors ?? []).map((s) => {
      const e = makeSurvivor(this.rng, s.x, level.rooms[s.room].y0, s.room);
      if (s.vip) { e.vip = true; e.name = level.contract?.vipName ?? e.name; } // the one the contract names (gen/contracts.js 'escort')
      e.z = e.lane;
      this.physics.addHitbox(e, 0.6, e.height, G.SURVIVOR);
      return e;
    });
    this.salvage = [];   // treasure picked up this run (banked if the squad gets home)
    this.stash = [];     // weapons sent back to the ship
    this.director = new Director(this);
    this.props = makeDestructibles(this);
    this.hazards = new Hazards(this);
    this.barks = new Barks(this, new Rng(level.seed, 'barks'));
    this.tactics = new Tactics(this);
    this.encounters = new Encounters(this);
    this.shipEvents = new ShipEvents(this);
    this.journal = new Journal(this); // the ship's log: what happened, when (HUD ticker, map, debrief)
    this.contract = new Contract(this); // the job aboard (gen/contracts.js): the goal, the work, the walk home
    this.intel = false; // deck plans pulled from a terminal: every cache on the minimap
    // The squad runs itself by the doctrine chosen before deployment (sim/doctrine.js).
    this.doctrine = new Doctrine(this, doctrine ?? params.doctrine);
    this.gear = new Kit(this);         // grenades and flares in use (the counts are this.kit)
    this.morale = new Morale(this);
    this.abilities = { dressings: this.marines.some((m) => m.role === 'medic') ? ABILITY.DRESSINGS : 0, dressT: 0 };
    this.on('enter-room', ({ first }) => { if (first) this.stats.rooms++; });
    // The squad calls out what the hive is up to.
    const lead = () => this.squad.order[0];
    this.on('flank', ({ marine }) => this.barks.say(this.squad.order.find((o) => o !== marine) ?? marine, 'flank', 0.8));
    this.on('stalker', ({ marine }) => this.barks.say(marine, 'stalker'));
    this.on('alien-flee', ({ alien }) => { if (alien.visible) this.barks.say(lead(), 'flee', 0.7); });
    this.on('alien-shy', ({ alien }) => { if (alien.visible) this.barks.say(lead(), 'shy', 0.6); });
    this.on('dragged', ({ marine }) => this.barks.say(lead(), 'dragged', 1, { name: marine.name }));
    this.on('drag-dropped', ({ marine }) => { if (marine.alive) this.barks.say(lead(), 'dropped'); });
    this.on('scream-start', ({ alien }) => { if (alien.visible) this.barks.say(lead(), 'screamer'); });
    this.on('scream', () => this.barks.later(0.8, lead(), 'screamed'));
    this.on('scream-cut', () => this.barks.say(lead(), 'scream_cut', 0.8));
    this.on('birth', ({ alien }) => { if (alien.visible) this.barks.say(lead(), 'birth'); });
    this.on('brood-dead', () => this.barks.say(lead(), 'brood_dead'));
    // The campaign's relics (meta/relics.js) and what this run finds; what happens to each man,
    // for the quirks he may pick up (meta/quirks.js).
    this.relics = new Set();
    this.relicsFound = [];
    this.fieldMods = [];
    this.flags = { dragged: false, brood: false };
    applyRelics(this, relics);
    this.on('downed', ({ marine }) => { marine.downs = (marine.downs ?? 0) + 1; });
    this.on('dragged', ({ marine }) => { marine.draggedN = (marine.draggedN ?? 0) + 1; this.flags.dragged = true; });
    this.on('lucky', ({ marine }) => { marine.escapesUsed = (marine.escapesUsed ?? 0) + 1; });
    this.on('loot', ({ marine }) => { if (marine) marine.searches = (marine.searches ?? 0) + 1; });
    this.on('birth', ({ alien }) => { if (alien.visible) this.flags.brood = true; });
    this.on('horde-over', () => { for (const m of this.marines) if (m.alive && m.hp < m.maxHp * 0.3) m.lowAfterHorde = true; });
    this.on('horde-warning', () => this.barks.say(lead(), 'horde_warn'));
    this.on('horde', () => this.barks.later(0.8, lead(), 'horde_on'));
    this.on('horde-over', () => this.barks.say(lead(), 'horde_over'));
  }

  emit(type, payload) { this.events.emit(type, payload); }
  on(type, fn) { return this.events.on(type, fn); }

  /** Lead mode: the player steers one marine (world.pad); the squad follows him. */
  get lead() { return this.control === 'lead'; }

  addAlien(a) {
    // Strength (meta/difficulty.js): tougher hide, harder claws.
    const { alienHp: hp = 1, alienDmg: dmg = 1 } = this.level.mods ?? {};
    if (hp !== 1) { a.hp = Math.round(a.hp * hp); a.maxHp = a.hp; }
    if (dmg !== 1) a.damage = a.damage.map((d) => Math.max(1, Math.round(d * dmg)));
    a.z = a.lane;
    this.aliens.push(a);
    this.physics.addHitbox(a, 0.9 * a.scale, a.height, G.ALIEN);
    return a;
  }

  /** A new hostile from the reserve (vents, ambush lockers): its kind depends on how deep we are. */
  breed(x, y, room, state, type = null, rng = this.rng) {
    const depth = this.level.rooms[room].dist / Math.max(1, ...this.level.rooms.map((r) => r.dist));
    return makeAlien(rng, x, y, room, state, { type: type ?? pickAlienType(this.breeds, depth + (this.level.threat ?? 0) * 0.15) });
  }

  // ------------------------------------------------------------------ the hive

  /** A screamer's scream: everything asleep in earshot wakes, and more come out of the vents near it. */
  scream(a) {
    let woke = 0;
    for (const o of this.aliens) {
      if (o.alive && o.state === 'dormant' && Math.hypot(o.x - a.x, o.y - a.y) < SCREAM.RANGE) { wake(this, o, 'scream'); woke++; }
    }
    const vents = this.director.ventsNear(a.room, 0, 1);
    const n = this.hive.int(SCREAM.CALL[0], SCREAM.CALL[1]);
    let called = 0;
    for (let i = 0; i < n && vents.length; i++) {
      const v = this.hive.pick(vents);
      if (this.director.spawnFromVent(v, v.id, this.hive.chance(0.6) ? 'runner' : 'drone')) called++;
    }
    this.emit('scream', { alien: a, woke, called });
  }

  /** The brood mother, awake: a runner out of her every few seconds while the ship has any left. */
  birth(a, dt) {
    const cfg = typeof a.births === 'object' ? a.births : {}; // the queen births faster and longer
    if (a.born >= (cfg.max ?? BROOD.MAX) || this.reserve <= 0) return;
    a.birthT -= dt;
    if (a.birthT > 0) return;
    a.birthT = cfg.every ?? BROOD.EVERY;
    this.reserve--;
    a.born++;
    const room = this.level.rooms[a.room];
    const [wl, wr] = walkLimits(room);
    const c = this.addAlien(makeAlien(this.rng, Math.min(wr, Math.max(wl, a.x - a.facing * 1.2)), room.y0, a.room, 'hunt', { type: 'runner' }));
    c.wakeT = 0.7;
    this.emit('birth', { alien: a, child: c });
  }

  /** A hacked sentry turret comes online for the squad. */
  addSentry(prop) {
    const room = this.level.rooms[prop.room];
    const s = { kind: 'sentry', name: 'SENTRY', prop, x: prop.x, y: room.y0 + 1.25, room: prop.room, ammo: SENTRY.AMMO, cool: 0.5, facing: 1, kills: 0, lastKillT: -99 };
    prop.used = true;
    this.sentries.push(s);
    this.emit('sentry-online', { sentry: s, prop });
    return s;
  }

  /** Eggs (or a cryo pod) letting out up to n of the ship's reserve. Returns how many came out. */
  hatch(prop, n, type = 'runner') {
    const room = this.level.rooms[prop.room];
    const [wl, wr] = walkLimits(room);
    let out = 0;
    for (; out < n && this.reserve > 0; out++) {
      this.reserve--;
      const a = this.addAlien(makeAlien(this.rng, Math.min(wr, Math.max(wl, prop.x + (out - 0.5) * 0.8)), room.y0, prop.room, 'hunt', { type }));
      a.wakeT = 0.5;
    }
    if (out) this.emit('hatch', { prop, count: out });
    return out;
  }

  /** The autodoc mends a wound: the trooper's aim, reloads and climbing are his own again. */
  mend(m) {
    const W = DOWN.WOUNDS[m.wound];
    if (!W) return;
    m.mods = { ...m.mods, spread: m.mods.spread / (W.spread ?? 1), reload: m.mods.reload / (W.reload ?? 1), climb: m.mods.climb / (W.climb ?? 1) };
    m.wound = null;
    this.emit('mended', { marine: m });
  }

  /** Dragged into the ducts: gone. */
  taken(m, a) {
    if (this.params.god || !m.alive) return;
    m.taken = true;
    this.emit('taken', { marine: m, alien: a });
    this.kill(m, a);
  }

  /** A survivor turning up mid-mission (a distress call - sim/shipevents.js). */
  addSurvivor(rng, x, room) {
    const e = makeSurvivor(rng, x, this.level.rooms[room].y0, room);
    e.z = e.lane;
    this.physics.addHitbox(e, 0.6, e.height, G.SURVIVOR);
    this.survivors.push(e);
    return e;
  }

  // ------------------------------------------------------------------ acid (spitters)

  /** A spitter lobs acid at its prey: an arc that lands about where he's standing. */
  spit(a, m) {
    const from = bodyPoint(a, 0.7);
    const tx = m.x;
    const ty = m.y + 1.0;
    const T = SPIT.FLIGHT * Math.min(1.4, Math.max(0.7, Math.hypot(tx - from.x, ty - from.y) / 8));
    this.projectiles.push({
      x: from.x, y: from.y, vx: (tx - from.x) / T, vy: (ty - from.y + 0.5 * SPIT.GRAVITY * T * T) / T, t: 0,
      room: a.room, from: a.x, by: a,
    });
    this.emit('spit', { alien: a, x: from.x, y: from.y });
  }

  /** What's on the walking line in a room that acid splashes against (debris, beams, barricades). */
  lineCover(room) {
    return this.level.rooms[room].props.filter((p) => p.obstacle && !p.destroyed);
  }

  /** Is this trooper crouched behind cover, facing acid coming from x? */
  covered(m, fromX) {
    if (!(m.crouch || this.squad.cover)) return false;
    const dir = Math.sign(fromX - m.x);
    return this.lineCover(m.room).some((p) => {
      const near = dir > 0 ? p.x0 - m.x : m.x - p.x1; // the obstacle's near edge, toward the spitter
      return near > -0.2 && near < SPIT.COVER;
    });
  }

  updateAcid(dt) {
    const g = SPIT.GRAVITY;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      const nx = p.x + p.vx * dt;
      p.vy -= g * dt;
      const ny = p.y + p.vy * dt;
      const room = this.level.rooms[p.room];
      let hit = null;
      const len = Math.hypot(nx - p.x, ny - p.y);
      const ray = len > 1e-6 ? this.physics.raycast(p.x, p.y, (nx - p.x) / len, (ny - p.y) / len, len, G.WORLD) : null;
      if (ray) hit = { x: ray.x, y: ray.y };
      for (const o of this.lineCover(p.room)) {
        const h = o.barricade ? COVER.BARRICADE.H : o.obstacle === 'crouch' ? 2.2 : 0.8;
        if (nx >= o.x0 && nx <= o.x1 && ny <= room.y0 + h && ny >= room.y0) { hit = { x: nx, y: ny, cover: o }; break; }
      }
      if (!hit) for (const m of this.marines) {
        if (m.alive && Math.abs(m.x - nx) < 0.45 && ny > m.y && ny < m.y + 1.9) { hit = { x: nx, y: ny, marine: m }; break; }
      }
      if (!hit && ny <= room.y0) hit = { x: nx, y: room.y0 };
      if (hit || p.t > 2.5) { this.projectiles.splice(i, 1); if (hit) this.splash(p, hit); continue; }
      p.x = nx;
      p.y = ny;
    }
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const pool = this.pools[i];
      pool.t -= dt;
      if (pool.t <= 0) { this.pools.splice(i, 1); continue; }
      for (const m of this.marines) {
        if (!m.alive || m.down || m.room !== pool.room || Math.abs(m.x - pool.x) > pool.r || this.params.god) continue; // (a man down: only claws finish him)
        m.acid = (m.acid ?? 0) + SPIT.POOL.DPS * dt;
        if (m.acid >= 2) { const d = m.acid; m.acid = 0; this.damage(m, d * (m.mods?.armor ?? 1), null, { x: m.x, y: m.y + 0.2, dx: 0, dy: 1, acid: true }); }
      }
    }
  }

  /** Acid lands: on cover it's spent; on the deck it burns whoever is close and pools. */
  splash(p, hit) {
    const room = this.level.rooms[p.room];
    this.emit('acid', { x: hit.x, y: hit.y, cover: !!hit.cover });
    if (hit.cover) {
      if (hit.cover.barricade) hit.cover.hp -= 12;
      if (hit.cover.barricade && hit.cover.hp <= 0) this.breakBarricade(hit.cover);
      return;
    }
    if (hit.y <= room.y0 + 0.3 || hit.marine) this.pools.push({ x: hit.x, room: p.room, y: room.y0, r: SPIT.POOL.R, t: SPIT.POOL.TIME, max: SPIT.POOL.TIME });
    for (const m of this.marines) {
      if (!m.alive || m.down || m.room !== p.room || Math.abs(m.x - hit.x) > SPIT.SPLASH || this.params.god) continue;
      if (this.covered(m, p.from)) continue; // took it on the cover
      this.attackedAt = this.time; // fired on: weapons free, even on cautious
      this.damage(m, this.rng.int(SPIT.DAMAGE[0], SPIT.DAMAGE[1]) * (this.level.mods?.alienDmg ?? 1) * (m.mods?.armor ?? 1), p.by, { x: m.x, y: m.y + 1.2, dx: Math.sign(m.x - p.from), dy: 0, acid: true });
    }
  }

  // ------------------------------------------------------------------ the Defend kit

  /**
   * Defend: two sentry guns set down either side of the squad, a little beyond the outermost man on
   * each side (in his room - the line may straddle a doorway), each with its own belt (config
   * DEFEND). They stay where they're put. Returns the two guns, or null (none in the kit).
   */
  deployDefence() {
    if (this.kit.defend <= 0 || !this.squad.alive) return null;
    const sq = this.squad;
    const guns = [-1, 1].map((side) => {
      const end = sq.order.reduce((a, m) => ((m.x - a.x) * side > 0 ? m : a));
      const room = this.level.rooms[end.room];
      const [wl, wr] = walkLimits(room);
      const x = Math.max(wl + 0.4, Math.min(wr - 0.4, end.x + side * DEFEND.GAP));
      const prop = { id: `gun${this.nextGun++}`, kind: 'turret', x, z: DEFEND.Z, room: room.id };
      return { kind: 'sentry', name: 'TURRET', prop, x, y: room.y0 + 1.25, room: room.id, ammo: DEFEND.AMMO, cool: 0.4, facing: side, kills: 0, lastKillT: -99, spec: DEFEND, deployed: true };
    });
    this.sentries.push(...guns);
    this.kit.defend--;
    if (this.director.horde) this.director.horde.defended = true;
    this.emit('defend', { guns });
    this.barks.say(sq.order[sq.order.length > 1 ? 1 : 0], 'defend', 1);
    return guns;
  }

  /** A barricade on the walking line coming apart (a brute smashing it, acid eating it). */
  breakBarricade(prop) {
    if (prop.destroyed) return;
    prop.destroyed = true;
    const room = this.level.rooms[prop.room];
    room.props = room.props.filter((p) => p !== prop);
    this.squad.featureCache.delete(room.id);
    this.noise(prop.x, room.y0 + 1, 14);
    this.emit('barricade-down', { prop, room });
  }

  /** Burns (a fire pushed through): armour takes some of it. */
  burn(m, dmg) {
    if (!m.alive || this.params.god) return;
    this.damage(m, dmg * (m.mods?.armor ?? 1), null, { x: m.x, y: m.y + 1, dx: 0, dy: 0.5, fire: true });
  }

  targets() { return [...this.aliens, ...this.critters, ...(this.survivors ?? []), ...this.props.filter((p) => p.explosive && p.alive)]; }

  /** Once the whole squad is inside the airlock, the outer door seals behind them. */
  cycleAirlock() {
    if (this.lockCycled) return;
    const outer = this.level.portals.find((p) => p.outer);
    if (!outer?.open) return;
    const order = this.squad.order;
    const air = this.level.rooms[this.level.airlock];
    const inside = (m) => ((this.level.heading ?? 1) > 0 ? m.x > air.x0 + 0.6 : m.x < air.x1 - 0.6);
    if (order.length && order.every((m) => m.room === this.level.airlock && m.mode === 'walk' && inside(m))) {
      this.lockCycled = true;
      this.setDoor(outer, false);
      this.emit('airlock-cycle', {});
      this.emit('bark', { marine: order[0], text: 'Outer door sealed. Pressure equalised. Here we go.' });
    }
  }

  /** Hostiles left on the ship: alive + still in the director's reserve + a horde still to come. */
  lifesigns() { return this.aliens.filter((a) => a.alive).length + this.reserve + (this.director?.hordeSize ?? 0); }

  noise(x, y, r) { this.noises.push({ x, y, r }); this.director.hear(r); }

  // ------------------------------------------------------------------ step

  step(dt) {
    if (this.status !== 'playing') return;
    this.time += dt;
    this.tick++;
    for (const c of this.commands.splice(0)) this.apply(c);
    this.stimT = Math.max(0, this.stimT - dt);

    for (const e of [...this.marines, ...this.aliens, ...this.critters, ...this.survivors]) {
      e.prevX = e.x; e.prevY = e.y; e.prevZ = e.z;
      if (e.pitch !== undefined) e.prevPitch = e.pitch;
      e.hitT = Math.max(0, e.hitT - dt);
      if (e.barkT > 0) e.barkT -= dt;
      if (e.panicT > 0) e.panicT -= dt;
    }

    this.updateMeters(dt);
    updateBreakdowns(this, dt);
    this.squad.update(dt);
    for (const a of this.aliens) updateAlien(this, a, dt);
    for (const c of this.critters) updateCritter(this, c, dt);
    for (const s of this.survivors) updateSurvivor(this, s, dt);
    this.noises.length = 0;

    for (const e of this.marines) if (e.alive) this.physics.moveHitbox(e, e.down ? DOWN.HITBOX : this.squad.cover ? 1.4 : e.height);
    for (const e of this.aliens) if (e.alive && e.state !== 'vent') this.physics.moveHitbox(e, undefined, bodyPoint(e, 0.5));
    for (const e of this.critters) if (e.alive) this.physics.moveHitbox(e);
    for (const e of this.survivors) if (e.alive && e.state !== 'rescued') this.physics.moveHitbox(e);
    this.physics.step(dt);

    this.updateAcid(dt);
    this.updateVisibility();
    let engaged = false;
    for (const m of this.squad.order) {
      updateMarineCombat(this, m, dt);
      if (m.target) engaged = true;
    }
    // Stay engaged briefly after the last target so the squad doesn't stutter-step.
    if (engaged) this.engagedUntil = this.time + 0.8;
    this.squad.engaged = this.time < (this.engagedUntil ?? 0);
    this.hazards.update();
    updateSentries(this, dt);
    updateMelee(this, dt);
    updateMedic(this, dt);
    this.gear.update(dt);
    this.morale.update(dt);
    this.tactics.update(dt);
    this.barks.update();

    this.cycleAirlock();
    this.shipEvents.update(dt);
    this.director.update(dt);
    this.doctrine.update(dt);

    this.contract.update(dt);
    if (!this.squad.alive) this.end('lost');
  }

  updateVisibility() {
    const marines = this.squad.order;
    for (const e of this.aliens) {
      const seer = e.alive && e.state !== 'vent' ? marines.find((m) => canSee(this, m, e)) : null;
      e.visible = !!seer;
      if (seer && !e.spotted) { e.spotted = true; practice(seer, 'per', 1); } // first to see it
      if (seer && e.alive && e.surface !== 'floor' && !e.calledHigh) { e.calledHigh = true; this.barks.say(seer, 'ceiling', 0.8); }
      if (!e.alive) e.visible = e.seenDead ?? false;
    }
    for (const c of this.critters) c.visible = c.alive ? marines.some((m) => canSee(this, m, c)) : c.visible;
    for (const s of this.survivors) {
      if (s.state === 'rescued') { s.visible = false; continue; }
      s.visible = s.alive ? marines.some((m) => canSee(this, m, s)) : s.visible;
    }
    for (const p of this.props) {
      if (!p.alive || !p.explosive) continue;
      p.visible = marines.some((m) => Math.abs(m.x - p.x) < 26 && canSee(this, m, p));
    }
    if (this.tick % 15 === 0) this.updateSeenRooms();
  }

  /** Mark rooms a marine can see into (through open doors / shafts) for the minimap. */
  updateSeenRooms() {
    for (const m of this.squad.order) {
      const room = this.level.rooms[m.room];
      for (const pid of room.portals) {
        const p = this.level.portals[pid];
        const other = this.level.rooms[p.a === m.room ? p.b : p.a];
        if (other.seen) continue;
        const cx = Math.min(Math.max(m.x, other.x0 + 1), other.x1 - 1);
        if (this.physics.los(m.x, m.y + 1.6, cx, other.y0 + 1.6)) other.seen = true;
      }
    }
  }

  // ------------------------------------------------------------------ interactions

  damage(e, dmg, source, hit) {
    if (!e.alive) return;
    if (e.kind === 'prop') {
      e.hp -= dmg;
      e.lastHitBy = source ?? e.lastHitBy;
      this.emit('hit', { entity: e, dmg, source, ...hit });
      if (e.hp <= 0) this.hazards.destroy(e);
      return;
    }
    e.hp -= dmg;
    e.hitT = 0.25;
    // Luck: a blow that should have killed him leaves him on his feet (once or so a mission).
    if (e.kind === 'marine' && source?.kind === 'alien') { practice(e, 'sta', dmg / 30); practice(e, 'nrv', 0.3); }
    if (e.kind === 'marine' && source?.kind === 'alien' && e.hp > 0 && e.hp < e.maxHp * 0.5) this.nerveCheck(e);
    if (e.kind === 'marine' && source?.kind === 'alien') breakingPoint(this, e);
    if (e.kind === 'marine' && e.hp <= 0 && e.escapes > 0 && !e.down) {
      e.escapes--;
      e.hp = 1;
      practice(e, 'lck', 2);
      this.emit('lucky', { marine: e });
      this.barks.say(e, 'lucky');
    }
    this.emit('hit', { entity: e, dmg, source, ...hit });
    if (e.kind === 'alien') {
      e.staggerT = (hit?.stagger ?? 0.12) * (e.staggerMul ?? 1);
      if (e.state === 'dormant') wake(this, e, 'shot');
      // A breacher blast knocks a crawler off the ceiling or the bulkhead.
      else if (e.surface !== 'floor' && e.state === 'hunt' && (hit?.stagger ?? 0) >= 0.3 && e.hp > 0) startDrop(this, e);
      // Rounds coming in pin it down (a heavy's twice as hard).
      if (source?.kind === 'marine') e.suppressT = Math.min(SUPPRESS.MAX, e.suppressT + SUPPRESS.HIT * (source.weapon?.heavy || source.weaponKey === 'heavy' ? 2 : 1));
      // Shot hard enough while it drags a man off: it lets go of him.
      if (e.drag && (e.drag.hurt += dmg) >= PACK.DRAG.DROP) letGo(this, e);
      // A heavy hit - or enough lead - cuts a scream off.
      if (e.state === 'scream' && e.hp > 0 && ((hit?.stagger ?? 0) >= SCREAM.CUT || (e.scream.hurt += dmg) >= 30)) {
        e.state = 'hunt';
        e.scream = null;
        e.screamT = 4;
        this.emit('scream-cut', { alien: e });
      }
      // Hit and run: badly hurt, an agile one may break off for the vents (once).
      if (!e.fled && e.flees > 0 && e.hp > 0 && e.hp < e.maxHp * PACK.FLEE.HP && (e.state === 'hunt' || e.state === 'attack') && !e.drag) {
        e.fled = true;
        if (this.hive.chance(e.flees)) bolt(this, e);
      }
    }
    if (e.hp <= 0) {
      if (e.kind === 'marine' && !e.down) this.downMarine(e);
      else this.kill(e, source);
    }
  }

  /**
   * A lethal blow puts a trooper down instead of killing him: he drops out of the line (the
   * squad closes up) and lies there - no clock - until someone gets him up (revive) or something
   * finishes him off (another strike, a blast).
   */
  downMarine(m) {
    m.down = true;
    m.hp = 0;
    m.target = null;
    m.reloadT = 0;
    m.burst = 0;
    m.moving = false;
    m.offX = 0;
    m.anim = 'die';
    this.squad.remove(m);
    this.tactics.alertUntil = this.time + STANCE.ALERT_AFTER;
    this.emit('downed', { marine: m });
    const mate = this.squad.order[this.squad.order.length > 1 ? 1 : 0];
    if (mate) this.barks.say(mate, 'medic', 1, { name: m.name });
  }

  /** Up off the deck (squad.js revive action): back in the line at the rear, with a wound. */
  revive(m, by, stim = false) {
    if (!m.alive || !m.down) return;
    m.down = false;
    if (stim && this.stims > 0) this.stims--; else stim = false;
    const medic = Math.max(1, by?.mods?.medic ?? 1);
    m.hp = Math.max(1, Math.round(Math.min(1, (stim ? DOWN.STIM_HP : DOWN.HP) * medic) * m.maxHp));
    if (!m.wound) {
      m.wound = this.wounds.chance(0.5) ? 'leg' : 'arm';
      const W = DOWN.WOUNDS[m.wound];
      m.mods = { ...m.mods, spread: m.mods.spread * (W.spread ?? 1), reload: m.mods.reload * (W.reload ?? 1), climb: m.mods.climb * (W.climb ?? 1) };
    }
    m.anim = 'idle_alert';
    this.squad.rejoin(m);
    if (this.lead && m === this.player) this.squad.takeLead(m); // back on his feet, back on point
    if (by) practice(by, 'int', 1.5);
    this.emit('revived', { marine: m, by, stim });
    this.barks.later(0.6, m, 'revived');
  }

  kill(e, source) {
    e.alive = false;
    e.hp = 0;
    e.seenDead = e.visible;
    this.physics.removeHitbox(e);
    if (e.kind === 'alien') {
      if (e.drag) letGo(this, e);
      if (e.births) {
        const bonus = e.royal ? BROOD.QUEEN_BONUS : BROOD.BONUS;
        this.credits += bonus;
        this.emit('brood-dead', { alien: e, bonus });
        if (e.royal) { applyRelic(this, 'queens_tooth'); this.relicsFound.push('queens_tooth'); this.emit('relic', { key: 'queens_tooth', prop: null, marine: source }); }
        this.flags.brood = true;
      }
      this.stats.kills++;
      this.addEnergy(ENERGY.PER_KILL); // every kill puts some fight back in them
      if (source) { source.kills++; source.lastKillT = this.time; }
      if (source?.kind === 'marine') {
        if (Math.hypot(e.x - source.x, e.y - source.y) < 3) practice(source, 'nrv', 1); // up close
        if (source.weaponKey === 'heavy' || source.weaponKey === 'breacher' || source.weapon?.heavy) practice(source, 'str', 0.5);
      }
      if (!this.cleared && this.lifesigns() === 0) {
        this.cleared = true;
        const bonus = HOSTILES.CLEAR_BONUS * (1 + (this.level.threat ?? 0) * 0.5);
        this.credits += bonus;
        this.emit('ship-clear', { bonus });
        this.emit('bark', { marine: this.squad.leader, text: `Tracker's dead quiet. Ship is CLEAR. (+${bonus} cr)` });
      }
    }
    if (e.kind === 'critter') {
      // Vermin are protein: the squad's energy comes back (high alert burns it).
      this.stats.critters++;
      this.addEnergy(ENERGY.PER_CRITTER);
      if (source?.kind === 'marine') this.barks.say(source, 'eat', 0.5);
    }
    if (e.kind === 'survivor') {
      this.stats.civilians = (this.stats.civilians ?? 0) + 1;
      this.emit('survivor-died', { survivor: e, friendly: source?.kind === 'marine' });
      const who = this.squad.order[0];
      if (who) this.emit('bark', { marine: who, text: source?.kind === 'marine' ? 'Cease fire! CEASE FIRE! ...that was a civilian.' : `We lost the civilian - ${e.name}!` });
    }
    if (e.kind === 'marine') {
      const finished = e.down;
      e.down = false;
      this.squad.remove(e);
      this.emit('marine-died', { marine: e });
      if (e.taken && this.squad.order[0]) this.barks.say(this.squad.order[0], 'taken', 1, { name: e.name });
      else if (finished && this.squad.order[0]) this.barks.say(this.squad.order[0], 'finished', 1, { name: e.name });
      this.tactics.alertUntil = this.time + STANCE.ALERT_AFTER * 1.5;
      if (this.squad.order[0]) this.barks.say(this.squad.order[0], 'down', 1, { name: e.name });
      if (this.lead && e === this.player) this.passControl();
    }
    this.emit('kill', { entity: e, source });
  }

  alienStrike(a, m) {
    if (!canReach(this, a, m)) return;
    if (m.kind === 'marine' && m.down) {
      // A man on the deck can't fight back: it finishes him - or drags him off to the vents.
      this.emit('strike', { alien: a, marine: m });
      if (this.params.god || m.dragged) return;
      if (a.drags > 0 && startDrag(this, a, m)) return;
      this.kill(m, a);
      return;
    }
    if (m.kind === 'survivor') { this.damage(m, this.rng.int(a.damage[0], a.damage[1]), a, { x: m.x, y: m.y + 1.2, dx: a.facing, dy: 0 }); return; }
    this.attackedAt = this.time;
    // (Power fists block some of it: config WEAPONS.fists ARMOR.)
    const dmg = this.rng.int(a.damage[0], a.damage[1]) * (this.squad.cover ? 0.75 : 1) * (m.mods?.armor ?? 1) * (m.weapon?.armor ?? 1);
    this.emit('strike', { alien: a, marine: m });
    if (this.params.god) return;
    this.damage(m, dmg, a, { x: m.x, y: m.y + 1.3, dx: a.facing, dy: 0 });
  }

  setDoor(portal, open, by = null) {
    if (portal.open === open) return;
    portal.open = open;
    this.physics.setDoor(portal.id, open);
    this.emit('door', { portal, open, by });
    if (open) this.noise(portal.x, portal.y, 10);
  }

  /**
   * A weak bulkhead blown open (encounter 'breach', or a blast against it): a doorway the ship
   * never had - the physics, the navigation graph and both rooms' features learn of it.
   */
  breach(id, by = null) {
    const L = this.level;
    const b = L.breaches?.find((q) => q.id === id);
    if (!b || b.open) return false;
    b.open = true;
    const ra = L.rooms[b.a];
    const rb = L.rooms[b.b];
    const p = { id: L.portals.length, kind: 'door', a: b.a, b: b.b, x: b.x, y: ra.y0, open: true, breach: id };
    L.portals.push(p);
    ra.portals.push(p.id);
    rb.portals.push(p.id);
    this.physics.openBreach(id);
    this.nav = new NavGraph(L);
    this.squad.featureCache.delete(b.a);
    this.squad.featureCache.delete(b.b);
    this.squad.handled.delete('endL');
    this.squad.handled.delete('endR');
    this.noise(b.x, ra.y0 + 1, 40);
    this.emit('breach', { breach: b, portal: p, by });
    return true;
  }

  resolveLoot(prop, marine) {
    prop.searched = true;
    prop.opened = true;
    const loot = prop.loot ?? { type: 'empty' };
    let text = 'Nothing useful.';
    switch (loot.type) {
      case 'credits': {
        const amount = Math.round(loot.amount * (marine?.mods?.credits ?? 1));
        this.credits += amount;
        text = `${amount} credits.`;
        break;
      }
      case 'ammo': {
        // Each trooper takes magazines for their own weapon.
        const mags = Math.max(1, Math.round(loot.amount / 30));
        for (const m of this.squad.order) { m.reserve += mags * m.weapon.mag; m.dry = false; }
        text = `Ammo cache. +${mags} mag${mags > 1 ? 's' : ''} each.`;
        break;
      }
      case 'medkit': {
        const m = [...this.squad.order].sort((p, q) => p.hp / p.maxHp - q.hp / q.maxHp)[0];
        m.hp = Math.min(m.maxHp, m.hp + loot.amount);
        text = m === marine ? 'Medkit. Patching myself up.' : `Medkit. ${m.name}, hold still.`;
        break;
      }
      case 'stim': this.stims++; text = 'Stim-pack.'; break;
      case 'relic': {
        // A relic (meta/relics.js): applies now, and goes home with the squad.
        const r = RELICS[loot.key];
        if (r) { applyRelic(this, loot.key); this.relicsFound.push(loot.key); text = `${r.label}. ${r.text}`; this.emit('relic', { key: loot.key, prop, marine }); } else text = 'A sealed case - empty.';
        break;
      }
      case 'keycard':
        this.kit.keycards++;
        text = 'A crew keycard - ACCESS: STORES. Somewhere there\'s a door for this.';
        this.emit('keycard', { prop, marine });
        break;
      case 'food': this.addEnergy(ENERGY.FOOD); text = 'Ration packs. Eat up.'; break;
      case 'defend': this.kit.defend++; text = 'Sentry kit - two guns. That\'s our answer to a swarm.'; break;
      case 'drink': this.addEnergy(ENERGY.DRINK); text = 'Energy drinks - still sealed!'; break;
      case 'weapon': {
        let item = loot.item;
        // Luck: the finder's eye for the good stuff turns it up a grade now and then.
        if ((marine?.mods?.find ?? 0) > 0 && item.rarity !== 'legendary' && this.luck.chance(marine.mods.find)) {
          item = upgradeWeapon(this.luck, item);
          loot.item = item;
          practice(marine, 'lck', 1);
        }
        const r = RARITY[item.rarity];
        text = `${r.label} weapon: ${item.name}${loot.bent ? ' - knocked about, but it works' : ''}!`;
        this.emit('bark', { marine, text });
        this.stats.loot++;
        this.emit('loot', { prop, loot, marine });
        this.offerWeapon(item);
        return;
      }
      case 'ruined': text = 'Smashed. Nothing in here worth having now.'; break;
      case 'treasure':
        this.salvage.push(loot.item);
        text = `${loot.item.name}. Worth ${loot.item.value} cr - if we get it home.`;
        break;
      case 'ambush': {
        if (this.reserve <= 0) { text = 'Something was nesting in here... long gone.'; break; }
        this.reserve--;
        const room = this.level.rooms[prop.room];
        const a = this.addAlien(this.breed(prop.x, room.y0, prop.room, 'hunt'));
        a.wakeT = 0.2;
        text = 'Contact! It was hiding inside!';
        this.emit('ambush', { count: 1, prop });
        break;
      }
      default:
    }
    if (loot.type !== 'empty' && loot.type !== 'ambush') this.stats.loot++;
    this.emit('loot', { prop, loot, marine });
    this.emit('bark', { marine, text });
  }

  /** Found a weapon: ask who takes it (or send it back to the ship's stash). */
  offerWeapon(item) {
    const options = this.squad.order.map((m) => ({ id: `give:${m.id}`, label: `${m.name} (${m.weapon.rarity === 'common' ? '' : m.weapon.rarity + ' '}${m.weaponKey})` }));
    options.push({ id: 'stash', label: 'Stash it' });
    const extra = affixText(item);
    this.squad.ask({ type: 'weapon', item, text: `${RARITY[item.rarity].label.toUpperCase()}: ${item.name}${extra ? ` - ${extra}` : ''}.`, options });
  }

  equip(m, item) {
    if (!m?.alive) { this.stashItem(item); return; }
    if (m.weaponItem && m.weaponItem.rarity !== 'common') this.stash.push(m.weaponItem);
    m.weaponItem = item;
    m.weapon = weaponStats(item);
    m.weaponKey = item.cls;
    m.loadout.weapon = item.cls;
    m.mag = m.weapon.mag;
    m.reserve = m.weapon.reserve;
    m.reloadT = 0;
    m.dry = false;
    this.emit('equip', { marine: m, item });
    this.emit('bark', { marine: m, text: `Oh, I like this. ${item.name}.` });
  }

  stashItem(item) {
    this.stash.push(item);
    this.emit('bark', { marine: this.squad.leader, text: 'Tag it for the ship.' });
  }

  startUplink() {
    this.uplink = { t0: this.time };
    this.director.waveT = 2;
    this.emit('uplink-start', {});
    this.emit('bark', { marine: this.squad.leader, text: 'Jacking in. Hold this deck!' });
  }

  completeUplink() {
    this.stats.rescued = this.survivors.filter((s) => s.state === 'rescued').length;
    // Anyone still down: carried out from the command deck, left behind anywhere else.
    for (const m of this.marines) {
      if (!m.alive || !m.down) continue;
      if (m.room === this.level.objective.room) this.revive(m, null);
      else this.kill(m, null);
    }
    this.emit('uplink-done', {});
    this.end('won');
  }

  end(status) {
    if (this.status !== 'playing') return;
    if (status === 'lost') for (const m of this.marines) if (m.alive && m.down) { m.alive = false; m.down = false; } // nobody left to carry them
    this.status = status;
    this.emit(status, { stats: this.stats, time: this.time });
  }

  // ------------------------------------------------------------------ player commands

  choose(optionId) { return this.squad.choose(optionId); }
  bark(marine, key, chance = 1, vars = {}) { return this.barks.say(marine, key, chance, vars); }
  setROE(roe) {
    if (roe === ROE.ALERT && this.energy < ENERGY.MIN_TO_ENTER) { this.bark(this.squad.leader, 'no_energy'); return false; }
    this.settings.roe = roe;
    this.emit('roe', { roe });
    return true;
  }
  setPace(pace) {
    if (pace === 'run' && this.stamina < PACE.MIN_TO_RUN) { this.bark(this.squad.leader, 'winded'); return false; }
    this.squad.pace = pace;
    if (pace === 'run') this.squad.cover = false;
    this.emit('pace', { pace });
    return true;
  }
  /** Cover: a full stop, everyone down. */
  toggleCover() {
    const sq = this.squad;
    sq.cover = !sq.cover;
    if (sq.cover && sq.pace === 'run') sq.pace = 'normal';
  }

  /** The kit buttons: a grenade, a flare, the Defend guns (queued: applied on the next step). */
  useKit(item) { this.commands.push({ kind: 'kit', item }); }

  // ------------------------------------------------------------------ lead mode (the controller)

  /** The controller's sticks and held buttons, as of this frame (sim/squad.js steer, sim/combat.js). */
  steer(pad) { Object.assign(this.pad, pad); }

  /** A (use): whatever is within the player's reach - a crate, a terminal, a door, a man down... */
  use() { this.commands.push({ kind: 'use' }); }

  /** RB: change magazines. */
  reloadWeapon() { this.commands.push({ kind: 'reload' }); }

  /** B: the followers hold where they are / fall in behind again. */
  toggleHold() { this.commands.push({ kind: 'hold' }); }

  /** Lead: the player's marine died - the next man in the line is his now. */
  passControl() {
    const prev = this.player;
    if (prev) prev.controlled = false;
    const next = this.squad.order[0] ?? null;
    this.player = next;
    if (!next) return;
    next.controlled = true;
    this.squad.takeLead(next);
    this.emit('control', { marine: next, from: prev });
    this.barks.later(1.2, next, 'took_point', 1);
  }

  /**
   * What the player's marine could use right now: the nearest interactable in his room within
   * reach (the HUD prompts it, A does it). Barrels are shot, survivors reached; neither is "used".
   */
  useTarget() {
    const p = this.player;
    if (!this.lead || !p?.alive || p.down) return null;
    const sq = this.squad;
    if (sq.state !== 'advance' || sq.trav || sq.task) return null;
    let best = null;
    for (const t of this.interactables()) {
      if (t.room !== p.room || t.kind === 'barrel' || t.kind === 'survivor' || t.kind === 'distress') continue;
      if (t.kind === 'door' && this.level.portals[t.portal].open) continue;
      const reach = t.kind === 'ladder' || t.kind === 'stairs' ? 0.7 : USE_REACH;
      const d = Math.abs(t.x - p.x);
      if (d > reach) continue;
      const rank = USE_RANK[t.kind] ?? 5;
      if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { t, d, rank };
    }
    return best?.t ?? null;
  }

  /** Lead: do the thing within reach (world.use -> apply). Returns true if something started. */
  useNearby() {
    const t = this.useTarget();
    if (!t) return false;
    const L = this.level;
    const sq = this.squad;
    const p = this.player;
    const room = L.rooms[t.room];
    const prop = t.prop !== undefined ? room.props.find((q) => q.id === t.prop) : null;
    switch (t.kind) {
      case 'crate':
        if (!prop || prop.searched) return false;
        prop.ignored = false;
        sq.startSearch(prop, `loot${prop.id}`);
        return true;
      case 'terminal':
        if (!prop) return false;
        if (prop.encounter === 'junction') prop.encounterDone = false;
        if ((prop.encounter === 'turret' || prop.encounter === 'autodoc') && !prop.used && !prop.jammed) prop.encounterDone = false;
        this.encounters.offer(prop.encounter, prop, { key: `enc${prop.id}`, type: 'encounter', x: prop.x, prop });
        return true;
      case 'objective': {
        const console_ = room.props.find((q) => q.objective);
        if (!console_ || this.uplink) return false;
        sq.handled.add('objective');
        return this.contract.begin(console_);
      }
      case 'door': {
        const d = L.portals[t.portal];
        if (d.open) return false;
        if (d.welded) { this.encounters.offer('doorctl', { x: t.x, room: t.room, door: d, id: `door${d.id}` }, { key: `doorctl${d.id}` }); return true; }
        if (d.fire) { this.encounters.offer('fire', { x: t.x, room: t.room, fire: d, id: `fire${d.id}` }, { key: `fire${d.id}` }); return true; }
        if (d.locked) { d.passed = false; this.encounters.offer('keydoor', { x: t.x, room: t.room, door: d, id: `key${d.id}` }, { key: `key${d.id}` }); return true; }
        p.facing = Math.sign(d.x - p.x) || p.facing;
        sq.heading = p.facing;
        sq.startDoor(d);
        return true;
      }
      case 'fire': {
        const d = L.portals[t.portal];
        this.encounters.offer('fire', { x: t.x, room: t.room, fire: d, id: `fire${d.id}` }, { key: `fire${d.id}` });
        return true;
      }
      case 'doorctl': {
        const d = L.portals[t.portal];
        this.encounters.offer('doorctl', { x: t.x, room: t.room, door: d, id: `door${d.id}` }, { key: `doorctl${d.id}` });
        return true;
      }
      case 'breach': {
        const b = L.breaches.find((q) => q.id === t.breach);
        if (!b || b.open) return false;
        this.encounters.offer('breach', { x: t.x, room: t.room, breach: b, far: t.room === b.a ? b.b : b.a, id: `breach${b.id}` }, { key: `breach${b.id}` });
        return true;
      }
      case 'vent': {
        const v = L.vents[t.vent];
        this.encounters.offer('vent', { x: v.x, room: v.room, vent: v, id: `vent${v.id}` }, { key: `vent${v.id}` });
        return true;
      }
      case 'downed': {
        const m = this.marines.find((q) => q.id === t.marine);
        if (!m?.alive || !m.down || m.dragged) return false;
        const medic = sq.order.filter((o) => o !== p && o.room === m.room && o.mode === 'walk' && Math.abs(o.x - m.x) <= 14)
          .sort((a, b) => (b.mods?.medic ?? 1) - (a.mods?.medic ?? 1) || Math.abs(a.x - m.x) - Math.abs(b.x - m.x))[0];
        const by = medic && (medic.mods?.medic ?? 1) > (p.mods?.medic ?? 1) ? medic : p;
        sq.startRevive(m, by, true);
        return true;
      }
      case 'ladder': case 'stairs':
        return sq.climb({ x: t.x, portal: L.portals[t.portal] });
      default: return false;
    }
  }

  kitNow(item) {
    if (item === 'grenade') return this.gear.grenade();
    if (item === 'flare') return this.gear.flare();
    if (item === 'defend') return !!this.deployDefence();
    return false;
  }

  addEnergy(n) {
    this.energy = Math.min(ENERGY.MAX, this.energy + n);
    this.emit('energy', { energy: this.energy, gain: n });
  }

  /** Stamina (running) and energy (high alert) meters. */
  updateMeters(dt) {
    const sq = this.squad;
    const moving = sq.leader?.moving;
    // Everyone has his own breath (Stamina stat); the squad runs only while all of them can.
    const running = sq.pace === 'run' && moving;
    let low = null;
    for (const m of sq.order) {
      if (running) { practice(m, 'spd', dt / 30); practice(m, 'sta', dt / 60); }
      if (this.settings.roe === ROE.ALERT) practice(m, 'nrv', dt / 90);
      if (running) m.stamina = Math.max(0, m.stamina - PACE.DRAIN * dt * m.mods.drain);
      else m.stamina = Math.min(m.staminaMax, m.stamina + (sq.pace === 'run' ? PACE.REGEN_FAST : moving ? PACE.REGEN_MOVING : PACE.REGEN_RESTING) * dt);
      if (!low || m.stamina < low.stamina) low = m;
    }
    if (low) this.stamina = low.stamina;
    if (running && low && low.stamina <= 0) { sq.pace = 'normal'; this.bark(low, 'winded'); this.emit('pace', { pace: 'normal' }); }
    if (this.settings.roe === ROE.ALERT) {
      const cool = Math.min(1, ...this.squad.order.map((m) => m.mods.focus));
      this.energy = Math.max(0, this.energy - ENERGY.DRAIN * dt * cool * (1 - 0.15 * this.upgrades.neural));
      if (this.energy <= 0) { this.settings.roe = ROE.NORMAL; this.bark(sq.leader, 'energy_out'); this.emit('roe', { roe: ROE.NORMAL }); }
    }
  }
  toggleFlashlight() { this.settings.flashlight = !this.settings.flashlight; this.emit('flashlight', { on: this.settings.flashlight }); }
  turnAround() {
    const heading = this.squad.heading;
    if (this.squad.trav || this.squad.action || this.squad.task) return;
    this.squad.orderTurn();
    this.doctrine.onTurn(heading);
  }
  useStim() {
    if (this.stims <= 0 || !this.squad.alive) return false;
    this.stims--;
    const m = [...this.squad.order].sort((p, q) => p.hp - q.hp)[0];
    const medic = Math.max(1, ...this.squad.order.map((q) => q.mods.medic));
    m.hp = Math.min(m.maxHp, m.hp + SQUAD.STIM_HEAL * medic);
    practice(bestAt(this.squad.order, 'int'), 'int', 1); // the medic
    this.stimT = 8;
    this.emit('stim', { marine: m });
    this.emit('bark', { marine: m, text: 'Stimmed up. Let\'s go.' });
    return true;
  }

  // ------------------------------------------------------------------ in-world interactions

  /**
   * Things the player can point the squad at (ui/interact.js): doors, ladders and stairs,
   * unsearched containers, survivors not yet reached, fuel barrels - in rooms the squad has
   * seen. Each has a stable id for world.nudge().
   */
  interactables() {
    const L = this.level;
    const known = (r) => L.rooms[r]?.seen || L.rooms[r]?.explored;
    const out = [];
    for (const p of L.portals) {
      if (p.outer && (p.open || !this.doctrine?.manual)) continue;
      const ends = portalEnds(L, p);
      if (p.kind === 'door') {
        if ((!known(p.a) && !known(p.b)) || p.fire) continue;
        const y = Math.min(L.rooms[p.a].y0, L.rooms[p.b].y0) + 1.3;
        out.push({ id: `p${p.id}`, kind: 'door', x: p.x, y, room: known(p.a) ? p.a : p.b, portal: p.id, label: p.outer ? 'Board the derelict' : p.open ? 'Go through' : p.locked ? 'Unlock the door' : 'Breach the door' });
        continue;
      }
      for (const r of [p.a, p.b]) {
        if (!known(r) || !ends[r]) continue;
        const up = p.a === r;
        out.push({ id: `p${p.id}r${r}`, kind: p.kind, x: ends[r].x, y: L.rooms[r].y0 + (up ? 1.6 : 0.6), room: r, portal: p.id,
          label: `${p.kind === 'ladder' ? 'Climb' : 'Take the stairs'} ${up ? 'up' : 'down'}` });
      }
    }
    for (const r of L.rooms) {
      if (!known(r.id)) continue;
      for (const pr of r.props) {
        if (pr.encounter === 'terminal' && !pr.encounterDone && !pr.destroyed) {
          out.push({ id: `t${pr.id}`, kind: 'terminal', x: pr.x, y: r.y0 + 1.1, room: r.id, prop: pr.id, label: 'Check the terminal' });
        }
        if (pr.encounter === 'junction' && L.rooms.some((q) => q.powerOut) && !pr.destroyed) {
          out.push({ id: `t${pr.id}`, kind: 'terminal', x: pr.x, y: r.y0 + 1.1, room: r.id, prop: pr.id, label: 'Restore the power' });
        }
        // The other set pieces; a turret or the autodoc left for later can still be used.
        const again = pr.encounter === 'turret' || pr.encounter === 'autodoc';
        if (ODDITY[pr.encounter] && !pr.destroyed && !pr.used && !pr.jammed && (again || !pr.encounterDone)) {
          out.push({ id: `t${pr.id}`, kind: 'terminal', x: pr.x, y: r.y0 + 1.1, room: r.id, prop: pr.id, label: ODDITY[pr.encounter] });
        }
        if (!pr.loot || pr.searched) continue;
        out.push({ id: `c${pr.id}`, kind: 'crate', x: pr.x, y: r.y0 + 0.8, room: r.id, prop: pr.id, label: `Search the ${PROPS[pr.kind].label.toLowerCase()}` });
      }
    }
    for (const s of this.survivors) {
      if (!s.alive || !s.visible || s.identified || s.state === 'rescued') continue;
      out.push({ id: `s${s.id}`, kind: 'survivor', x: s.x, y: s.y + 1, room: s.room, survivor: s.id, label: 'Get to the survivor' });
    }
    // Door controls (close / weld / cut) sit above each door's own "go through" marker, and any
    // vent still open can be welded shut.
    for (const p of L.portals) {
      if (p.kind !== 'door' || p.outer || (!known(p.a) && !known(p.b))) continue;
      const side = known(p.a) ? p.a : p.b;
      const y = Math.min(L.rooms[p.a].y0, L.rooms[p.b].y0) + 2.5;
      out.push({ id: `k${p.id}`, kind: 'doorctl', x: p.x, y, room: side, portal: p.id, label: p.welded ? 'Cut the door open' : 'Door controls' });
    }
    for (const v of L.vents) {
      if (v.welded || !known(v.room)) continue;
      out.push({ id: `v${v.id}`, kind: 'vent', x: v.x, y: v.ceiling ? v.y - 0.3 : v.y + 0.2, room: v.room, vent: v.id, label: 'Weld the vent shut' });
    }
    const call = this.shipEvents?.distress;
    if (call) out.push({ id: 'distress', kind: 'distress', x: call.x, y: L.rooms[call.room].y0 + 1.2, room: call.room, label: 'Answer the distress call' });
    for (const p of L.portals) {
      if (!p.fire || (!known(p.a) && !known(p.b))) continue;
      out.push({ id: `p${p.id}`, kind: 'fire', x: p.x, y: Math.min(L.rooms[p.a].y0, L.rooms[p.b].y0) + 1.3, room: known(p.a) ? p.a : p.b, portal: p.id, label: 'Deal with the fire' });
    }
    for (const m of this.marines) {
      if (!m.alive || !m.down || !known(m.room)) continue;
      out.push({ id: `d${m.id}`, kind: 'downed', x: m.x, y: m.y + 0.5, room: m.room, marine: m.id, label: `Get ${m.name} up` });
    }
    // Lead: the contract's target is worked by hand (the squad walks up to it by itself).
    if (this.lead && this.contract.worked && this.contract.phase === 'go' && !this.uplink && !this.contract.working && known(L.objective.room)) {
      const o = L.objective;
      out.push({ id: 'objective', kind: 'objective', x: o.x, y: L.rooms[o.room].y0 + 1.1, room: o.room, label: this.contract.def.verb ?? 'Start the uplink' });
    }
    for (const b of this.props) {
      if (!b.alive || !b.explosive || !b.visible) continue;
      out.push({ id: `b${b.id}`, kind: 'barrel', x: b.x, y: b.y + 0.7, room: b.room, barrel: b.id, label: b.prop.kind === 'gas_cylinder' ? 'Shoot the cylinder' : 'Shoot the barrel' });
    }
    // Weak bulkheads the squad knows of, from either side: a charge opens a way through.
    for (const b of L.breaches ?? []) {
      if (b.open) continue;
      for (const r of [b.a, b.b]) {
        if (!known(r)) continue;
        const side = r === b.a ? 1 : -1; // the wall is at the room's right end from a, its left from b
        out.push({ id: `w${b.id}r${r}`, kind: 'breach', x: wallFace(L.rooms[r], side) - side * 0.6, y: L.rooms[r].y0 + 1.6, room: r, breach: b.id, label: 'Weak bulkhead - set a charge' });
      }
    }
    return out;
  }

  /** Player pointed at something in the scene: the squad makes it their goal (sim/doctrine.js). */
  nudge(id) { this.commands.push({ kind: 'nudge', id }); }

  /** Player changed a standing order mid-mission (the orders bar): from the next step on. */
  setOrder(knob, value) { this.commands.push({ kind: 'order', knob, value }); }

  /** Player clicked a spot on the floor of a room the squad knows (Manual orders). */
  moveTo(room, x) { this.commands.push({ kind: 'move', room, x }); }

  /** A spot the squad can be sent to (room known, x within its walkable floor), or null. */
  floorSpot(room, x) {
    const r = this.level.rooms[room];
    if (!r || !(r.seen || r.explored)) return null;
    const [wl, wr] = walkLimits(r);
    return { room, x: Math.max(wl, Math.min(wr, x)) };
  }

  apply(c) {
    // Lead: the player walks, uses and shoots for himself; there is nothing to send the squad to.
    if (this.lead && (c.kind === 'nudge' || c.kind === 'move')) return;
    if (c.kind === 'use') { if (!this.useNearby()) this.emit('use-refused', {}); return; }
    if (c.kind === 'reload') { if (this.player?.alive) this.player.wantReload = true; return; }
    if (c.kind === 'hold') {
      this.squad.followersHold = !this.squad.followersHold;
      this.emit('hold', { on: this.squad.followersHold });
      const mate = this.squad.order.find((m) => m !== this.player);
      if (mate) this.barks.say(mate, this.squad.followersHold ? 'hold_ack' : 'follow_ack', 0.9);
      return;
    }
    // A new order walks away from an encounter the player hadn't answered.
    const d = this.squad.decision;
    if ((c.kind === 'nudge' || c.kind === 'move') && this.squad.state === 'decision' && d?.encounter) this.choose('leave');
    if (c.kind === 'nudge') {
      const t = this.interactables().find((q) => q.id === c.id);
      if (t) this.doctrine.nudge(t);
    } else if (c.kind === 'move') {
      const spot = this.floorSpot(c.room, c.x);
      if (spot) this.doctrine.moveTo(spot.room, spot.x);
    } else if (c.kind === 'order') this.doctrine.setOrder(c.knob, c.value);
    else if (c.kind === 'kit' && !this.kitNow(c.item)) this.emit('kit-refused', { item: c.item });
  }

  /**
   * Nerve: clawed and badly hurt, a trooper with less than average nerve may panic for a moment
   * (wild fire, slow to react - combat.js). A steady squad-mate close by (NRV 8+) holds him
   * together. Troopers with nerve 5+ never panic, so the baseline is unchanged.
   */
  nerveCheck(m) {
    const p = 0.1 * (5 - (m.stats?.nrv ?? 5)) + this.morale.mods.nerve; // shaken, even the steady can crack
    if (p <= 0 || m.panicT > 0) return;
    const steady = this.squad.order.find((o) => o !== m && o.alive && (o.stats?.nrv ?? 5) >= 8 && Math.hypot(o.x - m.x, o.y - m.y) < 4);
    if (this.nerve.chance(steady ? p * 0.4 : p)) {
      m.panicT = 2.2;
      this.barks.say(m, 'panic');
      this.emit('panic', { marine: m });
    } else {
      practice(m, 'nrv', 0.5);
      if (steady) this.barks.say(steady, 'steady', 0.4, { name: m.name });
    }
  }

  /** Everything the campaign needs from a finished run (meta/profile.js applyRun). */
  results() {
    return {
      status: this.status, time: this.time, kills: this.stats.kills,
      credits: this.credits, salvage: this.salvage.reduce((s, t) => s + t.value, 0), salvageItems: this.salvage,
      rescued: this.survivors.filter((s) => s.state === 'rescued').length, cleared: this.cleared,
      stash: this.stash, rewardMult: this.rewardMult,
      troopers: this.marines.map((m) => ({ id: m.trooperId, name: m.name, alive: m.alive, wound: m.wound ?? null, kills: m.kills, weaponItem: m.weaponItem, usage: { ...m.use }, downs: m.downs ?? 0, dragged: m.draggedN ?? 0, escapesUsed: m.escapesUsed ?? 0, searches: m.searches ?? 0, lowAfterHorde: !!m.lowAfterHorde })),
      flags: { ...this.flags, horde: (this.director.hordesCalled ?? 0) > 0 }, relics: [...this.relicsFound], fieldMods: [...this.fieldMods],
      journal: this.journal?.entries ?? [], // the ship's log, for the debrief's timeline (sim/journal.js)
      contract: this.contract.results(), hordes: this.director.hordesCalled ?? 0, survivorsAboard: this.survivors.length,
    };
  }

  // ------------------------------------------------------------------ inspection

  state() {
    const lead = this.squad.leader;
    return {
      status: this.status,
      control: this.control,
      player: this.player?.name ?? null,
      time: +this.time.toFixed(2),
      room: lead?.room,
      roomType: lead ? this.level.rooms[lead.room].type : null,
      x: lead ? +lead.x.toFixed(2) : null,
      squad: this.marines.map((m) => ({ name: m.name, hp: Math.round(m.hp), mag: m.mag, reserve: m.reserve, alive: m.alive, down: !!m.down })),
      state: this.squad.state,
      decision: this.squad.decision?.type ?? null,
      aliens: this.aliens.filter((a) => a.alive).length,
      lifesigns: this.lifesigns(),
      kills: this.stats.kills,
      credits: this.credits,
      salvage: this.salvage.reduce((s, t) => s + t.value, 0),
      survivors: this.survivors.map((s) => s.state),
      explored: this.level.rooms.filter((r) => r.explored).length,
      rooms: this.level.rooms.length,
    };
  }
}

