// Pacing director. Placed aliens alone make a ship predictable; the director cycles
//   calm -> build-up (things move in the vents: tracker pings) -> ambush -> release
// and throws waves at the squad while it holds the command deck for the uplink.
// The horde (config HORDE): at most once a ship. Noise draws it - every sound the squad makes and
// every commotion aboard heats the ship up, and it cools off in the quiet - and while it's hot,
// each second there's a chance it comes: the tracker lights up, a countdown while the squad holds
// (sim/squad.js), then the whole pack out of the vents on both sides of them at once. Own RNG
// stream.
import { HORDE } from '../core/config.js';
import { Rng } from '../core/rng.js';
import { walkLimits } from '../gen/layout.js';
import { enterVent } from './alien.js';

export class Director {
  constructor(world) {
    this.world = world;
    this.phase = 'calm';
    this.timer = 30;
    this.waveT = 0;
    this.spawned = 0;
    this.hordeSize = world.level.horde?.size ?? 0; // the ship's horde, still to come (0: it has been)
    this.horde = null; // under way: { size, left (seconds of warning), phase: 'warn' | 'on', aliens, t }
    this.hordeRng = new Rng(world.level.seed, 'horde');
    this.heat = 0;   // how much of the ship has heard the squad lately (config HORDE)
    this.rollT = 1;  // seconds to the next roll for the horde
    // (An ambush with nothing left to send is no commotion.)
    for (const [ev, n] of Object.entries(HORDE.EVENTS)) world.on(ev, (e) => { if (e?.count !== 0) this.heat += n; });
  }

  /** A noise of radius r (world.noise): the ship heats up. */
  hear(r) { this.heat += r * HORDE.NOISE; }

  /** Vents 1-2 rooms away from the squad that a marine can't currently see into. */
  ventsNear(roomId, minHops = 1, maxHops = 2) {
    const L = this.world.level;
    const hops = new Map([[roomId, 0]]);
    const queue = [roomId];
    while (queue.length) {
      const r = queue.shift();
      if (hops.get(r) >= maxHops) continue;
      for (const pid of L.rooms[r].portals) {
        const p = L.portals[pid];
        const o = p.a === r ? p.b : p.a;
        if (!hops.has(o)) { hops.set(o, hops.get(r) + 1); queue.push(o); }
      }
    }
    return L.vents.filter((v) => {
      const h = hops.get(v.room);
      return h !== undefined && h >= minHops && v.links.length > 0 && !v.welded;
    });
  }

  /** One out of the ducts. `budget`: from the ship's reserve (a horde brings its own). */
  spawnFromVent(vent, targetVentId, type = null, rng = undefined, budget = true) {
    const w = this.world;
    if (budget) {
      if (w.reserve <= 0) return null; // the ship's hostile budget is spent
      w.reserve--;
    }
    const a = w.addAlien(w.breed(vent.x, vent.y, vent.room, 'hunt', type, rng));
    enterVent(w, a, vent.id, targetVentId ?? vent.id);
    // Short duct crawl before emerging - gives the tracker time to ping.
    a.vent.dur = w.rng.float(2.5, 5);
    this.spawned++;
    return a;
  }

  activeHunters() {
    return this.world.aliens.filter((a) => a.alive && a.state !== 'dormant').length;
  }

  /** Is the squad holding for a horde (warned, or it's still coming out of the vents)? */
  get bracing() {
    const h = this.horde;
    return !!h && (h.phase === 'warn' || h.aliens.some((a) => a.alive && a.state === 'vent'));
  }

  /** The horde's countdown starts (the ship's one horde: never again after this). */
  callHorde(size = this.hordeSize) {
    this.hordesCalled = (this.hordesCalled ?? 0) + 1; // for the debrief's bonus (gen/contracts.js 'quiet')
    const w = this.world;
    this.hordeSize = 0;
    if (size <= 0) return null;
    this.horde = { size, left: w.tuning.hordeWarn ?? HORDE.WARN, phase: 'warn', aliens: [], t: 0 };
    w.emit('horde-warning', { size, seconds: this.horde.left });
    return this.horde;
  }

  /**
   * The ship heats up with noise and cools in the quiet; while it's hot enough, a roll each second
   * for the horde. Its warning runs down, it comes, and it's over when they're all dead (or a
   * minute on).
   */
  updateHorde(dt, lead, room) {
    const w = this.world;
    this.heat *= 0.5 ** (dt / HORDE.HALF);
    const h = this.horde;
    if (h?.phase === 'warn') {
      h.left -= dt;
      if (h.left <= 0) this.unleash(h, lead);
    } else if (h?.phase === 'on') {
      h.t += dt;
      if (h.aliens.every((a) => !a.alive) || h.t > HORDE.OVER) {
        this.horde = null;
        w.emit('horde-over', { count: h.aliens.length });
      }
    } else if (this.hordeSize > 0 && !w.uplink && room.dist >= 2 && room.type !== 'cockpit' && (this.rollT -= dt) <= 0) {
      this.rollT = 1;
      // How often hordes come (meta/difficulty.js): sooner and likelier, or later and rarer.
      const f = w.level.mods?.hordes ?? 1;
      const p = Math.min(HORDE.CHANCE * f, (this.heat - HORDE.START / f) * f / HORDE.PER);
      if (p > 0 && this.hordeRng.chance(p)) this.callHorde();
    }
  }

  /**
   * The horde comes: out of the vents in the squad's room and the rooms either side, alternating
   * sides of the squad where it can, in a stream a few seconds long - mostly runners and drones
   * (HORDE.TYPES). No vents left (all welded)? Then through the doors at both ends of the room.
   */
  unleash(h, lead) {
    const w = this.world;
    const rng = this.hordeRng;
    const mid = w.squad.order.reduce((sum, m) => sum + m.x, 0) / w.squad.order.length;
    const vents = this.ventsNear(lead.room, 0, 2);
    const sides = [vents.filter((v) => v.x < mid), vents.filter((v) => v.x >= mid)];
    const room = w.level.rooms[lead.room];
    const [wl, wr] = walkLimits(room);
    const types = Object.entries(HORDE.TYPES);
    for (let i = 0; i < h.size; i++) {
      const pool = sides[i % 2].length ? sides[i % 2] : sides[1 - (i % 2)];
      const type = rng.weighted(types);
      let a;
      if (pool.length) {
        const v = rng.pick(pool);
        a = this.spawnFromVent(v, v.id, type, rng, false);
        a.vent.dur = 0.6 + i * HORDE.EMERGE; // out together, not one by one
      } else {
        a = w.addAlien(w.breed(i % 2 ? wr - 0.4 : wl + 0.4, room.y0, room.id, 'hunt', type, rng));
        a.wakeT = 0.3 + i * HORDE.EMERGE;
      }
      a.horde = true;
      h.aliens.push(a);
    }
    h.phase = 'on';
    w.emit('horde', { count: h.aliens.length });
  }

  update(dt) {
    const w = this.world;
    const lead = w.squad.leader;
    if (!lead) return;
    const room = w.level.rooms[lead.room];
    this.updateHorde(dt, lead, room);

    if (w.uplink) {
      this.waveT -= dt;
      if (this.waveT <= 0 && this.activeHunters() < 9) {
        this.waveT = w.tuning.waveEvery;
        const vents = this.ventsNear(lead.room, 1, 2);
        const n = w.rng.int(1, 2);
        for (let i = 0; i < n && vents.length; i++) {
          const v = w.rng.pick(vents);
          const into = w.level.vents.filter((o) => !o.welded && (o.room === lead.room || v.links.includes(o.id)));
          this.spawnFromVent(v, (into.length ? w.rng.pick(into) : v).id);
        }
        w.emit('wave', {});
      }
      return;
    }

    if (room.dist < 2 || this.horde) return; // grace period near the airlock; no ambush on top of a horde
    const fighting = w.squad.engaged || this.activeHunters() > 0;
    this.timer -= fighting ? dt * 0.2 : dt;
    if (this.phase === 'calm' && this.timer <= 0) {
      this.phase = 'build';
      this.timer = w.rng.float(4, 7);
      w.emit('buildup', {});
    } else if (this.phase === 'build' && this.timer <= 0) {
      const progress = room.dist / Math.max(1, Math.max(...w.level.rooms.map((r) => r.dist)));
      const n = Math.min(w.reserve, 1 + Math.floor(progress * 2.5 + w.rng.next() * w.tuning.ambushBonus));
      const vents = this.ventsNear(lead.room, 1, 2);
      // Some ambushes come straight out of the ceiling above the squad.
      const overhead = w.level.vents.filter((v) => v.room === lead.room && v.ceiling && !v.welded);
      for (let i = 0; i < n && vents.length; i++) {
        const v = w.rng.pick(vents);
        const drop = overhead.length && w.rng.chance(0.45) ? w.rng.pick(overhead) : null;
        const toward = w.level.vents.filter((o) => v.links.includes(o.id) && !o.welded);
        this.spawnFromVent(v, drop ? drop.id : toward.length ? w.rng.pick(toward).id : v.id);
      }
      w.emit('ambush', { count: n });
      this.phase = 'calm';
      this.timer = w.rng.float(w.tuning.calm[0], w.tuning.calm[1]);
    }
  }
}
