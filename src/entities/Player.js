// Sgt. Vance. Controller-first: left stick moves (and sets the speed), right stick aims, LT shield,
// RT fire, A jump, B dodge back, Y weapon, X interact, RB reload, LB medkit. With no stick aim the
// gun tracks the closest hostile on screen and fires at it by itself.
import * as THREE from 'three';
import { Body } from '../core/Physics.js';
import { Character } from '../core/Models.js';
import { T, TILE } from '../gen/Ship.js';

export const WEAPONS = {
  rifle: { name: 'PULSE RIFLE', short: 'RIFLE', rate: 8.5, dmg: 12, mag: 40, reserve: 160, spread: 0.035, speed: 1500, pellets: 1, sfx: 'rifle', kick: 1.6, range: 560, reloadScale: 1.0, auto: true },
  shotgun: { name: 'SHOTGUN', short: 'SHOTGUN', rate: 1.5, dmg: 9, mag: 6, reserve: 30, spread: 0.17, speed: 1200, pellets: 7, sfx: 'shotgun', kick: 6, range: 320, reloadScale: 1.25, auto: false },
  smg: { name: 'SMG', short: 'SMG', rate: 14, dmg: 7, mag: 48, reserve: 240, spread: 0.08, speed: 1400, pellets: 1, sfx: 'smg', kick: 1.0, range: 440, reloadScale: 0.8, auto: true },
};
const ORDER = ['rifle', 'shotgun', 'smg'];
export const WALK = 95, RUN = 230, JUMP = 600, CLIMB = 140;

export class Player {
  constructor(game, model) {
    this.game = game;
    const s = game.ship.start;
    this.body = new Body(s.x, s.y, 20, 58);
    this.char = new Character(model);
    this.char.group.position.set(s.x, s.y, 0);
    game.renderer.scene.add(this.char.group);
    this.name = 'SGT. VANCE';
    this.hp = 100; this.hpMax = 100;
    this.shield = 100; this.shieldMax = 100; this.shieldUp = false; this.shieldCooldown = 0;
    this.weapons = { rifle: { mag: WEAPONS.rifle.mag, reserve: WEAPONS.rifle.reserve } };
    this.weapon = 'rifle';
    this.medkits = 2; this.healing = 0; this.scrap = 0;
    this.state = 'normal';
    this.facing = 1;
    this.aim = { x: 1, y: 0 };
    this.aimMode = 'auto';
    this.target = null; this.targetT = 0;
    this.fireT = 0; this.reload = null; this.dodgeT = 0; this.invuln = 0; this.hurtT = 0;
    this.coyote = 0; this.jumpBuffer = 0; this.jumpHeld = false;
    this.hasLog = false; this.rescued = 0; this.kills = 0; this.shots = 0; this.hits = 0;
    this.dead = false; this.deadT = 0;
    this.lastShotT = 0;
    this.upper = 'none';
    this.muzzle = new THREE.Vector3();
    this.stepFoot = 0;
    this.contactT = 0;
    this.lowAmmoBarked = false;
  }

  get x() { return this.body.x; }
  get y() { return this.body.y; }
  get cx() { return this.body.x; }
  get cy() { return this.body.y + this.body.h * 0.55; }
  get weaponDef() { return WEAPONS[this.weapon]; }
  get ammo() { return this.weapons[this.weapon]; }

  giveWeapon(kind) {
    if (this.weapons[kind]) { this.weapons[kind].reserve = Math.min(WEAPONS[kind].reserve * 2, this.weapons[kind].reserve + WEAPONS[kind].mag * 2); return false; }
    this.weapons[kind] = { mag: WEAPONS[kind].mag, reserve: WEAPONS[kind].reserve };
    this.switchTo(kind);
    return true;
  }

  giveAmmo() {
    const w = this.weaponDef;
    this.ammo.reserve = Math.min(w.reserve * 2, this.ammo.reserve + Math.round(w.mag * 1.5));
    this.lowAmmoBarked = false;
  }

  switchTo(kind) {
    if (!this.weapons[kind] || kind === this.weapon) return;
    this.weapon = kind; this.reload = null; this.fireT = Math.max(this.fireT, 0.25);
    this.game.audio.play('weapon_switch', { volume: 0.7 });
    this.game.barks.say(this, ['Switching.', `${WEAPONS[kind].short}.`][Math.floor(Math.random() * 2)], 1.0);
  }

  cycleWeapon() {
    const owned = ORDER.filter((k) => this.weapons[k]);
    if (owned.length < 2) { this.game.audio.play('ui_back', { volume: 0.4 }); return; }
    const i = owned.indexOf(this.weapon);
    this.switchTo(owned[(i + 1) % owned.length]);
  }

  startReload() {
    if (this.reload || this.dead) return;
    const w = this.weaponDef;
    if (this.ammo.mag >= w.mag || this.ammo.reserve <= 0) { if (this.ammo.reserve <= 0) this.game.audio.play('empty', { volume: 0.6 }); return; }
    const dur = this.char.playUpper('reload', { timeScale: 1 / w.reloadScale });
    this.reload = { t: 0, dur: dur || 1.2, done: false };
    this.upper = 'reload';
    if (Math.random() < 0.5) this.game.barks.say(this, 'Reloading!', 1.0);
  }

  finishReload() {
    const w = this.weaponDef;
    const need = w.mag - this.ammo.mag;
    const take = Math.min(need, this.ammo.reserve);
    this.ammo.mag += take; this.ammo.reserve -= take;
    this.reload = null;
    if (this.ammo.reserve <= 0 && !this.lowAmmoBarked) { this.lowAmmoBarked = true; this.game.barks.say(this, 'Last mag!', 1.4); }
  }

  useMedkit() {
    if (this.medkits <= 0 || this.hp >= this.hpMax || this.healing > 0 || this.dead) { if (this.medkits <= 0) this.game.audio.play('ui_back', { volume: 0.4 }); return; }
    this.medkits--; this.healing = 1.6; this.healAmount = 50;
    this.game.audio.play('medkit', { volume: 0.9 });
    this.game.barks.say(this, 'Patching up.', 1.2);
  }

  damage(amount, { from, acid = false, kind = 'melee' } = {}) {
    if (this.dead || this.invuln > 0) return false;
    const g = this.game;
    if (this.shieldUp && this.shield > 0 && !acid) {
      const absorbed = Math.min(this.shield, amount * 1.15);
      this.shield -= absorbed;
      amount -= absorbed / 1.15;
      g.audio.play('shield_hit', { volume: 0.8 });
      g.fx.shieldHit(this.cx + this.facing * 16, this.cy);
      g.fx.shake(2, 0.15);
      if (amount <= 0.5) { this.shieldCooldown = 1.2; return true; }
    }
    this.hp -= amount;
    this.hurtT = 0.35;
    this.char.hitFlash(0.09);
    g.fx.shake(acid ? 2 : 5, 0.25);
    g.fx.number(this.cx, this.body.top + 6, `-${Math.round(amount)}`, 0xff5a3a);
    g.audio.play('player_hurt', { volume: 0.9, minGap: 200 });
    if (!acid) { this.invuln = 0.35; this.char.playUpper('hurt', { timeScale: 1.4 }); this.upper = 'hurt'; }
    if (this.hp <= 0) this.die();
    else if (this.hp < 30 && Math.random() < 0.5) g.barks.say(this, ['I\'m hit bad!', 'Need a medkit…'][Math.floor(Math.random() * 2)], 1.4);
    return true;
  }

  die() {
    if (this.dead) return;
    this.dead = true; this.state = 'dead'; this.hp = 0;
    this.char.stopUpper(0.05);
    this.char.play('death', { fade: 0.08 });
    this.char.aimAngle = 0;
    this.game.audio.play('player_death', { volume: 1 });
    this.game.fx.shake(8, 0.6);
    this.game.fx.hitStop(0.12);
    this.body.vx = 0;
  }

  // ---------------------------------------------------------------------------------------------
  update(dt, input) {
    const g = this.game, b = this.body, ph = g.physics, ch = this.char;
    if (this.dead) {
      this.deadT += dt;
      b.vx *= 0.8;
      ph.step(b, dt);
      this.syncVisual(dt);
      return;
    }
    const m = ch.meta;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.fireT = Math.max(0, this.fireT - dt);
    this.coyote = b.onGround ? 0.12 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = input.jumpPressed ? 0.14 : Math.max(0, this.jumpBuffer - dt);
    // healing
    if (this.healing > 0) {
      const k = Math.min(dt, this.healing);
      this.hp = Math.min(this.hpMax, this.hp + (this.healAmount / 1.6) * k);
      this.healing -= dt;
    }
    // shield energy
    this.shieldUp = input.shield > 0.4 && this.shield > 0 && this.state !== 'ladder' && this.state !== 'dodge';
    if (this.shieldUp) { this.shield = Math.max(0, this.shield - 26 * dt); this.shieldCooldown = 1.2; if (this.shield <= 0) g.audio.play('power_down', { volume: 0.4, minGap: 800 }); }
    else { this.shieldCooldown = Math.max(0, this.shieldCooldown - dt); if (this.shieldCooldown <= 0) this.shield = Math.min(this.shieldMax, this.shield + 14 * dt); }
    if (input.shield > 0.4 && !this.wasShield && this.shield > 0) g.audio.play('shield_on', { volume: 0.6 });
    this.wasShield = input.shield > 0.4;

    // ---- aiming ----
    this.pickTarget(dt);
    let ax = this.aim.x, ay = this.aim.y;
    if (input.aiming) {
      const l = Math.hypot(input.aimX, input.aimY) || 1;
      ax = input.aimX / l; ay = input.aimY / l; this.aimMode = 'stick';
    } else if (input.mouseAim && input.mouse) {
      const w = g.renderer.screenToWorld(input.mouse.x, input.mouse.y);
      const dx = w.x - this.cx, dy = w.y - this.cy, l = Math.hypot(dx, dy) || 1;
      ax = dx / l; ay = dy / l; this.aimMode = 'mouse';
    } else if (this.target) {
      const dx = this.target.cx - this.cx, dy = this.target.cy - this.cy, l = Math.hypot(dx, dy) || 1;
      ax = dx / l; ay = dy / l; this.aimMode = 'auto';
    } else {
      // relax towards level, keep facing
      const dir = input.moveX !== 0 ? Math.sign(input.moveX) : this.facing;
      ax = dir; ay = this.aim.y * Math.max(0, 1 - dt * 4); this.aimMode = 'none';
      const l = Math.hypot(ax, ay) || 1; ax /= l; ay /= l;
    }
    this.aim.x = ax; this.aim.y = ay;

    // ---- state machine ----
    const speedWanted = Math.abs(input.moveX) > 0.62 ? RUN : WALK;
    if (this.state === 'dodge') {
      this.dodgeT -= dt;
      if (this.dodgeT <= 0) { this.state = 'normal'; this.invuln = 0.05; }
      b.vx = -this.facing * 360 * Math.max(0.25, this.dodgeT / 0.26);
    } else if (this.state === 'ladder') {
      const lad = b.ladder;
      b.vx = 0; b.x += (lad.x - b.x) * Math.min(1, dt * 14);
      b.vy = input.moveY * CLIMB;
      if (input.moveX !== 0 && Math.abs(input.moveY) < 0.3 && this.ladderT > 0.2) { b.vx = input.moveX * WALK; }
      this.ladderT += dt;
      // exits
      const topY = lad.yTop, botY = lad.yBottom;
      if (b.y >= topY - 1 && input.moveY > 0) { b.y = topY; this.leaveLadder(); b.onGround = true; }
      else if (b.y <= botY + 1 && input.moveY < 0) { b.y = botY; this.leaveLadder(); }
      else if (this.jumpBuffer > 0) { this.leaveLadder(); b.vy = JUMP * 0.55; b.vx = input.moveX * RUN * 0.6; this.jumpBuffer = 0; g.audio.play('jump', { volume: 0.5 }); }
      else if (input.moveX !== 0 && Math.abs(input.moveY) < 0.3 && this.ladderT > 0.35) {
        this.leaveLadder(); b.vx = input.moveX * WALK;
        if (b.y < lad.yTop && b.y > lad.yTop - TILE) b.y = lad.yTop - TILE - 1;      // drop clear of the hatch slab
      }
    } else {
      // ground / air movement
      const accel = b.onGround ? 2600 : 1400;
      const want = input.moveX * speedWanted * (this.shieldUp ? 0.55 : 1) * (this.healing > 0 ? 0.7 : 1);
      if (want > b.vx) b.vx = Math.min(want, b.vx + accel * dt);
      else if (want < b.vx) b.vx = Math.max(want, b.vx - accel * dt);
      if (input.moveX === 0 && b.onGround) b.vx *= Math.max(0, 1 - dt * 18);
      // jump
      if (this.jumpBuffer > 0 && this.coyote > 0) {
        b.vy = JUMP; b.onGround = false; this.coyote = 0; this.jumpBuffer = 0; this.jumpHeld = true;
        g.audio.play('jump', { volume: 0.5 });
        ch.play('jump', { fade: 0.05 });
      }
      if (this.jumpHeld && !input.jump && b.vy > 180) { b.vy *= 0.55; this.jumpHeld = false; }
      if (!input.jump) this.jumpHeld = false;
      // ladders
      if (Math.abs(input.moveY) > 0.45) {
        const lad = ph.ladderNear(b, input.moveY > 0);
        if (lad) this.enterLadder(lad, input.moveY > 0);
      }
      // dodge
      if (input.dodgePressed && b.onGround && this.state === 'normal') {
        this.state = 'dodge'; this.dodgeT = 0.26; this.invuln = 0.3; this.reload = null; this.char.stopUpper(0.05); this.upper = 'none';
        ch.play('dodge', { fade: 0.03, restart: true }); g.audio.play('dodge', { volume: 0.7 });
      }
    }

    // ---- buttons ----
    if (input.weaponPressed) this.cycleWeapon();
    if (input.reloadPressed) this.startReload();
    if (input.medkitPressed) this.useMedkit();
    if (this.reload) {
      this.reload.t += dt;
      for (const e of ch.events) if (e.clip === 'reload' && e.name === 'mag_out') g.audio.play('reload_out', { volume: 0.8 });
      for (const e of ch.events) if (e.clip === 'reload' && e.name === 'mag_in' && !this.reload.done) { this.reload.done = true; g.audio.play('reload_in', { volume: 0.8 }); this.finishReload(); }
      if (this.reload && this.reload.t >= this.reload.dur) { if (!this.reload.done) this.finishReload(); this.reload = null; }
    }
    // ---- facing ----
    const prevFacing = this.facing;
    if (this.state !== 'dodge') {
      if (this.aimMode !== 'none' && Math.abs(ax) > 0.15) this.facing = ax > 0 ? 1 : -1;
      else if (input.moveX !== 0) this.facing = input.moveX > 0 ? 1 : -1;
    }
    // ---- firing ----
    const w = this.weaponDef;
    const canFire = this.state !== 'dodge' && !this.reload && this.fireT <= 0 && this.healing <= 0;
    const wantsFire = input.fire > 0.5 || (this.aimMode === 'auto' && this.target && this.targetInRange()) || (this.aimMode !== 'auto' && this.target && this.targetInRange() && this.aimedAtTarget());
    const brawler = this.target && this.target.alive && Math.abs(this.target.cx - this.cx) < 36 && Math.abs(this.target.cy - this.cy) < 44 && this.state !== 'ladder';
    if (brawler && this.state !== 'dodge' && this.strikeT <= 0 && this.healing <= 0) this.strike();
    else if (canFire && wantsFire) {
      if (this.ammo.mag <= 0) { if (this.ammo.reserve > 0) this.startReload(); else { g.audio.play('empty', { volume: 0.6, minGap: 250 }); this.fireT = 0.3; } }
      else if (w.auto || !this.firedHeld || this.aimMode === 'auto') this.fire();
    }
    this.firedHeld = input.fire > 0.5;
    this.strikeT = Math.max(0, (this.strikeT || 0) - dt);
    if (this.striking) {
      for (const e of ch.events) if (e.clip === 'strike' && e.name === 'hit') {
        const t = this.target;
        if (t && t.alive && Math.abs(t.cx - this.cx) < 46 && Math.abs(t.cy - this.cy) < 50) { t.damage(28, { dx: this.facing, dy: 0.2, from: this }); t.body.vx += this.facing * 160; g.fx.hitStop(0.04); g.fx.shake(3, 0.12); }
        g.audio.play('hit_metal', { variants: 2, volume: 0.6 });
      }
      if (!ch.upperOverride || ch.upperOverride.name !== 'strike') this.striking = false;
    }

    // ---- physics ----
    ph.step(b, dt);
    if (b.onGround && this.state === 'normal' && this.wasAir) { g.audio.play('land', { volume: 0.5 }); if (this.fallSpeed < -620) { ch.play('land', { fade: 0.03, restart: true }); this.landT = 0.18; g.fx.shake(2, 0.12); } }
    this.wasAir = !b.onGround && this.state !== 'ladder';
    this.fallSpeed = b.vy;
    this.landT = Math.max(0, (this.landT || 0) - dt);
    // doors near me open
    g.world.doors.forEach((d) => { if (Math.abs(d.x - b.x) < 48 && b.y >= d.y - 40 && b.y <= d.y + 70) g.world.requestOpen(d, 0.8); });
    // acid pools and fires hurt
    this.syncVisual(dt, input);
  }

  enterLadder(lad, up) {
    const b = this.body;
    this.state = 'ladder'; b.onLadder = true; b.ladder = lad; b.vy = 0; b.vx = 0; this.ladderT = 0;
    if (!up && b.onHatch) b.y -= 2;
    this.reload = null; this.char.stopUpper(0.05); this.upper = 'none';
    this.char.play('climb', { fade: 0.08 });
  }

  leaveLadder() {
    const b = this.body;
    this.state = 'normal'; b.onLadder = false; b.ladder = null;
  }

  pickTarget(dt) {
    this.targetT -= dt;
    if (this.targetT > 0 && this.target && this.target.alive && this.target.visibleToPlayer) return;
    this.targetT = 0.1;
    const g = this.game, r = g.renderer;
    let best = null, bestD = Infinity;
    for (const a of g.aliens) {
      if (!a.alive || a.hidden || !a.visibleToPlayer) continue;
      if (!r.onScreen(a.cx, a.cy, -8)) continue;
      const d = Math.hypot(a.cx - this.cx, a.cy - this.cy);
      if (d < bestD && g.physics.lineOfSight(this.cx, this.cy, a.cx, a.cy)) { best = a; bestD = d; }
    }
    if (best && !this.target) { if (g.time - this.contactT > 12) { this.contactT = g.time; g.barks.say(this, g.aliens.filter((a) => a.alive && a.visibleToPlayer).length > 1 ? 'CONTACT! MULTIPLE HOSTILES!' : 'Contact!', 1.8); } }
    this.target = best;
  }

  targetInRange() {
    const t = this.target;
    return t && Math.hypot(t.cx - this.cx, t.cy - this.cy) <= this.weaponDef.range;
  }

  aimedAtTarget() {
    const t = this.target;
    const dx = t.cx - this.cx, dy = t.cy - this.cy, l = Math.hypot(dx, dy) || 1;
    return (dx / l) * this.aim.x + (dy / l) * this.aim.y > 0.985;
  }

  // Rifle butt: a strike on the upper body when a hostile is at arm's length.
  strike() {
    const g = this.game;
    this.strikeT = 0.55;
    this.reload = null;
    this.char.playUpper('strike', { timeScale: 1.6 });
    this.upper = 'strike'; this.striking = true;
    g.audio.play('dodge', { volume: 0.5, rate: 0.8 });
    g.fx.kick(this, 2);
  }

  fire() {
    const g = this.game, w = this.weaponDef;
    this.fireT = 1 / w.rate;
    this.ammo.mag--;
    this.shots++;
    this.char.muzzle(this.muzzle);
    const mx = this.muzzle.x, my = this.muzzle.y;
    for (let i = 0; i < w.pellets; i++) {
      const s = (Math.random() - 0.5) * 2 * w.spread + (Math.random() - 0.5) * 2 * w.spread;
      const a = Math.atan2(this.aim.y, this.aim.x) + s;
      g.bullets.spawn(mx, my, Math.cos(a), Math.sin(a), w, this);
    }
    g.fx.muzzle(mx, my, this.aim.x, this.aim.y, w === WEAPONS.shotgun ? 1.6 : 1);
    g.audio.play(w.sfx, { volume: w === WEAPONS.shotgun ? 1 : 0.75, minGap: 20 });
    g.fx.shake(w.kick * 0.5, 0.08);
    g.fx.kick(this, w.kick);
    g.director.noise(this.cx, this.cy, 700);
    if (this.upper !== 'reload' && this.upper !== 'hurt') { this.char.playUpper('fire', { timeScale: Math.max(1, 1 / w.rate < 0.3 ? 2.2 : 1.2) }); this.upper = 'fire'; }
    this.lastShotT = g.time;
    if (this.ammo.mag === 0 && this.ammo.reserve > 0) this.startReload();
  }

  syncVisual(dt, input) {
    const b = this.body, ch = this.char, m = ch.meta;
    ch.group.position.set(b.x, b.y, 0);
    ch.setFacing(this.facing);
    // base clip
    if (!this.dead) {
      if (this.state === 'ladder') {
        ch.play('climb', { fade: 0.08 });
        ch.setTimeScale(Math.abs(b.vy) > 5 ? Math.sign(b.vy) * Math.max(0.5, Math.abs(b.vy) / 110) : 0);
      } else if (this.state === 'dodge') {
        ch.play('dodge', { fade: 0.03 });
      } else if (!b.onGround) {
        ch.play(b.vy > 40 ? 'jump' : 'fall', { fade: 0.1 });
        ch.setTimeScale(1);
      } else if (this.landT > 0) {
        ch.play('land', { fade: 0.03 });
      } else if (Math.abs(b.vx) > 6) {
        const run = Math.abs(b.vx) > WALK * 1.25;
        const clip = run ? 'run' : 'walk';
        const ref = run ? (m.speeds && m.speeds.run) || RUN : (m.speeds && m.speeds.walk) || WALK;
        const back = Math.sign(b.vx) !== this.facing;
        ch.play(clip, { fade: 0.12 });
        ch.setTimeScale((Math.abs(b.vx) / ref) * (back ? -1 : 1));
      } else {
        ch.play('idle', { fade: 0.15 });
        ch.setTimeScale(1);
      }
      // upper: aim hold when targeting, otherwise whatever the base provides
      if (this.upper === 'fire' && !ch.upperOverride) this.upper = 'none';
      if (this.upper === 'hurt' && !ch.upperOverride) this.upper = 'none';
      if (this.upper === 'strike' && !ch.upperOverride) this.upper = 'none';
      if (this.upper === 'reload' && !this.reload) { this.upper = 'none'; }
      const wantAim = (this.aimMode !== 'none' && this.state !== 'ladder' && this.state !== 'dodge');
      if (wantAim && this.upper === 'none') { ch.playUpper('aim', { loop: true, fade: 0.15 }); this.upper = 'aim'; }
      else if (!wantAim && this.upper === 'aim') { ch.stopUpper(0.2); this.upper = 'none'; }
      // aim pitch for the upper body
      const pitch = Math.atan2(this.aim.y, Math.abs(this.aim.x));
      const target = this.state === 'ladder' ? 0 : Math.max(-1.1, Math.min(1.1, pitch));
      ch.aimAngle += (target - ch.aimAngle) * Math.min(1, dt * 14);
    }
    ch.update(dt);
    for (const e of ch.events) {
      if (e.name === 'step' && b.onGround) { this.game.audio.play('step', { variants: 2, volume: Math.abs(b.vx) > WALK * 1.25 ? 0.55 : 0.35, minGap: 90 }); this.game.director.noise(b.x, b.y, Math.abs(b.vx) > WALK * 1.25 ? 260 : 120); }
      if (e.name === 'rung') this.game.audio.play('step', { variants: 2, volume: 0.3, rate: 1.3, minGap: 120 });
    }
    // flashlight from the muzzle along the aim
    this.char.muzzle(this.muzzle);
    this.game.renderer.setFlashlight(!this.dead, this.muzzle.x, this.muzzle.y, this.aim.x, this.aim.y);
  }
}
