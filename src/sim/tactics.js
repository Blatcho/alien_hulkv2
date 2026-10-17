// Squad stances and choreography.
//
// Three weapon stances, chosen from context every step:
//   casual   weapon lowered   - moving through quiet, cleared ship
//   alert    weapon at hip    - halted, doors, ladders, motion on the tracker, nests, after a fight
//   engaged  weapon at eye    - shooting, covering a doorway/ladder, and a few seconds after the
//                               last target before someone calls "Clear!"
//
// Situational drills (side view, so "facing" is left/right):
//   door    point man at the panel, #2 kneels covering the door, #3 stands behind him,
//           the rear man watches the way we came; the squad stacks up tight.
//   ladder  one climber at a time. The next man in line covers the shaft (aim up/down),
//           the others face outward; the first man up covers the hatch for the rest.
//   search  one searches, one watches ahead, the rear man watches back.
//   uplink  point man at the console, the rest kneel/stand facing the entrance, one on the vents.
// On the move, sim/awareness.js adds the rest: sectors, looking around, checks, check-six,
// bounds, reactions to noises and contacts, the front rank kneeling in a firefight.
import { STANCE, SQUAD } from '../core/config.js';
import { Awareness } from './awareness.js';

export class Tactics {
  constructor(world) {
    this.world = world;
    this.post = 0;
    this.alertUntil = 0;
    this.hadCombat = false;
    this.lastSituation = 'move';
    this.calm = 0;
    this.wounded = new Set();
    this.aware = new Awareness(world);
    // First time into a room: weapons up to hip level for a few seconds while corners are checked.
    world.on('enter-room', ({ room, first }) => {
      if (!first || room.type === 'airlock') return;
      this.alertUntil = Math.max(this.alertUntil, world.time + 3.5);
      world.barks.say(world.squad.leader, 'entry', 0.35);
    });
    world.on('hit', ({ entity }) => {
      if (entity.kind !== 'marine' || !entity.alive || entity.hp > 30 || this.wounded.has(entity)) return;
      this.wounded.add(entity);
      world.barks.say(entity, 'wounded');
    });
  }

  /** Distance to the nearest unseen moving thing (what the motion tracker would ping). */
  nearestMotion() {
    const w = this.world;
    const lead = w.squad.leader;
    let best = Infinity;
    for (const e of [...w.aliens, ...w.critters]) {
      if (!e.alive || e.visible) continue;
      const moving = e.moving || e.state === 'vent' || e.state === 'emerge';
      if (!moving) continue;
      best = Math.min(best, Math.hypot(e.x - lead.x, e.y - lead.y));
    }
    return best;
  }

  situation() {
    const sq = this.world.squad;
    if (this.world.uplink) return 'uplink';
    if ((sq.state === 'decision' && sq.decision?.type === 'door') || sq.action?.type === 'door') return 'door';
    if (sq.ladder) return 'ladder';
    if (sq.action?.type === 'search' || sq.action?.type === 'encounter') return 'search';
    if (sq.state !== 'advance' || sq.turnPending || sq.cover) return 'hold';
    return 'move';
  }

  callClear() {
    const w = this.world;
    const order = w.squad.order;
    if (!order.length) return;
    const now = w.time;
    this.alertUntil = now + STANCE.ALERT_AFTER;
    // Only movement right on top of us cancels the call (the tracker also pings vermin).
    if (this.nearestMotion() < STANCE.MOTION_RANGE * 0.6) {
      w.barks.say(order[0], 'lost');
      return;
    }
    // Whoever scored the last kill makes the call - with a free hand (not mid-reload).
    const ready = order.filter((m) => m.reloadT <= 0);
    const speaker = [...(ready.length ? ready : order)].sort((p, q) => q.lastKillT - p.lastKillT)[0];
    if (w.barks.say(speaker, 'clear')) {
      speaker.signalT = STANCE.SIGNAL_TIME;
      const other = order.find((m) => m !== speaker);
      if (other) w.barks.later(0.8, other, 'clear_ack', 0.75);
    }
  }

  update(dt) {
    const w = this.world;
    const sq = w.squad;
    const order = sq.order;
    for (const m of w.marines) if (m.signalT > 0) m.signalT = Math.max(0, m.signalT - dt);
    if (!order.length) return;
    const now = w.time;
    const lead = sq.leader;
    const n = order.length;
    const H = sq.heading;

    // ---- combat state: weapons up while fighting and for a beat after, then "Clear!"
    if (sq.engaged) {
      if (!this.hadCombat) w.barks.say(order.find((m) => m.target) ?? lead, 'contact', 0.85);
      this.hadCombat = true;
      this.post = STANCE.POST_COMBAT;
    } else if (this.hadCombat) {
      this.post -= dt;
      if (this.post <= 0) { this.hadCombat = false; this.callClear(); }
    }
    // A dormant hostile in view: everyone's weapons come up.
    const sleeper = w.aliens.find((a) => a.alive && a.visible && a.state === 'dormant');
    if (sleeper) {
      this.alertUntil = Math.max(this.alertUntil, now + 3);
      w.barks.say(order[0], 'sleeper', 0.8);
    }
    const motion = this.nearestMotion();
    if (motion < STANCE.MOTION_RANGE) {
      this.alertUntil = Math.max(this.alertUntil, now + 4);
      if (!this.hadCombat) w.barks.say(order[Math.min(1, n - 1)], 'motion', 1, { n: Math.max(1, Math.round(motion)) });
    }
    const room = w.level.rooms[lead.room];
    if (room.nest) {
      this.alertUntil = Math.max(this.alertUntil, now + 3);
      w.barks.say(order[Math.min(2, n - 1)], 'nest', 0.8);
    }
    const quietSituation = this.situation() === 'move' && !this.hadCombat && now >= this.alertUntil;
    this.calm = quietSituation ? this.calm + dt : 0;
    if (this.calm > 50) { w.barks.say(order[n - 1], 'quiet', 0.5); this.calm = 0; }

    // ---- baseline stance for everyone
    const situation = this.situation();
    const tense = this.hadCombat || w.uplink || !!sleeper || w.settings.roe === 'alert';
    const wary = now < this.alertUntil || room.nest || !w.settings.flashlight || situation !== 'move' || sq.pace === 'cautious';
    const base = tense ? 'engaged' : wary ? 'alert' : 'casual';
    for (const m of order) { m.prevStance = m.stance; m.stance = base; m.crouch = false; m.cover = null; m.face = 0; }
    sq.gaps = [SQUAD.SPACING, SQUAD.SPACING, SQUAD.SPACING];

    // ---- situational drills
    const rear = n >= 3 ? order[n - 1] : null;
    switch (situation) {
      case 'door': {
        sq.gaps = [0.95, 1.1, 1.6];
        lead.face = H;
        if (order[1]) { order[1].crouch = true; order[1].stance = 'engaged'; order[1].face = H; }
        if (n >= 4) { order[2].face = H; order[2].stance = 'engaged'; }
        if (rear) { rear.face = -H; rear.stance = rear.stance === 'engaged' ? 'engaged' : 'alert'; }
        if (this.lastSituation !== 'door') {
          if (order[1]) w.barks.say(order[1], 'door_stack', 0.6);
          if (rear) w.barks.later(0.9, rear, 'rear', 0.35);
        }
        break;
      }
      case 'ladder': this.ladderDrill(order, H); break;
      case 'search':
        if (order[1]) order[1].face = H;
        if (rear) rear.face = -H;
        break;
      case 'hold':
        if (order[1]) order[1].face = H;
        if (rear) rear.face = -H;
        break;
      case 'uplink':
        sq.gaps = [1.3, 1.3, 1.3];
        for (let i = 1; i < n; i++) { order[i].face = -H; order[i].stance = 'engaged'; }
        if (order[1]) order[1].crouch = true;
        if (order[3]) order[3].cover = 'up';
        break;
      default:
    }
    this.lastSituation = situation;
    this.aware.plan(dt, order, situation, H);
    // A specialist out of the line faces his job, whatever his drill post was.
    if (sq.task) { const t = sq.task.m; t.face = Math.sign(sq.task.x - t.x) || t.facing; t.crouch = false; }

    // ---- hysteresis: weapons come UP immediately, but only drop after holding ~1 s
    const RANK = { casual: 0, alert: 1, engaged: 2 };
    for (const m of order) {
      if (m.target) continue;
      if (RANK[m.stance] < RANK[m.prevStance ?? m.stance]) {
        m.stanceHold = (m.stanceHold ?? 0) + dt;
        if (m.stanceHold < 1.0) m.stance = m.prevStance;
        else m.stanceHold = 0;
      } else m.stanceHold = 0;
    }

    // ---- targets always win; then facing
    for (const m of order) {
      m.faceT = (m.faceT ?? 1) + dt;
      if (m.target) m.lastTargetT = w.time;
      if (m.controlled) {
        // The player's marine: no drill post, no kneeling but his own, and the right stick turns him.
        m.face = 0; m.cover = null; m.crouch = false;
        if (m.target || m.aiming) m.stance = 'engaged';
        continue;
      }
      let want = m.facing;
      if (m.target) { m.stance = 'engaged'; m.cover = null; want = Math.sign(m.target.x - m.x) || m.facing; }
      else if ((!m.moving || m.backpedal) && m.face && (m.mode === 'walk' || m.mode === 'crouch')) want = m.face;
      else if (!m.moving && m.mode === 'walk' && !m.face) want = H;
      // Turning around is deliberate: at most ~3x a second, except to face a target - and after a
      // target goes down a man keeps covering that spot for a beat before turning back.
      const settled = m.faceT > 0.35 && w.time - (m.lastTargetT ?? -99) > 1.1;
      if (want !== m.facing && (m.target || settled)) { m.facing = want; m.faceT = 0; }
    }
    this.aware.look(dt, order, H);
    for (const m of w.marines) m.anim = this.anim(m);
  }

  /**
   * Ladders and stairs: the team regroups at the far end and covers the climb.
   *   below  next man in line covers the man climbing; the rest face outward
   *   above  the first man through kneels over the hatch / stairwell; everyone else who is up
   *          turns to cover the climb too - except the point man, who watches the way ahead
   *          as soon as someone else has the climb covered.
   */
  ladderDrill(order, H) {
    const w = this.world;
    const sq = w.squad;
    const L = sq.ladder;
    const p = L.portal;
    // Where the climb starts (below side) and ends (the side we regroup on).
    const startX = p.kind === 'ladder' ? p.x : L.up ? p.xb : p.xt;
    const endX = p.kind === 'ladder' ? p.x : L.up ? p.xt : p.xb;
    const before = [];
    const on = [];
    const after = [];
    for (const m of order) {
      if (m.s <= L.sa + 0.01) before.push(m);
      else if (L.sb !== undefined && m.s >= L.sb - 0.01) after.push(m);
      else on.push(m);
    }
    sq.gaps = [1.1, 1.1, 1.1];
    before.sort((a, b) => b.s - a.s);  // next climber first
    after.sort((a, b) => a.s - b.s);   // closest to the hatch first
    const coming = before.length + on.length;
    before.forEach((m, k) => {
      m.stance = 'alert';
      if (k === 0 && on.length) {
        // Next in line covers the man on the ladder.
        m.cover = L.up ? 'up' : 'down';
        m.stance = 'engaged';
        m.face = Math.sign(startX - m.x) || H;
        w.barks.say(m, 'ladder_cover', 0.5);
      } else m.face = k % 2 ? H : -H;
    });
    const lead = order[0];
    after.forEach((m, k) => {
      m.stance = 'alert';
      if (!coming) {
        // All up: a last look back down the climb, point man already eyes-front.
        m.face = m === lead ? H : Math.sign(endX - m.x) || -H;
        if (m !== lead) m.stance = 'engaged';
        return;
      }
      const covering = after.some((o) => o !== lead);
      if (m === lead && covering) { m.face = H; return; }   // point man watches ahead
      m.stance = 'engaged';
      m.face = Math.sign(endX - m.x) || -H;               // everyone else covers the climb
      if (k === 0) m.cover = L.up ? 'down' : 'up';          // closest kneels over the opening
    });
    if (coming && after.length === 1 && after[0] === lead && this.lastSituation !== 'ladder-top') {
      w.barks.say(lead, 'ladder_top', 0.6);
    }
  }

  /**
   * Clip name for a marine from mode, stance, crouch, cover and combat state. On the move his legs
   * always walk or run at the pace he's going: a reload, a throw, a shove, a flinch or a burst then
   * plays on his upper body only (m.animUpper - render/actors.js layers it over the legs), never a
   * standing clip sliding along the deck.
   */
  anim(m) {
    const sq = this.world.squad;
    m.animUpper = null;
    if (!m.alive) return 'die';
    if (m.mode === 'climb' || (m.mode === 'step' && Math.abs(m.z) > 1.25)) return 'climb'; // ladder step, not stairs
    if (m.mode === 'jump') return 'jump';
    const crouched = sq.cover || m.crouch || m.mode === 'crouch';
    if (m.moving) {
      m.animUpper = m.strikeT > 0 ? m.strikeAnim : m.hitT > 0.15 ? 'hit' : m.bashT > 0 ? 'bash' : m.reloadT > 0 ? 'reload' : m.signalT > 0 ? 'signal'
        : (m.target || m.controlled) && m.burst > 0 ? (crouched ? 'crouch_shoot' : 'shoot') : null;
      return this.gait(m, crouched);
    }
    if (m.strikeT > 0) return m.strikeAnim; // a power-weapon blow (sim/melee.js)
    if (m.hitT > 0.15) return 'hit';
    // Broken (sim/breakdown.js): frozen or hiding, he's down on his haunches.
    const b = m.breakdown;
    if (b && (b.mode === 'freeze' || b.phase === 'hide' || b.phase === 'run')) return 'crouch_alert';
    if (m.bashT > 0) return 'bash'; // a shove (sim/melee.js)
    if (m.reloadT > 0) return 'reload';
    if (m.signalT > 0) return 'signal';
    const worker = sq.task?.phase === 'work' ? sq.task.m : sq.task ? null : sq.leader;
    const working = sq.action && m === worker && ['search', 'door', 'uplink', 'encounter'].includes(sq.action.type);
    if (working && !m.target) return 'interact';
    if (m.cover && !m.target) return m.cover === 'up' ? 'aim_up' : 'aim_down';
    if (m.stance === 'engaged' || m.target || m.aiming) {
      if ((m.target || m.controlled) && m.burst > 0) return crouched ? 'crouch_shoot' : 'shoot';
      return crouched ? 'crouch_aim' : 'aim';
    }
    return crouched ? 'crouch_alert' : m.stance === 'alert' ? 'idle_alert' : 'idle_casual';
  }

  /**
   * The legs on the move. Going fast - the squad's pace, a jog to catch up, a man bolting - he runs
   * (never while backing up or crouched); otherwise the walk for his stance. The walks are authored
   * for walking speed, so anything quicker would have their feet slide.
   */
  gait(m, crouched) {
    const sq = this.world.squad;
    if (m.breakdown?.phase === 'run') return 'run';
    if (sq.pace === 'run' || (m.v > SQUAD.WALK * 1.4 && !m.backpedal && !crouched)) return 'run';
    if (crouched || sq.pace === 'cautious') return 'crouch_walk';
    if (m.stance === 'engaged' || m.target) return 'walk_aim';
    return m.stance === 'alert' ? 'walk_alert' : 'walk_casual';
  }
}
