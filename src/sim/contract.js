// The contract played out (gen/contracts.js): where the squad goes now (goal - the doctrine
// routes to it, the HUD and the map point at it), the work at the target (begin / complete:
// the squad's 'contract' action, or the uplink), the walk home for every job but the nav-lock
// (phase 'return': the run is won once everyone on his feet is back aboard the Kestrel), the
// reactor's fuse, and a crew rescue's count. A job that can't be finished (the crew dead) fails:
// the squad still extracts, for the credits aboard, but not the contract's pay.
import { BROOD } from '../core/config.js';
import { CONTRACTS } from '../gen/contracts.js';
import { walkLimits } from '../gen/layout.js';
import { bestAt } from './stats.js';

// Contracts whose target is a prop the squad works at (the others are found, or killed).
const WORKED = new Set(['uplink', 'blackbox', 'reactor', 'beacon']);

export class Contract {
  constructor(world) {
    this.world = world;
    this.def = world.level.contract ?? { kind: 'uplink', ...CONTRACTS.uplink };
    this.kind = this.def.kind;
    this.phase = 'go';      // 'go' | 'return' | 'done' | 'failed'
    this.fuse = null;       // reactor: seconds until it blows
    this.found = 0;         // rescue: crew brought home
    this.carried = false;   // blackbox: aboard with the squad
    this.working = false;
    this.failedWhy = null;
    world.on('survivor-rescued', ({ survivor }) => this.onRescued(survivor));
    world.on('survivor-died', ({ survivor }) => this.onSurvivorDied(survivor));
    world.on('brood-dead', ({ alien }) => { if (this.kind === 'queen' && alien?.royal && this.phase === 'go') this.advance('return'); });
    world.on('uplink-done', () => { if (this.kind === 'uplink') this.phase = 'done'; });
  }

  get dock() { return this.world.level.dock ?? this.world.level.airlock; }
  get extracting() { return this.phase === 'return' || this.phase === 'failed'; }
  get done() { return this.phase === 'done'; }
  /** Does the squad work this contract at a prop (the console, the reactor, the beacon site)? */
  get worked() { return WORKED.has(this.kind); }

  /**
   * Where the squad goes now: the target, home once the job is done, or null when there is a
   * crew to find and no one in sight - the doctrine sweeps the ship for them.
   */
  goal() {
    const L = this.world.level;
    if (this.extracting) {
      const d = L.rooms[this.dock];
      const [a, b] = walkLimits(d);
      return { kind: 'extract', room: d.id, x: (a + b) / 2 };
    }
    switch (this.kind) {
      case 'rescue': case 'escort': {
        const s = this.world.survivors.find((q) => q.alive && q.visible && !q.identified && (this.kind === 'rescue' || q.vip));
        return s ? { kind: 'rescue', room: s.room, x: s.x } : null;
      }
      case 'queen': {
        const b = L.boss;
        return b ? { kind: 'queen', room: b.room, x: b.x } : { kind: 'objective', room: L.objective.room, x: L.objective.x };
      }
      default: return { kind: 'objective', room: L.objective.room, x: L.objective.x };
    }
  }

  /** The squad is at the target (a squad 'objective' feature; lead: A at it): the work begins. */
  begin(prop) {
    const w = this.world;
    const sq = w.squad;
    if (this.phase !== 'go' || !this.worked) return false;
    if (this.kind === 'uplink') {
      if (w.uplink) return false;
      sq.startUplink(prop);
      return true;
    }
    if (this.working) return false;
    const by = bestAt(sq.order, this.def.work.stat) ?? sq.leader;
    sq.startWork(prop, this.def.work.time * (by.mods?.uplink ?? 1), by);
    this.working = true;
    w.emit('bark', { marine: sq.leader, text: `${by === sq.leader ? 'On it' : `${by.name}, you're up`}. Cover ${by === sq.leader ? 'me' : 'him'}.` });
    return true;
  }

  /** The work is done (the squad's 'contract' action ran out). */
  complete(prop) {
    const w = this.world;
    this.working = false;
    const say = (text) => w.emit('bark', { marine: w.squad.leader, text });
    const y = w.level.rooms[prop.room].y0 + 1;
    switch (this.kind) {
      case 'blackbox':
        this.carried = true;
        w.kit.blackbox = 1;
        prop.objective = false;
        say('Black box is out. Back to the ship - move!');
        break;
      case 'reactor':
        this.fuse = this.def.fuse;
        prop.objective = false;
        w.noise(prop.x, y, 12);
        w.emit('fuse-set', { seconds: this.fuse });
        say(`Charge set. ${Math.round(this.fuse)} seconds - everybody out!`);
        break;
      case 'beacon':
        prop.kind = 'beacon';
        prop.objective = false;
        w.noise(prop.x, y, 60); // the nest wakes
        w.emit('beacon-planted', { prop });
        say('Beacon planted. It\'s screaming - and so will they. Go!');
        break;
      default:
    }
    this.advance('return');
  }

  advance(phase) {
    this.phase = phase;
    this.world.emit('contract', { kind: this.kind, phase, why: this.failedWhy });
  }

  onRescued(s) {
    if (this.phase !== 'go') return;
    if (this.kind === 'rescue') { this.found++; if (this.found >= this.def.crew) this.advance('return'); }
    if (this.kind === 'escort' && s.vip) this.advance('return');
  }

  onSurvivorDied(s) {
    if (this.phase !== 'go') return;
    if (this.kind === 'rescue') {
      const left = this.world.survivors.filter((q) => q.alive && q.state !== 'rescued').length + this.found;
      if (left < this.def.crew) this.fail('not enough of the crew left alive');
    }
    if (this.kind === 'escort' && s?.vip) this.fail(`${s.name} is dead`);
  }

  fail(why) {
    this.failedWhy = why;
    this.advance('failed');
    this.world.emit('bark', { marine: this.world.squad.leader, text: 'Contract\'s blown. Back to the ship with what we have.' });
  }

  update(dt) {
    const w = this.world;
    if (w.status !== 'playing') return;
    if (this.fuse !== null && this.fuse > 0) {
      this.fuse -= dt;
      if (this.fuse <= 0) { this.fuse = 0; this.blow(); return; }
    }
    if (this.extracting && this.allHome()) this.extract();
  }

  /** Everyone on his feet is back aboard the Kestrel. */
  allHome() {
    const up = this.world.marines.filter((m) => m.alive && !m.down);
    return up.length > 0 && up.every((m) => m.room === this.dock);
  }

  /** Home: anyone still down is carried aboard from the dock, left behind anywhere else. The run is won. */
  extract() {
    const w = this.world;
    for (const m of w.marines) {
      if (!m.alive || !m.down) continue;
      if (m.room === this.dock) w.revive(m, null);
      else w.kill(m, null);
    }
    w.stats.rescued = w.survivors.filter((s) => s.state === 'rescued').length;
    if (this.phase === 'return') this.phase = 'done';
    w.emit('extracted', { done: this.done });
    w.end('won');
  }

  /** The reactor goes: whoever is still aboard the derelict dies with it. */
  blow() {
    const w = this.world;
    w.emit('reactor-blown', {});
    for (const m of w.marines) if (m.alive && m.room !== this.dock) w.kill(m, null);
    if (w.marines.some((m) => m.alive)) { this.phase = 'done'; w.end('won'); } else w.end('lost');
  }

  /** The HUD's objective: what to do now, and a second line (the distance is the HUD's). */
  describe() {
    const w = this.world;
    const name = this.def.vipName ?? 'the survivor';
    if (this.phase === 'failed') return { title: `CONTRACT FAILED: ${(this.failedWhy ?? '').toUpperCase()}.`, sub: 'BACK TO THE KESTREL.', dist: true };
    switch (this.kind) {
      case 'uplink': return w.uplink ? { title: 'UPLOAD NAV-LOCK.', sub: 'HOLD THE COMMAND DECK.' } : { title: 'REACH THE COMMAND DECK.', dist: true };
      case 'blackbox': return this.extracting ? { title: 'BLACK BOX ABOARD.', sub: 'BACK TO THE KESTREL.', dist: true } : { title: 'RECOVER THE BLACK BOX.', dist: true };
      case 'reactor': return this.extracting ? { title: `REACTOR BLOWS IN ${Math.max(0, Math.ceil(this.fuse ?? 0))} S.`, sub: 'GET TO THE KESTREL.', dist: true } : { title: 'SET THE REACTOR CHARGE.', dist: true };
      case 'beacon': return this.extracting ? { title: 'BEACON PLANTED.', sub: 'BACK TO THE KESTREL.', dist: true } : { title: 'PLANT THE BEACON IN THE NEST.', dist: true };
      case 'rescue': return this.extracting ? { title: 'THE CREW IS ABOARD.', sub: 'BACK TO THE KESTREL.', dist: true } : { title: `FIND THE CREW: ${this.found}/${this.def.crew} HOME.`, sub: this.goal() ? null : 'SWEEP THE SHIP.', dist: !!this.goal() };
      case 'escort': return this.extracting ? { title: `${name.toUpperCase()} IS SAFE.`, sub: 'BACK TO THE KESTREL.', dist: true } : { title: `FIND ${name.toUpperCase()}.`, sub: this.goal() ? null : 'SWEEP THE SHIP.', dist: !!this.goal() };
      case 'queen': return this.extracting ? { title: 'THE QUEEN IS DEAD.', sub: 'EVERYONE OUT.', dist: true } : { title: 'KILL THE QUEEN.', dist: true };
      default: return { title: 'REACH THE COMMAND DECK.', dist: true };
    }
  }

  /** For the debrief (meta/profile.js applyRun): done or not, and why not. */
  results() {
    return { kind: this.kind, label: this.def.label, done: this.kind === 'uplink' ? this.world.status === 'won' : this.done, phase: this.phase, failedWhy: this.failedWhy, found: this.found, pay: this.def.pay };
  }
}

export const queenBonus = () => BROOD.QUEEN_BONUS;
