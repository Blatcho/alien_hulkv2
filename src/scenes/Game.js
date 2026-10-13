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
import { TILE } from '../data/rooms.js';
import Autopilot from '../systems/Autopilot.js';
import Lighting from '../systems/Lighting.js';
import { generateLevel, randomSeed, ROOM_H } from '../systems/LevelGen.js';

const STAIR_LEAD = 22;   // half a body width: how far ahead of the centre a stair slope is sampled

export default class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.zoneKey = (data && data.zone) || 'thornmoor';
    this.stats = (data && data.stats) || new Stats();
    this.carry = (data && data.carry) || null;      // gold/potions/inventory carried between zones or from a save
    this.startAt = data && data.startAt;            // { x, y } checkpoint
    this.openedChests = new Set((data && data.openedChests) || []);
    this.demo = !!(data && data.demo);
    const urlSeed = parseInt(new URLSearchParams(location.search).get('seed') || '', 10);
    this.seed = (data && data.seed) || (Number.isFinite(urlSeed) ? urlSeed : randomSeed());
    // Resuming from the title's "Continue": unpack the saved snapshot.
    if (data && data.save) {
      const sv = data.save;
      this.carry = { gold: sv.gold || 0, potions: sv.potions !== undefined ? sv.potions : 3, inventory: sv.inventory || [], kills: sv.kills || 0 };
      this.startAt = sv.checkpoint || (sv.checkpointX !== undefined ? { x: sv.checkpointX, y: 600 } : null);
      this.openedChests = new Set(sv.openedChests || []);
      if (sv.seed) this.seed = sv.seed;
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

    // ---- generate the level ----------------------------------------------------------------
    const L = generateLevel({ seed: this.seed, zoneIndex: zone.zoneIndex, cols: zone.cols, rows: zone.rows, cloudRow: zone.cloudRow, highRow: zone.highRow, enemyTypes: zone.enemyTypes, level: zone.level });
    this.level = L;
    this.worldW = L.worldW;
    this.groundY = L.groundY;
    this.topY = L.topY;
    this.physics.world.setBounds(0, L.topY - 2000, L.worldW, (L.groundY + 300) - (L.topY - 2000));
    const bgMeta = this.cache.json.get('bg_layers')[this.zoneKey];
    const moonScreen = { x: bgMeta.moon.x * BG_SCALE, y: bgMeta.moon.y * BG_SCALE };
    this.lighting = new Lighting(this, { ...bgMeta, moon: moonScreen, ambient: zone.ambient, moonLight: zone.moonLight });
    this.parallax = new Parallax(this, this.zoneKey, { ...bgMeta, weather: zone.weather, lightning: zone.lightning, shafts: zone.shafts, topY: L.topY, cloudY: L.groundY - zone.cloudRow * ROOM_H, highY: L.groundY - zone.highRow * ROOM_H });

    this.ground = this.physics.add.staticGroup();
    this.ground.add(this.add.rectangle(0, this.groundY, L.worldW, 200, 0, 0).setOrigin(0));
    this.platforms = this.physics.add.staticGroup();
    this.ladders = L.ladders;
    this.stairs = L.stairs;
    this.buildTiles(L);
    this.doorBodies = this.physics.add.staticGroup();
    this.walls = this.physics.add.staticGroup();
    this.doors = []; this.breakables = [];
    for (const d of L.doors) { if (d.kind === 'breakable') this.buildBreakable(d); else this.buildDoor(d); }
    this.rooms = L.rooms.map((r) => ({ ...r, active: false, cleared: false, enemies: [] }));
    this.playerRoom = null; this.arena = null;
    for (const t of L.torches) this.buildTorch(t.x, t.y);
    for (const p of L.props) this.buildProp(p.kind, p.x, p.y);
    for (const r of L.rails) this.buildRail(r.x, r.y);
    for (const c of L.shrines) this.buildShrine(c);
    for (const c of L.chests) this.buildChest(c);
    if (L.gate) this.buildGate(L.gate);
    this.checkpoint = this.startAt || { x: L.start.x, y: L.start.y };

    this.player = new Player(this, this.checkpoint.x, this.checkpoint.y - PLAYER.bodyHeight / 2 - 2, this.stats);
    if (this.carry) {
      this.player.gold = this.carry.gold || 0; this.player.potions = this.carry.potions !== undefined ? this.carry.potions : 3;
      this.player.inventory = this.carry.inventory || []; this.player.kills = this.carry.kills || 0;
    }
    this.physics.add.collider(this.player.body_, this.ground);
    this.physics.add.collider(this.player.body_, this.platforms, null, () => !this.player.dropThrough && !this.player.climbing);
    this.physics.add.collider(this.player.body_, this.doorBodies);
    this.physics.add.collider(this.player.body_, this.walls);
    this.enemyDefs = L.enemies.map((e, i) => ({ ...e, id: i }));
    this.bossDef = zone.boss ? { type: zone.boss.type, x: L.gate.x - 420, y: L.gate.y, arena: [L.gate.x - 1100, L.gate.x + 120] } : null;
    this.bossSpawned = false;

    const cam = this.cameras.main;
    cam.startFollow(this.player.body_, true, 0.1, 0.1, 0, 60);
    cam.setDeadzone(120, 80);
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
    this.events.emit('seed', this.seed);
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
    // the camera may rise to the top of the level; at the bottom it keeps the ground-line framing
    const bottom = this.groundY + 120 / z;
    const top = this.topY - 360 / z;
    cam.setBounds(0, top, this.worldW, bottom - top);
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

  // ------------------------------------------------------------------ world building
  tileSet(band) {
    const sky = band === 'sky';
    const has = (k) => this.textures.exists(k);
    return {
      fill: sky && has('world_sky_fill') ? 'world_sky_fill' : has('world_stone_fill') ? 'world_stone_fill' : 'world_platform',
      top: sky && has('world_sky_top') ? 'world_sky_top' : has('world_stone_top') ? 'world_stone_top' : 'world_platform',
      edgeL: sky && has('world_sky_edge_l') ? 'world_sky_edge_l' : has('world_stone_edge_l') ? 'world_stone_edge_l' : null,
      edgeR: sky && has('world_sky_edge_r') ? 'world_sky_edge_r' : has('world_stone_edge_r') ? 'world_stone_edge_r' : null,
      platform: sky && has('world_cloud_platform') ? 'world_cloud_platform' : 'world_platform',
      ladder: sky && has('world_ladder_sky') ? 'world_ladder_sky' : has('world_ladder') ? 'world_ladder' : null,
      stair: sky && has('world_stair_sky') ? 'world_stair_sky' : has('world_stair') ? 'world_stair' : null,
    };
  }

  buildTiles(L) {
    for (const s of L.solids) {
      const ts = this.tileSet(s.band);
      // visuals: a top strip where exposed, masonry fill elsewhere, caps at run ends
      const img = this.lighting.lit(this.add.tileSprite(s.x, s.y, s.w, s.h, s.top ? ts.top : ts.fill).setOrigin(0, 0).setDepth(DEPTH.props - 3));
      if (s.top && ts.fill !== ts.top && s.h > TILE) img.setTexture(ts.fill);
      if (s.capL && ts.edgeL) this.lighting.lit(this.add.image(s.x, s.y, ts.edgeL).setOrigin(0, 0).setDepth(DEPTH.props - 2.9));
      if (s.capR && ts.edgeR) this.lighting.lit(this.add.image(s.x + s.w - TILE, s.y, ts.edgeR).setOrigin(0, 0).setDepth(DEPTH.props - 2.9));
      if (s.noBody) continue;   // masonry under a stair slope: the slope line carries the walker
      const body = this.add.rectangle(s.x, s.y, s.w, s.h, 0, 0).setOrigin(0, 0);
      this.ground.add(body);
    }
    for (const p of L.platforms) {
      const ts = this.tileSet(p.band);
      if (!p.ladderTop) this.lighting.lit(this.add.tileSprite(p.x, p.y, p.w, 28, ts.platform).setOrigin(0, 0).setDepth(DEPTH.props));
      const body = this.add.rectangle(p.x, p.y, p.w, p.h, 0, 0).setOrigin(0, 0);
      this.platforms.add(body);
      body.body.checkCollision.down = false; body.body.checkCollision.left = false; body.body.checkCollision.right = false;
    }
    for (const l of L.ladders) {
      const ts = this.tileSet(l.band);
      if (ts.ladder) this.lighting.lit(this.add.tileSprite(l.x, l.top, 48, l.bottom - l.top, ts.ladder).setOrigin(0.5, 0).setDepth(DEPTH.props - 2));
      else this.add.rectangle(l.x, l.top, 40, l.bottom - l.top, 0x6a4a30, 0.8).setOrigin(0.5, 0).setDepth(DEPTH.props - 2);
    }
    for (const st of L.stairs) {
      const ts = this.tileSet(st.band);
      for (const t of st.tiles) {
        if (ts.stair) this.lighting.lit(this.add.image(t.x, t.y, ts.stair).setOrigin(0, 0).setDepth(DEPTH.props - 2.5).setFlipX(st.dir < 0));
        else if (st.dir > 0) this.add.triangle(t.x, t.y, 0, TILE, TILE, 0, TILE, TILE, 0x5a5550).setOrigin(0, 0).setDepth(DEPTH.props - 2.5);
        else this.add.triangle(t.x, t.y, 0, 0, TILE, TILE, 0, TILE, 0x5a5550).setOrigin(0, 0).setDepth(DEPTH.props - 2.5);
      }
    }
    // dark backdrop behind rooms above the ground band so the sky shows through only at the open edges
  }

  // Height of a stair surface under x, if (x, feetY) is close to one; else null.
  stairSurface(x, feetY, tol = 48) {
    const s = this.stairAt(x, feetY, tol);
    return s ? s.y : null;
  }

  // The stair under (x, feetY) with the surface height there, or null. The slope is sampled half a body
  // width ahead (toward the rise) so a walker's leading edge clears the landing instead of hitting its
  // face, and the run is extended by the same amount at the bottom so the lift starts from floor level.
  stairAt(x, feetY, tol = 48) {
    for (const st of this.stairs) {
      const lo = st.dir > 0 ? st.x0 - STAIR_LEAD : st.x0, hi = st.dir > 0 ? st.x1 : st.x1 + STAIR_LEAD;
      if (x < lo || x > hi) continue;
      const xs = Math.min(st.x1, Math.max(st.x0, x + st.dir * STAIR_LEAD));
      const t = (xs - st.x0) / (st.x1 - st.x0);
      const y = st.yAtLeft + (st.yAtRight - st.yAtLeft) * t;
      if (feetY > y - tol && feetY < y + tol) return { y, dir: st.dir, st };
    }
    return null;
  }

  // Ladders overlapping the vertical span top..bottom at x. The feet may rest exactly on the landing at
  // a ladder's top (climbing down starts from there), so a ladder whose top is at the feet counts too.
  laddersAt(x, top, bottom) {
    return this.ladders.filter((l) => Math.abs(l.x - x) <= 32 && bottom > l.top - 6 && top < l.bottom);
  }

  ladderAt(x, top, bottom) {
    return this.laddersAt(x, top, bottom)[0] || null;
  }

  // Is there standing room (floor) at a point? Used by enemies to avoid walking off ledges.
  hasFloor(x, y) {
    if (y >= this.groundY - 2) return true;
    for (const s of this.level.solids) if (x >= s.x && x <= s.x + s.w && y >= s.y - 6 && y <= s.y + 24) return true;
    for (const p of this.level.platforms) if (x >= p.x && x <= p.x + p.w && y >= p.y - 6 && y <= p.y + 24) return true;
    return this.stairSurface(x, y, 40) !== null;
  }

  buildTorch(x, floorY) {
    this.add.rectangle(x, floorY + 2, 6, 110, 0x1a1a20).setOrigin(0.5, 1).setDepth(DEPTH.props - 2);
    this.add.image(x, floorY - 130, 'prop_torch').setOrigin(0.5, 0.5).setDepth(DEPTH.props - 1);
    const flame = this.add.sprite(x, floorY - 170, 'fx_flame').setOrigin(0.5, 0.75).setDepth(DEPTH.props).setBlendMode('ADD').setScale(1.1);
    flame.play({ key: 'flame', startFrame: Math.floor(Math.random() * 6) });
    const glow = this.add.image(x, floorY - 160, 'glow').setDepth(DEPTH.props + 1).setBlendMode('ADD').setAlpha(0.45).setScale(1.6);
    const emitter = this.add.particles(x, floorY - 175, 'particle_soft', {
      speedY: { min: -70, max: -30 }, speedX: { min: -15, max: 15 }, lifespan: { min: 500, max: 1100 }, scale: { start: 0.25, end: 0 },
      alpha: { start: 0.9, end: 0 }, tint: [0xffa040, 0xff6020], frequency: 90, blendMode: 'ADD',
    }).setDepth(DEPTH.props + 1);
    this.torches.push({ glow, flame, emitter, phase: Math.random() * 10 });
    this.lighting.addTorch(x, floorY - 165);
  }

  buildProp(kind, x, floorY) {
    const key = `prop_${kind}`;
    if (!this.textures.exists(key)) return;
    this.lighting.lit(this.add.image(x, floorY + 4, key).setOrigin(0.5, 1).setDepth(DEPTH.props - 2));
  }

  buildRail(x, floorY) {
    if (this.textures.exists('world_rail')) this.lighting.lit(this.add.image(x, floorY, 'world_rail').setOrigin(0.5, 1).setDepth(DEPTH.props - 1));
    else this.lighting.lit(this.add.image(x, floorY + 2, 'world_fence').setOrigin(0.5, 1).setDepth(DEPTH.props - 1));
  }

  buildShrine(c) {
    const img = this.lighting.lit(this.add.sprite(c.x, c.y + 2, 'prop_shrine', 0).setOrigin(0.5, 1).setDepth(DEPTH.props - 1));
    const glow = this.add.image(c.x, c.y - 110, 'glow').setDepth(DEPTH.props).setBlendMode('ADD').setAlpha(0).setScale(1.4).setTint(0x80c0ff);
    this.interactables.push({ kind: 'shrine', x: c.x, y: c.y, img, glow, lit: false, range: 70 });
  }

  buildChest(c) {
    const id = `${this.zoneKey}:${Math.round(c.x)}:${Math.round(c.y)}`;
    const opened = this.openedChests.has(id);
    const img = this.lighting.lit(this.add.sprite(c.x, c.y + 2, 'prop_chest', opened ? 1 : 0).setOrigin(0.5, 1).setDepth(DEPTH.props - 1));
    this.interactables.push({ kind: 'chest', x: c.x, y: c.y, img, id, opened, range: 70 });
  }

  buildGate(g) {
    const img = this.lighting.lit(this.add.image(g.x, g.y + 4, 'world_gate').setOrigin(0.5, 1).setDepth(DEPTH.props - 1));
    this.gate = { kind: 'gate', x: g.x, y: g.y, img, range: 90 };
    this.interactables.push(this.gate);
  }

  groundYAt(x, y) {
    // the nearest floor below a point (for shadows): ground, solids, platforms
    let best = this.groundY;
    if (y === undefined) return best;
    for (const s of this.level.solids) if (x >= s.x && x <= s.x + s.w && s.y >= y - 10 && s.y < best) best = s.y;
    for (const p of this.level.platforms) if (x >= p.x && x <= p.x + p.w && p.y >= y - 10 && p.y < best) best = p.y;
    return best;
  }

  spawnEnemy(type, x, level = 1, opts = {}) {
    const y = opts.y !== undefined ? opts.y : this.groundY;
    const e = new Enemy(this, x, y - 80, type, { level, ...opts });
    if (e.t.flying) { e.body_.y = y - (e.t.hoverY || 150); e.hoverBase = e.body_.y; }
    this.physics.add.collider(e.body_, this.ground);
    // one-way platforms: enemies drop through when the player is well below them
    this.physics.add.collider(e.body_, this.platforms, null, () => !(e.aggro && this.player.y > e.y + 60));
    this.physics.add.collider(e.body_, this.doorBodies);
    this.physics.add.collider(e.body_, this.walls);
    this.enemies.push(e);
    return e;
  }

  spawnDef(d) {
    this.spawned.add(d.id);
    const e = this.spawnEnemy(d.type, d.x, this.zone.level, { y: d.y, patrol: null });
    e.def = d;
    return e;
  }

  // ---------------------------------------------------------------- doors, walls, arenas
  // A gate across the corridor is seen edge-on: a narrow iron slab hanging from a slot in the lintel.
  buildDoor(d) {
    const sky = d.band !== 'ground';
    const has = (k) => this.textures.exists(k);
    const slotKey = sky && has('world_gate_slot_sky') ? 'world_gate_slot_sky' : 'world_gate_slot';
    const door = { ...d, open: 0, target: 0, locked: false, sfxAt: 0 };
    if (has('world_gate_edge')) door.leaf = this.lighting.lit(this.add.image(d.x, d.y, 'world_gate_edge').setOrigin(0.5, 1).setDepth(DEPTH.props - 2.7));
    else door.leaf = this.add.rectangle(d.x, d.y, 28, d.h, 0x303038, 0.95).setOrigin(0.5, 1).setDepth(DEPTH.props - 2.7);
    if (has(slotKey)) door.slot = this.lighting.lit(this.add.image(d.x, d.y - d.h + 2, slotKey).setOrigin(0.5, 1).setDepth(DEPTH.props - 2.6));
    door.body = this.add.rectangle(d.x - 14, d.y - d.h, 28, d.h, 0, 0).setOrigin(0, 0);
    this.doorBodies.add(door.body);
    this.doors.push(door);
    return door;
  }

  setDoorOpen(door, k) {
    door.open = k;
    const lift = Math.round(k * (door.h - 10));
    door.leaf.y = door.y - lift;
    if (door.leaf.setCrop) door.leaf.setCrop(0, lift, door.leaf.width, door.h - lift);
    door.body.body.enable = k < 0.55;
  }

  updateDoors(dt) {
    const p = this.player;
    for (const d of this.doors) {
      const dx = Math.abs(p.x - d.x), dy = Math.abs(p.feetY - d.y);
      if (dx > 1400) continue;
      let target = d.target;
      if (d.locked) target = 0;
      else if (dx < 150 && dy < 240 && p.alive) target = 1;
      else if (dx > 320 || dy > 400) target = 0;
      // never drop the gate on whoever stands in the doorway (the player or an enemy)
      const inDoorway = (dx < 50 && dy < 240) || this.enemies.some((e) => e.alive && !e.t.flying && Math.abs(e.x - d.x) < 50 && Math.abs(e.y + e.t.bodyH / 2 - d.y) < 240);
      if (target === 0 && d.open > 0 && inDoorway) target = d.open;
      if (target !== d.target) {
        d.target = target;
        if (target === 1 && d.open < 1) this.audio.play('sfx_door', { volume: 0.55 });
        else if (target === 0 && d.open > 0) this.audio.play('sfx_door', { volume: 0.45, detune: -300 });
      }
      if (d.open !== target) {
        const step = dt / (target > d.open ? 520 : 380);
        const k = target > d.open ? Math.min(target, d.open + step) : Math.max(target, d.open - step);
        this.setDoorOpen(d, k);
        if (k === 0 && target === 0 && dx < 900) { this.fx.landDust(d.x, d.y, 3); this.fx.shake(0.002, 60); }
      }
    }
  }

  buildBreakable(d) {
    const sky = d.band !== 'ground';
    const has = (k) => this.textures.exists(k);
    const keys = [sky && has('world_crack_wall_sky') ? 'world_crack_wall_sky' : 'world_crack_wall', sky && has('world_crack_wall2_sky') ? 'world_crack_wall2_sky' : 'world_crack_wall2'];
    const wall = { ...d, hp: 4, maxHp: 4, alive: true, invulnerable: false, faction: 'wall', keys };
    wall.img = has(keys[0]) ? this.lighting.lit(this.add.image(d.x, d.y, keys[0]).setOrigin(0.5, 1).setDepth(DEPTH.props - 2.6))
      : this.add.rectangle(d.x, d.y, d.w, d.h, 0x4a4640).setOrigin(0.5, 1).setDepth(DEPTH.props - 2.6);
    wall.body = this.add.rectangle(d.x - d.w / 2, d.y - d.h, d.w, d.h, 0, 0).setOrigin(0, 0);
    this.walls.add(wall.body);
    wall.hitBounds = () => ({ x: d.x, y: d.y - d.h / 2, w: d.w, h: d.h });
    wall.takeHit = (info) => this.hitBreakable(wall, info);
    this.breakables.push(wall);
    return wall;
  }

  hitBreakable(wall, info) {
    if (!wall.alive) return false;
    wall.hp -= info.heavy ? 4 : 1;
    const x = wall.x + (info.x !== undefined ? Math.sign(info.x - wall.x) : -1) * 40;
    this.fx.sparks.explode(info.heavy ? 10 : 5, x, wall.y - 90);
    this.fx.landDust(x, wall.y - 60, info.heavy ? 8 : 4);
    this.audio.play('sfx_wall_hit', { volume: info.heavy ? 0.9 : 0.7, detune: Math.round(Math.random() * 200 - 100) });
    this.fx.shake(info.heavy ? 0.008 : 0.003, info.heavy ? 160 : 70);
    this.input_.rumble(info.heavy ? 0.7 : 0.3, 0.4, info.heavy ? 160 : 70);
    this.tweens.add({ targets: wall.img, x: wall.x + 3, yoyo: true, repeat: 2, duration: 30 });
    if (wall.hp <= 0) { this.breakWall(wall); return true; }
    if (wall.hp <= 2 && this.textures.exists(wall.keys[1]) && wall.img.setTexture) wall.img.setTexture(wall.keys[1]);
    return true;
  }

  breakWall(wall) {
    wall.alive = false;
    wall.body.destroy();
    wall.img.destroy();
    this.fx.rubble.explode(30, wall.x, wall.y - 100);
    this.fx.landDust(wall.x, wall.y - 10, 14);
    this.fx.shake(0.012, 260);
    this.input_.rumble(0.9, 0.6, 320);
    this.fx.hitStop(60);
    this.audio.play('sfx_wall_break', { volume: 1 });
    this.events.emit('toast', 'The wall gives way', 1600);
  }

  roomAt(x, feetY) {
    return this.rooms.find((r) => x >= r.x && x < r.x + r.w && feetY > r.y && feetY <= r.y + r.h + 4) || null;
  }

  roomDoors(room) { return this.doors.filter((d) => d.cells.some(([c, r]) => c === room.c && r === room.r)); }

  updateRooms() {
    const p = this.player;
    const room = this.roomAt(p.x, p.feetY);
    this.playerRoom = room;
    if (room && room.arena && !room.cleared && !room.active && p.alive && !this.arena && p.x > room.x + 170 && p.x < room.x + room.w - 170 && p.grounded) this.startArena(room);
    if (this.arena) {
      // foes that fell out of the room (through the trapdoor) no longer hold the doors
      const r = this.arena;
      const left = r.enemies.filter((e) => e.alive && !e.t.flying && e.x >= r.x - 40 && e.x < r.x + r.w + 40 && e.y > r.y - 80 && e.y < r.y + r.h + 80);
      if (!left.length) this.clearArena();
    }
  }

  // Arena: the doors slam shut and the room's enemies wake; the doors unbar when they are all down.
  startArena(room) {
    room.active = true;
    this.arena = room;
    for (const d of this.enemyDefs) {
      if (d.cell[0] !== room.c || d.cell[1] !== room.r) continue;
      if (!this.spawned.has(d.id)) this.spawnDef(d);
    }
    room.enemies = this.enemies.filter((e) => e.alive && e.def && e.def.cell[0] === room.c && e.def.cell[1] === room.r);
    for (const e of room.enemies) e.aggro = true;
    for (const d of this.roomDoors(room)) d.locked = true;
    this.audio.play('sfx_gate', { volume: 0.8, detune: -400 });
    this.fx.shake(0.005, 200);
    this.events.emit('toast', 'The doors slam shut', 1800);
  }

  clearArena() {
    const room = this.arena;
    room.cleared = true; room.active = false;
    this.arena = null;
    for (const d of this.roomDoors(room)) d.locked = false;
    this.audio.play('sfx_room_clear', { volume: 0.9 });
    this.events.emit('banner', 'ROOM CLEARED', { tint: 0xffd070, sub: 'the doors unbar', hold: 1400 });
    // a shower of coins where the last one fell, and sometimes a potion
    const p = this.player;
    const n = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.pickups.push(new Pickup(this, p.x + (Math.random() - 0.5) * 160, p.y - 120 - Math.random() * 60, { type: 'gold', amount: 6 + Math.floor(Math.random() * 8) * (this.zone.level) }));
    if (Math.random() < 0.35) this.pickups.push(new Pickup(this, p.x, p.y - 150, { type: 'potion' }));
    this.writeCheckpoint();
  }

  // Enemies spawn when the camera approaches so the world stays cheap.
  spawnNearby() {
    const cam = this.cameras.main;
    const wv = cam.worldView;
    const lvl = this.zone.level;
    for (const d of this.enemyDefs) {
      if (this.spawned.has(d.id)) continue;
      if (d.x > wv.x - 400 && d.x < wv.right + 400 && d.y > wv.y - 400 && d.y < wv.bottom + 400) {
        this.spawnDef(d);
      }
    }
    if (this.bossDef && !this.bossSpawned && Math.abs(this.player.x - this.bossDef.x) < 700 && Math.abs(this.player.y - this.bossDef.y) < 400) {
      this.bossSpawned = true;
      this.boss = this.spawnEnemy(this.bossDef.type, this.bossDef.x, lvl, { y: this.bossDef.y });
    }
  }

  onBossAggro(boss) {
    this.audio.playMusic('music_boss', { fade: 600 });
    this.audio.play('sfx_boss_roar');
    this.fx.shake(0.01, 500);
    this.events.emit('boss-start', boss.t.name, () => ({ hp: boss.hp, maxHp: boss.maxHp }));
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
      if (Math.abs(it.x - p.x) < it.range && Math.abs(it.y - (p.y + PLAYER.bodyHeight / 2)) < 90) { near = it; break; }
    }
    if (near && p.alive && !this.transitioning) {
      let text = '';
      const btn = promptFor('interact', this.input_.lastDevice);
      if (near.kind === 'shrine') text = near.lit ? `[${btn}] Rest at the shrine` : `[${btn}] Light the shrine`;
      else if (near.kind === 'chest') text = near.opened ? '' : `[${btn}] Open chest`;
      else if (near.kind === 'gate') {
        if (this.bossDef && (!this.boss || this.boss.alive)) text = 'The Warden bars the way.';
        else text = this.gateKillsNeeded() > 0 ? `The gate is barred. ${this.gateKillsNeeded()} more foes must fall.` : `[${btn}] Pass through the gate`;
      }
      this.prompt.setText(text).setPosition(near.x, near.y - 230).setVisible(!!text);
      if (this.input_.pressed.interact && text && !text.startsWith('The ')) {
        this.input_.consume('interact');
        this.interact(near);
      }
    } else {
      this.prompt.setVisible(false);
    }
  }

  enemiesRemaining() {
    return this.enemyDefs.filter((d) => !this.spawned.has(d.id)).length + this.enemies.filter((e) => e.alive && !e.t.boss).length;
  }

  // The gate yields once six in ten of the zone's foes have fallen (side rooms are optional).
  gateKillsNeeded() {
    const total = this.enemyDefs.length;
    const killed = total - this.enemiesRemaining();
    return Math.max(0, Math.ceil(total * 0.6) - killed);
  }

  interact(it) {
    const p = this.player;
    if (it.kind === 'shrine') {
      it.lit = true;
      it.img.setFrame(1);
      it.glow.setAlpha(0.5);
      this.tweens.add({ targets: it.glow, alpha: 0.3, duration: 1200, yoyo: true, repeat: -1 });
      this.lighting.addPoint(it.x, it.y - 120, 260, 0x80c0ff, 1.0);
      p.hp = p.maxHp; p.stamina = p.maxStamina; p.potions = Math.max(p.potions, 3);
      this.checkpoint = { x: it.x, y: it.y };
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
      for (const d of drops) this.pickups.push(new Pickup(this, it.x, it.y - 40, d));
    } else if (it.kind === 'gate') {
      this.passGate();
    }
  }

  passGate() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.audio.play('sfx_gate');
    this.tweens.add({ targets: this.gate.img, y: this.gate.img.y - 200, duration: 1600, ease: 'Sine.easeInOut' });
    this.cameras.main.fadeOut(1800, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const next = this.zone.next;
      const carry = { gold: this.player.gold, potions: this.player.potions, inventory: this.player.inventory || [], kills: this.player.kills };
      if (!next) { this.scene.pause(); this.scene.launch('Victory'); return; }
      this.scene.restart({ zone: next, stats: this.stats, carry, openedChests: [...this.openedChests], demo: this.demo, seed: this.seed });
      this.time.delayedCall(50, () => this.writeCheckpoint());
    });
  }

  writeCheckpoint() { writeSave(snapshot(this)); }

  restartFromCheckpoint() {
    const carry = { gold: this.player.gold, potions: Math.max(this.player.potions, 2), inventory: this.player.inventory || [], kills: this.player.kills };
    this.scene.restart({ zone: this.zoneKey, stats: this.stats, carry, startAt: this.checkpoint, openedChests: [...this.openedChests], demo: this.demo, seed: this.seed });
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
    this.updateDoors(dt);
    this.player.update(inp, dt);
    this.updateRooms();
    for (const e of [...this.enemies]) e.update(dt);
    for (const p of [...this.pickups]) p.update(dt);
    this.combat.update(this.player, this.enemies);
    this.updateInteractables();
    if (this.player.y > this.groundY + 400 && this.player.alive) { this.player.takeHit({ damage: 9999, dir: 1 }); }
  }
}
