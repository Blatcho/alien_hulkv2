// Ship events: things going wrong aboard while the squad is there (chosen at generation -
// gen/populate.js placeEvents). None of them runs on a clock: each one starts when the squad
// gets somewhere, then waits for the squad to deal with it.
//   power     the deck goes dark: lamps out, and without light nobody sees far (vis/sight.js) while
//             things hear better (alien.js). A power junction on the deck brings it back
//             (encounter 'junction').
//   fire      a door on the way goes up: nobody passes until it's put out - or the squad pushes
//             through and takes the burns (encounter 'fire'). Aliens go round by the vents.
//   distress  a survivor radios in from deep in the ship: marked on the tracker, worth a bonus.
import { Rng } from '../core/rng.js';

export const DISTRESS_BONUS = 120;

export class ShipEvents {
  constructor(world) {
    this.world = world;
    this.rng = new Rng(world.level.seed, 'distress');
    this.list = (world.level.events ?? []).map((e) => ({ ...e, started: false, over: false }));
    this.t = 0;
    world.on('survivor-found', ({ survivor }) => {
      if (!survivor.distress) return;
      world.credits += DISTRESS_BONUS;
      const e = this.get('distress');
      if (e) e.over = true;
      world.emit('distress-answered', { survivor, bonus: DISTRESS_BONUS });
    });
  }

  get(kind) { return this.list.find((e) => e.kind === kind); }

  /** The distress call, while it's out there unanswered. */
  get distress() {
    const e = this.get('distress');
    if (!e?.started || e.over) return null;
    const s = this.world.survivors.find((q) => q.id === e.survivor);
    return s?.alive && !s.identified ? e : null;
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const w = this.world;
    const sq = w.squad;
    const lead = sq.leader;
    if (!lead) return;
    for (const e of this.list) {
      if (e.started) continue;
      if (e.kind === 'power' && e.rooms.includes(lead.room) && w.level.rooms[lead.room].dist >= 2) this.powerOut(e);
      // A door catches fire only with the whole squad on one side of it (nobody cut off).
      else if (e.kind === 'fire' && e.rooms.includes(lead.room) && !sq.trav && sq.order.every((m) => m.room === lead.room)) this.fire(e);
      else if (e.kind === 'distress' && w.stats.rooms >= e.after) this.startDistress(e);
    }
    // A door they braved stops being "braved" once they're through it.
    for (const p of w.level.portals) if (p.braved !== undefined && p.braved !== lead.room && !sq.trav) p.braved = undefined;
  }

  powerOut(e) {
    const w = this.world;
    const L = w.level;
    e.started = true;
    for (const id of e.rooms) L.rooms[id].powerOut = true;
    const room = L.rooms[e.junction.room];
    const prop = room.props.find((p) => p.id === e.junction.prop);
    if (prop && !prop.destroyed) {
      prop.encounter = 'junction';
      prop.encounterDone = false;
      room.seen = true; // the breaker panel is on the deck plan
      w.squad.featureCache.delete(room.id);
    }
    w.emit('power-out', { deck: e.deck, rooms: e.rooms });
    w.barks.say(w.squad.leader, 'power_out');
  }

  restorePower() {
    const w = this.world;
    const e = this.get('power');
    if (!e?.started || e.over) return;
    e.over = true;
    for (const id of e.rooms) w.level.rooms[id].powerOut = false;
    w.emit('power-on', { deck: e.deck });
  }

  fire(e) {
    const w = this.world;
    e.started = true;
    const p = w.level.portals[e.portal];
    p.fire = true;
    w.emit('fire', { portal: p });
    w.barks.say(w.squad.leader, 'fire');
  }

  putOut(p) {
    const w = this.world;
    p.fire = false;
    const e = this.list.find((q) => q.kind === 'fire' && q.portal === p.id);
    if (e) e.over = true;
    w.emit('fire-out', { portal: p });
  }

  startDistress(e) {
    const w = this.world;
    e.started = true;
    const room = w.level.rooms[e.room];
    room.seen = true;
    const s = w.addSurvivor(this.rng, e.x, e.room);
    s.distress = true;
    e.survivor = s.id;
    w.emit('distress', { room, survivor: s });
    w.barks.say(w.squad.leader, 'distress', 1, { deck: room.deck + 1 });
  }
}
