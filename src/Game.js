// One mission: a generated ship, the marine, the hostiles, survivors, loot and every system,
// stepped with hit-stop and rendered through the pixel pipeline. Also the title / pause / end states.
import * as THREE from 'three';
import { generateShip, randomSeed, TILE } from './gen/Ship.js';
import { World } from './world/World.js';
import { Physics } from './core/Physics.js';
import { loadModel } from './core/Models.js';
import { Player } from './entities/Player.js';
import { Survivor } from './entities/Survivor.js';
import { Bullets } from './entities/Bullet.js';
import { Pickup } from './entities/Pickup.js';
import { Fog } from './systems/Fog.js';
import { FX } from './systems/FX.js';
import { Barks } from './systems/Barks.js';
import { Tracker } from './systems/Tracker.js';
import { Events } from './systems/Events.js';
import { Director } from './systems/Director.js';
import { Autopilot } from './systems/Autopilot.js';

export class Game {
  constructor({ renderer, input, audio, hud, seed, demo = false, cols = 24, decks = 3 }) {
    this.renderer = renderer; this.input = input; this.audio = audio; this.hud = hud;
    this.seed = seed; this.cols = cols; this.decks = decks;
    this.demo = demo;
    this.screen = 'title';
    this.time = 0; this.realTime = 0;
    this.player = null; this.aliens = []; this.survivors = []; this.pickups = [];
    this.models = {};
    this.humanOverride = false;
    this.loading = '';
    this.lightBuf = [];
    this.interactable = null;
    this.extracted = false;
  }

  async loadModels() {
    const [marine, alien, survivor] = await Promise.all([loadModel('marine'), loadModel('alien'), loadModel('survivor')]);
    this.models = { marine, alien, survivor };
  }

  async start({ seed = this.seed, demo = this.demo } = {}) {
    this.teardown();
    this.seed = seed; this.demo = demo;
    this.loading = 'GENERATING SHIP…';
    this.ship = generateShip({ seed, cols: this.cols, decks: this.decks });
    this.world = new World(this.ship, this.renderer);
    this.physics = new Physics(this.ship, this.world);
    this.loading = 'LOADING…';
    await this.world.load();
    if (!this.models.marine) await this.loadModels();
    this.player = new Player(this, this.models.marine);
    this.bullets = new Bullets(this);
    this.fx = new FX(this);
    this.barks = new Barks(this);
    this.tracker = new Tracker(this);
    this.events = new Events(this);
    this.director = new Director(this);
    this.fog = new Fog(this);
    this.autopilot = new Autopilot(this);
    this.aliens = []; this.survivors = []; this.pickups = [];
    for (const s of this.ship.survivors) this.survivors.push(new Survivor(this, this.models.survivor, s));
    let weaponToggle = 0;
    for (const l of this.ship.loot) {
      const kind = l.kind === 'weapon' ? (weaponToggle++ % 2 === 0 ? 'shotgun' : 'smg') : null;
      this.pickups.push(new Pickup(this, l, kind));
    }
    this.pickups.push(new Pickup(this, { kind: 'log', x: this.ship.objective.x, y: this.ship.objective.y, room: this.ship.objective.room }));
    // a guaranteed second weapon somewhere on the way to the bridge
    if (!this.ship.loot.some((l) => l.kind === 'weapon')) {
      const mid = this.ship.rooms.filter((r) => this.ship.dist[r.id] >= 2 && r.type !== 'hive').sort(() => Math.random() - 0.5)[0];
      if (mid) this.pickups.push(new Pickup(this, { kind: 'weapon', x: (mid.x0 + 2) * TILE + 16, y: mid.y0 * TILE, room: mid.id }, 'shotgun'));
    }
    await this.director.populate();
    this.time = 0; this.extracted = false; this.extractT = 0;
    this.screen = 'play';
    this.loading = '';
    this.makePortrait();
    this.renderer.setCamera(this.player.x, this.player.y + 40);
    this.audio.playMusic('music_derelict');
    this.barks.say(this.player, 'Kestrel 21 docked. Sweeping the ship.', 2.4, 0.8);
    this.world.seen.add(this.ship.airlock);
  }

  teardown() {
    if (!this.world) return;
    const scene = this.renderer.scene;
    for (const o of scene.children.slice()) if (!o.isLight && o !== this.renderer.flash.target) scene.remove(o);
    this.input.virtual = null;
    this.audio.stopAll();
    this.world = null; this.player = null; this.aliens = []; this.survivors = []; this.pickups = [];
  }

  // A small render of the marine's head for the HUD portrait.
  makePortrait() {
    try {
      const r = this.renderer, gl = r.gl;
      const size = 46;
      const rt = new THREE.WebGLRenderTarget(size, size);
      const cam = new THREE.OrthographicCamera(-16, 16, 16, -16, -500, 500);
      const p = this.player.char;
      cam.position.set(p.group.position.x + 2, p.group.position.y + 55, 300);
      cam.lookAt(p.group.position.x + 2, p.group.position.y + 55, 0);
      const bg = r.scene.background; r.scene.background = new THREE.Color(0x10141a);
      const amb = r.ambient.intensity; r.ambient.intensity = 3.0;
      const fogVis = this.fog.mesh.visible; this.fog.mesh.visible = false;
      r.pool[0].position.set(p.group.position.x + 30, p.group.position.y + 80, 80); r.pool[0].intensity = 20000; r.pool[0].distance = 400; r.pool[0].color.setHex(0xfff0dd);
      gl.setRenderTarget(rt); gl.render(r.scene, cam); gl.setRenderTarget(null);
      const buf = new Uint8Array(size * size * 4);
      gl.readRenderTargetPixels(rt, 0, 0, size, size, buf);
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const img = c.getContext('2d').createImageData(size, size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const si = ((size - 1 - y) * size + x) * 4, di = (y * size + x) * 4;
        for (let k = 0; k < 3; k++) img.data[di + k] = Math.round(255 * Math.pow(buf[si + k] / 255, 1 / 2.2));
        img.data[di + 3] = 255;
      }
      c.getContext('2d').putImageData(img, 0, 0);
      this.portrait = c;
      r.scene.background = bg; this.fog.mesh.visible = fogVis; r.ambient.intensity = amb;
      rt.dispose();
    } catch (e) { this.portrait = null; }
  }

  objectivePoint() {
    if (!this.player) return null;
    if (this.player.hasLog) return { x: this.ship.start.x, y: this.ship.start.y + 30 };
    const log = this.pickups.find((p) => p.kind === 'log' && p.alive);
    return log ? { x: log.x, y: log.y + 10 } : null;
  }

  objectiveText() {
    if (!this.player) return '';
    if (this.player.hasLog) return 'RETURN TO THE KESTREL';
    return 'RETRIEVE THE SHIP\'S LOG FROM THE BRIDGE';
  }

  objectiveSub() {
    const n = this.survivors.filter((s) => s.alive && s.state === 'cower').length;
    const f = this.survivors.filter((s) => s.alive && s.state === 'follow').length;
    const parts = [];
    if (n) parts.push(`${n} SURVIVOR${n > 1 ? 'S' : ''} UNACCOUNTED FOR`);
    if (f) parts.push(`${f} FOLLOWING`);
    return parts.join('   ');
  }

  onObjective() {
    this.director.onObjective();
    this.barks.say(this.player, 'Got the log. Back to the Kestrel, move!', 2.4, 0.4);
  }

  score() {
    const p = this.player;
    return (p.hasLog ? 500 : 0) + p.rescued * 300 + p.kills * 25 + p.scrap + Math.max(0, 600 - Math.floor(this.time)) * (p.hasLog ? 1 : 0);
  }

  hitProp(p, dmg, dx, dy) {
    if (p.hp <= 0) return;
    p.hp -= dmg;
    this.fx.spark(p.x + (Math.random() - 0.5) * p.w * 0.6, p.y + p.h * 0.5, -dx, -dy);
    if (p.hp <= 0) {
      p.alive = false; p.mesh.visible = false;
      if (p.kind === 'barrel_red') {
        this.fx.explosion(p.x, p.y);
        this.audio.play('explosion', { volume: 1, x: p.x });
        for (const a of this.aliens) if (a.alive && Math.hypot(a.cx - p.x, a.cy - p.y) < 110) a.damage(80, { dx: Math.sign(a.cx - p.x), dy: 0.5, from: this.player });
        if (Math.hypot(this.player.cx - p.x, this.player.cy - p.y) < 90) this.player.damage(30, { acid: true });
        this.director.noise(p.x, p.y, 900);
      } else if (p.kind === 'egg') {
        this.fx.acid(p.x, p.y + 10, 0, 1, 18, true);
        this.audio.play('acid', { volume: 0.7, x: p.x });
        this.director.noise(p.x, p.y, 500);
        if (Math.random() < 0.5) { const { Alien } = this._alienModule; this.aliens.push(new Alien(this, this.models.alien, { x: p.x, y: p.y, state: 'hunt' })); this.aliens[this.aliens.length - 1].crawl = true; }
      }
    }
  }

  interactables() {
    const list = [];
    const p = this.player;
    for (const s of this.survivors) if (s.alive && s.state === 'cower' && Math.abs(s.body.x - p.x) < 40 && Math.abs(s.body.y - p.y) < 40) list.push({ label: s.interactLabel, act: () => s.interact(), d: Math.abs(s.body.x - p.x) });
    for (const k of this.pickups) if (k.alive && k.needsInteract && Math.abs(k.x - p.x) < 30 && Math.abs(k.y - p.y) < 40) list.push({ label: k.label, act: () => k.interact(), d: Math.abs(k.x - p.x) });
    const air = this.ship.rooms[this.ship.airlock];
    if (this.world.roomIdAt(p.x, p.y + 4) === air.id && p.x > (air.x1 - 1) * TILE + 8) {
      const following = this.survivors.filter((s) => s.alive && s.state === 'follow').length;
      list.push({ label: p.hasLog ? 'Board the Kestrel and extract' : following ? 'Extract now (log not recovered)' : 'Extract early (log not recovered)', act: () => this.extract(), d: 999 });
    }
    list.sort((a, b) => a.d - b.d);
    return list[0] || null;
  }

  extract() {
    if (this.extracted) return;
    this.extracted = true; this.extractT = 0;
    this.audio.play('room_clear', { volume: 1 });
    this.audio.playMusic('music_extract');
    this.barks.say(this.player, 'Kestrel, we\'re coming aboard. Go, go!', 2.2);
    for (const s of this.survivors) if (s.alive && s.state === 'follow') { s.state = 'rescued'; s.char.group.visible = false; s.hidden = true; this.player.rescued++; }
  }

  // Before the input poll: in demo mode the autopilot writes the virtual pad unless a human has
  // touched the controls in the last few seconds.
  preInput(realDt) {
    if (this.testDrive) { this.input.virtual = this.testDrive; return; }          // scripted input for tests
    if (this.screen !== 'play' || !this.demo || !this.player) { this.input.virtual = null; return; }
    this.humanOverride = this.input.humanIdleFor() < 5000;
    if (!this.humanOverride) this.autopilot.update(realDt, this.input);
    else this.input.virtual = null;
  }

  // ------------------------------------------------------------------------------------------
  update(realDt) {
    const input = this.input.state;
    this.realTime += realDt;
    if (this.screen === 'title') { this.time += realDt; return; }
    if (this.screen === 'pause') {
      if (input.pausePressed || input.confirmPressed) { this.screen = 'play'; this.audio.resume(); return; }
      if (input.backPressed) { this.screen = 'title'; this.teardown(); }
      return;
    }
    if (this.screen === 'dead' || this.screen === 'extracted') {
      this.time += realDt;
      if (this.player && (this.screen === 'extracted' || this.player.deadT > 1.5)) {
        if (input.confirmPressed) { this.start({ seed: this.screen === 'extracted' ? randomSeed() : this.seed, demo: this.demo }); return; }
        if (input.backPressed) { this.screen = 'title'; this.teardown(); return; }
        // the demo loops on its own: a fresh ship after the end screen has been up for a while
        this.endT = (this.endT || 0) + realDt;
        if (this.demo && this.endT > 9 && !this.starting) { this.starting = true; this.start({ seed: randomSeed(), demo: true }).then(() => { this.starting = false; this.endT = 0; }); return; }
      }
      // keep the world ticking slowly behind the screen
      this.tick(Math.min(realDt, 0.05) * 0.5, realDt);
      return;
    }
    if (input.pausePressed && !this.player.dead) { this.screen = 'pause'; return; }
    if (input.demoPressed && !this.demo) { this.demo = true; }
    // hit-stop
    let dt = Math.min(realDt, 1 / 30);
    if (this.fx.hitStopT > 0) { this.fx.hitStopT -= realDt; dt *= 0.08; }
    this.tick(dt, realDt);
  }

  tick(dt, realDt) {
    const input = this.input.state;
    this.time += dt;
    const p = this.player;
    this.audio.listenerX = p.cx;
    this.world.update(dt, p);
    for (const d of this.world.doors) { if (d.justOpened) this.audio.play('door', { volume: 0.6, x: d.x, minGap: 80 }); }
    // interact
    this.interactable = this.interactables();
    if (input.interactPressed && this.interactable && !p.dead) this.interactable.act();
    // substep physics for stability
    const sub = 2, sdt = dt / sub;
    for (let i = 0; i < sub; i++) {
      p.update(sdt, i === 0 ? input : { ...input, jumpPressed: false, dodgePressed: false, weaponPressed: false, reloadPressed: false, medkitPressed: false, interactPressed: false });
      for (const a of this.aliens) a.update(sdt);
      for (const s of this.survivors) s.update(sdt);
      this.bullets.update(sdt);
    }
    for (const k of this.pickups) k.update(dt);
    this.fog.update(dt);
    for (const a of this.aliens) { a.visibleToPlayer = !a.hidden && this.fog.visibleAt(a.cx, a.cy); a.char.group.visible = !a.hidden && (a.visibleToPlayer || a.state === 'dead' && this.fog.visibleAt(a.cx, a.cy, 40)); }
    for (const s of this.survivors) s.visibleToPlayer = !s.hidden && this.fog.visibleAt(s.cx, s.cy);
    this.fx.update(dt, realDt);
    this.barks.update(dt);
    this.tracker.update(dt);
    this.events.update(dt);
    this.director.update(dt);
    // death / extraction screens
    if (p.dead && this.screen === 'play') { this.screen = 'dead'; this.audio.stopMusic(); this.input.virtual = null; }
    if (this.extracted) { this.extractT += dt; if (this.extractT > 1.6 && this.screen === 'play') this.screen = 'extracted'; }
    // camera: ahead of the aim, a little above the feet, inside the hull
    const r = this.renderer;
    const lookX = p.aim.x * 60 * (p.aimMode !== 'none' ? 1 : 0.4) + p.facing * 24;
    const tx = p.cx + lookX, ty = p.body.y + 56 + p.aim.y * 30;
    const k = 1 - Math.pow(0.001, realDt);
    const cx = r.cx + (tx - r.cx) * k, cy = r.cy + (ty - r.cy) * k * 0.9;
    const minX = r.width / 2 - 40, maxX = this.ship.W * TILE + 200 - r.width / 2;
    const minY = r.height / 2 - 20, maxY = this.ship.H * TILE - r.height / 2 + 20;
    r.setCamera(Math.max(minX, Math.min(maxX, cx)), Math.max(minY, Math.min(maxY, cy)));
    // lights
    this.lightBuf.length = 0;
    this.world.collectLights(this.lightBuf, this.time);
    this.events.collectLights(this.lightBuf);
    this.fx.collectLights(this.lightBuf);
    if (!p.dead) this.lightBuf.push({ x: p.cx, y: p.cy + 12, z: 44, color: 0xcfe0ff, intensity: 0.5, range: 120, priority: 2 });
    for (const k of this.pickups) if (k.alive && (k.kind === 'log' || k.kind === 'medkit')) this.lightBuf.push({ x: k.x, y: k.y + 10, z: 16, color: k.kind === 'log' ? 0xffb340 : 0xff6a5a, intensity: 0.3 + 0.1 * Math.sin(this.time * 4), range: 60 });
    r.applyLights(this.lightBuf);
  }
}
