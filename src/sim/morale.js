// Squad morale, 0-100: what the squad has been through this mission. Kills, getting a man back on
// his feet, a dead brood mother, a cleared ship lift it; men going down, men lost, screams in
// the dark and ambushes wear it down. Out of a fight it settles back toward REST. Steady men aim
// and react a little better; shaken ones worse, and panic gets in (world.nerveCheck). A veteran
// on his feet keeps it from BREAKING - shaken at worst (config MORALE).
import { MORALE } from '../core/config.js';

export class Morale {
  constructor(world) {
    this.world = world;
    this.value = MORALE.START;
    this.level = this.levelOf(this.value);
    const on = (ev, n) => world.on(ev, (e) => this.add(typeof n === 'function' ? n(e) : n));
    on('kill', ({ entity }) => (entity.kind === 'alien' ? (entity.maxHp >= 200 ? MORALE.BIG_KILL : MORALE.KILL) : entity.kind === 'marine' ? MORALE.LOST : 0));
    on('downed', MORALE.DOWNED);
    on('taken', MORALE.TAKEN);
    on('revived', MORALE.REVIVED);
    on('scream', MORALE.SCREAM);
    on('ambush', MORALE.AMBUSH);
    on('power-out', MORALE.DARK);
    on('brood-dead', MORALE.BROOD);
    on('ship-clear', MORALE.CLEAR);
    on('survivor-rescued', MORALE.RESCUED);
    on('horde', MORALE.HORDE);
    on('horde-over', MORALE.HORDE_DOWN);
    on('breakdown', MORALE.BROKE);
  }

  levelOf(v) { return MORALE.LEVELS.find((l) => v >= l.min) ?? MORALE.LEVELS[MORALE.LEVELS.length - 1]; }

  /** What the squad's state of mind does to its shooting (combat.js) and nerve (world.nerveCheck). */
  get mods() { return this.level; }

  add(n) {
    if (!n) return;
    this.value = Math.max(this.floor(), Math.min(100, this.value + n));
    this.check();
  }

  /** A veteran standing: shaken at worst, never breaking. */
  floor() {
    return this.world.squad.order.some((m) => m.role === 'veteran') ? MORALE.VETERAN : 0;
  }

  update(dt) {
    const w = this.world;
    if (!w.squad.engaged) {
      const d = MORALE.REST - this.value;
      this.value += Math.sign(d) * Math.min(Math.abs(d), MORALE.DRIFT * dt);
    }
    this.value = Math.max(this.floor(), this.value);
    this.check();
  }

  check() {
    const level = this.levelOf(this.value);
    if (level === this.level) return;
    const worse = level.min < this.level.min;
    this.level = level;
    const w = this.world;
    w.emit('morale', { level: level.name, value: this.value, worse });
    const vet = w.squad.order.find((m) => m.role === 'veteran') ?? w.squad.order[0];
    if (worse && level.min < 35) w.barks.say(w.squad.order[w.squad.order.length - 1] ?? vet, 'shaken');
    else if (!worse && level.name === 'steady') w.barks.say(vet, 'steady_squad', 0.8);
    else if (!worse && level.name === 'holding') w.barks.say(vet, 'rallied', 0.8);
  }
}
