import { PLAYER } from '../config.js';

// Demo autopilot: plays the game by feeding a virtual action set into the shared InputManager.
// It explores to the right, fights whatever it meets (blocks/parries telegraphed swings, backsteps,
// chains light combos, slams groups), drinks potions when hurt, lights shrines, opens chests and
// passes gates. Any real keyboard or pad activity ends the demo (handled by the Game scene).
export default class Autopilot {
  constructor(scene) {
    this.scene = scene;
    this.actions = new Set();
    this.taps = {};              // action -> ms remaining held
    this.moveX = 0;
    this.lastX = 0;
    this.stuckMs = 0;
    this.interactCooldown = 0;
    this.thinkTimer = 0;
    this.mood = Math.random();   // per-fight randomness so demos differ
    this.plan = 'explore';
    this.flourishTimer = 3000;
    this.attackCadence = 0;
    this.guardHold = 0;
  }

  tap(action, ms = 70) { this.taps[action] = Math.max(this.taps[action] || 0, ms); }

  update(dt) {
    const s = this.scene;
    const p = s.player;
    this.actions.clear();
    this.moveX = 0;
    for (const a of Object.keys(this.taps)) {
      if (this.taps[a] > 0) { this.actions.add(a); this.taps[a] -= dt; }
    }
    this.interactCooldown -= dt;
    this.flourishTimer -= dt;
    this.attackCadence -= dt;
    this.guardHold -= dt;
    if (!p || !p.alive) { this.publish(); return; }

    // --- potion ---------------------------------------------------------------------------
    if (p.hp < p.maxHp * 0.35 && p.potions > 0 && p.canAct() && this.interactCooldown <= 0) {
      this.tap('potion'); this.interactCooldown = 1500;
    }

    // --- pick a target -------------------------------------------------------------------
    const enemies = s.enemies.filter((e) => e.alive);
    let target = null, best = 1e9;
    for (const e of enemies) {
      const d = Math.abs(e.x - p.x) + Math.abs(e.y - p.y) * 0.5;
      if (d < best && Math.abs(e.x - p.x) < 720) { best = d; target = e; }
    }

    if (target) this.fight(p, target, enemies, dt);
    else this.explore(p, dt);

    // --- stuck detection: hop over whatever is in the way --------------------------------
    if (Math.abs(this.moveX) > 0.1 && Math.abs(p.x - this.lastX) < 0.4 && p.grounded) this.stuckMs += dt; else this.stuckMs = 0;
    if (this.stuckMs > 700) { this.tap('jump', 120); this.stuckMs = -400; }
    this.lastX = p.x;
    this.publish();
  }

  fight(p, e, enemies, dt) {
    const s = this.scene;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const dist = Math.abs(dx);
    const dir = Math.sign(dx) || 1;
    const facingTarget = p.facing === dir;
    const flying = e.t.flying;
    const threat = e.state === 'attack' && dist < (e.t.attack.range + 90);
    const nearby = enemies.filter((o) => Math.abs(o.x - p.x) < 160 && Math.abs(o.y - p.y) < 120).length;
    const reach = 86;

    if (this.guardHold > 0) {
      // keep the guard up for a beat after the swing resolves
      this.actions.add('defend');
      if (!facingTarget) this.moveX = dir * 0.3;
      return;
    }

    if (threat && p.canAct() && p.grounded) {
      // telegraphed swing: block/parry most of the time, otherwise backstep out of it
      if (this.mood < 0.65 && p.stamina > PLAYER.blockStamina + 6) {
        if (!facingTarget) this.moveX = dir;
        this.actions.add('defend');
        this.guardHold = 260 + Math.random() * 200;
      } else if (p.stamina > PLAYER.dodgeStamina) {
        if (!facingTarget) this.moveX = dir;
        this.tap('dodge', 90);
        this.mood = Math.random();
      }
      return;
    }

    if (flying && dy < -60 && dist < 140) {
      // bat overhead: jump and swipe
      if (p.grounded && this.attackCadence <= 0) { this.tap('jump', 100); this.attackCadence = 400; }
      else if (!p.grounded && this.attackCadence <= 0 && p.stamina > PLAYER.lightStamina) { this.tap('light'); this.attackCadence = 500; }
      this.moveX = dir * 0.4;
      return;
    }

    if (dist > reach) {
      this.moveX = dir;
      // close with an occasional leap when the enemy is far
      if (dist > 400 && p.grounded && Math.random() < 0.004) this.tap('jump', 100);
      return;
    }

    // in range: face and attack
    if (!facingTarget) { this.moveX = dir; return; }
    if (this.attackCadence > 0) return;
    const staggered = e.state === 'stagger' || e.state === 'recover';
    const heavyNow = p.stamina >= PLAYER.heavyStamina && (nearby >= 2 || (staggered && Math.random() < 0.5) || (e.t.boss && Math.random() < 0.25));
    if (heavyNow && p.canAct()) {
      this.tap('heavy', 420 + Math.random() * 300);   // hold to charge the slam
      this.attackCadence = 1200;
    } else if (p.stamina >= PLAYER.lightStamina) {
      this.tap('light');
      this.attackCadence = 230;
    } else {
      // out of stamina: give ground
      this.moveX = -dir * 0.6;
      this.attackCadence = 300;
    }
  }

  explore(p, dt) {
    const s = this.scene;
    // objectives: unlit shrine, unopened chest, open gate; otherwise head right
    let goal = null;
    for (const it of s.interactables) {
      if (it.kind === 'shrine' && !it.lit && it.x > p.x - 40) goal = goal || it;
      if (it.kind === 'chest' && !it.opened && Math.abs(it.x - p.x) < 700) goal = goal || it;
      if (it.kind === 'gate' && s.gateKillsNeeded() === 0) goal = goal || it;
    }
    if (goal) {
      const dx = goal.x - p.x;
      const onGround = goal.y === undefined || goal.y >= s.groundY - 1;
      if (Math.abs(dx) < 40) {
        if (!onGround && p.y + PLAYER.bodyHeight / 2 > goal.y + 10) {
          // chest on a platform: double jump up to it
          if (p.grounded) this.tap('jump', 140);
          else if (p.jumpsLeft === 1 && p.body.velocity.y > -100) this.tap('jump', 140);
          this.moveX = Math.sign(dx) * 0.3;
        } else if (this.interactCooldown <= 0) {
          this.tap('interact'); this.interactCooldown = 900;
        }
      } else {
        this.moveX = Math.sign(dx);
        if (!onGround && Math.abs(dx) < 220 && p.grounded) this.tap('jump', 140);
      }
      return;
    }
    this.moveX = 1;
    if (this.flourishTimer <= 0 && p.grounded) {
      // a little showmanship while travelling: leap and flip
      this.tap('jump', 120);
      this.flourishTimer = 4000 + Math.random() * 5000;
      this.scene.time.delayedCall(260, () => this.tap('jump', 120));
    }
  }

  publish() {
    this.scene.input_.virtual = { moveX: this.moveX, moveY: 0, actions: this.actions };
  }

  detach() { this.scene.input_.virtual = null; }
}
