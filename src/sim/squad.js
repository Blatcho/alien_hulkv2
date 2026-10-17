// Squad controller. The leader walks in the squad's heading and stops at "features" it comes
// across in the current room - loot, ladders, stairs, doors, dead ends, obstacles - asking
// the player where a real choice exists. Followers replay the leader's breadcrumb trail, so
// ladders, jumps and crouch-passes are copied exactly.
//
// The formation is loose, not a conga line: everyone has his own pace and eases in and out
// of it, spacing drifts while walking (never closer than AWARE.MIN_GAP to the man ahead),
// stragglers jog to catch up, and a trooper may stop to check something (sim/awareness.js
// decides that). Whenever the squad halts, the spacing snaps back to the drill gaps.
//
// Turning around: the leader waits until the squad has closed up, then the order and the
// trail are reversed, so the rear marine becomes the new point man (no conga-line U-turns).
//
// Jobs go to whoever is best at them: for a search, a lock or the uplink the specialist steps
// out of the line, walks up to do it while the rest cover, then falls back in (this.task).
import { ABILITY, AWARE, DOWN, PACE, SQUAD } from '../core/config.js';
import { walkLimits } from '../gen/layout.js';
import { portalEnds } from '../gen/level.js';
import { PROPS } from '../gen/templates.js';
import { Trail } from '../nav/trail.js';
import { advance, crouchPath, jumpPath, modeSpeed, portalPath } from './traverse.js';
import { bestAt, practice, statPace } from './stats.js';
import { brokenDown, stillRunning } from './breakdown.js';

const LANES = [0, 0.42, -0.38, 0.8];

/** Climbing and stair speed follow the climber's Speed stat. */
const climbK = (mode, m) => (mode === 'climb' || mode === 'stairs' ? m.mods?.climb ?? 1 : 1);

/** Ease a speed toward `want` (quicker to slow down than to get going). */
const approach = (v, want, dt) => v + Math.max(-AWARE.DECEL * dt, Math.min(AWARE.ACCEL * dt, want - v));

export class Squad {
  constructor(world, marines) {
    this.world = world;
    this.level = world.level;
    this.marines = marines;
    this.order = [...marines];
    this.trail = new Trail();
    this.heading = 1;
    this.state = 'advance';   // advance | hold | decision | action
    this.decision = null;
    this.action = null;       // {type: 'door'|'search'|'uplink', t, dur, ...}
    this.trav = null;         // leader traversal in progress
    this.handled = new Set(); // feature keys resolved during this room visit
    this.turnPending = false;
    this.engaged = false;
    this.cover = false;
    this.pace = 'normal';     // cautious | normal | run
    this.featureCache = new Map();
    this.gaps = [SQUAD.SPACING, SQUAD.SPACING, SQUAD.SPACING]; // trail distance between consecutive marines (tactics adjusts)
    this.ladder = null;       // ladder/stairs in use: {portal, kind, sa, sb, up} trail arclengths of its start/end
    this.task = null;         // specialist stepped out of line for a job: {m, x, phase: go | work | back}

    const lead = this.order[0];
    const room = this.level.rooms[lead.room];
    this.trail.push(lead.x - (this.order.length) * SQUAD.SPACING, room.y0, 0, 'walk', lead.room);
    this.trail.push(lead.x, room.y0, 0, 'walk', lead.room);
    this.order.forEach((m, i) => { m.s = this.trail.length - i * SQUAD.SPACING; });
    this.placeFollowers();
    room.explored = true;
  }

  get leader() { return this.order[0]; }
  get alive() { return this.order.length > 0; }

  get running() { return this.pace === 'run'; }

  speed() {
    if (this.cover) return SQUAD.CROUCH;
    return PACE.SPEED[this.pace] * this.slowest();
  }

  /** The squad walks at the pace of its slowest man (Speed stat, a leg wound, a minigun to carry). */
  slowest() {
    let f = Infinity;
    for (const m of this.order) f = Math.min(f, statPace(m.stats) * (m.wound === 'leg' ? DOWN.WOUNDS.leg.pace : 1) * (m.weapon?.pace ?? 1));
    return f === Infinity ? 1 : f;
  }

  // ------------------------------------------------------------------ features

  features(roomId) {
    if (this.featureCache.has(roomId)) return this.featureCache.get(roomId);
    const L = this.level;
    const room = L.rooms[roomId];
    const [wl, wr] = walkLimits(room);
    const fs = [];
    for (const p of room.props) {
      // A crate half-buried in wreckage the squad vaults over is searched from the near edge
      // (otherwise the point man jumps straight over it and never stops).
      if (p.encounter) { fs.push({ key: `enc${p.id}`, type: 'encounter', x: p.x, prop: p }); continue; }
      const ob = p.loot && room.props.find((o) => o.obstacle && p.x > o.x0 - 0.7 && p.x < o.x1 + 0.7);
      if (ob) {
        fs.push({ key: `loot${p.id}`, type: 'loot', x: ob.x0 - 0.8, prop: p, dir: 1 });
        fs.push({ key: `loot${p.id}~`, type: 'loot', x: ob.x1 + 0.8, prop: p, dir: -1 });
      } else if (p.loot) fs.push({ key: `loot${p.id}`, type: 'loot', x: p.x, prop: p });
      if (p.objective) fs.push({ key: 'objective', type: 'objective', x: L.objective.x, prop: p });
      if (p.obstacle) {
        fs.push({ key: `ob${p.id}+`, type: p.obstacle, x: p.x0 - 0.55, prop: p, dir: 1 });
        fs.push({ key: `ob${p.id}-`, type: p.obstacle, x: p.x1 + 0.55, prop: p, dir: -1 });
      }
    }
    let left = null;
    let right = null;
    for (const pid of room.portals) {
      const p = L.portals[pid];
      if (p.kind === 'door') {
        if (p.b === roomId) left = p; else right = p;
        continue;
      }
      const end = portalEnds(L, p)[roomId];
      fs.push({ key: `v${pid}`, type: p.kind, x: end.x, portal: p, up: p.a === roomId });
    }
    fs.push({ key: 'endL', type: left ? 'door' : 'wall', x: left ? portalEnds(L, left)[roomId].x : wl, portal: left, dir: -1 });
    fs.push({ key: 'endR', type: right ? 'door' : 'wall', x: right ? portalEnds(L, right)[roomId].x : wr, portal: right, dir: 1 });
    this.featureCache.set(roomId, fs);
    return fs;
  }

  nextFeature(lead) {
    let best = null;
    let bestD = Infinity;
    for (const f of this.features(lead.room)) {
      if (this.handled.has(f.key) || (f.dir && f.dir !== this.heading)) continue;
      const d = (f.x - lead.x) * this.heading;
      if (d > 1e-3 && d < bestD) { best = f; bestD = d; }
    }
    return best;
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    if (!this.order.length) return;
    const lead = this.leader;
    this.updateAction(dt);

    if (lead.s < this.trail.length - 1e-3) {
      // Catching up to the end of the trail (new leader after a death, or retracing a ladder after a turn).
      const target = this.trail.length;
      const here = this.trail.sample(lead.s);
      lead.s = Math.min(target, lead.s + modeSpeed(here.mode, this.speed() * 1.3) * dt);
      this.applySample(lead, 0);
      if (lead.s >= this.trail.length - 1e-3) this.offerUnderfoot();
    } else if (this.trav) {
      this.stepTraversal(dt);
    } else if (this.turnPending) {
      if (this.settled()) this.reverse();
    } else if (this.canAdvance()) {
      this.explore(dt);
    } else { lead.moving = false; lead.v = 0; }

    this.updateFollowers(dt);
    // Everyone is up: hold the position a beat (still covering), then move on.
    if (this.ladder?.sb !== undefined && this.order.every((m) => m.s >= this.ladder.sb - 0.01)) {
      this.ladder.allUpT ??= this.world.time;
      if (this.world.time - this.ladder.allUpT > 1.4) {
        this.ladder = null;
        this.world.emit('regrouped', {});
      }
    }
    this.trail.forgetBefore(Math.min(...this.order.map((m) => m.s)) - 40);
  }

  canAdvance() {
    if (this.state !== 'advance' || this.cover || this.task) return false;
    // A horde coming (sim/director.js): they hold where they are and brace for it. Nor do they
    // leave a man who's frozen or bolted (sim/breakdown.js).
    if (this.world.director?.bracing || this.order.some(brokenDown)) return false;
    // After a ladder or stairs the point man steps clear far enough for everyone to get
    // off it, then holds until the whole squad is up.
    if (this.ladder?.sb !== undefined && this.leader.s >= this.ladder.sb + this.offset(this.order.length - 1) + 0.3) return false;
    // In a firefight the squad holds - unless someone is still on a ladder/stairs behind the
    // leader, in which case the point man keeps clearing the way so nobody is stuck exposed.
    return !this.engaged || this.followersTraversing();
  }

  /** Walking freely: spacing may breathe and troopers may stop to look at things. */
  loose() {
    return this.state === 'advance' && !this.trav && !this.turnPending && !this.cover && !this.engaged
      && !this.ladder && this.leader.v > 0.3;
  }

  /** Does the point man stop at this feature (so he should ease into it)? */
  stopsAt(f) {
    if (!f) return false;
    if (f.type === 'loot') return !f.prop.searched && !f.prop.ignored;
    if (f.type === 'door') return !f.portal.open || !!f.portal.fire;
    if (f.type === 'ladder' || f.type === 'stairs') return true;
    return f.type === 'wall' || f.type === 'objective' || f.type === 'goal';
  }

  /** Point man's step this frame: his own pace, eased; holds for bounds and room entries. */
  leadStep(dt, f = null) {
    const lead = this.leader;
    let want = lead.holdT > 0 ? 0 : this.speed() * (lead.pace ?? 1) * (lead.slowT > 0 ? 0.72 : 1);
    if (this.stopsAt(f)) want = Math.min(want, 0.45 + Math.abs(f.x - lead.x) * 1.8);
    lead.v = approach(lead.v ?? 0, want, dt);
    return lead.v * dt;
  }

  followersTraversing() {
    return this.order.some((m, i) => i > 0 && m.mode !== 'walk' && m.mode !== 'crouch');
  }

  explore(dt) {
    const lead = this.leader;
    let f = this.nextFeature(lead);
    // A spot the player clicked (Manual orders): the point man stops there.
    const gx = this.world.doctrine?.stopX(lead);
    if (gx !== null && gx !== undefined) {
      const dg = (gx - lead.x) * this.heading;
      if (dg >= -1e-3 && (!f || dg <= (f.x - lead.x) * this.heading)) f = { key: 'goal', type: 'goal', x: gx };
    }
    // Just off a ladder or stairs: don't stop for a door, a crate or a wall until the others are
    // off the climb too - wait short of it (they bunch up behind), then deal with it.
    const L = this.ladder;
    if (L?.sb !== undefined && f && f.type !== 'goal' && this.stopsAt(f) && !this.allUp()
      && Math.abs(f.x - lead.x) < 0.45 && lead.s - L.sb >= this.packed()) {
      lead.moving = false;
      lead.v = 0;
      return;
    }
    const step = this.leadStep(dt, f);
    const room = this.level.rooms[lead.room];
    if (f && step <= 1e-6) { lead.moving = false; return; } // holding (bound / threshold pause)
    // Tolerance > nextFeature's 1e-3 gate so the leader can never stop just short of a feature and skip it.
    if (f && Math.abs(f.x - lead.x) <= step + 2e-3) {
      this.moveLeader(f.x, room.y0);
      this.trigger(f);
    } else if (f) {
      this.moveLeader(lead.x + this.heading * step, room.y0);
    } else {
      // No feature ahead can only mean we are outside the room's limits; turn around.
      this.turnAround('dead-end');
    }
  }

  moveLeader(x, y, z = 0, mode = this.cover ? 'crouch' : 'walk') {
    const lead = this.leader;
    lead.moving = Math.abs(x - lead.x) > 1e-5;
    if (lead.moving) lead.facing = Math.sign(x - lead.x);
    lead.x = x; lead.y = y; lead.z = z; lead.mode = mode;
    this.trail.push(x, y, z, mode, lead.room);
    lead.s = this.trail.length;
  }

  startTraversal(tr) {
    this.trav = tr;
    if (tr.kind === 'ladder' || tr.kind === 'stairs') {
      const p = this.level.portals[tr.portal];
      let len = 0;
      for (let i = 1; i < tr.pts.length; i++) len += Math.hypot(tr.pts[i].x - tr.pts[i - 1].x, tr.pts[i].y - tr.pts[i - 1].y, (tr.pts[i].z - tr.pts[i - 1].z) * 0.5);
      this.ladder = { portal: p, kind: tr.kind, sa: this.leader.s, sb: undefined, len, up: tr.toRoom === p.b };
    }
  }

  /** Trail distance the squad needs behind the point man when bunched up tight. */
  packed() { return (this.order.length - 1) * AWARE.MIN_GAP + 0.25; }

  /** Trail distance from the leader to squad slot i. */
  offset(i) {
    let d = 0;
    for (let k = 0; k < i; k++) d += this.gaps[k] ?? SQUAD.SPACING;
    return d;
  }

  stepTraversal(dt) {
    const lead = this.leader;
    const tr = this.trav;
    lead.moving = true;
    const done = advance(lead, tr, dt, (mode) => modeSpeed(mode, this.speed()) * climbK(mode, lead), (pt) => {
      this.trail.push(pt.x, pt.y, pt.z, pt.mode, lead.room);
      lead.s = this.trail.length;
    });
    // Doors switch rooms as the body crosses the bulkhead; ladders/stairs once the climb is
    // over (the final step-off segment already belongs to the destination room).
    if (tr.toRoom !== undefined && lead.room !== tr.toRoom) {
      if (tr.kind === 'door') {
        const p = this.level.portals[tr.portal];
        if ((lead.x - p.x) * (tr.pts[1].x - tr.pts[0].x) > 0) this.enterRoom(tr.toRoom);
      } else if (tr.i >= tr.pts.length - 2) this.enterRoom(tr.toRoom);
    }
    if (done) {
      this.trav = null;
      lead.mode = 'walk';
      if (tr.toRoom !== undefined && lead.room !== tr.toRoom) this.enterRoom(tr.toRoom);
      if (tr.kind === 'jump' || tr.kind === 'crouch') this.handled.add(tr.featureKey);
      if ((tr.kind === 'ladder' || tr.kind === 'stairs') && this.ladder) {
        this.ladder.sb = lead.s;
        this.stepOffSide();
        for (const m of this.order) practice(m, 'spd', 0.15);
        this.world.emit('ladder-top', { marine: lead, ladder: this.ladder });
      }
    }
  }

  /**
   * Off a ladder or stairs: step off toward the side with room for the whole squad behind -
   * a top landing hard against a bulkhead would leave the men behind hanging on the climb.
   */
  stepOffSide() {
    const lead = this.leader;
    const [wl, wr] = walkLimits(this.level.rooms[lead.room]);
    const need = this.offset(this.order.length - 1) + 0.5;
    const ahead = this.heading > 0 ? wr - lead.x : lead.x - wl;
    const behind = this.heading > 0 ? lead.x - wl : wr - lead.x;
    if (ahead < need && behind > ahead) {
      this.heading = -this.heading;
      lead.facing = this.heading;
    }
  }

  /** Is the whole squad off the ladder / stairs it just took? */
  allUp() {
    const L = this.ladder;
    return !L || (L.sb !== undefined && this.order.every((m) => m.s >= L.sb - 0.01));
  }

  enterRoom(roomId) {
    const lead = this.leader;
    lead.room = roomId;
    this.trail.push(lead.x, lead.y, lead.z, lead.mode, roomId);
    lead.s = this.trail.length;
    this.handled.clear();
    const room = this.level.rooms[roomId];
    const first = !room.explored;
    room.explored = true;
    room.seen = true;
    this.world.emit('enter-room', { room, first });
  }

  // ------------------------------------------------------------------ features -> actions

  trigger(f) {
    const w = this.world;
    const lead = this.leader;
    const room = this.level.rooms[lead.room];
    switch (f.type) {
      case 'goal':
        lead.moving = false;
        w.doctrine.arrived();
        return;
      case 'encounter': {
        const p = f.prop;
        if (p.encounterDone || p.searched || p.destroyed) { this.handled.add(f.key); return; }
        w.encounters.offer(p.encounter, p, f);
        return;
      }
      case 'loot': {
        const p = f.prop;
        if (p.searched || p.ignored) { this.handled.add(f.key); return; }
        // Something hiding in it? Sharp eyes may notice before anyone reaches for the latch.
        if (p.loot?.type === 'ambush' && !p.checked) {
          p.checked = true;
          const spotter = w.encounters.spotAmbush(p);
          if (spotter) { w.encounters.offer('locker', p, f, spotter); return; }
        }
        this.ask({ type: 'loot', feature: f, text: `${PROPS[p.kind].label} spotted.`, options: [
          { id: 'search', label: 'Search it' }, { id: 'ignore', label: 'Leave it' }] });
        return;
      }
      case 'objective':
        this.handled.add(f.key);
        if (!w.uplink) this.startUplink(f.prop);
        return;
      case 'jump':
        this.startTraversal({ ...jumpPath(lead.x, room.y0, this.heading, PROPS[f.prop.kind].w), featureKey: f.key });
        w.emit('bark', { marine: lead, text: 'Over the wreckage.' });
        return;
      case 'crouch':
        this.startTraversal({ ...crouchPath(lead.x, room.y0, this.heading, PROPS[f.prop.kind].w), featureKey: f.key });
        return;
      case 'ladder':
      case 'stairs': {
        const verb = f.type === 'ladder' ? (f.up ? 'Climb up' : 'Climb down') : (f.up ? 'Take the stairs up' : 'Take the stairs down');
        this.ask({ type: 'vertical', feature: f, text: `${f.type === 'ladder' ? 'Ladder' : 'Stairwell'} ${f.up ? 'leading up' : 'leading down'}.`, options: [
          { id: 'take', label: verb }, { id: 'pass', label: 'Keep moving' }, { id: 'back', label: 'Turn back' }] });
        return;
      }
      case 'door': {
        const p = f.portal;
        if (p.welded) {
          w.encounters.offer('doorctl', { x: f.x, room: lead.room, door: p, id: `door${p.id}` }, f);
          return;
        }
        if (p.fire && p.braved !== lead.room) {
          w.encounters.offer('fire', { x: f.x, room: lead.room, fire: p, id: `fire${p.id}` }, f);
          return;
        }
        if (p.locked && !p.open) {
          w.encounters.offer('keydoor', { x: f.x, room: lead.room, door: p, id: `key${p.id}` }, f);
          return;
        }
        if (p.open) { this.startTraversal(portalPath(this.level, p, lead.room)); return; }
        if (p.outer) {
          // Boarding: the outer lock opens from our side without asking.
          w.emit('bark', { marine: lead, text: 'Kestrel, we are boarding. Cycling the lock.' });
          this.startDoor(p);
          return;
        }
        this.ask({ type: 'door', feature: f, text: p.airlock ? 'Inner airlock door. Beyond it: the ship.' : 'Sealed bulkhead door.', options: [
          { id: 'open', label: 'Open door' }, { id: 'back', label: 'Turn back' }] });
        return;
      }
      case 'wall':
        w.emit('bark', { marine: lead, text: 'Dead end. Turning back.' });
        this.turnAround('dead-end');
        return;
      default:
    }
  }

  ask(decision) {
    this.state = 'decision';
    this.decision = { id: (this.decision?.id ?? 0) + 1, ...decision };
    this.leader.moving = false;
    this.world.emit('decision', this.decision);
  }

  /** The doctrine (sim/doctrine.js) - or the player, at encounters - answers the pending decision. */
  choose(optionId) {
    const d = this.decision;
    if (!d || this.state !== 'decision') return false;
    this.decision = null;
    this.state = 'advance';
    const f = d.feature;
    const lead = this.leader;
    if (d.type === 'encounter') {
      if (!this.world.encounters.choose(d, optionId)) { this.decision = d; this.state = 'decision'; return false; }
      this.world.emit('decision-made', { decision: d, option: optionId });
      return true;
    }
    if (d.type === 'weapon') {
      if (optionId.startsWith('give:')) this.world.equip(this.world.marines.find((m) => String(m.id) === optionId.slice(5)), d.item);
      else this.world.stashItem(d.item);
      this.world.emit('decision-made', { decision: d, option: optionId });
      return true;
    }
    switch (optionId) {
      case 'search': this.startSearch(f.prop, f.key); break;
      case 'ignore': f.prop.ignored = true; this.handled.add(f.key); break;
      case 'take': this.startTraversal(portalPath(this.level, f.portal, lead.room)); break;
      case 'pass': this.handled.add(f.key); break;
      case 'open': this.startDoor(f.portal); break;
      case 'back': this.turnAround('order'); break;
      default: return false;
    }
    this.world.emit('decision-made', { decision: d, option: optionId });
    return true;
  }

  startSearch(prop, key) {
    this.state = 'action';
    // The squad's sharpest mind talks the point man through it (Intelligence).
    const tech = bestAt(this.order, 'int') ?? this.leader;
    this.action = { type: 'search', prop, key, t: 0, dur: SQUAD.SEARCH_TIME * (tech.mods?.search ?? 1), by: tech };
    this.assignTask(tech, prop.x);
    this.world.emit('search-start', { prop, marine: this.leader });
  }

  startDoor(portal) {
    this.state = 'action';
    this.action = { type: 'door', portal, t: 0, dur: SQUAD.DOOR_TIME * (this.order.some((m) => m.role === 'breacher') ? ABILITY.DOOR : 1) }; // a breacher on the door
    this.world.emit('door-work', { portal, marine: this.leader });
  }

  startUplink(prop) {
    this.state = 'action';
    const tech = bestAt(this.order, 'int') ?? this.leader;
    this.action = { type: 'uplink', prop, t: 0, dur: this.world.tuning.uplinkTime * (tech.mods?.uplink ?? 1), by: tech };
    this.assignTask(tech, prop.x);
    this.world.startUplink();
  }

  /**
   * Get a man up off the deck: the best medic close enough walks over (or the point man, if he's
   * the one standing next to him) and works on him. `urgent` (the player pointed at him) carries
   * on through a fight; otherwise the squad waits for a lull.
   */
  startRevive(m, by, urgent = false) {
    const w = this.world;
    this.state = 'action';
    const stim = w.stims > 0 && w.doctrine?.cfg?.stims !== 'hoard';
    this.action = { type: 'revive', target: m, t: 0, dur: DOWN.REVIVE / Math.max(1, by.mods?.medic ?? 1), by, stim, urgent };
    this.assignTask(by, m.x);
    w.emit('revive-start', { marine: m, by });
    w.barks.say(by, 'reviving', 0.8);
  }

  /** A man who bolts (sim/breakdown.js) drops to the rear of the line; the rest close up. */
  toRear(m) {
    const i = this.order.indexOf(m);
    if (i < 0 || i === this.order.length - 1) return;
    if (this.task?.m === m) { m.offX = 0; this.task = null; }
    this.order.splice(i, 1);
    this.order.push(m);
  }

  /** He bolted: back along the trail at a run until he's clear of it, then he hides there. */
  stepFlee(m, i, dt) {
    const b = m.breakdown;
    m.moving = false;
    m.v = 0;
    if (b.phase === 'run') {
      const here = this.trail.sample(m.s);
      const speed = modeSpeed(here.mode, PACE.SPEED.run) * climbK(here.mode, m);
      const step = Math.min(speed * dt, m.s - this.trail.start);
      m.s -= step;
      b.ran += step;
      m.v = speed;
      m.moving = step > 0.25 * dt;
      if (step <= 0 || !stillRunning(this.world, m)) b.phase = 'hide';
    }
    this.applySample(m, i);
    const p = this.trail.sample(m.s);
    if (m.moving && p?.dir) m.facing = -p.dir; // running back the way they came
  }

  /** A trooper got up off the deck falls in at the rear, walking back into line from where he lay. */
  rejoin(m) {
    const rear = this.order[this.order.length - 1];
    this.order.push(m);
    const s = rear ? Math.max(0, rear.s - (this.gaps[this.order.length - 2] ?? SQUAD.SPACING)) : this.trail.length;
    const p = this.trail.sample(s);
    m.s = s;
    m.offX = p && p.room === m.room ? m.x - p.x : 0;
    m.mode = 'walk';
    m.v = 0;
  }

  updateAction(dt) {
    const a = this.action;
    if (a?.type === 'revive' && (!a.target.alive || !a.target.down || a.target.dragged || !a.by.alive || a.by.down)) {
      // Finished off, or the medic went down himself: call it off.
      this.action = null;
      if (this.state === 'action') this.state = 'advance';
      if (this.task) this.task.phase = 'back';
      return;
    }
    if (a && a.by && (a.by.down || !a.by.alive)) a.by = this.leader; // he went down mid-job: the point man takes it
    if (!a || this.engaged && a.type !== 'uplink' && !a.urgent) return;
    if (this.task?.phase === 'go') return; // the specialist is still on his way
    a.t += dt;
    if (a.t < a.dur) return;
    this.action = null;
    this.state = 'advance';
    if (this.task) this.task.phase = 'back';
    if (a.type === 'search') {
      this.handled.add(a.key);
      practice(a.by, 'int', 1);
      this.world.resolveLoot(a.prop, this.leader);
    } else if (a.type === 'door') {
      this.world.setDoor(a.portal, true);
      this.startTraversal(portalPath(this.level, a.portal, this.leader.room));
    } else if (a.type === 'uplink') {
      practice(a.by, 'int', 3);
      this.world.completeUplink();
    } else if (a.type === 'encounter') {
      this.world.encounters.resolve(a.d, a.o);
    } else if (a.type === 'revive') {
      this.world.revive(a.target, a.by, a.stim);
    }
  }

  /** The best man for the job walks up to do it (same room, on his feet); otherwise the point man does. */
  assignTask(by, x) {
    const lead = this.leader;
    if (!by || by === lead || !by.alive || by.down || !this.order.includes(by) || by.room !== lead.room || by.mode !== 'walk' || Math.abs(by.x - x) > 14) return;
    this.task = { m: by, x, phase: 'go' };
    if (!by.offX) by.offX = 0;
    this.world.emit('bark', { marine: by, text: 'I\'ve got this one.' });
  }

  /** Walk the specialist off his trail slot to the job and back (after applySample). */
  stepTask(m, dt) {
    const T = this.task;
    const trailX = m.x;
    const side = Math.sign(T.x - (trailX + m.offX)) || m.facing;
    const goal = T.phase === 'back' ? 0 : T.x - 0.55 * side - trailX;
    const d = goal - m.offX;
    const step = Math.min(Math.abs(d), SQUAD.WALK * m.pace * dt);
    m.offX += Math.sign(d) * step;
    m.x = trailX + m.offX;
    if (step > 0.25 * dt) { m.moving = true; m.facing = Math.sign(d) || m.facing; }
    if (T.phase === 'go' && Math.abs(goal - m.offX) < 0.02) { T.phase = 'work'; m.facing = Math.sign(T.x - m.x) || m.facing; }
    if (T.phase === 'back' && Math.abs(m.offX) < 0.02) { m.offX = 0; m.x = trailX; this.task = null; }
  }

  // ------------------------------------------------------------------ turning

  turnAround(reason) {
    if (this.turnPending) return;
    this.turnPending = true;
    this.world.emit('squad-turn', { reason });
  }

  settled() {
    const lead = this.leader;
    const L = this.ladder;
    // A man queued at the foot of a climb while someone is on it counts as in position: when
    // turning back mid-climb he leads the way out, and the climber comes back down.
    const queued = (m, i) => L && m.s <= L.sa + 0.01 && this.order.some((o, j) => j < i && o.s > L.sa + 0.01);
    return this.order.every((m, i) => i === 0 || m.s >= Math.max(0, lead.s - this.offset(i)) - 0.05 || queued(m, i));
  }

  reverse() {
    if (this.task) { this.task.m.offX = 0; this.task = null; }
    const L = this.trail.reverse();
    for (const m of this.order) m.s = L - m.s;
    this.order.reverse();
    const lead = this.leader;
    this.trail.truncateAfter(Math.max(lead.s, this.trail.nextWalkable(lead.s)));
    this.heading = -this.heading;
    this.handled.clear();
    this.turnPending = false;
    this.ladder = null;
    // Features the new leader is standing on right now shouldn't re-trigger - except a ladder
    // or stairs at his feet (offerUnderfoot).
    for (const f of this.features(lead.room)) {
      if (Math.abs(f.x - lead.x) < 0.05 && f.type !== 'ladder' && f.type !== 'stairs') this.handled.add(f.key);
    }
    lead.facing = this.heading;
    this.world.emit('bark', { marine: lead, text: 'On me. Moving back.' });
    this.offerUnderfoot();
  }

  /**
   * A new point man standing at a ladder or stairs (after turning back mid-climb, or walking
   * back down the trail) never meets it "ahead" - offer it now: it may be exactly the way on.
   */
  offerUnderfoot() {
    const lead = this.leader;
    if (this.state !== 'advance' || this.trav || lead.mode !== 'walk') return;
    const f = this.features(lead.room).find((q) => (q.type === 'ladder' || q.type === 'stairs')
      && Math.abs(q.x - lead.x) < 0.3 && !this.handled.has(q.key));
    if (f) this.trigger(f);
  }

  /** Player "turn around" order. */
  orderTurn() {
    if (this.state === 'decision') { this.choose('back'); return; }
    if (this.trav || this.action) return;
    this.turnAround('order');
  }

  // ------------------------------------------------------------------ followers

  updateFollowers(dt) {
    const lead = this.leader;
    const L = this.ladder;
    const loose = this.loose();
    let waiting = 0;
    // The point man is up a ladder / stairs: if the drill gaps would leave the last man on the
    // climb, everyone closes up - spaced evenly between the top and the point man, tighter than
    // the drill if the landing is short - so nobody is left hanging on it.
    let pack = null;
    if (L?.sb !== undefined && lead.s - this.offset(this.order.length - 1) < L.sb + 0.2) {
      pack = Math.max(AWARE.MIN_GAP, (lead.s - L.sb - 0.2) / (this.order.length - 1));
    }
    for (let i = 1; i < this.order.length; i++) {
      const m = this.order[i];
      if (m.breakdown?.mode === 'flee') { this.stepFlee(m, i, dt); continue; }
      if (m.breakdown?.mode === 'freeze') { m.moving = false; m.v = 0; continue; }
      const ahead = this.order[i - 1];
      let target = Math.max(0, lead.s - this.offset(i));
      // Walking freely, everyone keeps his own distance - but never walks into the man ahead.
      if (loose) target -= (this.gaps[i - 1] ?? SQUAD.SPACING) * m.slack;
      if (pack !== null) target = Math.max(target, lead.s - i * pack);
      target = Math.min(target, ahead.s - AWARE.MIN_GAP);
      // Staggered climbs: wait at the foot (queueing back from it) while the man ahead is on
      // the ladder - or, on stairs, still in the lower half - so someone is always covering.
      if (L && m.s <= L.sa + 0.01 && target > L.sa - waiting * 1.2) {
        const end = L.kind === 'ladder' ? L.sb ?? Infinity : L.sa + L.len * 0.5;
        const busy = this.order.some((o, j) => j < i && o.s > L.sa + 0.01 && o.s < end - 0.01);
        if (busy) target = Math.max(m.s, L.sa - waiting * 1.2);
        if (busy) waiting++;
      }
      const before = m.s;
      const here = this.trail.sample(m.s);
      // Ladders, stairs and vaults run at their exact pace (the climb staggering depends on it).
      const free = here.mode === 'walk' || here.mode === 'crouch';
      const err = target - m.s;
      let want = 0;
      if (err > 0.01 && !(free && m.checkT > 0)) {
        const pace = modeSpeed(here.mode, this.speed()) * (free ? m.pace : climbK(here.mode, m));
        // Close in briskly when well behind, settle gently into the slot.
        want = Math.min(pace * (err > 2.2 ? AWARE.CATCH_UP : err > 0.8 ? 1.25 : 1), 0.35 + err * 2);
        if (m.backpedal) want *= 0.7;
      }
      m.v = free ? approach(m.v, want, dt) : want;
      if (m.s < target && m.v > 0) m.s = Math.min(target, m.s + m.v * dt);
      else if (m.s >= target) m.v = Math.min(m.v, want);
      // Millimetre queue shuffles don't count as walking (they made troopers twitch round).
      m.moving = m.s - before > 0.25 * dt;
      this.applySample(m, i);
      if (this.task?.m === m) this.stepTask(m, dt);
      else if (m.offX) {
        // Back on his feet: walking from where he lay into his place in the line.
        const step = Math.min(Math.abs(m.offX), SQUAD.WALK * dt);
        m.offX -= Math.sign(m.offX) * step;
        m.x += m.offX;
        if (step > 0.25 * dt) { m.moving = true; m.facing = -Math.sign(m.offX) || m.facing; }
      }
    }
  }

  applySample(m, slot) {
    const p = this.trail.sample(m.s);
    if (!p) return;
    const laneK = Math.max(0, 1 - Math.abs(p.z) / 0.8);
    m.x = p.x; m.y = p.y; m.z = p.z + LANES[slot % LANES.length] * laneK;
    m.mode = p.mode;
    if (p.room !== undefined && p.room !== m.room) {
      m.room = p.room;
      const room = this.level.rooms[p.room];
      room.explored = true;
      room.seen = true;
    }
    // A trooper with a drill post (m.face - e.g. rear guard at a door) backs up while the
    // queue closes up instead of turning to walk and then turning straight back.
    if (m.moving && p.dir && p.dir !== m.facing && !m.face && (m.faceT ?? 1) > 0.3) { m.facing = p.dir; m.faceT = 0; }
  }

  placeFollowers() {
    this.order.forEach((m, i) => { m.moving = false; this.applySample(m, i); });
  }

  /** Remove a dead marine; everyone behind closes the gap automatically. */
  remove(marine) {
    const i = this.order.indexOf(marine);
    if (i < 0) return;
    if (this.task?.m === marine) this.task = null; // the point man picks the job up
    // A new point man first walks the trail up to where the old one fell, then carries on with
    // whatever was in progress there (a half-climbed ladder, a door being opened, the uplink).
    this.order.splice(i, 1);
    // The man sent off on a job is now the point man: he does it from where the line is (only
    // the men behind the point man walk out of line - his errand would never finish).
    if (this.task && this.task.m === this.order[0]) {
      this.task.m.offX = 0;
      this.task = null;
    }
  }

  /** Is the squad as a whole standing still (for rear-guard facing, idle anims)? */
  halted() {
    return this.order.every((m) => !m.moving);
  }

  /** Last point the leader passed that can be used as a respawn/anchor. */
  get room() { return this.leader?.room; }

  static lane(slot) { return LANES[slot % LANES.length]; }
}
