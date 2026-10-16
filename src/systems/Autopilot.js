// Demo mode: drives the marine through the mission without a controller. Sweeps towards the bridge,
// rescues survivors on the way, grabs loot it passes, takes the log, returns to the Kestrel. It
// writes a virtual controller state; a human touching the keys or pad takes over for a while.
import { NavAgent } from './Nav.js';
import { TILE } from '../gen/Ship.js';

export class Autopilot {
  constructor(game) {
    this.game = game;
    this.nav = new NavAgent(game.world, game.physics);
    this.v = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, aiming: false, fire: 0, shield: 0, jump: false, dodge: false, weapon: false, interact: false, reload: false, medkit: false };
    this.plan = null; this.planT = 0; this.interactT = 0; this.dodgeT = 0; this.waitT = 0; this.label = '';
    this.visited = new Set();
    this.lootT = 0;
  }

  // Where to go next: survivor to rescue → loot nearby → the log → the airlock.
  choose() {
    const g = this.game, p = g.player, ship = g.ship;
    const here = g.world.roomIdAt(p.x, p.y + 4);
    if (p.dead) return null;
    if (p.hasLog) {
      const air = ship.rooms[ship.airlock];
      return { kind: 'extract', x: ship.start.x + 40, y: ship.start.y, room: air.id, label: 'Return to the Kestrel' };
    }
    // nearby survivor (by graph distance)
    const cands = [];
    for (const s of g.survivors) if (s.state === 'cower' && s.alive) cands.push({ kind: 'survivor', x: s.body.x, y: s.body.y, room: g.world.roomIdAt(s.body.x, s.body.y + 4), d: g.director.roomDistance(here, g.world.roomIdAt(s.body.x, s.body.y + 4)), who: s, label: `Rescue ${s.name}` });
    for (const k of g.pickups) if (k.alive && k.kind !== 'log') cands.push({ kind: 'loot', x: k.x, y: k.y, room: k.room, d: g.director.roomDistance(here, k.room) + 0.5, who: k, label: 'Grab supplies' });
    const log = g.pickups.find((k) => k.alive && k.kind === 'log');
    if (log) cands.push({ kind: 'log', x: log.x, y: log.y, room: log.room, d: g.director.roomDistance(here, log.room) + 1.5, who: log, label: 'Retrieve the ship\'s log' });
    cands.sort((a, b) => a.d - b.d);
    return cands[0] || null;
  }

  update(dt, input) {
    const g = this.game, p = g.player, v = this.v;
    v.moveX = 0; v.moveY = 0; v.jump = false; v.dodge = false; v.interact = false; v.reload = false; v.medkit = false; v.weapon = false; v.fire = 0; v.shield = 0; v.aiming = false;
    if (p.dead) return;
    this.planT -= dt;
    if (!this.plan || this.planT <= 0 || (this.plan.who && (this.plan.who.alive === false || (this.plan.who.state && this.plan.who.state !== 'cower')))) {
      this.plan = this.choose(); this.planT = 2.5;
      if (this.plan) this.nav.setGoal(this.plan.x, this.plan.y, this.plan.room);
    }
    if (!this.plan) return;
    this.label = this.plan.label;
    const it = this.nav.update(p.body, dt);
    // threats: hold ground and shoot when a hostile is close; dodge back when one is on us
    const threat = g.aliens.filter((a) => a.alive && !a.hidden && a.visibleToPlayer && Math.hypot(a.cx - p.cx, a.cy - p.cy) < 260);
    const closest = threat.sort((a, b) => Math.hypot(a.cx - p.cx, a.cy - p.cy) - Math.hypot(b.cx - p.cx, b.cy - p.cy))[0];
    this.dodgeT -= dt;
    if (closest) {
      const d = Math.hypot(closest.cx - p.cx, closest.cy - p.cy);
      const dir = Math.sign(closest.cx - p.cx) || 1;
      if (d < 70 && closest.state === 'attack' && this.dodgeT <= 0 && p.body.onGround) { v.dodge = true; this.dodgeT = 1.4; }
      else if (d < 60 && this.dodgeT <= 0) { v.shield = 1; v.moveX = -dir * 0.5; }
      else if (d < 120) v.moveX = -dir * 0.6;
      else if (p.state !== 'ladder') v.moveX = it.moveX * 0.4;
      if (p.state === 'ladder') { v.moveY = it.moveY; v.moveX = it.moveX; }
    } else {
      v.moveX = it.moveX; v.moveY = it.moveY; v.jump = it.jump;
    }
    // ammo and health
    if (p.ammo.mag < p.weaponDef.mag * 0.3 && p.ammo.reserve > 0 && !p.reload && !closest) v.reload = true;
    if (p.hp < 45 && p.medkits > 0 && p.healing <= 0 && !closest) v.medkit = true;
    if (p.ammo.mag === 0 && p.ammo.reserve === 0) v.weapon = true;
    // interact at the goal
    this.interactT -= dt;
    if (this.plan.who && this.plan.who.interact && this.plan.kind !== 'loot' && Math.abs(p.x - this.plan.x) < 30 && Math.abs(p.y - this.plan.y) < 40 && this.interactT <= 0) { v.interact = true; this.interactT = 0.6; }
    if (this.plan.kind === 'extract' && Math.abs(p.x - this.plan.x) < 40 && Math.abs(p.y - this.plan.y) < 40 && this.interactT <= 0) {
      // wait for followers
      const pending = g.survivors.filter((s) => s.state === 'follow' && s.alive);
      if (!pending.length || this.waitT > 20) { v.interact = true; this.interactT = 0.6; } else this.waitT += dt;
    }
    if (this.nav.arrived && this.plan.kind === 'loot') { this.planT = 0; }
    input.virtual = v;
  }
}
