import { WIDTH, HEIGHT, PLAYER, DEPTH, VIEW_TOP, BG_SCALE, ZOOM_STEPS, DEFAULT_ZOOM } from '../config.js';
import { getInput, promptFor } from '../input/Input.js';
import Parallax from '../systems/Parallax.js';
import Combat from '../systems/Combat.js';
import FX from '../systems/FX.js';
import AudioSystem from '../systems/Audio.js';
import Stats from '../systems/Stats.js';
import { writeSave, snapshot } from '../systems/Save.js';
import Player from '../entities/Player.js';
import Enemy from '../entities/Enemy.js';
import Pickup from '../entities/Pickup.js';
import { ZONES } from '../data/zones.js';
import Autopilot from '../systems/Autopilot.js';
import Lighting from '../systems/Lighting.js';

export default class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.zoneKey = (data && data.zone) || 'thornmoor';
    this.stats = (data && data.stats) || new Stats();
    this.carry = (data && data.carry) || null;      // gold/potions/inventory carried between zones or from a save
    this.startX = data && data.startX;
    this.openedChests = new Set((data && data.openedChests) || []);
    this.demo = !!(data && data.demo);
    // Resuming from the title's "Continue": unpack the saved snapshot.
    if (data && data.save) {
      const sv = data.save;
      this.carry = { gold: sv.gold || 0, potions: sv.potions !== undefined ? sv.potions : 3, inventory: sv.inventory || [], kills: sv.kills || 0 };
      this.startX = sv.checkpointX || this.startX;
      this.openedChests = new Set(sv.openedChests || []);
    }
  }

  create() {
    const zone = ZONES[this.zoneKey];
    this.zone = zone;
    this.input_ = getInput();
    this.audio = new AudioSystem(this);
    this.fx = new FX(this);
    this.combat = new Combat(this);
    this.enemies = [];
    this.pickups = [];
    this.interactables = [];
    this.torches = [];
    this.spawned = new Set();
    this.gate = null; this.gateWall = null; this.boss = null; this.prompt = null;
    this.worldW = zone.width;
    this.physics.world.setBounds(0, -2000, zone.width, HEIGHT + 2000);
    const bgMeta = this.cache.json.get('bg_layers')[this.zoneKey];
    this.groundY = bgMeta.ground_y;
    const moonScreen = { x: bgMeta.moon.x * BG_SCALE, y: bgMeta.moon.y * BG_SCALE };
    this.lighting = new Lighting(this, { ...bgMeta, moon: moonScreen, ambient: zone.ambient, moonLight: zone.moonLight });
    this.parallax = new Parallax(this, this.zoneKey, { ...bgMeta, weather: zone.weather, lightning: zone.lightning, shafts: zone.shafts });

    this.ground = this.physics.add.staticGroup();
    this.ground.add(this.add.rectangle(0, this.groundY, zone.width, 200, 0, 0).setOrigin(0));
    this.platforms = this.physics.add.staticGroup();
    for (const p of zone.platforms) this.buildPlatform(p);
    for (const p of zone.props) this.buildProp(p);
    for (const c of zone.checkpoints) this.buildShrine(c);
    for (const c of zone.chests) this.buildChest(c);
    if (zone.gate) this.buildGate(zone.gate);
    this.checkpointX = this.startX || zone.start;

    const px = this.checkpointX;
    this.player = new Player(this, px, this.groundY - PLAYER.bodyHeight / 2 - 2, this.stats);
    if (this.carry) {
      this.player.gold = this.carry.gold || 0; this.player.potions = this.carry.potions !== undefined ? this.carry.potions : 3;
      this.player.inventory = this.carry.inventory || []; this.player.kills = this.carry.kills || 0;
    }
    this.physics.add.collider(this.player.body_, this.ground);
    this.physics.add.collider(this.player.body_, this.platforms);
    this.enemyDefs = zone.enemies.map((e, i) => ({ ...e, id: i }));
    this.bossDef = zone.boss || null;
    this.bossSpawned = false;
    this.boss = null;

    const cam = this.cameras.main;
    // Horizontal follow only; the vertical framing is set by applyZoom so the ground line stays put.
    cam.setBounds(0, -100000, zone.width, 200000);
    cam.startFollow(this.player.body_, true, 0.1, 0, 0, 0);
    cam.setDeadzone(120, 60);
    this.zoom = this.loadZoom();
    this.applyZoom(this.zoom, true);
    cam.fadeIn(600, 0, 0, 0);
    // Zone music (and the boss/victory tracks) are fetched on demand to keep the first load small.
    const zoneKey = this.zoneKey;
    if (this.cache.audio.exists(zone.music)) this.audio.playMusic(zone.music);
    else this.load.audio(zone.music, `assets/audio/${zone.music}.ogg`);
    for (const k of ['music_boss', 'music_victory']) if (!this.cache.audio.exists(k)) this.load.audio(k, `assets/audio/${k}.ogg`);
    if (this.load.list.size > 0) {
      this.load.once('complete', () => { if (this.scene.isActive() && this.zoneKey === zoneKey && !this.audio.musicKey) this.audio.playMusic(zone.music); });
      this.load.start();
    }
    this.time.delayedCall(500, () => this.events.emit('zone-title', zone.name, zone.subtitle));
    if (new URLSearchParams(location.search).get('debug')) this.combat.debug = true;

    this.events.on('restart-checkpoint', () => this.restartFromCheckpoint());
    this.events.on('player-died', () => this.time.delayedCall(1600, () => { if (!this.player.alive && !this.demo) this.scene.launch('GameOver'); }));
    this.events.on('boss-aggro', (boss) => this.onBossAggro(boss));
    this.prompt = this.add.bitmapText(0, 0, 'body', '', 20).setOrigin(0.5).setDepth(DEPTH.fx + 3).setVisible(false);
    this.gateOpen = false;
    this.transitioning = false;
    this.autopilot = null;
    if (this.demo) {
      this.autopilot = new Autopilot(this);
      this.player.potions = 5;
      this.time.delayedCall(2600, () => this.events.emit('toast', 'DEMO  -  press any button to take control', 3500));
      this.events.on('player-died', () => this.time.delayedCall(2400, () => { if (this.demo && !this.player.alive) this.restartFromCheckpoint(); }));
    }
    this.events.once('shutdown', () => this.cleanup());
  }

  // Leave the self-playing demo as soon as a real device produces input.
  endDemo() {
    if (!this.demo) return;
    this.demo = false;
    if (this.autopilot) { this.autopilot.detach(); this.autopilot = null; }
    this.events.emit('toast', 'You have the beast', 1800);
    this.events.emit('demo-ended');
  }

  // ------------------------------------------------------------------ zoom
  loadZoom() {
    try { const z = parseFloat(localStorage.getItem('botm_zoom')); if (ZOOM_STEPS.includes(z)) return z; } catch (e) { /* ignore */ }
    return DEFAULT_ZOOM;
  }

  applyZoom(z, silent = false) {
    this.zoom = z;
    const cam = this.cameras.main;
    cam.setZoom(z);
    // keep the world ground line at the same screen height as the zoom-1 framing (780 of 900)
    const groundScreen = this.groundY - VIEW_TOP;
    const centerY = this.groundY - (groundScreen - HEIGHT / 2) / z;
    cam.scrollY = centerY - HEIGHT / 2;
    this.parallax.setZoom(z);
    try { localStorage.setItem('botm_zoom', String(z)); } catch (e) { /* ignore */ }
    if (!silent) this.events.emit('toast', `Zoom ${Math.round(z * 100)}%`, 900);
  }

  stepZoom(dir) {
    const i = ZOOM_STEPS.indexOf(this.zoom);
    const j = Math.max(0, Math.min(ZOOM_STEPS.length - 1, (i < 0 ? ZOOM_STEPS.indexOf(DEFAULT_ZOOM) : i) + dir));
    if (ZOOM_STEPS[j] !== this.zoom) this.applyZoom(ZOOM_STEPS[j]);
  }

  cleanup() {
    this.audio.stopMusic(200);
    if (this.autopilot) this.autopilot.detach();
    this.input_.virtual = null;
    for (const ev of ['restart-checkpoint', 'player-died', 'boss-aggro']) this.events.off(ev);
  }

  // ------------------------------------------------------------------ world
  buildPlatform(p) {
    const ts = this.lighting.lit(this.add.tileSprite(p.x, p.y, p.w, 28, 'world_platform').setOrigin(0, 0).setDepth(DEPTH.props));
    const body = this.add.rectangle(p.x, p.y, p.w, 20, 0, 0).setOrigin(0, 0);
    this.platforms.add(body);
    body.body.checkCollision.down = false; body.body.checkCollision.left = false; body.body.checkCollision.right = false;
    return ts;
  }

  buildProp(p) {
    const key = `prop_${p.type}`;
    if (p.type === 'fence') { this.lighting.lit(this.add.image(p.x, this.groundY + 2, 'world_fence').setOrigin(0.5, 1).setDepth(DEPTH.props - 1)); return; }
    if (!this.textures.exists(key)) return;
    if (p.type === 'torch') {
      // standing torch: iron post from the ground up to the bracket
      this.add.rectangle(p.x, this.groundY + 2, 6, 110, 0x1a1a20).setOrigin(0.5, 1).setDepth(DEPTH.props - 2);
      this.add.image(p.x, this.groundY - 130, key).setOrigin(0.5, 0.5).setDepth(DEPTH.props - 1);
      const flame = this.add.sprite(p.x, this.groundY - 170, 'fx_flame').setOrigin(0.5, 0.75).setDepth(DEPTH.props).setBlendMode('ADD').setScale(1.1);
      flame.play({ key: 'flame', startFrame: Math.floor(Math.random() * 6) });
      const glow = this.add.image(p.x, this.groundY - 160, 'glow').setDepth(DEPTH.props + 1).setBlendMode('ADD').setAlpha(0.45).setScale(1.6);
      const emitter = this.add.particles(p.x, this.groundY - 175, 'particle_soft', {
        speedY: { min: -70, max: -30 }, speedX: { min: -15, max: 15 }, lifespan: { min: 500, max: 1100 }, scale: { start: 0.25, end: 0 },
        alpha: { start: 0.9, end: 0 }, tint: [0xffa040, 0xff6020], frequency: 90, blendMode: 'ADD',
      }).setDepth(DEPTH.props + 1);
      this.torches.push({ glow, flame, emitter, phase: Math.random() * 10 });
      this.lighting.addTorch(p.x, this.groundY - 165);
      return;
    }
    if (p.type === 'cage') {
      const img = this.lighting.lit(this.add.image(p.x, p.y || 230, key).setOrigin(0.5, 0).setDepth(DEPTH.props - 2));
      this.tweens.add({ targets: img, angle: { from: -2.5, to: 2.5 }, duration: 2600 + Math.random() * 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      return;
    }
    const pivotY = p.type === 'pillar' || p.type.startsWith('gravestone') || p.type === 'skull' ? 1 : 1;
    if (p.type === 'brazier' && this.textures.exists(key)) {
      this.lighting.lit(this.add.image(p.x, this.groundY + 4, key).setOrigin(0.5, 1).setDepth(DEPTH.props - 1));
      const flame = this.add.sprite(p.x, this.groundY - 62, 'fx_flame').setOrigin(0.5, 0.8).setDepth(DEPTH.props).setBlendMode('ADD').setScale(1.5, 1.3);
      flame.play({ key: 'flame', startFrame: Math.floor(Math.random() * 6) });
      this.lighting.addTorch(p.x, this.groundY - 70, { radius: 340, intensity: 1.5 });
      return;
    }
    if (p.type === 'banner') { this.lighting.lit(this.add.image(p.x, p.y || 240, key).setOrigin(0.5, 0).setDepth(DEPTH.props - 2)); return; }
    this.lighting.lit(this.add.image(p.x, this.groundY + 4, key).setOrigin(0.5, pivotY).setDepth(DEPTH.props - 2));
  }

  buildShrine(c) {
    const img = this.lighting.lit(this.add.sprite(c.x, this.groundY + 2, 'prop_shrine', 0).setOrigin(0.5, 1).setDepth(DEPTH.props - 1));
    const glow = this.add.image(c.x, this.groundY - 110, 'glow').setDepth(DEPTH.props).setBlendMode('ADD').setAlpha(0).setScale(1.4).setTint(0x80c0ff);
    const shrine = { kind: 'shrine', x: c.x, img, glow, lit: false, range: 70 };
    this.interactables.push(shrine);
  }

  buildChest(c) {
    const y = c.y !== undefined ? c.y : this.groundY;
    const id = `${this.zoneKey}:${c.x}`;
    const opened = this.openedChests.has(id);
    const img = this.lighting.lit(this.add.sprite(c.x, y + 2, 'prop_chest', opened ? 1 : 0).setOrigin(0.5, 1).setDepth(DEPTH.props - 1));
    this.interactables.push({ kind: 'chest', x: c.x, y, img, id, opened, range: 70 });
  }

  buildGate(g) {
    const img = this.lighting.lit(this.add.image(g.x, this.groundY + 4, 'world_gate').setOrigin(0.5, 1).setDepth(DEPTH.props - 1));
    this.gate = { kind: 'gate', x: g.x, img, range: 90 };
    this.interactables.push(this.gate);
    // invisible wall until the gate opens
    this.gateWall = this.add.rectangle(g.x + 40, this.groundY - 150, 20, 300, 0, 0).setOrigin(0.5, 0);
    this.platforms.add(this.gateWall);
  }

  groundYAt() { return this.groundY; }

  spawnEnemy(type, x, level = 1, opts = {}) {
    const e = new Enemy(this, x, this.groundY - 80, type, { level, ...opts });
    if (e.t.flying) { e.body_.y = this.groundY - (e.t.hoverY || 150); e.hoverBase = e.body_.y; }
    this.physics.add.collider(e.body_, this.ground);
    // one-way platforms: enemies drop through when the player is well below them
    this.physics.add.collider(e.body_, this.platforms, null, () => !(e.aggro && this.player.y > e.y + 60));
    this.enemies.push(e);
    return e;
  }

  // Enemies spawn when the camera approaches so the world stays cheap.
  spawnNearby() {
    const camX = this.cameras.main.scrollX;
    const lvl = this.zone.level;
    for (const d of this.enemyDefs) {
      if (this.spawned.has(d.id)) continue;
      if (d.x < camX + WIDTH + 400 && d.x > camX - 400) {
        this.spawned.add(d.id);
        this.spawnEnemy(d.type, d.x, lvl, { patrol: d.patrol || null });
      }
    }
    if (this.bossDef && !this.bossSpawned && this.player.x > this.bossDef.arena[0] - 500) {
      this.bossSpawned = true;
      this.boss = this.spawnEnemy(this.bossDef.type, this.bossDef.x, lvl);
    }
  }

  onBossAggro(boss) {
    this.audio.playMusic('music_boss', { fade: 600 });
    this.audio.play('sfx_boss_roar');
    this.fx.shake(0.01, 500);
    this.events.emit('boss-start', boss.t.name, () => ({ hp: boss.hp, maxHp: boss.maxHp }));
    // arena walls
    const [a, b] = this.bossDef.arena;
    this.platforms.add(this.add.rectangle(a - 10, this.groundY - 400, 20, 400, 0, 0).setOrigin(0.5, 0));
    this.platforms.add(this.add.rectangle(b + 10, this.groundY - 400, 20, 400, 0, 0).setOrigin(0.5, 0));
    this.cameras.main.setBounds(a - 140, -100000, (b - a) + 280, 200000);
  }

  onEnemyKilled(enemy, info) {
    this.player.kills += 1;
    const loot = this.registry.get('loot');
    let drops = [{ type: 'gold', amount: 3 + Math.floor(Math.random() * 6) * (enemy.t.tier + 1) }];
    if (loot && loot.rollDrops) drops = loot.rollDrops(enemy.t.tier, this.stats.level, { luck: this.stats.goldFind - 1 });
    drops.push({ type: 'gem', amount: enemy.xp });
    for (const d of drops) this.pickups.push(new Pickup(this, enemy.x, enemy.y - 20, d));
    this.events.emit('enemy-killed', enemy);
    if (enemy.t.boss) {
      this.events.emit('boss-end');
      this.audio.stopMusic(1500);
      this.fx.shake(0.02, 900);
      this.time.delayedCall(3500, () => { if (this.player.alive) { this.writeCheckpoint(); this.scene.pause(); this.scene.launch('Victory'); } });
    }
  }

  onLevelUp(levels) {
    this.player.maxHp = this.stats.maxHp; this.player.maxStamina = this.stats.maxStamina;
    this.player.hp = this.player.maxHp; this.player.stamina = this.player.maxStamina;
    this.events.emit('levelup', this.stats.level);
    this.fx.flashScreen(0xffe0a0, 200, 0.3);
  }

  addItemToInventory(item) {
    this.player.inventory = this.player.inventory || [];
    this.player.inventory.push(item);
    this.events.emit('toast', `Found ${item.name}`, 2200);
  }

  // ----------------------------------------------------------- interaction
  updateInteractables() {
    const p = this.player;
    let near = null;
    for (const it of this.interactables) {
      if (Math.abs(it.x - p.x) < it.range && Math.abs((it.y !== undefined ? it.y : this.groundY) - (p.y + PLAYER.bodyHeight / 2)) < 90) { near = it; break; }
    }
    if (near && p.alive && !this.transitioning) {
      let text = '';
      const btn = promptFor('interact', this.input_.lastDevice);
      if (near.kind === 'shrine') text = near.lit ? `[${btn}] Rest at the shrine` : `[${btn}] Light the shrine`;
      else if (near.kind === 'chest') text = near.opened ? '' : `[${btn}] Open chest`;
      else if (near.kind === 'gate') text = this.gateKillsNeeded() > 0 ? `The gate is barred. ${this.gateKillsNeeded()} more foes must fall.` : `[${btn}] Pass through the gate`;
      this.prompt.setText(text).setPosition(near.x, this.groundY - 230).setVisible(!!text);
      if (this.input_.pressed.interact && text && !text.startsWith('The gate')) {
        this.input_.consume('interact');
        this.interact(near);
      }
    } else {
      this.prompt.setVisible(false);
    }
  }

  enemiesRemaining() {
    return this.enemyDefs.filter((d) => !this.spawned.has(d.id)).length + this.enemies.filter((e) => e.alive).length;
  }

  // The gate yields once three quarters of the zone's foes have fallen (stragglers do not block progress).
  gateKillsNeeded() {
    const total = this.enemyDefs.length;
    const killed = total - this.enemiesRemaining();
    return Math.max(0, Math.ceil(total * 0.75) - killed);
  }

  interact(it) {
    const p = this.player;
    if (it.kind === 'shrine') {
      it.lit = true;
      it.img.setFrame(1);
      it.glow.setAlpha(0.5);
      this.tweens.add({ targets: it.glow, alpha: 0.3, duration: 1200, yoyo: true, repeat: -1 });
      this.lighting.addPoint(it.x, this.groundY - 120, 260, 0x80c0ff, 1.0);
      p.hp = p.maxHp; p.stamina = p.maxStamina; p.potions = Math.max(p.potions, 3);
      this.checkpointX = it.x;
      this.writeCheckpoint();
      this.audio.play('sfx_checkpoint');
      this.events.emit('toast', 'Shrine lit. Progress saved.', 2000);
      this.fx.flashScreen(0x80c0ff, 300, 0.2);
    } else if (it.kind === 'chest' && !it.opened) {
      it.opened = true;
      it.img.setFrame(1);
      this.openedChests.add(it.id);
      this.audio.play('sfx_chest');
      const loot = this.registry.get('loot');
      const drops = [{ type: 'gold', amount: 20 + Math.floor(Math.random() * 30) * this.zone.level }, { type: 'potion' }];
      if (loot && loot.rollItem) drops.push({ type: 'item', item: loot.rollItem(this.stats.level + this.zone.level, { luck: 0.6 }) });
      for (const d of drops) this.pickups.push(new Pickup(this, it.x, (it.y !== undefined ? it.y : this.groundY) - 40, d));
    } else if (it.kind === 'gate') {
      this.passGate();
    }
  }

  passGate() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.audio.play('sfx_gate');
    this.tweens.add({ targets: this.gate.img, y: this.gate.img.y - 200, duration: 1600, ease: 'Sine.easeInOut' });
    this.gateWall.destroy();
    this.player.gateX = this.gate.x + 160;
    this.cameras.main.fadeOut(1800, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const next = this.zone.next;
      const carry = { gold: this.player.gold, potions: this.player.potions, inventory: this.player.inventory || [], kills: this.player.kills };
      this.scene.restart({ zone: next, stats: this.stats, carry, openedChests: [...this.openedChests], demo: this.demo });
      this.time.delayedCall(50, () => this.writeCheckpoint());
    });
  }

  writeCheckpoint() {
    writeSave(snapshot(this));
  }

  restartFromCheckpoint() {
    const carry = { gold: this.player.gold, potions: Math.max(this.player.potions, 2), inventory: this.player.inventory || [], kills: this.player.kills };
    this.scene.restart({ zone: this.zoneKey, stats: this.stats, carry, startX: this.checkpointX, openedChests: [...this.openedChests], demo: this.demo });
  }

  // ------------------------------------------------------------------ update
  update(time, delta) {
    const dt = Math.min(delta, 50);
    const inp = this.input_;
    if (this.autopilot) this.autopilot.update(dt);
    inp.update(this.game.loop.frame);
    if (this.demo && inp.realActivity) { for (const a of Object.keys(inp.pressed)) inp.consume(a); this.endDemo(); }
    this.parallax.update(time, dt);
    this.lighting.update(time);
    for (const t of this.torches) {
      const f = 0.4 + 0.12 * Math.sin(time / 90 + t.phase) + 0.06 * Math.sin(time / 37 + t.phase * 2);
      t.glow.setAlpha(f).setScale(1.5 + 0.1 * Math.sin(time / 120 + t.phase));
    }
    if (this.fx.stopped) { this.physics.world.pause(); } else if (this.physics.world.isPaused) { this.physics.world.resume(); }
    if (inp.pressed.zoomOut) { inp.consume('zoomOut'); this.stepZoom(-1); }
    if (inp.pressed.zoomIn) { inp.consume('zoomIn'); this.stepZoom(1); }
    if (inp.pressed.pause && this.player.alive && !this.transitioning) {
      inp.consume('pause');
      if (this.scene.manager.keys.Pause) { this.scene.launch('Pause'); this.scene.pause(); return; }
    }
    this.spawnNearby();
    this.player.update(inp, dt);
    for (const e of [...this.enemies]) e.update(dt);
    for (const p of [...this.pickups]) p.update(dt);
    this.combat.update(this.player, this.enemies);
    this.updateInteractables();
    // fell off the world (should not happen with flat ground, but be safe)
    if (this.player.y > HEIGHT + 400 && this.player.alive) { this.player.takeHit({ damage: 9999, dir: 1 }); }
  }
}
