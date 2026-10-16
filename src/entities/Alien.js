// Xenomorph-style hostiles. They lurk in hives and vents, travel the vent network between rooms,
// hunt on the deck (walk, run, crawl when wounded), swipe at reach, and bleed acid.
import { Body } from '../core/Physics.js';
import { Character } from '../core/Models.js';
import { NavAgent, walk } from '../systems/Nav.js';
import { TILE } from '../gen/Ship.js';

export const ALIEN_HP = 60;
let nextId = 1;

export class Alien {
  constructor(game, model, { x, y, state = 'lurk', vent = null }) {
    this.game = game;
    this.id = nextId++;
    this.body = new Body(x, y, 22, 50);
    this.char = new Character(model);
    this.char.group.position.set(x, y, 0);
    game.renderer.scene.add(this.char.group);
    this.nav = new NavAgent(game.world, game.physics);
    this.hp = ALIEN_HP; this.alive = true;
    this.state = state;                     // lurk | vent | emerge | hunt | attack | hurt | dead
    this.hidden = state === 'vent';
    this.vent = vent;                       // vent spot {c, r} when in the network / emerging
    this.t = 0; this.stateT = 0;
    this.facing = Math.random() < 0.5 ? -1 : 1;
    this.target = null;
    this.attackT = 0; this.hitDone = false;
    this.speed = 0;
    this.visibleToPlayer = false;
    this.deadT = 0; this.removed = false;
    this.crawl = false;
    this.hissT = Math.random() * 4;
    this.ventT = 0; this.ventFrom = null;
    this.noiseHeard = -99;
    this.lastSeenPlayer = -99;
    this.char.group.visible = !this.hidden;
    if (state === 'lurk') this.char.play('lurk', { fade: 0 });
  }

  get cx() { return this.body.x; }
  get cy() { return this.body.y + this.body.h * 0.5; }
  get headY() { return this.body.y + this.body.h * 0.78; }

  damage(amount, { crit = false, dx = 0, dy = 0, from } = {}) {
    if (!this.alive) return;
    const g = this.game;
    this.hp -= amount;
    this.char.hitFlash(0.07);
    g.fx.acid(this.cx, this.cy + (crit ? 10 : 0), -dx, -dy, crit ? 14 : 7);
    g.fx.number(this.cx, this.body.top + 4, crit ? `${Math.round(amount)} CRIT` : `${Math.round(amount)}`, crit ? 0xffd34a : 0xe8f0ff, crit);
    g.audio.play('hit_flesh', { variants: 2, volume: 0.6, x: this.cx, minGap: 30 });
    if (from && from.hits !== undefined) from.hits++;
    if (this.state === 'lurk' || this.state === 'vent') this.wake();
    if (this.hp <= 0) { this.die(dx, dy, from); return; }
    if (crit) g.fx.hitStop(0.05);
    if (this.hp < ALIEN_HP * 0.3) this.crawl = true;
    if (this.state !== 'attack' && this.state !== 'emerge' && Math.random() < (crit ? 0.8 : 0.25)) {
      this.state = 'hurt'; this.stateT = 0.3; this.char.play('hurt', { fade: 0.03, restart: true });
      this.body.vx += dx * 90;
    }
    g.audio.play('alien_hurt', { volume: 0.6, x: this.cx, minGap: 120 });
  }

  die(dx = 0, dy = 0, from) {
    const g = this.game;
    this.alive = false; this.state = 'dead'; this.deadT = 0;
    this.char.play('death', { fade: 0.04, restart: true });
    this.char.aimAngle = 0;
    this.body.vx = dx * 120; this.body.vy = Math.max(this.body.vy, 80);
    g.fx.acid(this.cx, this.cy, -dx, -dy, 26, true);
    g.fx.acidPool(this.cx, this.body.y, 34);
    g.fx.hitStop(0.09);
    g.fx.shake(3, 0.2);
    g.audio.play('alien_death', { volume: 0.9, x: this.cx });
    g.audio.play('kill', { volume: 0.5 });
    g.director.onKill(this);
    if (from && from.kills !== undefined) from.kills++;
  }

  wake() {
    if (this.state === 'lurk') { this.state = 'hunt'; this.stateT = 0; this.game.audio.play('alien_hiss', { volume: 0.7, x: this.cx }); }
    else if (this.state === 'vent') { this.ventT = Math.min(this.ventT, 0.6); }
  }

  // Enter the vent network from a vent grille above (or wherever we are, if spawned there).
  enterVent(spot) {
    const g = this.game;
    this.state = 'vent'; this.hidden = true; this.char.group.visible = false;
    this.vent = spot; this.ventFrom = spot; this.ventT = 1.4 + Math.random() * 1.2;
    g.audio.play('vent_clang', { volume: 0.7, x: spot.c * TILE });
    g.fx.dust(spot.c * TILE + TILE / 2, spot.r * TILE, 6);
  }

  // Leave the network through a grille: drop out of the ceiling tile and fall to the floor.
  emergeAt(spot) {
    const g = this.game;
    this.vent = spot;
    this.body.x = spot.c * TILE + TILE / 2; this.body.y = spot.r * TILE - this.body.h + 4;
    this.body.vx = 0; this.body.vy = -60;
    this.hidden = false; this.char.group.visible = true;
    this.state = 'emerge'; this.stateT = 0; this.crawl = true;
    this.char.play('crawl', { fade: 0, restart: true });
    g.audio.play('vent_clang', { volume: 0.9, x: this.body.x });
    g.fx.dust(this.body.x, spot.r * TILE, 10);
  }

  update(dt) {
    const g = this.game, b = this.body, ph = g.physics, p = g.player;
    this.t += dt; this.stateT += dt;
    this.hissT -= dt;
    if (this.state === 'dead') {
      this.deadT += dt;
      b.vx *= 0.85;
      ph.step(b, dt);
      if (this.deadT > 8) { this.removed = true; g.renderer.scene.remove(this.char.group); }
      this.syncVisual(dt);
      return;
    }
    if (this.state === 'vent') {
      this.ventT -= dt;
      if (this.ventT <= 0) {
        const spot = g.director.ventNear(p, this);
        if (spot) this.emergeAt(spot); else this.ventT = 1.5;
      }
      return;
    }
    const dxp = p.cx - this.cx, dyp = p.cy - this.cy;
    const distP = Math.hypot(dxp, dyp);
    const sameRoom = g.world.roomIdAt(b.x, b.y + 4) === g.world.roomIdAt(p.x, p.y + 4);
    const seesPlayer = !p.dead && distP < 520 && ph.lineOfSight(this.cx, this.cy, p.cx, p.cy);
    if (seesPlayer) this.lastSeenPlayer = this.t;
    const alertRange = 420;
    switch (this.state) {
      case 'lurk': {
        b.vx = 0;
        if ((distP < alertRange && seesPlayer) || (sameRoom && distP < 260) || this.noiseHeard > this.t - 1.5) {
          this.state = 'hunt'; this.stateT = 0;
          g.audio.play('alien_screech', { volume: 0.8, x: this.cx, minGap: 400 });
        }
        break;
      }
      case 'emerge': {
        if (b.onGround && this.stateT > 0.25) { this.state = 'hunt'; this.stateT = 0; this.crawl = this.hp < ALIEN_HP * 0.3; }
        break;
      }
      case 'hurt': {
        b.vx *= 0.8;
        if (this.stateT > 0.3) { this.state = 'hunt'; this.stateT = 0; }
        break;
      }
      case 'attack': {
        b.vx *= 0.7;
        for (const e of this.char.events) {
          if (e.clip === 'attack' && e.name === 'hit' && !this.hitDone) {
            this.hitDone = true;
            this.swipe();
          }
        }
        if (this.char.finished() || this.stateT > 0.9) { this.state = 'hunt'; this.stateT = 0; this.attackT = 0.5 + Math.random() * 0.4; }
        break;
      }
      case 'hunt': {
        this.attackT -= dt;
        // choose a victim: a survivor within reach is easier prey than the marine
        let victim = p;
        for (const s of g.survivors) if (s.alive && s.state !== 'cower' && Math.hypot(s.cx - this.cx, s.cy - this.cy) < Math.min(distP, 90)) victim = s;
        const dx = victim.cx - this.cx, dy = victim.cy - this.cy;
        const d = Math.hypot(dx, dy);
        if (d < 46 && Math.abs(dy) < 56 && this.attackT <= 0 && b.onGround && !victim.dead && victim.alive !== false) {
          this.state = 'attack'; this.stateT = 0; this.hitDone = false; this.victim = victim;
          this.facing = dx >= 0 ? 1 : -1;
          this.char.play('attack', { fade: 0.03, restart: true });
          g.audio.play('alien_attack', { volume: 0.8, x: this.cx });
          break;
        }
        // navigation
        const myRoom = g.world.roomIdAt(b.x, b.y + 4), pRoom = g.world.roomIdAt(p.x, p.y + 4);
        if (myRoom === pRoom || (seesPlayer && Math.abs(dyp) < 70)) {
          // direct pursuit on this deck
          this.nav.clear();
          const far = Math.abs(dxp) > 24;
          const run = distP < 380 || this.lastSeenPlayer > this.t - 2;
          const speed = this.crawl ? 120 : run ? 250 : 110;
          const want = far ? Math.sign(dxp) * speed : 0;
          b.vx += (want - b.vx) * Math.min(1, dt * (b.onGround ? 10 : 3));
          if (b.hitWall && b.onGround && this.stuckT > 0.3) { b.vy = 480; this.stuckT = 0; }
          this.stuckT = (Math.abs(b.vx) < 10 && far) ? (this.stuckT || 0) + dt : 0;
          if (dyp > 60 && Math.abs(dxp) < 40 && b.onGround && this.stuckT > 0.5) b.vy = 560;
        } else {
          // another room: vents if we have one here and the way is long, else walk the graph
          const path = g.director.roomDistance(myRoom, pRoom);
          const room = g.ship.rooms[myRoom];
          const ventHere = room && room.vents.length ? g.director.ventSpotInRoom(room) : null;
          if (ventHere && (path > 1 || this.stuckT > 1.5) && this.stateT > 0.8) {
            const vx = ventHere.c * TILE + TILE / 2;
            if (Math.abs(vx - b.x) < 10 && b.onGround) { this.enterVent(ventHere); break; }
            this.nav.setGoal(vx, room.y0 * TILE, myRoom);
          } else {
            this.nav.setGoal(p.x, p.y, pRoom);
          }
          const it = this.nav.update(b, dt);
          const speed = this.crawl ? 120 : this.lastSeenPlayer > this.t - 3 ? 250 : 150;
          walk(b, it, dt, ph, { speed, climb: 150 });
          this.walked = true;
          this.stuckT = this.nav.stuckT;
        }
        if (Math.abs(b.vx) > 8) this.facing = b.vx > 0 ? 1 : -1;
        else if (seesPlayer) this.facing = dxp >= 0 ? 1 : -1;
        if (this.hissT <= 0 && seesPlayer) { this.hissT = 3 + Math.random() * 5; g.audio.play('alien_hiss', { volume: 0.5, x: this.cx, minGap: 300 }); }
        break;
      }
    }
    // doors open for aliens too
    for (const d of g.world.doors) if (Math.abs(d.x - b.x) < 44 && b.y >= d.y - 40 && b.y <= d.y + 70) g.world.requestOpen(d, 0.5);
    // crawl height
    const wantH = this.crawl ? 32 : 50;
    if (b.h !== wantH) { if (wantH < b.h || !ph.solidTile(Math.floor(b.x / TILE), Math.floor((b.y + wantH) / TILE), b, 'up')) b.h = wantH; }
    if (this.walked) this.walked = false;
    else if (!b.onLadder) ph.step(b, dt); else b.y += b.vy * dt;
    this.speed = Math.abs(b.vx);
    this.syncVisual(dt);
  }

  swipe() {
    const g = this.game;
    const v = this.victim || g.player;
    const dx = v.cx - this.cx, dy = v.cy - this.cy;
    if (Math.hypot(dx, dy) < 58 && Math.sign(dx || this.facing) === this.facing) {
      if (v === g.player) {
        g.player.damage(18, { from: this, kind: 'melee' });
        g.fx.slash(v.cx, v.cy, this.facing);
      } else v.damage(25, { from: this });
    }
  }

  syncVisual(dt) {
    const b = this.body, ch = this.char;
    ch.group.position.set(b.x, b.y, 0);
    ch.setFacing(this.facing);
    if (this.state === 'hunt' || this.state === 'emerge') {
      const s = Math.abs(b.vx);
      if (b.onLadder) { ch.play('crawl', { fade: 0.1 }); ch.setTimeScale(Math.max(0.3, Math.abs(b.vy) / 120)); }
      else if (!b.onGround && this.state !== 'emerge') { ch.play('crawl', { fade: 0.1 }); ch.setTimeScale(0.6); }
      else if (s > 8) {
        const clip = this.crawl ? 'crawl' : s > 170 ? 'run' : 'walk';
        const ref = this.crawl ? 120 : s > 170 ? 260 : 110;
        ch.play(clip, { fade: 0.1 }); ch.setTimeScale(Math.max(0.4, s / ref));
      } else { ch.play(this.crawl ? 'crawl' : 'idle', { fade: 0.15 }); ch.setTimeScale(this.crawl ? 0.2 : 1); }
    } else if (this.state === 'lurk') ch.play('lurk', { fade: 0.2 });
    ch.update(dt);
    for (const e of ch.events) if (e.name === 'step' && b.onGround && this.visibleToPlayer) this.game.audio.play('step', { variants: 2, volume: 0.2, rate: 1.4, x: b.x, minGap: 100 });
  }
}
