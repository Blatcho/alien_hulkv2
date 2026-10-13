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
    this.hipHeight = this.def.leg_len * 0.88 * (this.def.scale || 1);

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
    this.jumpsLeft = 2;
    this.guardRaisedAt = -1e9;
    this.blocking = false;
    this.onStairs = false;
    this.climbing = false;
    this.fallFrom = null;      // highest feet y reached while airborne (for hard landings)
    this.skidDir = 0;
    this.camLead = 0;
    this.ladder = null;
    this.dropThrough = false;
    this.dropTimer = 0;
    this.jumpedAt = -1e9;
    this.stairDir = 0;         // rise direction of the stair under the feet (+1 rises to the right)
    this.wallDir = 0;          // side of the wall being clung to (+1 = wall on the right)
    this.wallCoyoteUntil = 0; this.wallLockUntil = 0; this.wallPush = 0;
    this.rigShift = 0;
    this.climbTop = null;      // pull-up onto a landing in progress {y0, y1}
    this.rig.onEvent = (name, ev) => this.onRigEvent(name, ev);
    this.rig.play('idle');
    // a faint cool key light that follows the hero so the dark armour stays readable away from torches
    this.heroLight = scene.lighting ? scene.lighting.addPoint(x, y - 40, 260, 0xb8c8ff, 0.55) : null;
  }

  get x() { return this.body_.x; }
  get y() { return this.body_.y; }
  get grounded() { return this.body.blocked.down || this.body.touching.down || this.onStairs; }
  get feetY() { return this.body_.y + PLAYER.bodyHeight / 2; }
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

  canAct() { return ['idle', 'run', 'jump', 'fall', 'land', 'land_hard', 'double_jump', 'wall_jump', 'skid'].includes(this.state); }
  get climbingState() { return this.state === 'climb'; }
  get airborneState() { return ['jump', 'fall', 'double_jump', 'wall_jump', 'wall_slide', 'air_attack'].includes(this.state); }

  // ------------------------------------------------------------------ update
  update(inp, dt) {
    const dts = dt / 1000;
    const b = this.body;
    this.stateTime += dt;
    const now = this.scene.time.now;
    this.unstickCorner();
    const grounded = this.grounded;

    // timers
    if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else if (this.stamina < this.maxStamina && this.state !== 'charge') this.stamina = Math.min(this.maxStamina, this.stamina + this.stats.staminaRegen * dts);
    const standing = (grounded && b.velocity.y >= -1) || this.onStairs;   // not in the launch frame of a jump
    if (standing) this.coyote = PLAYER.coyoteTime; else this.coyote -= dt;
    if (inp.pressed.jump) this.jumpBuffer = PLAYER.jumpBuffer; else this.jumpBuffer -= dt;
    if (!grounded) { if (this.fallFrom === null || this.feetY < this.fallFrom) this.fallFrom = this.feetY; }
    if (grounded && !this.wasGrounded && this.state !== 'dead') this.onLand();
    this.wasGrounded = grounded;
    if (standing) { this.airAttacked = false; this.jumpsLeft = 2; }

    const moveX = inp.moveX;
    const wantMove = Math.abs(moveX) > 0.05;
    if (this.dropTimer > 0) { this.dropTimer -= dt; if (this.dropTimer <= 0) this.dropThrough = false; }

    if (this.state === 'dead') { this.applyFriction(dts, PLAYER.friction); this.syncRig(dt); return; }

    // ---- ladders ----------------------------------------------------------------------
    if (this.state === 'climb') { this.updateClimb(inp, dt); this.syncRig(dt); return; }
    if (this.state === 'climb_top') { this.updateClimbTop(dt); this.syncRig(dt); return; }
    this.climbing = false;
    // where two ladders meet at a landing (one ends where the next begins) pick the one that goes the way
    // the player is pushing: up wants a ladder whose top is above the feet, down one that continues below
    if (this.scene.laddersAt && this.canAct() && !this.scene.fx.stopped && (inp.held.up || inp.held.down)) {
      for (const ladder of this.scene.laddersAt(this.x, this.y - 30, this.feetY)) {
        const wantUp = inp.held.up && this.feetY > ladder.top + 8;
        const wantDown = inp.held.down && this.feetY < ladder.bottom - 8 && !(this.grounded && this.feetY > ladder.bottom - 12);
        if (wantUp || wantDown) { this.startClimb(ladder); this.syncRig(dt); return; }
      }
    }
    // drop through one-way platforms: down + jump
    if (inp.pressed.jump && inp.held.down && this.grounded && !this.onStairs && this.canAct()) {
      inp.consume('jump'); this.jumpBuffer = 0;
      this.dropThrough = true; this.dropTimer = 260;
      this.body.setVelocityY(120);
    }
    // ---- stairs: snap the feet to the slope while walking on it --------------------------
    this.onStairs = false;
    if (this.scene.stairAt && now - this.jumpedAt > 180 && b.velocity.y >= -40 && this.state !== 'dodge') {
      const st = this.scene.stairAt(this.x, this.feetY);
      if (st !== null) {
        const sy = st.y;
        this.stairDir = st.dir;
        // move the body (keeps its horizontal velocity) so the feet rest on the slope
        this.body.y = sy - PLAYER.bodyHeight;
        this.body.prev.y = this.body.y; if (this.body.prevFrame) this.body.prevFrame.y = this.body.y;
        this.body_.y = sy - PLAYER.bodyHeight / 2;
        this.body.setVelocityY(0);
        this.body.setAllowGravity(false);
        this.onStairs = true;
      }
    }
    if (!this.onStairs && !this.climbing) this.body.setAllowGravity(true);

    // --- state-specific handling ---------------------------------------------------------
    if (this.state === 'hurt') {
      this.applyFriction(dts, PLAYER.friction * 0.6);
      if (this.stateTime > 320) this.setState(grounded ? 'idle' : 'fall');
    } else if (this.state === 'dodge') {
      // backstep: hop away from the facing direction, keep facing the threat
      b.setVelocityX(-this.facing * PLAYER.dodgeSpeed * (1 - 0.6 * this.stateTime / PLAYER.dodgeDuration));
      if (this.stateTime > PLAYER.dodgeDuration && grounded) { this.setState('idle'); this.rig.play('idle', { fade: 120 }); }
      else if (this.stateTime > PLAYER.dodgeDuration + 400) { this.setState('fall'); this.rig.play('fall', { fade: 120 }); }
    } else if (this.state === 'wall_slide') {
      // clinging: slide slowly, kick off on jump, let go when the wall ends or the push toward it stops
      const wd = this.wallDir;
      b.setVelocityX(wd * 40);   // keep leaning into the stone so the contact holds frame to frame
      if (b.velocity.y > PLAYER.wallSlideSpeed) b.setVelocityY(PLAYER.wallSlideSpeed);
      if (this.jumpBuffer > 0) this.wallJump(wd);
      else if (grounded || this.wallContact() !== wd || Math.sign(moveX) !== wd) {
        this.wallCoyoteUntil = now + PLAYER.wallCoyote;
        this.setState(grounded ? 'idle' : 'fall'); this.rig.play(grounded ? 'idle' : 'fall', { fade: 120 });
      } else if (b.velocity.y > 60 && Math.floor(this.stateTime / 110) !== Math.floor((this.stateTime - dt) / 110)) {
        this.scene.fx.landDust(this.x + wd * PLAYER.bodyWidth / 2, this.y + 10, 1);
      }
    } else if (this.state === 'guard' || this.state === 'guard_hit' || this.state === 'parry') {
      this.applyFriction(dts, PLAYER.friction);
      if (this.state === 'guard' && wantMove) this.facing = moveX > 0 ? 1 : -1;
      const stillHeld = inp.held.defend && grounded;
      if (this.state === 'guard' && !stillHeld) { this.blocking = false; this.setState('idle'); this.rig.play('idle', { fade: 140 }); }
      else if (this.state !== 'guard' && this.rig.finished) {
        if (stillHeld) { this.setState('guard'); this.rig.play('guard', { fade: 80 }); }
        else { this.blocking = false; this.setState('idle'); this.rig.play('idle', { fade: 120 }); }
      }
    } else if (this.state === 'attack' || this.state === 'heavy' || this.state === 'air_attack') {
      // lunge decays; air attack keeps air control
      if (this.state === 'air_attack') this.airControl(moveX, dts);
      else { b.setVelocityX(this.lunge * this.facing); this.lunge *= Math.pow(0.02, dts); if (Math.abs(this.lunge) < 5) this.lunge = 0; }
      if (this.state === 'attack' && inp.pressed.light && this.stamina >= PLAYER.lightStamina && this.combo < 3) {
        inp.consume('light');
        // inside the window the next swipe starts at once; earlier presses wait for the recovery beat
        if (this.comboWindow) this.startAttack(this.combo + 1);
        else this.queuedAttack = 'light';
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
      // free movement states: idle / run / jump / fall / land / skid
      const locked = this.state === 'land_hard' && this.stateTime < PLAYER.hardLandLock;
      const wall = grounded ? 0 : this.wallContact();
      if (wall && Math.sign(moveX) === wall) this.wallPush += dt; else this.wallPush = 0;
      if (locked) { this.applyFriction(dts, PLAYER.friction * 1.5); }
      else if (!grounded && wall && b.velocity.y > 0 && this.wallPush >= PLAYER.wallGrabDelay && this.state !== 'wall_jump' && !this.nearFloor(90)) {
        // pushing into a wall while falling: cling to it
        this.wallDir = wall; this.facing = wall;
        this.setState('wall_slide'); this.rig.play('wall_slide', { fade: 80 });
        this.jumpBuffer = 0;
        this.scene.audio.play('sfx_footstep', { variants: 2, volume: 0.4, detune: -600 });
      }
      else if (grounded) {
        // a single step in the way: vault onto it without breaking stride
        if (wantMove && this.state !== 'skid' && this.stepUp(moveX)) { /* airborne now */ }
        // reversing at speed plants the feet: a short skid before the new direction takes
        if (wantMove && this.state !== 'skid' && Math.sign(moveX) === -Math.sign(b.velocity.x) && Math.abs(b.velocity.x) > PLAYER.turnSkidSpeed) {
          this.setState('skid'); this.skidDir = Math.sign(b.velocity.x);
          this.rig.play('skid', { fade: 40, restart: true });
          this.scene.fx.landDust(this.x + this.skidDir * 10, this.feetY, 5);
          this.scene.audio.play('sfx_footstep', { variants: 2, volume: 0.6, detune: -400 });
        }
        if (this.state === 'skid') { this.applyFriction(dts, PLAYER.friction * 2.2); if (this.stateTime > PLAYER.turnSkidMs || Math.abs(b.velocity.x) < 30) { this.setState('idle'); } }
        else this.groundMove(moveX, dts);
      } else if (now >= this.wallLockUntil) this.airControl(moveX, dts);
      if (this.state === 'wall_slide') { this.syncRig(dt); return; }
      if (wantMove && this.state !== 'land' && this.state !== 'skid' && !locked && now >= this.wallLockUntil) this.facing = moveX > 0 ? 1 : -1;

      // jump (buffered + coyote), then one double jump in the air
      if (this.jumpBuffer > 0 && this.coyote > 0 && this.state !== 'jump' && this.jumpsLeft === 2 && !(this.state === 'land_hard' && this.stateTime < 120)) {
        this.jumpBuffer = 0; this.coyote = 0; this.jumpsLeft = 1;
        this.onStairs = false; this.jumpedAt = now; b.setAllowGravity(true);
        b.setVelocityY(PLAYER.jumpVelocity);
        this.setState('jump');
        this.rig.play('jump', { fade: 60 });
        this.scene.audio.play('sfx_jump', { volume: 0.6 });
        this.scene.fx.landDust(this.x, this.y + PLAYER.bodyHeight / 2, 4);
      } else if (this.jumpBuffer > 0 && !standing && (wall || (this.wallDir && now < this.wallCoyoteUntil))) {
        // airborne against a wall (or just off one): kick away from it
        this.wallJump(wall || this.wallDir);
      } else if (this.jumpBuffer > 0 && !standing && this.jumpsLeft === 1) {
        this.jumpBuffer = 0; this.jumpsLeft = 0; this.jumpedAt = now;
        b.setVelocityY(PLAYER.doubleJumpVelocity);
        if (wantMove) this.facing = moveX > 0 ? 1 : -1;
        this.setState('double_jump');
        this.rig.play('double_jump', { fade: 40, restart: true });
        this.scene.audio.play('sfx_jump', { volume: 0.7, detune: 300 });
        this.scene.fx.airRing(this.x, this.y + 30);
      }
      if ((this.state === 'jump' || this.state === 'double_jump' || this.state === 'wall_jump') && inp.released.jump && b.velocity.y < 0) b.setVelocityY(b.velocity.y * PLAYER.jumpCutMultiplier);

      // actions
      const hardLock = this.state === 'land_hard' && this.stateTime < 120;
      if (hardLock) { /* the first beat of a heavy landing cannot be cancelled */ }
      else if (inp.pressed.light && this.stamina >= PLAYER.lightStamina) {
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
      } else if (inp.held.defend && grounded) {
        this.raiseGuard(moveX);
      } else if (inp.pressed.potion) {
        inp.consume('potion');
        this.usePotion();
      }

      // locomotion animation (only if an action above did not change state)
      if (!this.canAct()) { this.syncRig(dt); return; }
      if (this.state === 'land') {
        if (this.stateTime > 170) this.setState('idle');
      } else if (this.state === 'land_hard') {
        if (this.rig.finished || this.stateTime > 360) this.setState('idle');
      } else if (this.state === 'skid') {
        // handled above
      } else if (standing) {
        if (wantMove) {
          this.setState('run');
          // on a stair slope: the climb or the descent, judged from the travel direction against the rise
          const moving = Math.abs(b.velocity.x) > 20 ? Math.sign(b.velocity.x) : Math.sign(moveX);
          const clipName = this.onStairs ? (moving * this.stairDir > 0 ? 'stairs_up' : 'stairs_down') : 'run';
          this.rig.play(clipName, { fade: 100 });
          this.rig.speed = 0.8 + 0.5 * Math.abs(b.velocity.x) / PLAYER.runSpeed;
        }
        else { this.setState('idle'); this.rig.play('idle', { fade: 160 }); this.rig.speed = 1; }
      } else if (this.state === 'double_jump') {
        if (this.rig.finished) { this.setState('fall'); this.rig.play('fall', { fade: 100 }); }
      } else if ((this.state === 'jump' || this.state === 'wall_jump') && !standing) {
        if (b.velocity.y > 80) { this.setState('fall'); this.rig.play('fall', { fade: 140 }); }
      } else {
        if (b.velocity.y > 80 && this.state !== 'fall') { this.setState('fall'); this.rig.play('fall', { fade: 140 }); }
        else if (!['jump', 'wall_jump', 'fall'].includes(this.state)) { this.setState('fall'); this.rig.play('fall', { fade: 140 }); }
      }
    }
    this.syncRig(dt);
  }

  groundMove(moveX, dts) {
    const b = this.body;
    const uphill = this.onStairs && Math.sign(moveX) === this.stairDir;
    const target = moveX * PLAYER.runSpeed * this.stats.speedMult * (uphill ? PLAYER.stairsUpSpeed : 1);
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
    const lead = -this.facing * (60 + Math.min(1, Math.abs(this.body.velocity.x) / PLAYER.runSpeed) * 70);
    this.camLead += (lead - this.camLead) * Math.min(1, dt / 450);
    const cam = this.scene.cameras.main;
    if (cam.followOffset) cam.setFollowOffset(this.camLead, cam.followOffset.y);
    const shift = (this.state === 'climb' || this.state === 'climb_top') ? -this.facing * PLAYER.climbOffset : 0;
    this.rigShift += (shift - this.rigShift) * Math.min(1, dt / 120);
    this.rig.setPosition(this.body_.x + this.rigShift, bottom - this.hipHeight);
    this.rig.setFacing(this.facing);
    this.rig.update(this.scene.fx.stopped ? 0 : dt);
    this.rig.tick(dt);
    this.shadow.setPosition(this.body_.x, bottom + 2);
    if (this.heroLight) this.heroLight.setPosition(this.body_.x - this.facing * 30, this.body_.y - 50);
    const gy = this.scene.groundYAt ? this.scene.groundYAt(this.x, bottom) : bottom;
    this.shadow.setY(gy + 2);
    const air = Math.max(0, Math.min(1, (gy - bottom) / 300));
    this.shadow.setScale(1 - air * 0.5).setAlpha(0.6 - air * 0.4);
    // invulnerability blink
    if (this.scene.time.now < this.invulnUntil && this.state !== 'dodge') this.rig.setAlpha(Math.floor(this.scene.time.now / 60) % 2 ? 0.35 : 1);
    else this.rig.setAlpha(1);
    if (this.hitbox && !this.hitbox.heavy) {
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
    // Backstep away from the direction the beast is facing (a stick direction can re-face first).
    if (Math.abs(moveX) > 0.05 && this.state !== 'attack') this.facing = moveX > 0 ? 1 : -1;
    this.dodgeDir = -this.facing;
    this.setState('dodge');
    this.spendStamina(PLAYER.dodgeStamina);
    this.invulnUntil = this.scene.time.now + PLAYER.dodgeInvuln;
    this.body.setVelocity(this.dodgeDir * PLAYER.dodgeSpeed, PLAYER.dodgeHop);
    this.rig.play('backstep', { fade: 40, restart: true });
    this.scene.audio.play('sfx_dodge', { volume: 0.7 });
    this.scene.fx.landDust(this.x, this.y + PLAYER.bodyHeight / 2, 5);
    this.clearHitbox();
    this.scene.combat.clearOwner(this);
  }

  // The physics body climbs on the ladder's centre line (so it fits through the shaft); the drawn
  // rig hangs a little to the side it arrived from, facing the rungs it grips.
  climbX(L) { return L.x; }

  startClimb(ladder) {
    this.ladder = ladder;
    this.climbing = true;
    this.onStairs = false;
    this.clearHitbox(); this.lunge = 0; this.blocking = false;
    this.setState('climb');
    this.body.setAllowGravity(false);
    this.body.setVelocity(0, 0);
    this.rig.play('climb_hold', { fade: 120 });
    this.rig.speed = 1;
  }

  // Side of a wall the body is pressed against while airborne (+1 right, -1 left), 0 if none. World
  // edges and gates do not count: a gate is walked through, not climbed.
  wallContact() {
    const b = this.body;
    const w = this.scene.physics.world.bounds;
    const side = b.blocked.right && b.right < w.right - 2 ? 1 : b.blocked.left && b.x > w.x + 2 ? -1 : 0;
    if (!side) return 0;
    const doors = this.scene.doors || [];
    const edge = side > 0 ? b.right : b.x;
    if (doors.some((d) => d.open < 0.55 && Math.abs(d.x - edge) < 24 && this.feetY > d.y - d.h - 10 && this.feetY <= d.y + 10)) return 0;
    return side;
  }

  // Arcade physics can leave a body "standing" on the very corner of a wall it is being pushed into
  // (the vertical overlap is resolved because it is the smaller one). With almost no footing under
  // it, ease the body off the corner so it falls instead of hanging there.
  unstickCorner() {
    const b = this.body;
    if (!(b.blocked.down || b.touching.down) || this.onStairs || this.state === 'climb' || this.state === 'climb_top') return;
    const L = this.scene.level;
    if (!L) return;
    const side = b.blocked.right ? 1 : b.blocked.left ? -1 : 0;
    if (!side) return;                                   // walking off a ledge is not a corner
    const feetY = this.feetY;
    if (feetY >= this.scene.groundY - 2) return;
    let footing = 0;
    for (const s of L.solids) {
      if (s.noBody || Math.abs(s.y - feetY) > 2 || s.x > b.right || s.x + s.w < b.x) continue;
      footing = Math.max(footing, Math.min(b.right, s.x + s.w) - Math.max(b.x, s.x));
    }
    for (const pl of L.platforms) if (Math.abs(pl.y - feetY) <= 2 && pl.x <= b.right && pl.x + pl.w >= b.x) footing = Math.max(footing, Math.min(b.right, pl.x + pl.w) - Math.max(b.x, pl.x));
    if (footing > 6) return;
    // only the wall we are pushing into is under us: step back off its corner
    const dir = side;
    this.body_.x -= dir * 8;
    b.reset(this.body_.x, this.body_.y);
    b.setVelocity(0, 40);
  }

  // Is there standing ground within `h` px below the feet? (no wall cling right above a landing)
  nearFloor(h) {
    const gy = this.scene.groundYAt ? this.scene.groundYAt(this.x, this.feetY) : this.feetY;
    return gy - this.feetY < h;
  }

  // Walking into a block no taller than a single step: hop onto it, keeping the run going.
  stepUp(moveX) {
    const b = this.body;
    const dir = Math.sign(moveX);
    if (!(dir > 0 ? b.blocked.right : b.blocked.left)) return false;
    const ahead = this.x + dir * (PLAYER.bodyWidth / 2 + 8);
    const feetY = this.feetY;
    const L = this.scene.level;
    if (!L) return false;
    const step = L.solids.find((s) => !s.noBody && ahead >= s.x && ahead <= s.x + s.w && s.y < feetY - 4 && s.y >= feetY - PLAYER.stepHeight);
    if (!step) return false;
    // headroom on top of the step for the whole body
    const blockedAbove = L.solids.some((s) => !s.noBody && ahead >= s.x && ahead <= s.x + s.w && s.y + s.h > step.y - PLAYER.bodyHeight - 4 && s.y < step.y);
    if (blockedAbove) return false;
    const now = this.scene.time.now;
    if (now - this.jumpedAt < 250) return false;
    this.jumpedAt = now; this.coyote = 0; this.jumpsLeft = 1;
    this.onStairs = false; b.setAllowGravity(true);
    b.setVelocityY(PLAYER.stepUpVelocity);
    b.setVelocityX(dir * Math.max(Math.abs(b.velocity.x), PLAYER.runSpeed * 0.6));
    this.setState('jump');
    this.rig.play('stairs_up', { fade: 60, restart: true });
    this.rig.speed = 1.4;
    this.scene.fx.landDust(this.x, feetY, 2);
    return true;
  }

  wallJump(wd) {
    const b = this.body;
    const now = this.scene.time.now;
    this.jumpBuffer = 0; this.coyote = 0; this.jumpsLeft = 1; this.jumpedAt = now;
    this.wallDir = wd; this.wallCoyoteUntil = 0; this.wallLockUntil = now + PLAYER.wallJumpLock;
    this.onStairs = false; b.setAllowGravity(true);
    b.setVelocity(-wd * PLAYER.wallJumpVX, PLAYER.wallJumpVY);
    this.facing = -wd;
    this.setState('wall_jump');
    this.rig.play('wall_jump', { fade: 30, restart: true });
    this.scene.audio.play('sfx_jump', { volume: 0.65, detune: -200 });
    this.scene.fx.landDust(this.x + wd * PLAYER.bodyWidth / 2, this.y + 20, 5);
    this.scene.input_.rumble(0.25, 0.2, 70);
  }

  updateClimb(inp, dt) {
    const b = this.body;
    const L = this.ladder;
    const speed = PLAYER.climbSpeed;
    const dir = inp.held.up ? -1 : inp.held.down ? 1 : 0;
    b.setVelocity(0, dir * speed);
    // ease to the climbing position beside the rungs
    this.body_.x += (this.climbX(L) - this.body_.x) * Math.min(1, dt / 90);
    // moving: the climb loop (run backwards on the way down); still: hang on the rungs
    if (dir !== 0) { this.rig.play('climb', { fade: 110 }); this.rig.speed = dir < 0 ? 1.15 : -0.95; }
    else this.rig.play('climb_hold', { fade: 160 });
    const top = this.feetY <= L.top + 2;
    const bottom = this.feetY >= L.bottom - 2;
    if (inp.pressed.jump) {
      inp.consume('jump'); this.jumpBuffer = 0;
      this.leaveLadder();
      this.jumpsLeft = 1; this.jumpedAt = this.scene.time.now;
      b.setVelocityY(PLAYER.jumpVelocity * 0.6);
      if (Math.abs(inp.moveX) > 0.05) { this.facing = inp.moveX > 0 ? 1 : -1; b.setVelocityX(this.facing * 200); }
      this.setState('jump'); this.rig.play('jump', { fade: 60 });
      return;
    }
    if (top && dir <= 0) {
      // pull up onto the landing above the ladder (the body rises over the clip's length)
      b.setVelocity(0, 0);
      this.climbTop = { y0: this.body_.y, y1: L.top - PLAYER.bodyHeight / 2 - 2, x: L.x };
      this.ladder = null;
      this.setState('climb_top'); this.rig.play('climb_top', { fade: 60, restart: true });
      return;
    }
    if (bottom && dir >= 0) {
      this.leaveLadder();
      this.setState('fall'); this.rig.play('fall', { fade: 120 });
    }
  }

  updateClimbTop(dt) {
    const t = Math.min(1, this.stateTime / this.rig.clip.duration);
    const k = t * t * (3 - 2 * t);
    const c = this.climbTop;
    this.body_.y = c.y0 + (c.y1 - c.y0) * k;
    this.body_.x += (c.x - this.body_.x) * Math.min(1, dt / 90);
    this.body.reset(this.body_.x, this.body_.y);
    if (t >= 1) {
      this.climbTop = null;
      this.leaveLadder();
      this.setState('idle'); this.rig.play('idle', { fade: 120 });
    }
  }

  leaveLadder() {
    this.climbing = false; this.ladder = null; this.climbTop = null;
    this.body.setAllowGravity(true);
    this.rig.speed = 1;
  }

  raiseGuard(moveX) {
    if (Math.abs(moveX) > 0.05) this.facing = moveX > 0 ? 1 : -1;
    this.blocking = true;
    this.guardRaisedAt = this.scene.time.now;
    this.setState('guard');
    this.rig.play('guard', { fade: 90 });
    this.clearHitbox(); this.lunge = 0;
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
    } else if (name === 'slam') {
      const gy = this.y + PLAYER.bodyHeight / 2;
      s.fx.shockwave(this.x + this.facing * 30, gy, this.facing, 1 + 0.5 * ((this.chargeMult || 1) - 1));
      s.fx.landDust(this.x, gy, 14);
      s.fx.shake(0.012, 260);
      s.input_.rumble(1, 0.6, 260);
      s.audio.play('sfx_land', { volume: 1, detune: -600 });
      s.audio.play('sfx_thunder', { volume: 0.35, rate: 1.8 });
    } else if (name === 'hit_on') {
      const heavy = this.state === 'heavy';
      const air = this.state === 'air_attack';
      const base = this.stats.damage();
      const mult = heavy ? 2.2 * (this.chargeMult || 1) : (this.combo === 3 ? 1.5 : air ? 1.2 : 1);
      const reach = (heavy ? 110 : 92) * this.stats.reachMult;
      this.clearHitbox();
      // the slam is a low, wide ground shock; swipes are a forward box
      // the slam is a wide ground shock reaching well behind as well; swipes are a forward box
      const hbW = heavy ? reach * 2.6 : reach, hbH = heavy ? 90 : air ? 180 : 110;
      const hbY = heavy ? this.y + PLAYER.bodyHeight / 2 - 40 : air ? this.y + 40 : this.y - 10;
      this.hitbox = s.combat.add({
        owner: this, faction: 'player', x: this.x + this.facing * (heavy ? reach * 0.2 : reach * 0.55), y: hbY, w: hbW, h: hbH,
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
      if (this.grounded) { s.audio.play('sfx_footstep', { variants: 2, volume: 0.7, detune: -250 }); s.fx.landDust(this.x - this.facing * 14, this.feetY, 2); }
    } else if (name === 'rung') {
      s.audio.play('sfx_footstep', { variants: 2, volume: 0.35, detune: 300 });
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
    const fall = this.fallFrom === null ? 0 : this.feetY - this.fallFrom;
    this.fallFrom = null;
    const s = this.scene;
    if (fall >= PLAYER.hardLandFall && ['jump', 'fall', 'double_jump'].includes(this.state)) {
      // heavy landing: deep squat, dust ring, thud, shake
      this.setState('land_hard');
      this.rig.play('land_hard', { fade: 30, restart: true });
      s.audio.play('sfx_land', { volume: 1, detune: -500 });
      s.fx.landDust(this.x, this.feetY, 14);
      s.fx.shake(0.006 + Math.min(0.01, fall / 60000), 180);
      s.input_.rumble(0.7, 0.3, 160);
      this.body.setVelocityX(this.body.velocity.x * 0.3);
      return;
    }
    s.audio.play('sfx_land', { volume: 0.55 });
    s.fx.landDust(this.x, this.feetY, 7);
    if (['jump', 'fall', 'double_jump'].includes(this.state)) { this.setState('land'); this.rig.play('land', { fade: 40 }); }
  }

  // ------------------------------------------------------------------ damage
  takeHit(info) {
    if (!this.alive || this.invulnerable) return false;
    const now = this.scene.time.now;
    const src = info.source;
    const fromFront = src ? Math.sign(src.x - this.x) === this.facing : -info.dir === this.facing;
    if (this.blocking && fromFront && ['guard', 'guard_hit', 'parry'].includes(this.state)) {
      const s = this.scene;
      if (now - this.guardRaisedAt <= PLAYER.parryWindow) {
        // perfect block: no damage, the attacker is thrown into a stagger
        this.setState('parry');
        this.rig.play('parry', { fade: 20, restart: true });
        s.fx.parry(this.x + this.facing * 40, this.y - 20);
        s.fx.hitStop(110);
        s.fx.shake(0.006, 120);
        s.audio.play('sfx_block', { volume: 1, detune: 500 });
        s.input_.rumble(0.4, 0.9, 140);
        s.fx.number(this.x, this.y - 80, 'PARRY', { color: 0x80d0ff, size: 0.9 });
        if (src && src.takeParry) src.takeParry(this);
        this.stamina = Math.min(this.maxStamina, this.stamina + 10);
        return true;
      }
      if (this.stamina >= PLAYER.blockStamina) {
        const blocked = Math.max(1, Math.round(info.damage * this.stats.damageTakenMult * PLAYER.blockDamageMult));
        this.hp -= blocked;
        this.spendStamina(PLAYER.blockStamina);
        this.setState('guard_hit');
        this.rig.play('guard_hit', { fade: 20, restart: true });
        this.body.setVelocityX(info.dir * 140);
        s.fx.guardFlash(this.x + this.facing * 34, this.y - 10, this.facing);
        s.fx.number(this.x, this.y - 70, blocked, { color: 0xa0c0ff, size: 0.8 });
        s.audio.play('sfx_block', { volume: 0.8 });
        s.input_.rumble(0.3, 0.5, 100);
        s.fx.hitStop(40);
        if (this.hp <= 0) { this.die(); }
        return true;
      }
      // guard broken: exhausted
      this.blocking = false;
      s.fx.number(this.x, this.y - 80, 'GUARD BROKEN', { color: 0xff8040, size: 0.8 });
    }
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
    this.blocking = false;
    if (this.state === 'climb' || this.state === 'climb_top') this.leaveLadder();
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

  destroy() { this.rig.destroy(); this.body_.destroy(); this.shadow.destroy(); if (this.heroLight && this.scene.lighting) this.scene.lighting.remove(this.heroLight); }
}
