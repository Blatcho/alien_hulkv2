// Trooper awareness: what each marine looks at, and the small behaviours that make the squad
// read as four people rather than one conga line.
//   - Everyone scans his own sector - point man ahead, #2 high (vents, hatches, lamps), #3 low
//     (crates, bodies, floor vents), the rear man the way we came - and they avoid doubling up.
//   - Weapon and torch pitch onto what a man looks at, and the sight cone follows (vis/sight.js),
//     so what the flashlights sweep is what the squad sees.
//   - A trooper passing a vent, a hatch or a body stops for a second to check it.
//   - The rear man checks six every so often: backs up facing the rear, or stops and looks.
//   - Noises, vents banging and tracker contacts pull eyes round; contacts behind turn the rear
//     man; contacts on another deck get weapons pointed at the ceiling / floor.
//   - When something is on the tracker the point man advances in bounds, kneeling to cover
//     while the rest close up; he also pauses at the threshold of every unexplored room.
//   - In a firefight the front rank kneels so the men behind can fire over them, and a rear man
//     with nothing to shoot covers the other way (flankers come through the vents).
// Decisions draw on their own RNG stream, so they never reshuffle combat or the director.
import { AWARE, STANCE } from '../core/config.js';
import { Rng } from '../core/rng.js';
import { walkLimits } from '../gen/layout.js';
import { portalEnds } from '../gen/level.js';
import { bodyPoint, eye } from '../vis/sight.js';
import { practice } from './stats.js';

const RANK = { casual: 0, alert: 1, engaged: 2 };
const raise = (m, stance) => { if (RANK[stance] > RANK[m.stance]) m.stance = stance; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const free = (m) => m.mode === 'walk' || m.mode === 'crouch';

// How interesting each kind of thing is, and what a role prefers.
const INTEREST = { vent: 3, opening: 3, door: 2, corner: 1.2, prop: 1, body: 2.5, lamp: 1.2, horizon: 3 };
const HIGH = new Set(['vent-high', 'opening-high', 'lamp']);
const LOW = new Set(['prop', 'body', 'vent-low', 'opening-low']);
const CHECKABLE = new Set(['vent', 'opening', 'body']);

export class Awareness {
  constructor(world) {
    this.world = world;
    this.rng = new Rng(world.level.seed, 'aware');
    this.rooms = new Map();   // room id -> static points of interest
    this.sounds = [];         // recent noises worth a look {x, y, t, kind}
    this.bodies = [];         // dead things worth a second look
    this.entry = false;       // point man owes a pause at the threshold of a new room
    this.boundLeft = 2.5;
    this.nervousUntil = 0;
    this.threat = null;       // nearest unseen mover on the tracker
    const hear = (x, y, kind) => this.sounds.push({ x, y, t: world.time, kind: 'sound', what: kind });
    world.on('vent-emerge', ({ vent }) => hear(vent.x, vent.y, 'vent'));
    world.on('vent-enter', ({ vent }) => { if (vent) hear(vent.x, vent.y, 'vent'); });
    world.on('alien-wake', ({ alien }) => hear(alien.x, alien.y + 0.8, 'wake'));
    world.on('explosion', ({ x, y }) => hear(x, y + 1, 'boom'));
    world.on('door', ({ portal, by }) => { if (by && by.kind !== 'marine') hear(portal.x, portal.y + 1.2, 'door'); });
    world.on('kill', ({ entity }) => {
      if (entity.kind === 'marine') return;
      this.bodies.push({ e: entity, t: world.time, kind: 'body', x: entity.x, y: entity.y + 0.3, room: entity.room });
      this.nervousUntil = Math.max(this.nervousUntil, world.time + 5);
    });
    world.on('enter-room', ({ room, first }) => {
      if (first && !room.exterior && room.type !== 'airlock') this.entry = true;
    });
  }

  // ------------------------------------------------------------------ points of interest

  poisOf(roomId) {
    let list = this.rooms.get(roomId);
    if (list) return list;
    const L = this.world.level;
    const room = L.rooms[roomId];
    const [wl, wr] = walkLimits(room);
    list = [];
    const add = (x, y, kind, tag = kind) => list.push({ x, y, kind, tag, room: roomId, seenT: -99, checkedT: -99 });
    for (const vid of room.vents ?? []) {
      const v = L.vents[vid];
      add(v.x, v.y, 'vent', v.ceiling ? 'vent-high' : 'vent-low');
    }
    for (const pid of room.portals) {
      const p = L.portals[pid];
      const end = portalEnds(L, p)[roomId];
      if (!end) continue;
      if (p.kind === 'door') { add(end.x, room.y0 + 1.3, 'door'); continue; }
      const up = p.a === roomId; // the far end of a ladder / stairs is above us
      add(end.x, up ? room.y1 - 0.2 : room.y0 + 0.1, 'opening', up ? 'opening-high' : 'opening-low');
    }
    for (const p of room.props) add(p.x, room.y0 + 0.7, 'prop');
    if (room.light === 'flicker') add((wl + wr) / 2, room.y1 - 0.3, 'lamp');
    add(wl + 0.4, room.y0 + 1.0, 'corner');
    add(wr - 0.4, room.y0 + 1.0, 'corner');
    this.rooms.set(roomId, list);
    return list;
  }

  /** Everything a trooper might look at right now. */
  candidates(m) {
    const now = this.world.time;
    this.bodies = this.bodies.filter((b) => now - b.t < 90);
    return [...this.poisOf(m.room), ...this.bodies.filter((b) => b.room === m.room && b.e.seenDead)];
  }

  // ------------------------------------------------------------------ behaviour (before facing)

  /**
   * Movement-side decisions for this step: checks, check-six, bounds, threshold pauses,
   * reactions to contacts, the front rank in a firefight. Runs after the situational drills
   * (tactics.js), and never overrides a drill's post.
   */
  plan(dt, order, situation, H) {
    const w = this.world;
    const sq = w.squad;
    const now = w.time;
    this.sounds = this.sounds.filter((s) => now - s.t < 2.5);
    for (const m of w.marines) {
      for (const k of ['checkT', 'sixT', 'holdT', 'slowT', 'lookT', 'checkCool', 'sixCool', 'watchT']) if (m[k] > 0) m[k] -= dt;
      m.backpedal = false;
    }
    if (!order.length) return;
    const n = order.length;
    const lead = order[0];
    const rear = n >= 2 ? order[n - 1] : null;
    const loose = sq.loose();

    // Tracker: the nearest unseen mover.
    this.threat = null;
    let best = STANCE.MOTION_RANGE;
    for (const e of w.aliens.concat(w.critters)) {
      if (!e.alive || e.visible) continue;
      if (!(e.moving || e.state === 'vent' || e.state === 'emerge')) continue;
      const d = Math.hypot(e.x - lead.x, e.y - lead.y);
      if (d < best) { best = d; this.threat = e; }
    }
    if (this.threat?.kind === 'alien') this.nervousUntil = Math.max(this.nervousUntil, now + 6);
    if (w.level.rooms[lead.room].nest) this.nervousUntil = Math.max(this.nervousUntil, now + 2);
    const nervous = now < this.nervousUntil;

    // Spacing drift: each man settles into his own distance, and it wanders.
    for (const m of order) {
      m.slackT -= dt;
      if (m.slackT <= 0) { m.slackT = this.rng.float(2, 5); m.slackGoal = this.rng.float(AWARE.SLACK[0], AWARE.SLACK[1]); }
      const goal = loose ? m.slackGoal * (sq.pace === 'run' ? 0.5 : 1) : 0;
      m.slack += Math.sign(goal - m.slack) * Math.min(Math.abs(goal - m.slack), dt * (loose ? 0.3 : 1.5));
    }

    // ---- point man: threshold pause on a new room, bounds when nervous (not the player's own)
    if (this.entry && !sq.trav && sq.state === 'advance') {
      this.entry = false;
      if (!lead.controlled) {
        lead.holdT = AWARE.ENTRY_PAUSE;
        lead.slowT = 1.8;
        lead.bound = false;
      }
    }
    if (nervous && loose && sq.pace !== 'run' && lead.holdT <= 0 && !lead.controlled) {
      this.boundLeft -= lead.v * dt;
      if (this.boundLeft <= 0) {
        lead.holdT = this.rng.float(AWARE.BOUND_HOLD[0], AWARE.BOUND_HOLD[1]);
        lead.bound = true;
        this.boundLeft = this.rng.float(AWARE.BOUND[0], AWARE.BOUND[1]);
        w.barks.say(order[1] ?? lead, 'bound', 0.3);
      }
    } else if (!nervous) this.boundLeft = 2.5;
    if (lead.holdT > 0 && situation === 'move') {
      raise(lead, lead.bound ? 'engaged' : 'alert');
      if (lead.bound && free(lead)) lead.crouch = true;
      if (lead.bound && order[1]) raise(order[1], 'engaged');
    } else lead.bound = false;

    // ---- checks and check-six only while walking freely; otherwise everyone closes up
    if (!loose) {
      for (const m of order) { m.checkT = 0; m.sixT = 0; }
    } else {
      // The rear man checks six now and then: backs up facing the rear, or stops and looks.
      if (rear && n >= 3 && free(rear) && rear.sixT <= 0 && rear.checkT <= 0 && rear.sixCool <= 0) {
        rear.sixT = this.rng.float(AWARE.SIX_TIME[0], AWARE.SIX_TIME[1]);
        rear.sixMode = this.rng.chance(0.55) ? 'backpedal' : 'stop';
        if (rear.sixMode === 'stop') rear.checkT = rear.sixT;
        rear.sixCool = this.rng.float(AWARE.SIX_EVERY[0], AWARE.SIX_EVERY[1]) * (rear.stance === 'casual' ? 1.5 : 1);
        rear.look = null;
        w.barks.say(rear, 'six', 0.25);
      }
      // A stop to check something close ahead: one man at a time, never the point man.
      if (!order.some((m) => m.checkT > 0 && m.sixT <= 0)) {
        for (let i = 1; i < n; i++) {
          const m = order[i];
          if (m.checkCool > 0 || m.sixT > 0 || !free(m)) continue;
          const poi = this.candidates(m).find((p) => CHECKABLE.has(p.kind) && now - p.checkedT > 30
            && (p.x - m.x) * H > 0.3 && (p.x - m.x) * H < 2.6);
          if (!poi) continue;
          m.checkT = this.rng.float(AWARE.CHECK[0], AWARE.CHECK[1]);
          practice(m, 'per', 0.3);
          m.checkOn = poi;
          m.checkCool = this.rng.float(AWARE.CHECK_COOL[0], AWARE.CHECK_COOL[1]);
          poi.checkedT = now;
          m.look = poi;
          m.lookT = m.checkT;
          if (poi.kind === 'vent') w.barks.say(m, 'check_vent', 0.35);
          else if (poi.kind === 'body') w.barks.say(m, 'check_body', 0.4);
          break;
        }
      }
      // Don't straggle: a man left far behind gives up his check and catches up.
      for (let i = 1; i < n; i++) {
        const m = order[i];
        if (m.checkT > 0 && order[i - 1].s - m.s > 5.5) { m.checkT = 0; m.sixT = 0; }
      }
    }
    for (const m of order) {
      if (m.sixT > 0) {
        m.face = -H;
        if (m.sixMode === 'backpedal') m.backpedal = true;
        raise(m, 'alert');
      } else if (m.checkT > 0 && m.checkOn) {
        raise(m, m.checkOn.kind === 'vent' || m.checkOn.kind === 'opening' ? 'engaged' : 'alert');
        if (m.checkOn.y < m.y + 0.5 && m.checkOn.kind !== 'opening') m.crouch = true;
      }
    }

    // ---- contacts: behind us turns the rear man; above/below points weapons at the deck
    const t = this.threat;
    if (t && !sq.engaged) {
      const dx = t.x - lead.x;
      const real = t.kind === 'alien' || Math.hypot(t.x - rear?.x, t.y - rear?.y) < 4; // not every rat
      if (real && rear && n >= 2 && dx * H < -1.5 && free(rear) && !rear.face) {
        // Held for a while: a contact flickering on and off the tracker mustn't spin him round.
        rear.watchT = Math.max(rear.watchT, AWARE.WATCH);
        rear.watchDir = -H;
        if (t.kind === 'alien') w.barks.say(rear, 'behind', 0.5);
      }
      if (t.kind === 'alien' && Math.abs(t.y - lead.y) > 2.2) w.barks.say(order[Math.min(1, n - 1)], t.y > lead.y ? 'above' : 'below', 0.5);
    }
    if (!sq.engaged && this.sounds.length && !this.heardT) {
      this.heardT = 3;
      w.barks.say(order[Math.min(2, n - 1)], 'noise', 0.4);
    }
    if (this.heardT > 0) this.heardT -= dt;
    if (this.heardT <= 0) this.heardT = 0;

    for (const m of order) {
      if (m.watchT <= 0 || m.face || !free(m) || m.controlled) continue;
      m.face = m.watchDir;
      if (m.moving) m.backpedal = true;
      raise(m, 'engaged');
    }

    // ---- firefight: front rank kneels, the rear covers the other way
    if (sq.engaged) {
      const shooters = order.filter((m) => m.target);
      for (const m of shooters) {
        const dir = Math.sign(m.target.x - m.x) || m.facing;
        const behind = shooters.some((o) => o !== m && (Math.sign(o.target.x - o.x) || o.facing) === dir
          && (m.x - o.x) * dir > 0.3 && (m.x - o.x) * dir < 4);
        if (behind && free(m) && !m.moving && !m.controlled) m.kneelUntil = now + AWARE.KNEEL;
      }
      for (const m of order) if (now < m.kneelUntil && free(m)) m.crouch = true;
      const first = shooters[0];
      if (first && rear && n >= 3 && !rear.target && free(rear)) {
        rear.face = -(Math.sign(first.target.x - first.x) || H);
        raise(rear, 'engaged');
      }
    } else for (const m of order) m.kneelUntil = 0;
  }

  // ------------------------------------------------------------------ looking (after facing)

  /** Pick what each trooper looks at and swing weapon/torch pitch (and head) onto it. */
  look(dt, order, H) {
    const n = order.length;
    for (const m of this.world.marines) {
      if (!m.alive) continue;
      if (m.controlled) {
        // The player's: his gun goes where the right stick points (or onto what it's drawn to).
        const c = m.target ? bodyPoint(m.target) : null;
        const pitch = m.aimSet ? m.aimAngle : c ? this.pitchTo(m, c.x, c.y) : AWARE.PITCH_BASE[m.stance] ?? 0;
        m.aimPitch = clamp(pitch, -1.25, 1.25);
        const rate = AWARE.PITCH_RATE * 3 * dt;
        m.pitch += clamp(m.aimPitch - m.pitch, -rate, rate);
        m.glance += clamp(-m.glance, -3 * dt, 3 * dt);
        continue;
      }
      const i = order.indexOf(m);
      const role = i === 0 ? 'point' : i === n - 1 && n > 2 ? 'rear' : i === 1 ? 'high' : 'low';
      let pitch = AWARE.PITCH_BASE[m.stance] ?? 0;
      let glance = 0;
      if (m.target) { const c = bodyPoint(m.target); pitch = this.pitchTo(m, c.x, c.y); }
      else if (m.cover) pitch = m.cover === 'up' ? 0.9 : -0.8;
      else if (m.mode !== 'climb' && m.mode !== 'jump') {
        if (m.lookT <= 0 || !this.valid(m, m.look)) this.choose(m, role, H);
        const L = m.look;
        if (L) {
          const dx = L.x - m.x;
          if ((Math.sign(dx) || m.facing) === m.facing || Math.abs(dx) < 0.4) pitch = this.pitchTo(m, L.x, L.y);
          else glance = 1; // behind him: a look over the shoulder, the weapon stays on his sector
        }
      } else pitch = 0;
      const deep = m.cover || m.target || m.checkT > 0; // may point well down (a shaft, a body, a crawler)
      m.aimPitch = clamp(pitch, deep ? -0.85 : AWARE.PITCH_MIN, m.cover ? 0.95 : AWARE.PITCH_MAX);
      const rate = AWARE.PITCH_RATE * (m.target ? 2 : 1) * dt;
      m.pitch += clamp(m.aimPitch - m.pitch, -rate, rate);
      m.glance += clamp(glance - m.glance, -3 * dt, 3 * dt);
    }
  }

  pitchTo(m, x, y) {
    const e = eye(m);
    return Math.atan2(y - e.y, Math.max(1.2, Math.abs(x - e.x)));
  }

  valid(m, L) {
    if (!L) return false;
    if (L.kind === 'threat') return L.e.alive && !L.e.visible;
    if (L.kind === 'sound') return this.world.time - L.t < 2.5;
    if (L.kind === 'horizon') return true;
    return L.room === m.room;
  }

  choose(m, role, H) {
    const w = this.world;
    const now = w.time;
    const look = (L, t) => { m.look = L; m.lookT = t; };
    if (m.checkT > 0 && m.checkOn) return look(m.checkOn, m.checkT);
    // Something heard close by beats the sector scan.
    const heard = this.sounds.filter((s) => Math.hypot(s.x - m.x, s.y - m.y) < 18).sort((a, b) => b.t - a.t)[0];
    if (heard && heard !== m.look) return look(heard, 1.2);
    // A tracker contact: the men not on point watch where it is (ceiling, floor, behind).
    const t = this.threat;
    const worth = t && (t.kind === 'alien' || Math.hypot(t.x - m.x, t.y - m.y) < 5); // vermin only up close
    if (worth && role !== 'point' && (role !== 'rear' || (t.x - m.x) * m.facing > 0)) {
      return look({ kind: 'threat', e: t, ...bodyPoint(t, 0.4) }, 0.9);
    }
    const scan = { kind: 'horizon', tag: 'horizon', x: m.x + m.facing * 8, y: m.y + 1.4 + this.rng.float(-0.7, 0.5) };
    const pool = [scan];
    for (const p of this.candidates(m)) {
      const dx = p.x - m.x;
      const d = Math.hypot(dx, p.y - m.y);
      if (d > 11 || d < 0.5) continue;
      pool.push(p);
    }
    const others = w.marines.filter((o) => o !== m && o.alive).map((o) => o.look);
    const entries = pool.map((p) => {
      const dx = p.x - m.x;
      const ahead = (Math.sign(dx) || m.facing) === m.facing;
      let wgt = INTEREST[p.kind] ?? 1;
      if (p.kind !== 'horizon') wgt *= 1 - Math.hypot(dx, p.y - m.y) / 12;
      if (!ahead) wgt *= role === 'rear' ? 0.5 : 0.2;          // behind: only a glance
      if (role === 'point') wgt *= ahead ? 2 : 0.5;
      if (role === 'high' && HIGH.has(p.tag)) wgt *= 3;
      if (role === 'low' && LOW.has(p.tag)) wgt *= 3;
      if (role === 'rear' && ahead && m.facing === H) wgt *= 0.6;
      if (others.includes(p)) wgt *= 0.15;                     // someone already has it
      if (p.seenT !== undefined) wgt *= clamp((now - p.seenT) / 8, 0.2, 1);
      return [p, Math.max(0.01, wgt)];
    });
    const pick = this.rng.weighted(entries);
    pick.seenT = now;
    look(pick, this.rng.float(AWARE.SCAN[0], AWARE.SCAN[1]));
  }
}
