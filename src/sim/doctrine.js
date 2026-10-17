// Doctrine: how the squad behaves, chosen before deployment and changeable mid-mission from the
// orders bar (world.setOrder -> setOrder). It is the squad's one decision-maker. When the point
// man reaches a door, ladder, crate or found weapon (squad.js asks), the doctrine answers once
// the squad has stacked up, so the drills still play out. It also runs fire discipline, pace,
// flashlights and stims.
//
// Route 'manual' (the Manual orders) is the player's game: the squad holds position and only
// moves where the player clicks - a spot on the floor (moveTo) or something in the scene
// (nudge) - then stops and holds there. Doors and ladders on the way are still handled by the
// squad, and so are fights, stims and flashlights. The other routes run on their own (Recon,
// Assault, Salvage - kept for multi-team play).
//
// Decisions serve a GOAL:
//   - the objective (route 'direct');
//   - the nearest unexplored room within a detour budget (route 'thorough');
//   - a player order: a click (manual), Turn around, or a nudge on an object in the scene.
// Routes come from nav.route over the ship plan (the contract comes with the derelict's
// schematics).
import { ENERGY, PACE, ROE } from '../core/config.js';
import { walkLimits } from '../gen/layout.js';
import { portalEnds } from '../gen/level.js';

export const KNOBS = {
  route: { label: 'Route', options: { manual: 'Your call - they go where you click', direct: 'Direct to the cockpit', thorough: 'Sweep side rooms' } },
  roe: { label: 'Fire discipline', options: { cautious: 'Cautious - return fire', normal: 'Normal - anything that moves', alert: 'High alert - weapons up, burns energy' } },
  pace: { label: 'Pace', options: { stealthy: 'Stealthy', steady: 'Steady', fast: 'Fast - run when able' } },
  loot: { label: 'Loot', options: { leave: 'Leave it', way: 'On the way', all: 'Search everything' } },
  stims: { label: 'Stims', options: { early: 'Early (< 60%)', critical: 'Critical (< 35%)', hoard: 'Hoard (< 15%)' } },
  light: { label: 'Flashlights', options: { on: 'On', auto: 'Auto - off in lit, quiet rooms', off: 'Off - stealth' } },
  kit: { label: 'Kit', options: { use: 'Use it - grenades into packs, flares into dark rooms', save: 'Save it - only on your call' } },
};

// The autonomous default (tools, tests, old links). The briefing starts on Manual (preset key 'standard').
export const DEFAULT_DOCTRINE = { route: 'direct', roe: 'normal', pace: 'steady', loot: 'way', stims: 'critical', light: 'on', kit: 'use' };

export const PRESETS = {
  standard: { label: 'Manual', text: 'You direct the squad: they hold until you click a spot or an object, go there, and hold again', doctrine: { route: 'manual', roe: 'normal', pace: 'steady', loot: 'way', stims: 'critical', light: 'on', kit: 'use' } },
  recon: { label: 'Recon', text: 'Quiet and thorough: sweep the ship, avoid fights', doctrine: { route: 'thorough', roe: 'cautious', pace: 'stealthy', loot: 'way', stims: 'critical', light: 'auto', kit: 'use' } },
  assault: { label: 'Assault', text: 'Fast and loud, weapons up, stims early', doctrine: { route: 'direct', roe: 'alert', pace: 'fast', loot: 'leave', stims: 'early', light: 'on', kit: 'use' } },
  salvage: { label: 'Salvage', text: 'Every room, every crate', doctrine: { route: 'thorough', roe: 'normal', pace: 'steady', loot: 'all', stims: 'critical', light: 'on', kit: 'use' } },
};

export const isManual = (d) => d?.route === 'manual';

/**
 * Orders that don't apply under Manual (the briefing greys them out): the route is the
 * player's clicks, and a squad that never moves on its own can't go looking for every crate.
 */
export function disabledOptions(d) {
  return isManual(d) ? { route: ['direct', 'thorough'], loot: ['all'] } : { route: ['manual'] };
}

/** Manual orders with an option it can't use fall back to the nearest one that works. */
export function fitOrders(d) {
  const out = { ...d };
  if (isManual(out) && out.loot === 'all') out.loot = 'way';
  return out;
}

/**
 * A knob's options as the orders bar offers them mid-mission. Every route can be switched to
 * (Manual hands the route to the player's clicks); only searching everything is off under
 * Manual, as in the briefing.
 */
export function missionOptions(cfg, knob) {
  return Object.entries(KNOBS[knob].options).map(([v, label]) => ({ v, label, off: knob === 'loot' && v === 'all' && isManual(cfg) }));
}

/** The order after the current one for a knob's hotkey (skips options that can't apply). */
export function nextOrder(cfg, knob) {
  const opts = missionOptions(cfg, knob);
  const i = opts.findIndex((o) => o.v === cfg[knob]);
  for (let k = 1; k < opts.length; k++) {
    const o = opts[(i + k) % opts.length];
    if (!o.off) return o.v;
  }
  return null;
}

const PACE_OF = { stealthy: 'cautious', steady: 'normal', fast: 'run' };
const ROE_OF = { cautious: ROE.CAUTIOUS, normal: ROE.NORMAL, alert: ROE.ALERT };
const STIM_AT = { early: 0.6, critical: 0.35, hoard: 0.15 };
const DETOUR = 40;      // route seconds a thorough squad will go out of its way for a side room
const SWEEP_UNTIL = 360; // mission seconds after which a thorough squad heads for the cockpit
const STACK_UP = 0.5;   // seconds settled before answering (lets the door / ladder drills run)
const MAX_WAIT = 3;     // ...but never wait longer than this for stragglers

/** Parse a doctrine from a compact URL string ("route.roe.pace.loot.stims.light.kit") or object. */
export function parseDoctrine(v) {
  if (!v) return { ...DEFAULT_DOCTRINE };
  if (typeof v === 'object') return sanitize(v);
  const keys = Object.keys(KNOBS);
  return sanitize(Object.fromEntries(String(v).split('.').map((x, i) => [keys[i], x])));
}
export const doctrineString = (d) => Object.keys(KNOBS).map((k) => d[k]).join('.');
function sanitize(d) {
  const out = { ...DEFAULT_DOCTRINE };
  for (const k of Object.keys(KNOBS)) if (d?.[k] in KNOBS[k].options) out[k] = d[k];
  return out;
}

export class Doctrine {
  constructor(world, config) {
    this.world = world;
    this.cfg = fitOrders(parseDoctrine(config));
    this.goal = null;
    this.override = null;   // { goal, until, verb, target } from Turn around / nudges
    this.forced = null;     // a fuel barrel the player wants shot (combat.js)
    this.wanted = null;     // a container the player wants searched (prop id)
    this.waitT = 0;
    this.stimT = 0;
    this.lastDecision = null;
    world.settings.roe = ROE_OF[this.cfg.roe];
    world.settings.flashlight = this.cfg.light !== 'off';
    world.squad.pace = PACE_OF[this.cfg.pace] === 'run' ? 'normal' : PACE_OF[this.cfg.pace];
  }

  get manual() { return isManual(this.cfg); }

  update(dt) {
    const w = this.world;
    const sq = w.squad;
    if (!sq.alive) return;
    // An errand that's done (or can't be any more - the man they went back for is dead) is
    // dropped at once, whatever the route: a point man left standing on it can block a ladder.
    if (this.override && (w.time > this.override.until || this.reached(this.override))) this.override = null;
    if (this.manual) {
      // Manual: hold position until the player gives somewhere to go.
      if (sq.state === 'hold' && this.override) sq.state = 'advance';
      // ...but not with men still on a ladder or stairs: the point man steps clear first.
      else if (sq.state === 'advance' && !this.override && !sq.trav && !sq.turnPending && !sq.ladder) { sq.state = 'hold'; sq.leader.v = 0; }
    } else if (sq.state === 'hold') sq.state = 'advance';
    this.manage(dt);
    this.rescue();
    this.errands();
    this.steer(dt);
    // Cover is a full stop: nobody moves on and nothing is decided until it's released.
    if (sq.cover || sq.state !== 'decision') { this.waitT = 0; return; }
    const d = sq.decision;
    if (d !== this.lastDecision) { this.lastDecision = d; this.waitT = 0; this.decT = 0; }
    this.decT += dt;
    if (sq.settled() || this.decT > MAX_WAIT) this.waitT += dt;
    if (this.waitT < STACK_UP) return;
    if (d.encounter && this.manual && !w.params.autoplay) return; // Manual: it waits for the player
    if (d.deadline !== undefined && w.time < d.deadline && !w.params.autoplay) return; // the player's call, for now
    const option = this.decide(d);
    if (option) w.choose(option);
  }

  // ------------------------------------------------------------------ standing orders

  /** Pace, fire discipline, flashlights and stims, managed by the squad itself. */
  manage(dt) {
    const w = this.world;
    const sq = w.squad;
    // Pace: 'fast' runs whenever everyone has the breath for it (and not into a firefight).
    if (this.cfg.pace === 'fast') {
      if (sq.pace !== 'run' && !sq.engaged && !sq.cover && w.stamina >= PACE.MIN_TO_RUN + 25) w.setPace('run');
      else if (sq.pace === 'run' && sq.engaged) w.setPace('normal');
    } else if (sq.pace !== PACE_OF[this.cfg.pace]) w.setPace(PACE_OF[this.cfg.pace]);
    // High alert burns energy; once kills, vermin, food or drinks have refilled it, weapons come back up.
    if (this.cfg.roe === 'alert' && w.settings.roe !== ROE.ALERT && w.energy >= ENERGY.MAX * 0.5) w.setROE(ROE.ALERT);
    // Flashlights: 'auto' keeps them off only while calm in a lit room.
    if (this.cfg.light === 'auto') {
      const room = w.level.rooms[sq.leader.room];
      const dark = room.light === 'dim' || room.light === 'flicker' || w.level.mods?.blackout || room.powerOut;
      const calm = !sq.engaged && w.time >= w.tactics.alertUntil && !w.tactics.aware.threat;
      const want = dark || !calm;
      if (w.settings.flashlight !== want) w.toggleFlashlight();
    }
    // Stims: the medic uses one when someone drops below the doctrine's threshold.
    this.stimT -= dt;
    if (this.stimT <= 0 && w.stims > 0 && sq.order.some((m) => m.hp / m.maxHp < STIM_AT[this.cfg.stims])) {
      w.useStim();
      this.stimT = 2;
    }
  }

  /**
   * The player changed an order mid-mission (the orders bar). Pace, flashlights and stims are
   * picked up by manage(); fire discipline and lights change at once. Switching to or from
   * Manual hands the route over: the squad holds for clicks, or sets off on its own.
   */
  setOrder(knob, value) {
    const w = this.world;
    if (!KNOBS[knob]?.options[value] || this.cfg[knob] === value) return false;
    if (knob === 'loot' && value === 'all' && this.manual) return false; // not with Manual orders
    const wasManual = this.manual;
    this.cfg = fitOrders({ ...this.cfg, [knob]: value });
    if (knob === 'route') {
      this.goal = null;
      if (this.manual !== wasManual) this.override = null; // a different chain of command: drop the errand
    }
    if (knob === 'roe') w.setROE(ROE_OF[value]); // high alert with no energy: refused (manage retries once fed)
    if (knob === 'light' && value !== 'auto' && w.settings.flashlight !== (value === 'on')) w.toggleFlashlight();
    if (knob === 'pace' && value !== 'fast') w.setPace(PACE_OF[value]);
    w.emit('orders', { knob, value, cfg: { ...this.cfg } });
    w.barks.say(w.squad.leader, 'order_ack', 0.7);
    return true;
  }

  /** A door or vent the player pointed at: once the point man is there, its choices come up. */
  errands() {
    const w = this.world;
    const o = this.override;
    if (o?.verb !== 'doorctl' && o?.verb !== 'vent') return;
    const sq = w.squad;
    const lead = sq.leader;
    if (sq.state === 'decision' || sq.action || sq.trav || lead.room !== o.goal.room || Math.abs(lead.x - o.goal.x) > 1.6) return;
    this.override = null;
    if (o.verb === 'vent') {
      const v = w.level.vents[o.target.vent];
      w.encounters.offer('vent', { x: v.x, room: v.room, vent: v, id: `vent${v.id}` }, { key: `vent${v.id}` });
    } else {
      const p = w.level.portals[o.target.portal];
      w.encounters.offer('doorctl', { x: o.goal.x, room: o.goal.room, door: p, id: `door${p.id}` }, { key: `doorctl${p.id}` });
    }
  }

  /**
   * Someone's down: get him up. Right away if the player pointed at him (even mid-fight),
   * otherwise once the fight is over. A man down in another room: the self-led routes go back
   * for him; under Manual the player sends them (by pointing at him).
   */
  rescue() {
    const w = this.world;
    const sq = w.squad;
    const down = w.marines.filter((m) => m.alive && m.down && !m.dragged); // dragged: shoot it off him first
    if (!down.length || sq.action || sq.trav || sq.turnPending || sq.state === 'decision' || sq.cover) return;
    const lead = sq.leader;
    const urgent = this.override?.verb === 'downed' ? down.find((m) => m.id === this.override.target.marine) : null;
    if (sq.engaged && !urgent) return; // not into the teeth of it - after the fight
    const m = urgent ?? down.sort((p, q) => Math.abs(p.x - lead.x) - Math.abs(q.x - lead.x))[0];
    // The best medic close enough walks over; else the point man, once he's standing over him.
    const medic = sq.order.filter((o) => o !== lead && o.room === m.room && o.mode === 'walk' && Math.abs(o.x - m.x) <= 14)
      .sort((p, q) => (q.mods?.medic ?? 1) - (p.mods?.medic ?? 1) || Math.abs(p.x - m.x) - Math.abs(q.x - m.x))[0];
    if (medic && lead.room === m.room) { sq.startRevive(m, medic, !!urgent); if (urgent) this.override = null; return; }
    if (lead.room === m.room && Math.abs(lead.x - m.x) < 1.6 && lead.mode === 'walk') { sq.startRevive(m, lead, !!urgent); if (urgent) this.override = null; return; }
    if (urgent || this.manual) return; // the player's errand is already set / Manual waits for one
    if (this.override?.verb !== 'downed') {
      this.override = { goal: { kind: 'downed', room: m.room, x: m.x }, until: Infinity, verb: 'downed',
        target: { kind: 'downed', marine: m.id, x: m.x, y: m.y + 0.5, label: `Get ${m.name} up` } };
      w.barks.say(lead, 'going_back', 1, { name: m.name });
    }
  }

  /**
   * Don't walk to the far end of a room when the way to the goal is behind us: turn as soon
   * as the route's next portal lies back the way we came.
   */
  steer(dt) {
    const w = this.world;
    const sq = w.squad;
    this.steerT = (this.steerT ?? 0) - dt;
    if (this.steerT > 0 || sq.state !== 'advance' || sq.trav || sq.turnPending || sq.cover || sq.engaged || sq.ladder || sq.task) return;
    this.steerT = 0.5;
    if (this.override?.verb === 'turn' && w.time < this.override.until) return;
    const goal = this.currentGoal();
    if (!goal) return;
    const lead = sq.leader;
    const rear = sq.order[sq.order.length - 1];
    // A spot the squad is already standing around (between the rear man and the point) counts as reached.
    if (this.override?.verb === 'move' && goal.room === lead.room && rear.room === lead.room
      && (goal.x - lead.x) * sq.heading < 0 && (goal.x - rear.x) * sq.heading > 0) { this.arrived(); return; }
    const next = this.route(goal)?.steps.find((s) => s.type === 'portal');
    const end = next ? portalEnds(w.level, w.level.portals[next.portal])[lead.room] : goal.room === lead.room ? { x: goal.x } : null;
    if (!end || (end.x - lead.x) * sq.heading > -1.2) return;
    // Only with everyone on their feet in this room (never mid-climb or straddling a door).
    if (sq.order.some((m) => m.room !== lead.room || (m.mode !== 'walk' && m.mode !== 'crouch'))) return;
    // Turning makes the rear man the point man: only worth it once he too is past the way
    // out (if it lies inside our own line, walk on until it doesn't - or we'd ping-pong).
    if ((end.x - rear.x) * sq.heading > -0.3) return;
    sq.turnAround('route');
    this.steerT = 4;
  }

  // ------------------------------------------------------------------ decisions

  decide(d) {
    const w = this.world;
    const sq = w.squad;
    switch (d.type) {
      case 'loot': {
        if (this.wanted === d.feature.prop.id) { this.wanted = null; return 'search'; } // player's call
        if (this.cfg.loot === 'leave') return 'ignore';
        if (this.cfg.loot === 'way' && (sq.engaged || w.tactics.aware.threat?.kind === 'alien')) return 'ignore';
        return 'search';
      }
      case 'weapon': {
        // Whoever gains most takes it (same class, better grade); the best shot first.
        const rank = { common: 0, rare: 1, epic: 2, legendary: 3 };
        const takers = sq.order.filter((m) => m.weaponKey === d.item.cls && rank[m.weapon.rarity] < rank[d.item.rarity]);
        takers.sort((a, b) => (b.stats?.acc ?? 5) - (a.stats?.acc ?? 5));
        return takers[0] ? `give:${takers[0].id}` : 'stash';
      }
      case 'encounter': return this.encounterChoice(d);
      case 'door': return this.onRoute(d.feature.portal) ? 'open' : 'back';
      case 'vertical': return this.onRoute(d.feature.portal) ? 'take' : 'pass';
      default: return d.fallback ?? d.options?.[d.options.length - 1]?.id ?? null;
    }
  }

  /** When the player lets the clock run out at an encounter, the standing orders choose. */
  encounterChoice(d) {
    const w = this.world;
    const opt = (id) => d.options.find((o) => o.id === id);
    const quiet = this.cfg.pace === 'stealthy' || this.cfg.roe === 'cautious';
    if (d.kind === 'locker') return this.cfg.loot === 'all' && opt('open').odds >= 0.6 ? 'open' : 'shoot';
    if (d.kind === 'terminal') return opt('download').odds >= (this.cfg.route === 'thorough' ? 0.3 : 0.5) ? 'download' : 'leave';
    if (d.kind === 'doorctl') return d.prop.door.welded && this.onRoute(d.prop.door) && w.kit.charges > 0 ? 'cut' : 'leave';
    if (d.kind === 'vent') return 'leave';
    if (d.kind === 'junction') return opt('restore').odds >= 0.4 ? 'restore' : opt('hotwire').odds >= 0.45 ? 'hotwire' : 'leave';
    if (d.kind === 'fire') {
      if (!this.onRoute(d.prop.fire)) return 'back';
      return opt('putout').odds >= 0.4 ? 'putout' : 'through';
    }
    if (d.kind === 'turret') return opt('hack').odds >= 0.35 ? 'hack' : 'leave';
    if (d.kind === 'autodoc') return w.squad.order.some((m) => m.wound || m.hp < m.maxHp * 0.7) ? 'treat' : 'leave';
    if (d.kind === 'eggs') return this.cfg.kit !== 'save' && !opt('burn').off ? 'burn' : quiet ? 'sneak' : 'shoot';
    if (d.kind === 'cryopod') {
      if (d.prop.known) return d.prop.pod === 'alien' ? 'shoot' : 'open';
      return this.cfg.loot === 'leave' ? 'leave' : 'open';
    }
    if (d.kind === 'keydoor') {
      if (!opt('card').off) return 'card';
      return this.cfg.loot !== 'leave' && w.kit.charges > 1 ? 'cut' : 'back';
    }
    if (d.kind === 'armoury') {
      if (this.cfg.loot === 'leave') return 'leave';
      const hack = opt('hack');
      const force = opt('force');
      const pick = quiet || hack.odds >= force.odds ? hack : force;
      return pick.odds >= 0.35 ? pick.id : 'leave';
    }
    return 'leave';
  }

  onRoute(portal) {
    const goal = this.currentGoal();
    if (!goal) return !this.manual && portal.kind === 'door'; // free roam (after a turn): keep going this way
    const route = this.route(goal);
    return !!route?.steps.some((s) => s.type === 'portal' && s.portal === portal.id);
  }

  route(goal) {
    const w = this.world;
    const lead = w.squad.leader;
    // A welded door is a wall once the cutting charges are gone; a locked one too without a
    // keycard - or once they've chosen to leave it locked (until they're sent there).
    const welded = (pid) => w.level.portals[pid].welded && w.kit.charges <= 0;
    const locked = (pid) => this.lockedOut(w.level.portals[pid]);
    return w.nav.route({ room: lead.room, x: lead.x }, goal, { blocked: (pid) => welded(pid) || locked(pid) || (goal.kind === 'explore' && this.intoObjective(pid)) });
  }

  /** A locked door the squad can't (or won't) get through. */
  lockedOut(p) {
    const w = this.world;
    return !!p.locked && !p.open && (p.passed || (w.kit.keycards <= 0 && w.kit.charges <= 0));
  }

  /** Portals into the cockpit - a sweeping squad leaves the objective for last. */
  intoObjective(pid) {
    const p = this.world.level.portals[pid];
    const obj = this.world.level.objective.room;
    return p.a === obj || p.b === obj;
  }

  currentGoal() {
    const w = this.world;
    const L = w.level;
    const lead = w.squad.leader;
    if (this.override) {
      const o = this.override;
      if (w.time > o.until || this.reached(o)) this.override = null;
      else return o.goal;
    }
    if (this.manual) return null; // Manual: only where the player sends them
    // A sweep answers a distress call.
    const call = w.shipEvents?.distress;
    if (call && this.cfg.route === 'thorough') return (this.goal = { kind: 'distress', room: call.room, x: call.x });
    if (this.cfg.route === 'thorough' && w.time < SWEEP_UNTIL) {
      const behind = L.rooms[this.goal?.room]?.locked;
      if (this.goal?.kind === 'explore' && !L.rooms[this.goal.room].explored && (behind === undefined || !this.lockedOut(L.portals[behind]))) return this.goal;
      let best = null;
      for (const r of L.rooms) {
        if (r.explored || r.exterior || r.id === L.objective.room || r.type === 'airlock') continue;
        const [a, b] = walkLimits(r);
        const to = { kind: 'explore', room: r.id, x: (a + b) / 2 };
        const route = this.route(to);
        if (route && route.cost <= DETOUR && (!best || route.cost < best.cost)) best = { cost: route.cost, goal: to };
      }
      if (best) return (this.goal = best.goal);
    }
    return (this.goal = { kind: 'objective', room: L.objective.room, x: L.objective.x });
  }

  /** Is an override's job done? */
  reached(o) {
    const w = this.world;
    const lead = w.squad.leader;
    const t = o.target;
    if (o.verb === 'move') return !!o.arrived;
    if (o.verb === 'doorctl' || o.verb === 'vent') return false; // errands() clears it on arrival
    if (o.verb === 'downed') {
      const m = w.marines.find((q) => q.id === t.marine);
      return !m?.alive || !m.down;
    }
    if (t?.kind === 'crate' || t?.kind === 'terminal') {
      const p = w.level.rooms[t.room].props.find((q) => q.id === t.prop);
      return !p || p.searched || p.encounterDone || p.destroyed;
    }
    if (t?.kind === 'survivor') {
      const s = w.survivors.find((q) => q.id === t.survivor);
      if (!s?.alive || s.identified) return true;
      o.goal = { kind: 'nudge', room: s.room, x: s.x }; // follow them
      return false;
    }
    return !!o.goal && lead.room === o.goal.room;
  }

  /**
   * The player pointed at something in the scene (world.nudge): make it the goal. Doors,
   * ladders and stairs: get through them. Crates: search them. Survivors: reach them (they
   * head for the Kestrel once they know us). Barrels: shoot them once nobody's in the blast.
   */
  nudge(t) {
    const w = this.world;
    const L = w.level;
    const lead = w.squad.leader;
    if (t.kind === 'barrel') {
      this.forced = w.props.find((b) => b.id === t.barrel) ?? null;
      w.barks.say(lead, 'nudge_barrel');
      return;
    }
    if (t.kind === 'doorctl' || t.kind === 'vent') {
      // Walk up to it; the choices come up there (errands).
      const x = t.kind === 'vent' ? t.x : portalEnds(L, L.portals[t.portal])[t.room].x;
      this.override = { goal: { kind: 'nudge', room: t.room, x }, until: Infinity, verb: t.kind, target: t };
      w.barks.say(lead, 'nudge');
      return;
    }
    if (t.kind === 'downed') {
      // Get him up - now, fight or no fight.
      this.override = { goal: { kind: 'downed', room: t.room, x: t.x }, until: Infinity, verb: 'downed', target: t };
      w.barks.say(lead, 'nudge');
      return;
    }
    let goal = { kind: 'nudge', room: t.room, x: t.x };
    if (t.portal !== undefined) {
      // The far side of the door / ladder: route through it.
      const p = L.portals[t.portal];
      const ends = portalEnds(L, p);
      const cost = (r) => w.nav.route({ room: lead.room, x: lead.x }, { room: r, x: ends[r].x })?.cost ?? -1;
      const far = cost(p.a) >= cost(p.b) ? p.a : p.b;
      goal = { kind: 'nudge', room: far, x: ends[far].x };
      p.passed = false; // sent there: a locked door gets its choice again
    }
    if (t.kind === 'crate') {
      const prop = L.rooms[t.room].props.find((p) => p.id === t.prop);
      if (prop) prop.ignored = false;
      this.wanted = t.prop;
      w.squad.handled.delete(`loot${t.prop}`);
      w.squad.handled.delete(`loot${t.prop}~`);
    }
    if (t.kind === 'terminal') {
      w.squad.handled.delete(`enc${t.prop}`);
      const prop = L.rooms[t.room].props.find((p) => p.id === t.prop);
      if (prop?.encounter === 'junction') prop.encounterDone = false; // try the breakers again
      if ((prop?.encounter === 'turret' || prop?.encounter === 'autodoc') && !prop.used && !prop.jammed) prop.encounterDone = false; // left for later
    }
    this.override = { goal, until: this.manual ? Infinity : w.time + 90, verb: t.kind, target: t };
    w.barks.say(lead, 'nudge');
  }

  /** Manual: the player clicked a spot on the floor - go there and hold. */
  moveTo(room, x) {
    const w = this.world;
    const r = w.level.rooms[room];
    this.override = {
      goal: { kind: 'nudge', room, x }, until: this.manual ? Infinity : w.time + 90, verb: 'move',
      target: { kind: 'move', room, x, y: r.y0 + 0.1, label: 'Move here' },
    };
    w.barks.say(w.squad.leader, 'nudge');
  }

  /** Where the point man should stop in this room for a move order (squad.explore), or null. */
  stopX(lead) {
    const o = this.override;
    return ['move', 'downed', 'doorctl', 'vent'].includes(o?.verb) && !o.arrived && o.goal.room === lead.room ? o.goal.x : null;
  }

  arrived() {
    if (this.override?.verb !== 'move') return;
    this.override.arrived = true;
    this.override = null;
    const w = this.world;
    w.emit('arrived', {});
    if (this.manual) w.barks.say(w.squad.leader, 'in_position', 0.6);
  }

  /**
   * Player "turn around": for a while the squad goes where the turn pointed - the nearest
   * unexplored room behind them, or just onward that way - instead of U-turning again at the
   * next door because the objective lies the other way.
   */
  onTurn(oldHeading) {
    if (this.manual) { this.override = null; return; } // Manual: turn to face the other way, and hold
    const w = this.world;
    const L = w.level;
    const lead = w.squad.leader;
    let best = null;
    for (const r of L.rooms) {
      if (r.explored || r.exterior || r.type === 'airlock') continue;
      const [a, b] = walkLimits(r);
      const x = (a + b) / 2;
      if ((x - lead.x) * oldHeading > -2) continue; // not behind us
      const route = w.nav.route({ room: lead.room, x: lead.x }, { room: r.id, x });
      if (route && (!best || route.cost < best.cost)) best = { cost: route.cost, goal: { kind: 'turn', room: r.id, x } };
    }
    this.override = { goal: best?.goal ?? null, until: w.time + (best ? 40 : 12), verb: 'turn' };
  }
}
