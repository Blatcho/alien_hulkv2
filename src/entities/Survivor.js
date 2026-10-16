// Crew survivors: found cowering, rescued with X, then they follow the marine to the Kestrel.
import { Body } from '../core/Physics.js';
import { Character } from '../core/Models.js';
import { NavAgent, walk } from '../systems/Nav.js';
import { TILE } from '../gen/Ship.js';

const LINES_RESCUE = ['Oh thank god. Get me out of here.', 'They came through the vents…', 'I\'m right behind you, Sergeant.', 'Don\'t leave me here.'];
const LINES_FOLLOW = ['Behind you!', 'Keep moving, keep moving.', 'How far to the ship?', 'Did you hear that?'];

export class Survivor {
  constructor(game, model, rec) {
    this.game = game; this.rec = rec; this.name = rec.name;
    this.body = new Body(rec.x, rec.y, 18, 56);
    this.char = new Character(model);
    this.char.group.position.set(rec.x, rec.y, 0);
    game.renderer.scene.add(this.char.group);
    this.nav = new NavAgent(game.world, game.physics);
    this.state = 'cower';                   // cower | follow | rescued | dead
    this.alive = true; this.hp = 60;
    this.facing = Math.random() < 0.5 ? -1 : 1;
    this.goalT = 0; this.lineT = 6 + Math.random() * 10;
    this.char.play('cower', { fade: 0 });
    this.dead = false;
    this.visibleToPlayer = false;
  }

  get cx() { return this.body.x; }
  get cy() { return this.body.y + this.body.h * 0.5; }
  get interactLabel() { return this.state === 'cower' ? `Rescue ${this.name}` : null; }

  interact() {
    if (this.state !== 'cower') return false;
    this.state = 'follow';
    this.char.play('wave', { fade: 0.1 });
    this.game.barks.say(this, LINES_RESCUE[Math.floor(Math.random() * LINES_RESCUE.length)], 2.4);
    this.game.barks.say(this.game.player, 'Stay behind me.', 1.6, 0.6);
    this.game.audio.play('survivor_rescued', { volume: 0.8 });
    return true;
  }

  damage(amount, { from } = {}) {
    if (!this.alive) return;
    this.hp -= amount;
    this.char.hitFlash(0.08);
    this.game.fx.blood(this.cx, this.cy, 8);
    this.game.audio.play('hit_flesh', { variants: 2, volume: 0.6, x: this.cx });
    if (this.hp <= 0) {
      this.alive = false; this.dead = true; this.state = 'dead';
      this.char.play('death', { fade: 0.05, restart: true });
      this.game.barks.say(this.game.player, `${this.name}… damn it.`, 1.8);
    } else if (this.state === 'follow') this.char.play('hurt', { fade: 0.03, restart: true });
  }

  update(dt) {
    const g = this.game, b = this.body, ph = g.physics, p = g.player;
    if (this.state === 'dead' || this.state === 'rescued') { b.vx *= 0.8; ph.step(b, dt); this.sync(dt); return; }
    if (this.state === 'cower') { b.vx = 0; ph.step(b, dt); this.facing = p.x > b.x ? 1 : -1; this.sync(dt); return; }
    // follow the marine
    this.goalT -= dt;
    const dxp = p.x - b.x, dyp = p.y - b.y;
    const dist = Math.hypot(dxp, dyp);
    const myRoom = g.world.roomIdAt(b.x, b.y + 4), pRoom = g.world.roomIdAt(p.x, p.y + 4);
    let it = { moveX: 0, moveY: 0, jump: false };
    if (myRoom === pRoom && Math.abs(dyp) < 40) {
      this.nav.clear();
      if (Math.abs(dxp) > 46) it.moveX = Math.sign(dxp) * Math.min(1, Math.abs(dxp) / 120 + 0.4);
      if (b.hitWall && b.onGround) it.jump = true;
    } else {
      if (this.goalT <= 0) { this.nav.setGoal(p.x, p.y, pRoom); this.goalT = 0.4; }
      it = this.nav.update(b, dt);
    }
    const speed = dist > 160 ? 200 : 90;
    walk(b, it, dt, ph, { speed, climb: 130 });
    for (const d of g.world.doors) if (Math.abs(d.x - b.x) < 44 && b.y >= d.y - 40 && b.y <= d.y + 70) g.world.requestOpen(d, 0.5);
    if (Math.abs(b.vx) > 8) this.facing = b.vx > 0 ? 1 : -1; else this.facing = dxp >= 0 ? 1 : -1;
    this.lineT -= dt;
    if (this.lineT <= 0) { this.lineT = 9 + Math.random() * 12; if (dist < 300) g.barks.say(this, LINES_FOLLOW[Math.floor(Math.random() * LINES_FOLLOW.length)], 1.8); }
    // reaching the airlock room with the marine there: safe aboard the Kestrel
    const airlock = g.ship.rooms[g.ship.airlock];
    if (myRoom === airlock.id && b.x > (airlock.x1 - 2) * TILE) {
      this.state = 'rescued'; this.alive = true;
      g.player.rescued++;
      g.barks.say(this, 'Going aboard. Thank you.', 1.6);
      g.audio.play('room_clear', { volume: 0.7 });
      this.char.group.visible = false; this.hidden = true;
    }
    this.sync(dt);
  }

  sync(dt) {
    const b = this.body, ch = this.char;
    ch.group.position.set(b.x, b.y, 0);
    ch.setFacing(this.facing);
    if (this.state === 'follow') {
      const s = Math.abs(b.vx);
      if (b.onLadder) { ch.play('walk', { fade: 0.1 }); ch.setTimeScale(Math.abs(b.vy) > 5 ? 1 : 0); }
      else if (!b.onGround) { ch.play('run', { fade: 0.1 }); ch.setTimeScale(0.5); }
      else if (s > 8) { const run = s > 120; ch.play(run ? 'run' : 'walk', { fade: 0.12 }); ch.setTimeScale(Math.max(0.4, s / (run ? 200 : 90))); }
      else if (ch.base === 'wave' && !ch.finished()) { /* keep waving */ }
      else { ch.play('idle', { fade: 0.15 }); ch.setTimeScale(1); }
    }
    ch.update(dt);
  }
}
