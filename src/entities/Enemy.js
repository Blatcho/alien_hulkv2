import { DEPTH, COMBAT } from '../config.js';
import Rig from '../rig/Rig.js';
import { humanoidClips, batClips } from '../rig/clips/humanoid.js';
import { ENEMY_TYPES } from '../data/enemies.js';

let nextId = 1;

export default class Enemy {
  constructor(scene, x, y, typeKey, { level = 1, patrol = null } = {}) {
    this.scene = scene;
    this.id = nextId++;
    this.typeKey = typeKey;
    const t = ENEMY_TYPES[typeKey];
    this.t = t;
    this.faction = 'enemy';
    this.alive = true;
    this.level = level;
    const scaleHp = 1 + (level - 1) * 0.35;
    const scaleDmg = 1 + (level - 1) * 0.22;
    this.maxHp = Math.round(t.hp * scaleHp); this.hp = this.maxHp;
    this.damage = t.damage * scaleDmg;
    this.xp = Math.round(t.xp * (1 + (level - 1) * 0.3));
    this.facing = -1;
    this.state = 'idle';
    this.stateTime = 0;
    this.cooldown = 600 + Math.random() * 600;
    this.patrol = patrol;
    this.patrolDir = 1;
    this.poise = t.poise;
    this.poiseDamage = 0;
    this.hitbox = null;
    this.guarding = false;
    this.aggro = false;
    this.removeAt = 0;
    this.invulnerable = false;
    this.hoverBase = y;
    this.hoverPhase = Math.random() * Math.PI * 2;
    this.lunge = 0;

    this.body_ = scene.add.rectangle(x, y, t.bodyW, t.bodyH, 0xff0000, 0);
    scene.physics.add.existing(this.body_);
    this.body = this.body_.body;
    this.body.setCollideWorldBounds(true);
    if (t.flying) { this.body.setAllowGravity(false); }
    const def = scene.cache.json.get(`rig_${t.rig}`);
    const clips = t.flying ? batClips() : humanoidClips(t.clipOpts || {});
    this.rig = new Rig(scene, x, y, def, clips, { scale: t.scale });
    this.rig.setDepth(DEPTH.enemies + (t.boss ? 2 : 0));
    this.hipHeight = t.flying ? 0 : def.leg_len * 0.88 * t.scale;
    this.shadow = scene.add.image(x, y, 'fx_shadow').setDepth(DEPTH.enemies - 1).setAlpha(0.5).setScale(t.scale * (t.flying ? 0.6 : 1));
    this.rig.onEvent = (n, ev) => this.onRigEvent(n, ev);
    this.rig.play(t.flying ? 'fly' : 'idle');
    this.rig.clipTime = Math.random() * 1000;
    this.hpBar = scene.add.graphics().setDepth(DEPTH.fx + 1).setVisible(false);
    this.currentAttack = null;
  }

  get x() { return this.body_.x; }
  get y() { return this.body_.y; }
  get grounded() { return this.body.blocked.down || this.body.touching.down; }
  hitBounds() { return { x: this.x, y: this.y, w: this.t.bodyW, h: this.t.bodyH }; }

  setState(s) { if (this.state !== s) { this.state = s; this.stateTime = 0; } }

  distToPlayer() {
    const p = this.scene.player;
    return { dx: p.x - this.x, dy: p.y - this.y, d: Math.hypot(p.x - this.x, p.y - this.y) };
  }

  update(dt) {
    const dts = dt / 1000;
    this.stateTime += dt;
    const p = this.scene.player;
    const b = this.body;
    const t = this.t;
    if (!this.alive) {
      if (!t.flying) this.friction(dts, 1600);
      if (this.removeAt && this.scene.time.now > this.removeAt) this.destroy();
      else this.syncRig(dt);
      return;
    }
    this.cooldown -= dt;
    const { dx, dy, d } = this.distToPlayer();
    const playerAlive = p.alive;
    if (!this.aggro && playerAlive && d < t.aggro && Math.abs(dy) < 260) { this.aggro = true; if (t.boss) this.scene.events.emit('boss-aggro', this); }
    if (this.aggro && d > t.aggro * 1.8) this.aggro = false;

    if (t.flying) { this.updateFlying(dt, dts, dx, dy, d, playerAlive); this.syncRig(dt); return; }

    switch (this.state) {
      case 'stagger':
        this.friction(dts, 1400);
        if (this.stateTime > (this.rig.clipName === 'stagger' ? 500 / Math.max(0.3, this.rig.speed) : 450)) this.setState('idle');
        break;
      case 'guard':
        this.friction(dts, 2000);
        if (Math.abs(dx) > 20) this.facing = Math.sign(dx);
        if (this.stateTime > 700) { this.setState('idle'); this.guarding = false; }
        break;
      case 'attack':
        b.setVelocityX(this.lunge * this.facing);
        this.lunge *= Math.pow(0.02, dts);
        break;
      case 'recover':
        this.friction(dts, 1800);
        if (this.stateTime > 350) this.setState('idle');
        break;
      default: {
        // idle / patrol / chase
        if (this.aggro && playerAlive) {
          if (Math.abs(dx) > 14) this.facing = Math.sign(dx);
          const range = this.pickAttack(d);
          if (range) {
            this.startAttack(range);
          } else {
            const stop = t.attack.range * 0.75;
            if (Math.abs(dx) > stop && Math.abs(dy) < 220) {
              b.setVelocityX(Math.sign(dx) * t.speed);
              this.setState('chase');
              this.rig.play(t.speed > 130 ? 'run' : 'walk', { fade: 120 });
              this.rig.speed = t.speed / 130;
            } else {
              this.friction(dts, 2000);
              this.setState('idle');
              this.rig.play('idle', { fade: 160 });
            }
          }
        } else if (this.patrol) {
          const [x0, x1] = this.patrol;
          if (this.x < x0) this.patrolDir = 1; else if (this.x > x1) this.patrolDir = -1;
          this.facing = this.patrolDir;
          b.setVelocityX(this.patrolDir * t.speed * 0.4);
          this.setState('patrol');
          this.rig.play('walk', { fade: 160 });
          this.rig.speed = 0.7;
        } else {
          this.friction(dts, 2000);
          this.setState('idle');
          this.rig.play('idle', { fade: 160 });
        }
      }
    }
    this.syncRig(dt);
  }

  updateFlying(dt, dts, dx, dy, d, playerAlive) {
    const b = this.body;
    const t = this.t;
    this.hoverPhase += dts * 3;
    if (this.state === 'attack') {
      // dive toward recorded target, then return
      const k = Math.min(1, this.stateTime / 350);
      b.setVelocity(this.diveVX, this.diveVY);
      if (this.stateTime > 420) { this.setState('return'); this.rig.play('fly'); }
      return;
    }
    if (this.state === 'stagger') { b.setVelocity(b.velocity.x * 0.9, b.velocity.y * 0.9); if (this.stateTime > 300) this.setState('idle'); return; }
    const p = this.scene.player;
    let tx = this.x, ty = this.hoverBase;
    if (this.aggro && playerAlive) {
      tx = p.x - Math.sign(dx || 1) * 90;
      ty = p.y - t.hoverY + Math.sin(this.hoverPhase) * 24;
      if (Math.abs(dx) > 10) this.facing = Math.sign(dx);
      if (this.cooldown <= 0 && d < t.aggro * 0.6) {
        this.setState('attack');
        this.cooldown = t.attack.cooldown + Math.random() * 400;
        const L = Math.max(1, d);
        this.diveVX = (dx / L) * t.speed * 2.2; this.diveVY = (dy / L) * t.speed * 2.2;
        this.rig.play('attack', { restart: true });
        this.scene.audio.play('sfx_bat', { volume: 0.5 });
        return;
      }
    } else {
      tx = this.x + Math.cos(this.hoverPhase * 0.4) * 40;
      ty = this.hoverBase + Math.sin(this.hoverPhase) * 30;
    }
    const vx = (tx - this.x) * 3, vy = (ty - this.y) * 3;
    const sp = Math.hypot(vx, vy);
    const max = t.speed;
    if (sp > max) { b.setVelocity(vx / sp * max, vy / sp * max); } else b.setVelocity(vx, vy);
    if (this.state !== 'idle') { this.setState('idle'); this.rig.play('fly'); }
  }

  pickAttack(d) {
    if (this.cooldown > 0) return null;
    const t = this.t;
    if (t.extraAttacks) {
      for (const a of t.extraAttacks) if (d < a.range && Math.random() < a.chance) return a;
    }
    if (d < t.attack.range) return t.attack;
    return null;
  }

  startAttack(a) {
    this.currentAttack = a;
    this.setState('attack');
    this.rig.play(a.clip, { fade: 60, restart: true });
    this.cooldown = (this.t.attack.cooldown) + Math.random() * 500;
    this.lunge = 0;
    this.body.setVelocityX(0);
  }

  friction(dts, f) {
    const v = this.body.velocity.x; const s = f * dts;
    this.body.setVelocityX(Math.abs(v) <= s ? 0 : v - Math.sign(v) * s);
  }

  onRigEvent(name) {
    const s = this.scene;
    const a = this.currentAttack || this.t.attack;
    if (!this.alive) return;
    if (name === 'swing') {
      s.audio.play('sfx_swing', { variants: 3, volume: 0.5, detune: -300 });
      this.lunge = this.t.boss ? 160 : 120;
      if (this.t.flying) return;
      const kind = this.t.rig === 'spearman' ? 'sword' : 'sword';
      s.fx.slash(this.x + this.facing * a.reach * 0.5, this.y - 30, this.facing, kind, (a.reach / 100) * this.t.scale, 0xc0d0ff);
    } else if (name === 'hit_on') {
      this.clearHitbox();
      this.hitbox = s.combat.add({
        owner: this, faction: 'enemy', x: this.x + this.facing * a.reach * 0.5, y: this.y - 10, w: a.reach, h: this.t.bodyH * 0.9,
        damage: this.damage * (a.clip === 'overhead' || a.clip === 'sweep' ? 1.4 : 1), knockback: this.t.boss ? COMBAT.heavyKnockback : COMBAT.knockback,
        heavy: !!this.t.boss, kind: 'weapon', follow: (hb) => { hb.x = this.x + this.facing * a.reach * 0.5; hb.y = this.y - 10; },
      });
    } else if (name === 'hit_off') {
      this.clearHitbox();
    } else if (name === 'end') {
      this.clearHitbox();
      if (this.state === 'attack' || this.state === 'return') { this.setState(this.t.flying ? 'idle' : 'recover'); this.rig.play(this.t.flying ? 'fly' : 'idle', { fade: 120 }); }
      else if (this.state === 'stagger') { this.setState('idle'); }
    } else if (name === 'step' && this.aggro) {
      s.audio.play('sfx_footstep', { variants: 2, volume: 0.25 });
    }
  }

  clearHitbox() { if (this.hitbox) { this.scene.combat.remove(this.hitbox); this.hitbox = null; } }

  syncRig(dt) {
    const bottom = this.body_.y + this.t.bodyH / 2;
    this.rig.setPosition(this.body_.x, this.t.flying ? this.body_.y : bottom - this.hipHeight);
    this.rig.setFacing(this.facing);
    this.rig.update(this.scene.fx.stopped ? 0 : dt);
    this.rig.tick(dt);
    const gy = this.scene.groundYAt ? this.scene.groundYAt(this.x) : bottom;
    this.shadow.setPosition(this.body_.x, gy + 2);
    if (this.hpBar.visible) this.drawHpBar();
  }

  drawHpBar() {
    const g = this.hpBar;
    const w = this.t.boss ? 0 : 54 * this.t.scale;
    g.clear();
    if (!w) { g.setVisible(false); return; }
    const x = this.x - w / 2, y = this.y - this.t.bodyH / 2 - 16;
    g.fillStyle(0x100808, 0.8).fillRect(x - 1, y - 1, w + 2, 6);
    g.fillStyle(0xc02020, 1).fillRect(x, y, w * Math.max(0, this.hp / this.maxHp), 4);
  }

  takeHit(info) {
    if (!this.alive) return false;
    const t = this.t;
    const s = this.scene;
    // guard: armoured enemies sometimes block non-heavy hits from the front
    const fromFront = Math.sign(info.source ? info.source.x - this.x : info.dir) === this.facing;
    if (t.guardChance > 0 && fromFront && !info.heavy && this.state !== 'attack' && Math.random() < t.guardChance) {
      this.setState('guard'); this.guarding = true;
      this.rig.play('guard', { fade: 40, restart: true });
      s.audio.play('sfx_block');
      s.fx.impact(this.x - this.facing * 10, this.y - 20, { metal: true, blood: false });
      s.fx.number(this.x, this.y - t.bodyH / 2 - 10, 'BLOCKED', { color: 0xa0c0ff, size: 0.8 });
      this.body.setVelocityX(info.dir * 120);
      s.fx.hitStop(40);
      return true;
    }
    this.hp -= info.damage;
    this.hpBar.setVisible(true);
    this.rig.flash(80);
    s.fx.number(this.x, this.y - t.bodyH / 2 - 10, info.damage, { color: info.crit ? 0xffd040 : 0xffffff, crit: info.crit });
    s.fx.impact(info.x !== undefined ? (this.x + info.x) / 2 : this.x, this.y - 20, { heavy: info.heavy, metal: t.armored, blood: !t.bone && !t.armored, bone: t.bone });
    s.audio.play(t.armored ? 'sfx_hit_metal' : 'sfx_hit_flesh', { variants: 2, volume: 0.8 });
    if (t.hurtSfx && Math.random() < 0.6) s.audio.play(t.hurtSfx, { volume: 0.5 });
    s.fx.hitStop(info.heavy ? COMBAT.heavyHitStopMs : COMBAT.hitStopMs);
    s.fx.shake(info.heavy ? 0.008 : 0.003, info.heavy ? 160 : 80);
    s.input_.rumble(info.heavy ? 0.8 : 0.3, info.heavy ? 0.6 : 0.5, info.heavy ? 180 : 90);
    if (info.source && info.source.stats && info.source.stats.lifesteal) {
      const heal = Math.round(info.damage * info.source.stats.lifesteal);
      if (heal > 0) info.source.hp = Math.min(info.source.maxHp, info.source.hp + heal);
    }
    if (this.hp <= 0) { this.die(info); return true; }
    // knockback & stagger by poise
    this.poiseDamage += info.heavy ? 3 : 1;
    const kb = (info.knockback || COMBAT.knockback) * (t.boss ? 0.15 : 1);
    if (t.flying) { this.body.setVelocity(info.dir * kb * 0.8, -kb * 0.3); this.setState('stagger'); this.rig.play('hurt', { restart: true }); return true; }
    if (this.poiseDamage > this.poise || info.heavy) {
      this.poiseDamage = 0;
      this.clearHitbox(); this.lunge = 0;
      this.setState('stagger');
      this.rig.play(info.heavy ? 'stagger' : 'hurt', { fade: 30, restart: true });
      this.body.setVelocity(info.dir * kb, info.heavy ? -220 : -80);
    } else {
      this.body.setVelocityX(info.dir * kb * 0.4);
    }
    return true;
  }

  // The player parried this enemy's attack: cancel it and stagger (bosses recover faster).
  takeParry(player) {
    if (!this.alive) return;
    this.clearHitbox(); this.lunge = 0;
    this.poiseDamage = 0;
    this.cooldown = this.t.attack.cooldown + (this.t.boss ? 400 : 900);
    this.setState('stagger');
    this.rig.play('stagger', { fade: 20, restart: true, speed: this.t.boss ? 1.6 : 0.8 });
    this.body.setVelocity(Math.sign(this.x - player.x) * (this.t.boss ? 60 : 220), -120);
    this.rig.flash(60);
    this.scene.audio.play(this.t.hurtSfx, { volume: 0.6 });
  }

  die(info) {
    this.alive = false;
    this.hp = 0;
    this.clearHitbox();
    this.hpBar.setVisible(false);
    this.setState('dead');
    this.rig.play('death', { fade: 40, restart: true });
    this.scene.audio.play(this.t.deathSfx, { volume: 0.8 });
    this.body.setVelocity(info.dir * (this.t.flying ? 200 : 180), this.t.flying ? 200 : -200);
    if (this.t.flying) this.body.setAllowGravity(true);
    this.body.checkCollision.none = false;
    this.removeAt = this.scene.time.now + (this.t.boss ? 4000 : 2200);
    this.scene.tweens.add({ targets: [this.rig, this.shadow], alpha: 0, delay: this.t.boss ? 3000 : 1400, duration: 700 });
    this.scene.onEnemyKilled(this, info);
  }

  destroy() {
    this.clearHitbox();
    this.rig.destroy(); this.body_.destroy(); this.shadow.destroy(); this.hpBar.destroy();
    const i = this.scene.enemies.indexOf(this);
    if (i >= 0) this.scene.enemies.splice(i, 1);
  }
}
