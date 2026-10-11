import { PLAYER, COMBAT, DEPTH } from '../config.js';
import Rig from '../rig/Rig.js';
import { beastClips } from '../rig/clips/humanoid.js';

// The beast-man. A physics rectangle drives movement; the rig is drawn on top of it.
export default class Player {
  constructor(scene, x, y, stats) {
    this.scene = scene;
    this.stats = stats;
    this.faction = 'player';
    this.alive = true;
    this.body_ = scene.add.rectangle(x, y, PLAYER.bodyWidth, PLAYER.bodyHeight, 0xffffff, 0);
    scene.physics.add.existing(this.body_);
    const b = this.body_.body;
    b.setCollideWorldBounds(true);
    b.setMaxVelocityY(PLAYER.maxFallSpeed);
    this.body = b;
    this.def = scene.cache.json.get('rig_beast');
    this.rig = new Rig(scene, x, y, this.def, beastClips());
    this.rig.setDepth(DEPTH.player);
    this.shadow = scene.add.image(x, y, 'fx_shadow').setDepth(DEPTH.player - 1).setAlpha(0.6);
    this.hipHeight = this.def.leg_len * 0.88;

    this.facing = 1;
    this.state = 'idle';
    this.stateTime = 0;
    this.hp = stats.maxHp; this.maxHp = stats.maxHp;
    this.stamina = stats.maxStamina; this.maxStamina = stats.maxStamina;
    this.staminaDelay = 0;
    this.gold = 0;
    this.coyote = 0; this.jumpBuffer = 0; this.wasGrounded = false;
    this.invulnUntil = 0;
    this.combo = 0; this.comboWindow = false; this.queuedAttack = null;
    this.charge = 0;
    this.hitbox = null;
    this.airAttacked = false;
    this.lunge = 0;
    this.dodgeDir = 1;
    this.potions = 3;
    this.kills = 0;
    this.rig.onEvent = (name, ev) => this.onRigEvent(name, ev);
    this.rig.play('idle');
  }

  get x() { return this.body_.x; }
  get y() { return this.body_.y; }
  get grounded() { return this.body.blocked.down || this.body.touching.down; }
  get invulnerable() { return this.scene.time.now < this.invulnUntil || this.state === 'dead'; }
  hitBounds() { return { x: this.x, y: this.y, w: PLAYER.bodyWidth, h: PLAYER.bodyHeight }; }

  setState(s) {
    if (this.state === s) return;
    this.state = s; this.stateTime = 0;
  }

  spendStamina(n) {
    this.stamina = Math.max(0, this.stamina - n);
    this.staminaDelay = PLAYER.staminaRegenDelay;
  }

  canAct() { return ['idle', 'run', 'jump', 'fall', 'land'].includes(this.state); }

  // ------------------------------------------------------------------ update
  update(inp, dt) {
    const dts = dt / 1000;
    const b = this.body;
    this.stateTime += dt;
    const now = this.scene.time.now;
    const grounded = this.grounded;

    // timers
    if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else if (this.stamina < this.maxStamina && this.state !== 'charge') this.stamina = Math.min(this.maxStamina, this.stamina + this.stats.staminaRegen * dts);
    if (grounded) this.coyote = PLAYER.coyoteTime; else this.coyote -= dt;
    if (inp.pressed.jump) this.jumpBuffer = PLAYER.jumpBuffer; else this.jumpBuffer -= dt;
    if (grounded && !this.wasGrounded && this.state !== 'dead') this.onLand();
    this.wasGrounded = grounded;
    if (grounded) this.airAttacked = false;

    const moveX = inp.moveX;
    const wantMove = Math.abs(moveX) > 0.05;

    if (this.state === 'dead') { this.applyFriction(dts, PLAYER.friction); this.syncRig(dt); return; }

    // --- state-specific handling ---------------------------------------------------------
    if (this.state === 'hurt') {
      this.applyFriction(dts, PLAYER.friction * 0.6);
      if (this.stateTime > 320) this.setState(grounded ? 'idle' : 'fall');
    } else if (this.state === 'dodge') {
      b.setVelocityX(this.dodgeDir * PLAYER.dodgeSpeed * (1 - 0.5 * this.stateTime / PLAYER.dodgeDuration));
      if (this.stateTime > PLAYER.dodgeDuration) { this.setState(grounded ? 'idle' : 'fall'); }
    } else if (this.state === 'attack' || this.state === 'heavy' || this.state === 'air_attack') {
      // lunge decays; air attack keeps air control
      if (this.state === 'air_attack') this.airControl(moveX, dts);
      else { b.setVelocityX(this.lunge * this.facing); this.lunge *= Math.pow(0.02, dts); if (Math.abs(this.lunge) < 5) this.lunge = 0; }
      if (this.state === 'attack' && this.comboWindow && inp.pressed.light && this.stamina >= PLAYER.lightStamina) {
        inp.consume('light');
        this.queuedAttack = 'light';
      }
      if (this.state === 'attack' && this.comboWindow && inp.pressed.dodge && this.stamina >= PLAYER.dodgeStamina) {
        inp.consume('dodge'); this.startDodge(moveX);
      }
      if (this.state === 'air_attack' && grounded) { this.endAttack(); }
    } else if (this.state === 'charge') {
      this.applyFriction(dts, PLAYER.friction);
      this.charge = Math.min(700, this.charge + dt);
      if (wantMove) this.facing = moveX > 0 ? 1 : -1;
      if (!inp.held.heavy || this.charge >= 700) this.releaseHeavy();
    } else {
      // free movement states: idle / run / jump / fall / land
      if (grounded) this.groundMove(moveX, dts); else this.airControl(moveX, dts);
      if (wantMove && this.state !== 'land') this.facing = moveX > 0 ? 1 : -1;

      // jump (buffered + coyote)
      if (this.jumpBuffer > 0 && this.coyote > 0 && this.state !== 'jump') {
        this.jumpBuffer = 0; this.coyote = 0;
        b.setVelocityY(PLAYER.jumpVelocity);
        this.setState('jump');
        this.rig.play('jump', { fade: 60 });
        this.scene.audio.play('sfx_jump', { volume: 0.6 });
        this.scene.fx.landDust(this.x, this.y + PLAYER.bodyHeight / 2, 4);
      }
      if (this.state === 'jump' && inp.released.jump && b.velocity.y < 0) b.setVelocityY(b.velocity.y * PLAYER.jumpCutMultiplier);

      // actions
      if (inp.pressed.light && this.stamina >= PLAYER.lightStamina) {
        inp.consume('light');
        if (grounded) this.startAttack(1);
        else if (!this.airAttacked) this.startAirAttack();
      } else if (inp.pressed.heavy && grounded && this.stamina >= PLAYER.heavyStamina) {
        inp.consume('heavy');
        this.setState('charge'); this.charge = 0;
        this.rig.play('charge', { fade: 80 });
        if (wantMove) this.facing = moveX > 0 ? 1 : -1;
      } else if (inp.pressed.dodge && grounded && this.stamina >= PLAYER.dodgeStamina) {
        inp.consume('dodge');
        this.startDodge(moveX);
      } else if (inp.pressed.potion) {
        inp.consume('potion');
        this.usePotion();
      }

      // locomotion animation (only if an action above did not change state)
      if (!this.canAct()) { this.syncRig(dt); return; }
      if (this.state === 'land') {
        if (this.stateTime > 160) this.setState('idle');
      } else if (grounded) {
        if (wantMove) { this.setState('run'); this.rig.play('run', { fade: 100 }); this.rig.speed = 0.8 + 0.5 * Math.abs(b.velocity.x) / PLAYER.runSpeed; }
        else { this.setState('idle'); this.rig.play('idle', { fade: 160 }); this.rig.speed = 1; }
      } else {
        if (b.velocity.y > 80 && this.state !== 'fall') { this.setState('fall'); this.rig.play('fall', { fade: 140 }); }
        else if (this.state !== 'jump' && this.state !== 'fall') { this.setState('fall'); this.rig.play('fall', { fade: 140 }); }
      }
    }
    this.syncRig(dt);
  }

  groundMove(moveX, dts) {
    const b = this.body;
    const target = moveX * PLAYER.runSpeed * this.stats.speedMult;
    const accel = Math.abs(moveX) > 0.05 ? PLAYER.runAccel : PLAYER.friction;
    const dv = target - b.velocity.x;
    const step = accel * dts;
    b.setVelocityX(Math.abs(dv) <= step ? target : b.velocity.x + Math.sign(dv) * step);
  }

  airControl(moveX, dts) {
    const b = this.body;
    if (Math.abs(moveX) > 0.05) {
      const target = moveX * PLAYER.runSpeed * this.stats.speedMult;
      const dv = target - b.velocity.x;
      const step = PLAYER.airAccel * dts;
      b.setVelocityX(Math.abs(dv) <= step ? target : b.velocity.x + Math.sign(dv) * step);
    }
  }

  applyFriction(dts, f) {
    const b = this.body;
    const v = b.velocity.x;
    const step = f * dts;
    b.setVelocityX(Math.abs(v) <= step ? 0 : v - Math.sign(v) * step);
  }

  syncRig(dt) {
    const bottom = this.body_.y + PLAYER.bodyHeight / 2;
    this.rig.setPosition(this.body_.x, bottom - this.hipHeight);
    this.rig.setFacing(this.facing);
    this.rig.update(this.scene.fx.stopped ? 0 : dt);
    this.rig.tick(dt);
    this.shadow.setPosition(this.body_.x, bottom + 2);
    const air = Math.max(0, Math.min(1, (this.scene.groundYAt ? this.scene.groundYAt(this.x) - bottom : 0) / 300));
    this.shadow.setScale(1 - air * 0.5).setAlpha(0.6 - air * 0.4);
    // invulnerability blink
    if (this.scene.time.now < this.invulnUntil && this.state !== 'dodge') this.rig.setAlpha(Math.floor(this.scene.time.now / 60) % 2 ? 0.35 : 1);
    else this.rig.setAlpha(1);
    if (this.hitbox) {
      const tip = this.rig.boneTip(this.hitbox.bone || 'arm_l_near', 44);
      this.hitbox.x = this.x + this.facing * this.hitbox.reach * 0.55;
      this.hitbox.y = Math.min(this.y + 20, Math.max(this.y - 40, tip.y));
    }
  }

  // ------------------------------------------------------------------ actions
  startAttack(n) {
    this.combo = n;
    this.setState('attack');
    this.comboWindow = false; this.queuedAttack = null;
    this.spendStamina(PLAYER.lightStamina);
    this.rig.play(`attack${n}`, { fade: 50, restart: true });
    this.lunge = n === 3 ? 260 : 150;
  }

  startAirAttack() {
    this.airAttacked = true;
    this.setState('air_attack');
    this.spendStamina(PLAYER.lightStamina);
    this.rig.play('air_attack', { fade: 50, restart: true });
    this.body.setVelocityY(Math.min(this.body.velocity.y, -150));
  }

  releaseHeavy() {
    const k = this.charge / 700;
    this.chargeMult = 1 + k * 1.2;
    this.setState('heavy');
    this.spendStamina(PLAYER.heavyStamina);
    this.rig.play('heavy', { fade: 60, restart: true, speed: 1 + k * 0.2 });
    this.lunge = 120 + 200 * k;
  }

  startDodge(moveX) {
    this.dodgeDir = Math.abs(moveX) > 0.05 ? Math.sign(moveX) : this.facing;
    this.facing = this.dodgeDir;
    this.setState('dodge');
    this.spendStamina(PLAYER.dodgeStamina);
    this.invulnUntil = this.scene.time.now + PLAYER.dodgeInvuln;
    this.rig.play('dodge', { fade: 40, restart: true });
    this.scene.audio.play('sfx_dodge', { volume: 0.7 });
    this.scene.fx.landDust(this.x, this.y + PLAYER.bodyHeight / 2, 5);
    this.clearHitbox();
    this.scene.combat.clearOwner(this);
  }

  usePotion() {
    if (this.potions <= 0 || this.hp >= this.maxHp) { this.scene.audio.play('sfx_ui_back', { volume: 0.5 }); return; }
    this.potions -= 1;
    const heal = Math.round(this.maxHp * 0.45);
    this.hp = Math.min(this.maxHp, this.hp + heal);
    this.scene.audio.play('sfx_potion');
    this.scene.fx.number(this.x, this.y - 70, `+${heal}`, { color: 0x60ff80 });
    this.scene.events.emit('player-heal', heal);
  }

  onRigEvent(name, ev) {
    const s = this.scene;
    if (name === 'swing') {
      const heavy = this.state === 'heavy';
      s.audio.play(heavy ? 'sfx_heavy_swing' : 'sfx_swing', { variants: heavy ? 0 : 3, volume: 0.7 });
      const tip = this.rig.bonePos('torso');
      s.fx.slash(this.x + this.facing * 58, tip.y - 20, this.facing, 'claw', heavy ? 1.5 : 1.0 + this.combo * 0.12, heavy ? 0xff9060 : 0xffffff);
    } else if (name === 'hit_on') {
      const heavy = this.state === 'heavy';
      const air = this.state === 'air_attack';
      const base = this.stats.damage();
      const mult = heavy ? 2.2 * (this.chargeMult || 1) : (this.combo === 3 ? 1.5 : air ? 1.2 : 1);
      const reach = (heavy ? 110 : 92) * this.stats.reachMult;
      this.clearHitbox();
      this.hitbox = s.combat.add({
        owner: this, faction: 'player', x: this.x + this.facing * reach * 0.55, y: this.y - 10, w: reach, h: heavy ? 150 : 110,
        damage: base * mult, knockback: heavy ? COMBAT.heavyKnockback : (this.combo === 3 ? COMBAT.knockback * 1.6 : COMBAT.knockback),
        heavy: heavy || this.combo === 3, kind: 'claw', critChance: this.stats.critChance, reach,
      });
    } else if (name === 'hit_off') {
      this.clearHitbox();
    } else if (name === 'recover') {
      if (this.state === 'attack') {
        this.comboWindow = true;
        if (this.queuedAttack && this.combo < 3) { this.startAttack(this.combo + 1); }
      }
    } else if (name === 'end') {
      if (['attack', 'heavy', 'air_attack'].includes(this.state)) this.endAttack();
    } else if (name === 'step') {
      if (this.grounded) s.audio.play('sfx_footstep', { variants: 2, volume: 0.5 });
    }
  }

  endAttack() {
    this.clearHitbox();
    this.comboWindow = false; this.queuedAttack = null; this.combo = 0;
    this.lunge = 0;
    this.setState(this.grounded ? 'idle' : 'fall');
    this.rig.play(this.grounded ? 'idle' : 'fall', { fade: 120 });
  }

  clearHitbox() { if (this.hitbox) { this.scene.combat.remove(this.hitbox); this.hitbox = null; } }

  onLand() {
    this.scene.audio.play('sfx_land', { volume: 0.5 });
    this.scene.fx.landDust(this.x, this.y + PLAYER.bodyHeight / 2, 6);
    if (['jump', 'fall'].includes(this.state)) { this.setState('land'); this.rig.play('land', { fade: 40 }); }
  }

  // ------------------------------------------------------------------ damage
  takeHit(info) {
    if (!this.alive || this.invulnerable) return false;
    const dmg = Math.max(1, Math.round(info.damage * this.stats.damageTakenMult));
    this.hp -= dmg;
    this.scene.fx.number(this.x, this.y - 70, dmg, { color: 0xff6060 });
    this.scene.fx.impact(this.x + info.dir * -10, this.y - 20, { heavy: info.heavy, blood: true });
    this.scene.fx.shake(info.heavy ? 0.012 : 0.006, info.heavy ? 220 : 120);
    this.scene.input_.rumble(info.heavy ? 1 : 0.6, 0.4, info.heavy ? 260 : 150);
    this.clearHitbox(); this.lunge = 0;
    this.rig.flash(80);
    if (this.hp <= 0) { this.die(); return true; }
    this.scene.audio.play('sfx_player_hurt');
    this.invulnUntil = this.scene.time.now + PLAYER.hurtInvuln;
    this.setState('hurt');
    this.rig.play('hurt', { fade: 30, restart: true });
    this.body.setVelocity(info.dir * (info.knockback || COMBAT.knockback) * 0.8, -180);
    this.scene.events.emit('player-hurt', dmg);
    return true;
  }

  die() {
    this.alive = false;
    this.hp = 0;
    this.setState('dead');
    this.rig.play('death', { fade: 40, restart: true });
    this.scene.audio.play('sfx_player_death');
    this.body.setVelocityX(-this.facing * 120);
    this.scene.events.emit('player-died');
  }

  destroy() { this.rig.destroy(); this.body_.destroy(); this.shadow.destroy(); }
}
