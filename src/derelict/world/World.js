// Builds the three.js scene for a generated ship: one instanced mesh per tile kind, doors with
// sliding leaves, ladders, stairs, vents, lamps, props, the dropship outside the airlock. Keeps the
// lists the systems need (light sources, interactables, prop records).
import * as THREE from 'three';
import { T, TILE, CELL_W, DECK_H } from '../gen/Ship.js';
import { loadModel, YAW } from '../core/Models.js';

const TILE_MODELS = ['tile_floor', 'tile_floor_hazard', 'tile_wall', 'tile_wall_pipes', 'tile_wall_conduit', 'tile_wall_screen',
  'tile_bulkhead', 'tile_hull', 'door_frame', 'door_leaf', 'ladder', 'hatch', 'stair', 'vent', 'lamp', 'lamp_red', 'airlock', 'kestrel'];
const PROP_MODELS = ['crate', 'crate_tall', 'barrel', 'barrel_red', 'locker', 'cabinet', 'console', 'console_tall', 'cryopod', 'bunk',
  'table', 'chair', 'rack', 'planter', 'generator', 'reactor', 'engine', 'pipe', 'debris', 'resin', 'egg', 'ammo', 'medkit',
  'weapon_shotgun', 'weapon_smg', 'log'];

const PROP_GLOW = { console: 0x66d9a0, console_tall: 0x6ab8ff, cryopod: 0x80ccff, generator: 0x80ff80, reactor: 0xffa040, engine: 0x59a6ff, egg: 0x8cff73, medkit: 0xff6a5a, log: 0xffb340 };

export const ROOM_COLORS = {
  corridor: 0x6a737d, quarters: 0x7a6a5a, medbay: 0x6a8a90, armory: 0x6a6a52, cargo: 0x6f6a60, mess: 0x7a705f,
  lab: 0x5f7a7a, hydroponics: 0x5f7a5f, generator: 0x7a6a4a, storage: 0x6a6a6a, reactor: 0x8a5a4a, workshop: 0x6f6a5a,
  airlock: 0x5f7a6a, bridge: 0x5f6a8a, engine: 0x7a5a4a, hive: 0x4a2a2a,
};

export class World {
  constructor(ship, renderer = null) {
    this.ship = ship;
    this.renderer = renderer;
    this.scene = renderer ? renderer.scene : null;
    this.group = new THREE.Group();
    if (this.scene) this.scene.add(this.group);
    this.models = {};
    this.doors = [];              // {rec, leaf, open(0..1), target, locked, col, row}
    this.doorByTile = new Map();
    this.props = [];              // {rec, mesh, kind, meta, hp, x, y}
    this.lightSources = [];       // static lamps: {x,y,color,intensity,range,flicker,broken,room,on}
    this.roomAt = new Int16Array(ship.W * ship.H).fill(-1);
    this.seen = new Set();        // room ids the player has seen
    this.time = 0;
    this.blackout = 0;            // seconds left of ship-wide blackout
    this._buildRoomMap();
    this._buildDoors();
  }

  async load() {
    const names = [...TILE_MODELS, ...PROP_MODELS];
    const loaded = await Promise.all(names.map((n) => loadModel(n).catch((e) => { console.warn('model', n, e); return null; })));
    names.forEach((n, i) => { if (loaded[i]) this.models[n] = loaded[i]; });
    this._buildTiles();
    this._buildDoorMeshes();
    this._buildProps();
    this._buildLights();
    this._buildKestrel();
  }

  _buildRoomMap() {
    const { ship } = this;
    for (const room of ship.rooms) {
      for (let r = room.y0 - 1; r <= room.y1 + 1; r++) for (let c = room.x0 - 1; c <= room.x1 + 1; c++) {
        if (c < 0 || c >= ship.W || r < 0 || r >= ship.H) continue;
        const i = r * ship.W + c;
        const interior = r >= room.y0 && r <= room.y1 && c >= room.x0 && c <= room.x1;
        if (interior || this.roomAt[i] < 0) this.roomAt[i] = room.id;
      }
    }
  }

  roomIdAt(x, y) {
    const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
    if (c < 0 || c >= this.ship.W || r < 0 || r >= this.ship.H) return -1;
    return this.roomAt[r * this.ship.W + c];
  }

  roomOf(x, y) { const id = this.roomIdAt(x, y + 4); return id >= 0 ? this.ship.rooms[id] : null; }

  _geometryOf(name) {
    const m = this.models[name];
    if (!m) return null;
    let mesh = null;
    m.gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    return mesh;
  }

  _instanced(name, placements) {
    // placements: [{x, y, flip}]
    const src = this._geometryOf(name);
    if (!src || !placements.length) return null;
    const mats = Array.isArray(src.material) ? src.material : [src.material];
    const inst = new THREE.InstancedMesh(src.geometry, Array.isArray(src.material) ? src.material : src.material, placements.length);
    inst.frustumCulled = false;
    const m = new THREE.Matrix4();
    placements.forEach((p, i) => {
      m.makeScale(p.flip ? -1 : 1, 1, 1);
      m.setPosition(p.x + (p.flip ? TILE : 0), p.y, p.z || 0);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
    return inst;
  }

  _buildTiles() {
    const { ship } = this;
    const place = { tile_floor: [], tile_floor_hazard: [], tile_wall: [], tile_wall_pipes: [], tile_wall_conduit: [], tile_wall_screen: [],
      tile_bulkhead: [], tile_hull: [], ladder: [], hatch: [], stair: [], vent: [], airlock: [] };
    const rng = mulberry(ship.seed + 7);
    for (let r = 0; r < ship.H; r++) for (let c = 0; c < ship.W; c++) {
      const t = ship.tileAt(c, r);
      const x = c * TILE, y = r * TILE;
      const hull = c === 0 || c === ship.W - 1 || r === 0 || r === ship.H - 1;
      if (t === T.SOLID) {
        if (hull) place.tile_hull.push({ x, y });
        else if (c % CELL_W === 0 && r % DECK_H !== 0) place.tile_bulkhead.push({ x, y });
        else if (r % DECK_H === 0) place[rng() < 0.08 ? 'tile_floor_hazard' : 'tile_floor'].push({ x, y });
        else place.tile_bulkhead.push({ x, y });
      } else if (t === T.LADDER) place.ladder.push({ x, y });
      else if (t === T.HATCH) place.hatch.push({ x, y });
      else if (t === T.STAIR_R) place.stair.push({ x, y });
      else if (t === T.STAIR_L) place.stair.push({ x, y, flip: true });
      else if (t === T.VENT) place.vent.push({ x, y });
      else if (t === T.AIRLOCK) { if (r === ship.rooms[ship.airlock].y0) place.airlock.push({ x, y }); }
      // back walls behind every interior tile (and behind ladders, doors, stairs)
      const interior = this.roomAt[r * ship.W + c] >= 0 && t !== T.SOLID && t !== T.AIRLOCK;
      if (interior) {
        const room = ship.rooms[this.roomAt[r * ship.W + c]];
        const v = rng();
        let kind = 'tile_wall';
        if (room.type === 'hive') kind = v < 0.5 ? 'tile_wall' : 'tile_wall_pipes';
        else if (v < 0.12) kind = 'tile_wall_pipes';
        else if (v < 0.22) kind = 'tile_wall_conduit';
        else if (v < 0.27 && r === room.y0 + 1) kind = 'tile_wall_screen';
        place[kind].push({ x, y, z: -6 });
      }
    }
    for (const [name, list] of Object.entries(place)) this._instanced(name, list);
    // tint hive back walls? kept simple: a dark red plane behind the hive rooms
    for (const room of ship.rooms) {
      const col = new THREE.Color(ROOM_COLORS[room.type] || 0x666666);
      const w = (room.x1 - room.x0 + 1) * TILE, h = (room.y1 - room.y0 + 1) * TILE;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ color: col.multiplyScalar(0.25) }));
      plane.position.set(room.x0 * TILE + w / 2, room.y0 * TILE + h / 2, -30);
      this.group.add(plane);
    }
  }

  _buildDoors() {
    for (const rec of this.ship.doors) {
      const x = rec.col * TILE, y = rec.row * TILE;
      const d = { rec, group: null, leaf: null, open: 0, target: 0, locked: rec.locked, col: rec.col, row: rec.row, x: x + TILE / 2, y, hold: 0 };
      this.doors.push(d);
      for (let r = rec.row; r < rec.row + rec.h; r++) this.doorByTile.set(`${rec.col},${r}`, d);
    }
  }

  _buildDoorMeshes() {
    const frame = this._geometryOf('door_frame'), leaf = this._geometryOf('door_leaf');
    for (const d of this.doors) {
      const g = new THREE.Group();
      g.position.set(d.col * TILE, d.row * TILE, 0);
      if (frame) g.add(new THREE.Mesh(frame.geometry, frame.material));
      if (leaf) { d.leaf = new THREE.Mesh(leaf.geometry, leaf.material); g.add(d.leaf); }
      d.group = g;
      this.group.add(g);
    }
  }

  doorAt(c, r) { return this.doorByTile.get(`${c},${r}`) || null; }
  doorOpenAt(c, r) { const d = this.doorAt(c, r); return d ? d.open > 0.7 : true; }

  requestOpen(d, seconds = 1.2) { if (!d.locked) d.hold = Math.max(d.hold, seconds); }

  _buildProps() {
    const { ship } = this;
    const rng = mulberry(ship.seed + 13);
    for (const rec of ship.props) {
      let kind = rec.kind;
      if (kind === 'crate' && rng() < 0.3) kind = 'crate_tall';
      if (kind === 'barrel' && rng() < 0.3) kind = 'barrel_red';
      if (kind === 'console' && rng() < 0.3) kind = 'console_tall';
      const model = this.models[kind];
      if (!model) continue;
      const src = this._geometryOf(kind);
      const mesh = new THREE.Mesh(src.geometry, src.material);
      const flip = rng() < 0.5 ? -1 : 1;
      mesh.position.set(rec.x, rec.y, model.meta.background ? -8 : 0);
      mesh.scale.x = flip;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      const p = { rec, mesh, kind, meta: model.meta, x: rec.x, y: rec.y, w: model.meta.w || 24, h: model.meta.h || 24,
        hp: kind === 'barrel_red' ? 30 : kind === 'egg' ? 40 : 0, alive: true, room: rec.room };
      this.props.push(p);
      const glow = PROP_GLOW[kind];
      if (glow) {
        this.lightSources.push({ x: rec.x, y: rec.y + (model.meta.h || 24) * 0.6, z: 24, color: glow, intensity: kind === 'egg' ? 0.35 : 0.6, range: kind === 'reactor' ? 130 : 90, flicker: kind === 'egg' || kind === 'reactor', room: rec.room, on: true, prop: p, base: kind === 'egg' ? 0.35 : 0.6 });
      }
    }
  }

  _buildLights() {
    const { ship } = this;
    const lamp = this._geometryOf('lamp'), red = this._geometryOf('lamp_red');
    const lamps = [], reds = [];
    for (const l of ship.lights) {
      const x = l.x - TILE / 2, y = l.y - TILE + 6;
      if (!l.broken) lamps.push({ x, y });
      reds.push({ x: x + 10, y, });
      this.lightSources.push({ x: l.x, y: l.y - 8, z: 30, color: l.color, intensity: l.broken ? 0 : 1.0, range: 150, flicker: l.flicker, broken: l.broken, room: l.room, on: !l.broken, lamp: true, base: l.broken ? 0 : 1.0 });
      this.lightSources.push({ x: l.x + 10, y: l.y - 8, z: 30, color: 0xff2a1a, intensity: 0, range: 120, flicker: true, room: l.room, on: false, emergency: true, base: 0.8 });
    }
    if (lamp) this.lampMesh = this._instanced('lamp', lamps);
    if (red) this.redMesh = this._instanced('lamp_red', reds);
  }

  _buildKestrel() {
    const src = this._geometryOf('kestrel');
    if (!src) return;
    const mesh = new THREE.Mesh(src.geometry, src.material);
    const d = this.ship.dock;
    mesh.position.set(d.x, d.y, -4);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.kestrel = mesh;
    this.lightSources.push({ x: d.x + 24, y: d.y + 64, z: 30, color: 0x9fd8ff, intensity: 0.8, range: 140, flicker: false, on: true, base: 0.8 });
    this.lightSources.push({ x: d.x + 150, y: d.y + 44, z: 30, color: 0xff9a4a, intensity: 0.7, range: 110, flicker: true, on: true, base: 0.7 });
  }

  update(dt, player) {
    this.time += dt;
    // doors slide open when held (someone near) and close after
    for (const d of this.doors) {
      if (d.hold > 0) { d.hold -= dt; d.target = 1; } else d.target = 0;
      const was = d.open;
      const speed = 3.2;
      if (d.open < d.target) d.open = Math.min(1, d.open + speed * dt);
      else if (d.open > d.target) d.open = Math.max(0, d.open - speed * dt);
      if (d.leaf) d.leaf.position.y = d.open * 82;
      d.moved = was !== d.open;
      d.justOpened = was < 0.05 && d.open >= 0.05;
      d.justClosed = was > 0.05 && d.open <= 0.05;
    }
    if (this.blackout > 0) this.blackout -= dt;
  }

  // Current intensities for the light pool: flicker, blackout, broken lamps.
  collectLights(out, t) {
    const dark = this.blackout > 0;
    for (const s of this.lightSources) {
      if (s.prop && !s.prop.alive) continue;
      let i = s.base !== undefined ? s.base : s.intensity;
      if (s.emergency) i = dark ? 0.8 * (0.6 + 0.4 * Math.abs(Math.sin(t * 4 + s.x))) : 0;
      else if (s.lamp) {
        const roomDark = dark || (this.roomDark && this.roomDark.has(s.room));
        if (roomDark) i = 0;
        else if (s.flicker) i *= 0.55 + 0.45 * (Math.sin(t * 13 + s.x * 0.1) > -0.3 ? 1 : 0.2) * (0.8 + 0.2 * Math.sin(t * 31 + s.y));
      } else if (s.flicker) i *= 0.75 + 0.25 * Math.sin(t * 9 + s.x);
      if (i <= 0) continue;
      out.push({ x: s.x, y: s.y, z: s.z, color: s.color, intensity: i, range: s.range });
    }
  }

  // The red lamps are instanced for all rooms; show the mesh only during blackouts via scale.
  setBlackout(seconds) { this.blackout = seconds; }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
