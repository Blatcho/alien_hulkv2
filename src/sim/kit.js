// The squad's kit (config KIT): frag grenades, flares, the Defend guns found aboard (world.js
// deployDefence) and the welding charges (door controls and vents - sim/encounters.js). Grenades,
// flares and Defend go on the player's call (the kit buttons), or the squad's own under the Kit
// order 'use': a grenade into a pack (or at something big), a flare into a dark room with
// something in it, the Defend guns down when a horde is about to hit (config DEFEND.AUTO).
// A flare burns on the deck for the rest of the mission: the room is lit - full sight for the
// squad in it, and torch-shy creepers hang back (alien.js lit()).
import { DEFEND, GRENADE } from '../core/config.js';
import { walkLimits } from '../gen/layout.js';
import { bodyPoint } from '../vis/sight.js';

/** A room the squad can't see well in: its power out, dim or flickering lights, or a blackout ship. */
export const darkRoom = (world, room) => !room.flare && (room.powerOut || room.light === 'dim' || room.light === 'flicker' || !!world.level.mods?.blackout);

export class Kit {
  constructor(world) {
    this.world = world;
    this.cool = 0;       // seconds before the squad throws another grenade of its own accord
    this.grenades = [];  // in flight: { x0, y0, x1, y1, h, x, y, t, T, by }
    this.entered = null; // a room the point man just walked into for the first time
    world.on('enter-room', ({ room, first }) => { if (first) this.entered = room; });
  }

  /** The squad uses its kit by itself (the Kit order), or saves it for the player's call. */
  get auto() { return this.world.doctrine?.cfg.kit !== 'save'; }

  /**
   * The best spot for a grenade from marine m: the awake hostile in range and in sight with the
   * most of them around it (big ones count double), nobody of ours - and nothing the squad still
   * needs - near it. { x, y, value } or null.
   */
  aim(m) {
    const w = this.world;
    let best = null;
    for (const a of w.aliens) {
      if (!a.alive || a.state === 'vent' || a.state === 'dormant' || !a.visible) continue;
      const c = bodyPoint(a, 0.5);
      const d = Math.hypot(c.x - m.x, c.y - (m.y + 1.5));
      if (d < GRENADE.RANGE[0] || d > GRENADE.RANGE[1] || !w.physics.los(m.x, m.y + 1.6, c.x, c.y)) continue;
      const near = (o) => o.alive && o.state !== 'rescued' && Math.hypot(o.x - c.x, o.y + 0.9 - c.y) < GRENADE.R + GRENADE.SAFE;
      if (w.marines.some(near) || w.survivors.some(near)) continue;
      // ...nor anything the squad still needs: a terminal or a junction not yet used, the command deck.
      const needed = (p) => p.alive && (p.prop.objective || ((p.prop.encounter === 'terminal' || p.prop.encounter === 'junction') && !p.prop.encounterDone))
        && Math.hypot(p.x - c.x, p.y + 0.6 - c.y) < GRENADE.R + 0.5;
      if (w.props.some(needed)) continue;
      let value = 0;
      for (const o of w.aliens) {
        if (!o.alive || o.state === 'vent') continue;
        const p = bodyPoint(o, 0.5);
        if (Math.hypot(p.x - c.x, p.y - c.y) < GRENADE.R * 0.8) value += o.maxHp >= GRENADE.BIG ? 2 : 1;
      }
      if (!best || value > best.value) best = { x: c.x, y: c.y, value };
    }
    return best;
  }

  /** Frag out: the man with the best throw (on his feet, not reloading) at the best spot. */
  grenade(auto = false) {
    const w = this.world;
    if (w.kit.grenades <= 0 || !w.squad.alive) return false;
    let pick = null;
    for (const m of w.squad.order) {
      if ((m.mode !== 'walk' && m.mode !== 'crouch') || m.reloadT > 0 || m.signalT > 0) continue;
      const t = this.aim(m);
      if (t && (!pick || t.value > pick.t.value)) pick = { m, t };
    }
    if (!pick || (auto && pick.t.value < GRENADE.CLUSTER)) return false;
    const { m, t } = pick;
    w.kit.grenades--;
    m.signalT = 0.5; // the throw
    m.facing = Math.sign(t.x - m.x) || m.facing;
    const x0 = m.x + m.facing * 0.4;
    const y0 = m.y + 1.7;
    const room = w.level.rooms[m.room];
    const h = Math.max(0.2, Math.min(1.2, room.y1 - Math.max(y0, t.y) - 0.4)); // a lob under the deckhead
    const T = GRENADE.FLIGHT * Math.min(1.3, Math.max(0.6, Math.hypot(t.x - x0, t.y - y0) / 9));
    this.grenades.push({ x0, y0, x1: t.x, y1: t.y, h, x: x0, y: y0, t: 0, T, by: m });
    this.cool = GRENADE.COOL;
    w.emit('grenade', { marine: m, x: t.x, y: t.y });
    w.barks.say(m, 'grenade');
    return true;
  }

  /** A flare on the deck ahead of the point man: his room is lit for the rest of the mission. */
  flare() {
    const w = this.world;
    const lead = w.squad.leader;
    if (w.kit.flares <= 0 || !lead) return false;
    const room = w.level.rooms[lead.room];
    if (room.flare) return false;
    const [wl, wr] = walkLimits(room);
    const x = Math.min(wr - 0.5, Math.max(wl + 0.5, lead.x + w.squad.heading * 4));
    w.kit.flares--;
    room.flare = { x, y: room.y0 };
    lead.signalT = Math.max(lead.signalT, 0.4);
    w.emit('flare', { room, x, y: room.y0, marine: lead });
    w.barks.say(lead, 'flare');
    return true;
  }

  update(dt) {
    const w = this.world;
    this.cool -= dt;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.t += dt;
      const k = Math.min(1, g.t / g.T);
      g.x = g.x0 + (g.x1 - g.x0) * k;
      g.y = g.y0 + (g.y1 - g.y0) * k + g.h * 4 * k * (1 - k);
      if (k < 1) continue;
      this.grenades.splice(i, 1);
      w.hazards.explode(g.x1, g.y1, g.by, { r: GRENADE.R, damage: GRENADE.DAMAGE, noise: GRENADE.NOISE, grenade: true });
    }
    const room = this.entered;
    this.entered = null;
    if (!this.auto || !w.squad.alive) return;
    // A horde about to hit: guns down either side.
    const h = w.director.horde;
    if (h?.phase === 'warn' && !h.defended && h.left <= DEFEND.AUTO && w.kit.defend > 0) w.deployDefence();
    // A pack bunched up (or something big) in the open: frag out.
    if (this.cool <= 0 && w.squad.engaged && w.kit.grenades > 0 && !this.grenade(true)) this.cool = 0.5;
    // Into a dark room with something in it (a nest, the command deck): light it up.
    if (room && w.kit.flares > 0 && darkRoom(w, room) && room.id === w.squad.leader.room
      && (room.nest || room.type === 'cockpit' || w.aliens.some((a) => a.alive && a.room === room.id && a.state !== 'dormant' && a.state !== 'vent'))) this.flare();
  }
}
