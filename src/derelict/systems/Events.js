// Ship events: fires that burn in engine spaces and hurt whoever stands in them, and a blackout
// that kills the lights across the ship when the marine enters a certain room.
import { TILE } from '../gen/Ship.js';

export class Events {
  constructor(game) {
    this.game = game;
    this.fires = []; this.blackoutRec = null; this.blackoutDone = false; this.blackoutT = 0;
    for (const e of game.ship.events) {
      if (e.kind === 'fire') this.fires.push({ x: e.x, y: e.y, room: e.room, t: Math.random() * 10, heat: 1 });
      if (e.kind === 'blackout') this.blackoutRec = e;
    }
    this.announcedFire = false;
  }

  update(dt) {
    const g = this.game, p = g.player, fx = g.fx;
    let nearestFire = Infinity;
    for (const f of this.fires) {
      f.t += dt;
      const d = Math.hypot(f.x - p.cx, f.y - p.cy);
      nearestFire = Math.min(nearestFire, d);
      if (g.renderer.onScreen(f.x, f.y, 100)) {
        if (Math.random() < dt * 40) fx.flame(f.x + (Math.random() - 0.5) * 26, f.y + 2, 1);
        if (Math.random() < dt * 5) fx.smoke(f.x + (Math.random() - 0.5) * 20, f.y + 24, 1);
      }
      if (!p.dead && Math.abs(p.x - f.x) < 22 && Math.abs(p.y - f.y) < 40) {
        f.hurtT = (f.hurtT || 0) + dt;
        if (f.hurtT > 0.35) { f.hurtT = 0; p.damage(6, { acid: true }); }
      }
      for (const a of g.aliens) if (a.alive && !a.hidden && Math.abs(a.cx - f.x) < 20 && Math.abs(a.body.y - f.y) < 40 && Math.random() < dt * 3) a.damage(8, { dx: 0, dy: 1 });
      if (!this.announcedFire && d < 300 && g.world.roomIdAt(p.x, p.y + 4) === f.room) { this.announcedFire = true; g.barks.say(p, 'Fire. Watch your step.', 1.8); }
    }
    g.audio.loop('fire', nearestFire < 420 ? Math.max(0, 1 - nearestFire / 420) * 0.8 : 0);
    // blackout
    if (this.blackoutRec && !this.blackoutDone) {
      if (g.world.roomIdAt(p.x, p.y + 4) === this.blackoutRec.room && g.time > 6) {
        this.blackoutDone = true; this.blackoutT = this.blackoutRec.duration / 1000;
        g.world.setBlackout(this.blackoutT);
        g.audio.play('power_down', { volume: 1 });
        g.barks.say(p, 'Power\'s gone. Switching to lamp.', 2.2, 0.8);
        g.director.onBlackout();
      }
    }
    if (this.blackoutT > 0) {
      this.blackoutT -= dt;
      g.audio.loop('alarm', 0.35);
      if (this.blackoutT <= 0) { g.audio.play('power_up', { volume: 0.8 }); g.barks.say(p, 'Lights are back.', 1.4); }
    } else g.audio.loop('alarm', 0);
  }

  collectLights(out) {
    for (const f of this.fires) {
      const flick = 0.75 + 0.25 * Math.sin(f.t * 23) * Math.sin(f.t * 7.3);
      out.push({ x: f.x, y: f.y + 18, z: 24, color: 0xff8a30, intensity: 1.4 * flick, range: 170, priority: 0.5 });
    }
  }
}
