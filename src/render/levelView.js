// Builds the ship's 3D scenery from level data + the Blender room kit (roomkit.glb, props.glb).
// Static pieces are batched per room; doors, props with hinged lids and lamps stay separate
// so they can animate. Every kit piece has a box fallback, so the game runs without art.
// The hull class's look (gen/classes.js) casts its tint over the kit, wears the wall tiles, picks
// the lamp colour and the wall variants, and puts its silhouette outside the hull (exterior.js).
import * as THREE from 'three';
import { WORLD } from '../core/config.js';
import { Rng } from '../core/rng.js';
import { HULL_CLASSES } from '../gen/classes.js';
import { PROPS, ROOM_TYPES } from '../gen/templates.js';
import { RARITY } from '../sim/loot.js';
import { shaftOpening } from '../gen/level.js';
import { Batch, boxGeo } from './batch.js';
import { exteriorPieces } from './exterior.js';

const { DECK_H, SLAB, WALL, BACK_Z, FRONT_Z, DOOR_H } = WORLD;
const INNER_H = DECK_H - SLAB;

const COL = {
  wall: 0x2e3338, slab: 0x3a3f44, hull: 0x23272b, bulk: 0x33383d, door: 0x5b5a4a,
  ladder: 0x6b6f72, stairs: 0x4a4e52, prop: 0x55504a, plating: 0x1d2024,
};

export class LevelView {
  constructor(level, assets) {
    this.level = level;
    this.assets = assets;
    this.group = new THREE.Group();
    this.group.name = 'level';
    this.doors = new Map();   // portal id -> {obj, open: 0..1}
    this.props = new Map();   // prop id -> {obj, hinge, kind, open: 0..1}
    this.lamps = [];          // {x, y, z, color, room, flicker}
    this.lampObjs = [];       // lamp fixtures on a deck that can lose its power: {room, mats}
    this.loose = [];          // objects added to the group outside the per-room batches
    this.welds = new Map();   // key -> {mesh, t}: fresh welds (doors, vents), glowing and cooling
    this.fallbackMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.25 });
    this.glowMats = new Map();   // emissive colour -> material (exterior lights)
    // Outside the hull only the fill light reaches: the silhouette keeps a floor of its own light.
    this.exteriorMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0.2, emissive: 0x2a3038, emissiveIntensity: 0.55 });
    this.look = HULL_CLASSES[level.cls]?.look ?? null;
    this.breachWalls = new Map(); // breach id -> {obj, x, y, T, open}: weak bulkheads, their own objects
  }

  // ------------------------------------------------------------------ the class's look

  /** The class's cast over the kit ([r, g, b] multipliers), or null for none. */
  classTint() { return this.look?.tint ?? null; }

  /** The cast for one room: on a station a little different per room (a patchwork of refits). */
  roomTint(rng) {
    const L = this.look;
    if (!L) return null;
    if (!L.jitter) return L.tint;
    const j = rng.float(-L.jitter, L.jitter);
    const w = rng.float(-L.jitter, L.jitter);
    return [L.tint[0] * (1 + j + w), L.tint[1] * (1 + j), L.tint[2] * (1 + j - w)];
  }

  /** One wall tile's share of the wear: darker here and there, rusting where the class rusts. */
  tileTint(base, rng) {
    const L = this.look;
    if (!L) return null;
    const k = 1 - L.wear * rng.float(0, 0.3);
    const r = rng.chance(L.rust * 0.3) ? [1.12, 0.92, 0.78] : [1, 1, 1];
    return [base[0] * k * r[0], base[1] * k * r[1], base[2] * k * r[2]];
  }

  glowMat(color) {
    let m = this.glowMats.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 1.25, roughness: 0.6 });
      this.glowMats.set(color, m);
    }
    return m;
  }

  dockPiece(name) {
    const e = this.assets?.gltf.get('dock');
    return e ? e.gltf.scene.getObjectByName(name) ?? null : null;
  }

  /**
   * Boarding ship + tube sections between its collar and the derelict's hull. Modelled docked
   * on the port side; for a starboard dock (level.mirror) the pieces are placed in the mirrored
   * frame and flipped (the batcher rights their winding).
   */
  buildDock(room) {
    const b = new Batch();
    const L = this.level;
    const X = L.cols * WORLD.CELL_W;
    const flip = L.mirror ? new THREE.Matrix4().makeScale(-1, 1, 1).setPosition(X, 0, 0) : new THREE.Matrix4();
    const u = L.mirror ? { x0: X - room.x1, x1: X - room.x0, collar: X - room.collar } : room;
    const at = (x, y, z = 0) => new THREE.Matrix4().multiplyMatrices(flip, new THREE.Matrix4().makeTranslation(x, y, z));
    const ship = this.dockPiece('dropship');
    if (ship) b.addObject(ship, at(u.collar, room.y0, 0));
    else b.add(boxGeo(u.collar - u.x0 + 6, 5.2, 3.6, 0x3a4436), at(u.x0 + (u.collar - u.x0) / 2 - 2, room.y0 + 2.1, -0.6), this.fallbackMat);
    const tube = this.dockPiece('dock_tube');
    for (let x = u.collar; x < u.x1 - 0.01; x += 2) {
      if (tube) b.addObject(tube, at(x, room.y0, 0));
      else b.add(boxGeo(2, 0.3, 3, 0x2a2e30), at(x + 1, room.y0 + 3.35, -0.5), this.fallbackMat);
    }
    for (const lx of [u.collar - 3, u.collar - 7, u.collar - 11]) {
      this.lamps.push({ x: L.mirror ? X - lx : lx, y: room.y0 + 3.6, z: 0.4, color: 0xdfeaff, room: room.id, flicker: 0, dim: 1 });
    }
    return b.build('dock');
  }

  kit(name) {
    const e = this.assets?.gltf.get('roomkit');
    return e ? e.gltf.scene.getObjectByName(name) ?? null : null;
  }

  propNode(kind) {
    const e = this.assets?.gltf.get('props');
    return e ? e.gltf.scene.getObjectByName(kind) ?? null : null;
  }

  build() {
    const L = this.level;
    for (const room of L.rooms) this.group.add(room.exterior ? this.buildDock(room) : this.buildRoom(room));
    this.group.add(this.buildStructure());
    this.group.add(this.buildExterior());
    for (const p of L.portals) {
      if (p.kind === 'door') this.addDoor(p);
    }
    for (const room of L.rooms) for (const prop of room.props) this.addProp(room, prop);
    for (const o of this.loose) this.group.add(o);
    return this.group;
  }

  // ------------------------------------------------------------------ rooms

  buildRoom(room) {
    const b = new Batch();
    const rng = new Rng(room.seed ?? room.id, 'dress');
    const wear = new Rng(room.seed ?? room.id, 'wear'); // its own stream: the wear adds to the dressing, never reshuffles it
    const tpl = ROOM_TYPES[room.type];
    const M = new THREE.Matrix4();
    const at = (x, y, z = 0, sx = 1, sy = 1) => M.makeScale(sx, sy, 1).setPosition(x, y, z);
    const tint = this.roomTint(wear);

    // Back wall panels, 2 m modules - the room type's variants, or the class's own for that type.
    // A hall two decks tall gets a second row over a band where the deck's slab would be.
    const variants = Object.entries(this.look?.backdrops?.[room.type] ?? tpl.backdrop);
    const rows = room.tall ? [room.y0, room.y0 + DECK_H] : [room.y0];
    for (const ry of rows) {
      let lastWindow = -99;
      for (let x = room.x0 + 1, i = 0; x < room.x1; x += 2, i++) {
        let v = rng.weighted(variants);
        if (v === 'window' && i - lastWindow < 3) v = 'plain';
        if (v === 'window') lastWindow = i;
        const piece = this.kit(`wall_${v}`) ?? this.kit('wall_plain');
        const t = this.tileTint(tint, wear);
        if (piece) b.addObject(piece, at(x, ry), t);
        else b.add(boxGeo(2, INNER_H, 0.3, v === 'window' ? 0x1a2a3a : COL.wall), at(x, ry + INNER_H / 2, BACK_Z - 0.15), this.fallbackMat, t);
      }
      if (ry > room.y0) b.add(boxGeo(room.x1 - room.x0, SLAB, 0.6, COL.slab), at((room.x0 + room.x1) / 2, ry - SLAB / 2, BACK_Z + 0.3), this.fallbackMat, tint);
    }

    // Lamps along the back wall. On a deck whose power can fail (ship events) the fixtures stay
    // separate objects, so they can go dark with the deck.
    const lampColor = room.light === 'red' ? 0xff2a1a : (this.look?.lamp ?? 0xcfe8ff);
    const lampPiece = this.kit(room.light === 'red' ? 'lamp_red' : 'lamp_white');
    // (A fuse box in the room can take the lights too - sim/hazards.js.)
    const canFail = this.level.events?.some((e) => e.kind === 'power' && e.rooms.includes(room.id)) || room.props.some((p) => p.kind === 'fuse_box');
    for (const ry of rows) for (let x = room.x0 + 3; x < room.x1 - 1; x += 6) {
      const lx = x + rng.float(-0.6, 0.6);
      if (lampPiece && canFail) {
        const o = lampPiece.clone(true);
        o.position.set(lx, ry, 0);
        const mats = [];
        o.traverse((n) => { if (n.isMesh) { n.material = n.material.clone(); mats.push({ m: n.material, e: n.material.emissiveIntensity ?? 1 }); } });
        this.loose.push(o);
        this.lampObjs.push({ room: room.id, mats, k: 1 });
      } else if (lampPiece) b.addObject(lampPiece, at(lx, ry), tint);
      this.lamps.push({ x: lx, y: ry + 3.5, z: BACK_Z + 0.6, color: lampColor, room: room.id,
        flicker: room.light === 'flicker' ? rng.float(0.5, 3) : 0, dim: (room.light === 'dim' ? 0.5 : 1) * (this.level.mods?.blackout ? 0.2 : 1) });
    }

    // Ceiling clutter and organic dressing.
    for (let x = room.x0 + 1; x < room.x1; x += 2) {
      if (rng.chance(0.35)) {
        const piece = this.kit(rng.chance(0.6) || canFail ? 'ceiling_pipes' : 'ceiling_lamp');
        if (piece) b.addObject(piece, at(x, room.y1 - INNER_H), tint); // (under the ceiling, however high)
      }
    }
    // Organic dressing is modelled in place (puddles/mounds at the wall base); cobwebs are
    // top-left corner pieces, mirrored for right-hand corners.
    const decals = room.nest ? [['biomass', 5], ['slime', 2]] : [['slime', 1.5], ['none', 4]];
    for (let x = room.x0 + 2.5; x < room.x1 - 2; x += rng.float(3, 6)) {
      const d = rng.weighted(decals);
      const piece = d !== 'none' && this.kit(d);
      if (piece) b.addObject(piece, at(x, room.y0, 0, rng.chance(0.5) ? -1 : 1));
    }
    const web = this.kit('cobweb');
    if (web && rng.chance(0.6)) b.addObject(web, at(room.x0 + 0.3 + 0.8, room.y0));
    if (web && rng.chance(0.4)) b.addObject(web, at(room.x1 - 0.3 - 0.8, room.y0, 0, -1));
    for (const vid of room.vents ?? []) {
      const v = this.level.vents[vid];
      const piece = this.kit(v.ceiling ? 'vent_ceiling' : 'vent_wall');
      if (piece) b.addObject(piece, at(v.x, v.ceiling ? room.y1 - INNER_H : room.y0), tint);
      else b.add(boxGeo(1, v.ceiling ? 0.1 : 0.6, 0.1, 0x111416), at(v.x, v.ceiling ? room.y1 - 0.05 : room.y0 + 0.45, BACK_Z + 0.1), this.fallbackMat, tint);
    }

    // Ladders & stairs whose lower end is in this room.
    for (const pid of room.portals) {
      const p = this.level.portals[pid];
      if (p.a !== room.id || p.kind === 'door') continue;
      if (p.kind === 'ladder') {
        const piece = this.kit('ladder');
        if (piece) b.addObject(piece, at(p.x, p.yLow), tint);
        else {
          for (const dx of [-0.35, 0.35]) b.add(boxGeo(0.08, 6, 0.08, COL.ladder), at(p.x + dx, p.yLow + 3, WORLD.LADDER_Z), this.fallbackMat);
          for (let y = 0.3; y < 6; y += 0.35) b.add(boxGeo(0.7, 0.05, 0.05, COL.ladder), at(p.x, p.yLow + y, WORLD.LADDER_Z), this.fallbackMat);
        }
      } else {
        const x0 = Math.min(p.xb, p.xt);
        const piece = this.kit('stairs');
        if (piece) b.addObject(piece, at(p.dir > 0 ? x0 : x0 + WORLD.STAIRS_RUN, p.yLow, 0, p.dir), tint);
        else {
          for (let k = 0; k < 14; k++) {
            const t = (k + 0.5) / 14;
            const sx = p.xb + (p.xt - p.xb) * t;
            b.add(boxGeo(WORLD.STAIRS_RUN / 14 + 0.02, 0.12, 1.0, COL.stairs), at(sx, p.yLow + (p.yHigh - p.yLow) * t, WORLD.STAIRS_Z), this.fallbackMat);
          }
        }
      }
    }

    const group = b.build(`room-${room.id}`);
    return group;
  }

  // ------------------------------------------------------------------ slabs, hull, bulkheads

  buildStructure() {
    const L = this.level;
    const b = new Batch();
    const M = new THREE.Matrix4();
    // Slab body stops 0.1 m behind the front so the kit's floor_trim strip (z 0.9..1.0) shows.
    const front = FRONT_Z - (this.kit('floor_trim') ? 0.1 : 0);
    const depth = front - BACK_Z + 0.4;
    const zc = (front + BACK_Z - 0.4) / 2;
    const trim = this.kit('floor_trim');
    const T = this.classTint();
    for (const s of L.solids) {
      const w = s.x1 - s.x0;
      const h = s.y1 - s.y0;
      const cx = (s.x0 + s.x1) / 2;
      const cy = (s.y0 + s.y1) / 2;
      if (s.kind === 'slab') {
        b.add(boxGeo(w, h, depth, COL.slab), M.makeTranslation(cx, cy, zc), this.fallbackMat, T);
        if (trim) for (let x = s.x0 + 1; x <= s.x1 - 1; x += 2) b.addObject(trim, M.makeTranslation(x, s.y1, 0), T);
      } else if (s.kind === 'hull') {
        const air = this.isAirlockHull(s);
        if (air === 'dock') {
          // The docking hull: one full-height piece with the lock cut through it, facing the tube.
          const piece = this.dockPiece('hull_dock') ?? this.kit('hull_airlock');
          const H = this.level.heading ?? 1;
          if (piece) b.addObject(piece, M.makeScale(H, 1, 1).setPosition(cx, this.level.rooms[this.level.airlock].y0, 0), T);
          else b.add(boxGeo(w, DECK_H - SLAB, depth, COL.hull), M.makeTranslation(cx, this.level.rooms[this.level.airlock].y0 + (DECK_H - SLAB) / 2, zc), this.fallbackMat, T);
          continue;
        }
        const piece = this.kit('hull_end');
        if (piece) b.addObject(piece, M.makeTranslation(cx, s.y0, 0), T);
        else b.add(boxGeo(w, h, depth, COL.hull), M.makeTranslation(cx, cy, zc), this.fallbackMat, T);
      }
    }
    // Walkways over shaft openings (the opening is behind the walkway in depth).
    for (const p of L.portals) {
      if (p.kind === 'door') continue;
      const [h0, h1] = shaftOpening(p);
      const back = -0.55;
      b.add(boxGeo(h1 - h0, SLAB, front - back, COL.slab), M.makeTranslation((h0 + h1) / 2, p.yHigh - SLAB / 2, (front + back) / 2), this.fallbackMat, T);
      if (p.kind === 'ladder') {
        const rim = this.kit('shaft_rim');
        if (rim) b.addObject(rim, M.makeTranslation(p.x, p.yHigh, 0), T);
      }
    }
    // Bulkheads between neighbouring rooms.
    for (let d = 0; d < L.decks; d++) {
      const rooms = L.rooms.filter((r) => r.deck === d && !r.exterior).sort((a, c) => a.x0 - c.x0);
      for (let i = 0; i + 1 < rooms.length; i++) {
        const xb = rooms[i].x1;
        if (rooms[i + 1].x0 - xb > 0.01) {
          // A hall's void between them: a solid wall on each side of it.
          for (const wx of [xb, rooms[i + 1].x0]) {
            const piece = this.kit('bulkhead_solid');
            if (piece) b.addObject(piece, M.makeTranslation(wx, rooms[i].y0, 0), T);
            else b.add(boxGeo(WALL, INNER_H, depth, COL.bulk), M.makeTranslation(wx, rooms[i].y0 + INNER_H / 2, zc), this.fallbackMat, T);
          }
          continue;
        }
        const door = L.portals.find((p) => p.kind === 'door' && p.a === rooms[i].id);
        const weak = L.breaches?.find((q) => q.a === rooms[i].id && q.b === rooms[i + 1].id);
        if (weak) { this.breachWall(weak, xb, rooms[i].y0, T); continue; }
        const piece = this.kit(door ? 'bulkhead_door' : 'bulkhead_solid');
        if (piece) b.addObject(piece, M.makeTranslation(xb, rooms[i].y0, 0), T);
        else {
          const y0 = rooms[i].y0 + (door ? DOOR_H : 0);
          const y1 = rooms[i].y0 + INNER_H;
          b.add(boxGeo(WALL, y1 - y0, depth, COL.bulk), M.makeTranslation(xb, (y0 + y1) / 2, zc), this.fallbackMat, T);
          if (door) b.add(boxGeo(WALL, DOOR_H, 0.4, COL.bulk), M.makeTranslation(xb, rooms[i].y0 + DOOR_H / 2, BACK_Z + 0.2), this.fallbackMat, T);
        }
      }
    }
    // Outer plating above the roof and below the keel gives the ship a silhouette against space.
    for (const s of L.solids.filter((q) => q.kind === 'slab')) {
      if (Math.abs(s.y1 - L.decks * DECK_H) < 0.01) b.add(boxGeo(s.x1 - s.x0, 1.4, depth, COL.plating), M.makeTranslation((s.x0 + s.x1) / 2, s.y1 + 0.7, zc - 0.4), this.fallbackMat, T);
      if (Math.abs(s.y1) < 0.01) b.add(boxGeo(s.x1 - s.x0, 1.6, depth, COL.plating), M.makeTranslation((s.x0 + s.x1) / 2, s.y0 - 0.8, zc - 0.4), this.fallbackMat, T);
    }
    return b.build('structure');
  }

  /** A weak bulkhead (gen/populate.js placeBreaches): an object of its own, so it can be blown open. */
  breachWall(br, x, y, T) {
    const b = new Batch();
    const M = new THREE.Matrix4();
    const piece = this.kit('bulkhead_weak') ?? this.kit('bulkhead_solid');
    if (piece) b.addObject(piece, M.makeTranslation(x, y, 0), T);
    else {
      const depth = FRONT_Z - BACK_Z + 0.3;
      const zc = (FRONT_Z + BACK_Z - 0.3) / 2;
      b.add(boxGeo(WALL, INNER_H, depth, COL.bulk), M.makeTranslation(x, y + INNER_H / 2, zc), this.fallbackMat, T);
      b.add(boxGeo(WALL + 0.04, 0.3, 0.3, 0xb8912a), M.makeTranslation(x, y + 1.5, FRONT_Z - 0.3), this.fallbackMat);
    }
    const obj = b.build(`breach-${br.id}`);
    this.loose.push(obj);
    this.breachWalls.set(br.id, { obj, x, y, T, open: false });
  }

  /** Blown open: the torn wall takes the weak one's place (the lintel stays). */
  openBreach(id) {
    const v = this.breachWalls.get(id);
    if (!v || v.open) return;
    v.open = true;
    this.group.remove(v.obj);
    const b = new Batch();
    const M = new THREE.Matrix4();
    const piece = this.kit('bulkhead_breach');
    if (piece) b.addObject(piece, M.makeTranslation(v.x, v.y, 0), v.T);
    else {
      const depth = FRONT_Z - BACK_Z + 0.3;
      const zc = (FRONT_Z + BACK_Z - 0.3) / 2;
      b.add(boxGeo(WALL, INNER_H - DOOR_H, depth, COL.bulk), M.makeTranslation(v.x, v.y + DOOR_H + (INNER_H - DOOR_H) / 2, zc), this.fallbackMat, v.T);
      for (const [dx, w, h] of [[-0.9, 0.8, 0.3], [0.7, 0.6, 0.25], [-0.2, 0.5, 0.2]]) b.add(boxGeo(w, h, 0.6, COL.plating), M.makeTranslation(v.x + dx, v.y + h / 2, 0.2), this.fallbackMat);
    }
    v.obj = b.build(`breach-${id}-open`);
    this.group.add(v.obj);
  }

  /** The class's silhouette beyond the hull (exterior.js): drives, pods, masts, running lights. */
  buildExterior() {
    const b = new Batch();
    const M = new THREE.Matrix4();
    for (const p of exteriorPieces(this.level)) {
      const geo = p.glow ? boxGeo(p.x1 - p.x0, p.y1 - p.y0, p.z1 - p.z0, 0x000000, { shadeTop: 1, shadeBottom: 1 }) : boxGeo(p.x1 - p.x0, p.y1 - p.y0, p.z1 - p.z0, p.color);
      b.add(geo, M.makeTranslation((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, (p.z0 + p.z1) / 2), p.glow ? this.glowMat(p.glow) : this.exteriorMat);
    }
    return b.build('exterior');
  }

  /** 'dock' for the hull the boarding tube meets (the lock is cut through it), else false. */
  isAirlockHull(s) {
    const air = this.level.rooms[this.level.airlock];
    const H = this.level.heading ?? 1;
    const atWall = H > 0 ? Math.abs(s.x1 - air.x0) < 0.01 : Math.abs(s.x0 - air.x1) < 0.01;
    const onDeck = s.y0 >= air.y0 - 0.01 && s.y0 < air.y0 + DECK_H - 0.01;
    return atWall && onDeck ? 'dock' : false;
  }

  // ------------------------------------------------------------------ doors & props

  addDoor(p) {
    const piece = this.kit('door_panel');
    let obj;
    if (piece) obj = piece.clone(true);
    else {
      const g = boxGeo(WORLD.DOOR_W, DOOR_H, 2.5, COL.door);
      g.translate(0, -DOOR_H / 2, 0);
      obj = new THREE.Mesh(g, this.fallbackMat);
    }
    obj.position.set(p.x, p.y + DOOR_H, piece ? 0 : 0.35);
    this.group.add(obj);
    this.doors.set(p.id, { obj, open: p.open ? 1 : 0, portal: p });
  }

  addProp(room, prop) {
    const def = PROPS[prop.kind];
    const node = this.propNode(prop.kind);
    let obj;
    if (node) obj = node.clone(true);
    else {
      const h = def.h ?? (prop.kind === 'locker' ? 2.2 : prop.kind === 'reactor' ? 4 : prop.kind === 'beam' ? 0.35 : 1.0);
      const g = boxGeo(def.w, h, 0.8, prop.loot ? 0x6a5a3a : prop.objective ? 0x3a6a5a : COL.prop);
      g.translate(0, h / 2 + (prop.kind === 'beam' ? 1.5 : 0), 0);
      obj = new THREE.Mesh(g, this.fallbackMat);
    }
    obj.position.set(prop.x, room.y0, prop.z);
    this.group.add(obj);
    if (prop.loot?.type === 'weapon') {
      // The case's glowing strip shows the rarity inside before you open it.
      const col = new THREE.Color(RARITY[prop.loot.item.rarity].color);
      obj.traverse((o) => {
        if (o.isMesh && o.material.name === 'M_Rarity') {
          o.material = o.material.clone();
          o.material.color.copy(col);
          o.material.emissive.copy(col);
          o.material.emissiveIntensity = 2.2;
        }
      });
    }
    const hinge = obj.getObjectByName(`${prop.kind}_lid`) ?? obj.getObjectByName(`${prop.kind}_door`);
    this.props.set(prop.id, { obj, hinge, lid: !!obj.getObjectByName(`${prop.kind}_lid`), rest: hinge?.rotation.clone(), prop, open: 0 });
  }

  /** Destroyed destructible: swap in its wreck model (or just remove it). */
  destroyProp(prop) {
    const v = this.props.get(prop.id);
    if (!v || v.wrecked) return;
    v.wrecked = true;
    this.group.remove(v.obj);
    const wreck = PROPS[prop.kind].wreck && this.propNode(PROPS[prop.kind].wreck);
    if (wreck) {
      const w = wreck.clone(true);
      w.position.copy(v.obj.position);
      this.group.add(w);
      v.obj = w;
    }
  }

  // ------------------------------------------------------------------ per-frame

  update(dt, time) {
    for (const d of this.doors.values()) {
      const target = d.portal.open ? 1 : 0;
      d.open += Math.sign(target - d.open) * Math.min(Math.abs(target - d.open), dt * 1.6);
      d.obj.scale.y = 1 - d.open * 0.94;
    }
    for (const p of this.props.values()) {
      if (!p.prop.opened || p.open >= 1) continue;
      p.open = Math.min(1, p.open + dt * 2.5);
      if (p.hinge) {
        const a = -1.7 * easeOut(p.open);
        if (p.lid) p.hinge.rotation.x = p.rest.x + a;
        else p.hinge.rotation.y = p.rest.y + a;
      }
    }
    // Eased, so a failing lamp sags and recovers over a few frames instead of popping. A deck
    // with its power out (ship events) goes dark - fixtures too; firelight burns regardless.
    const rooms = this.level.rooms;
    for (const lamp of this.lamps) {
      const out = !lamp.fire && !lamp.blaze && rooms[lamp.room]?.powerOut;
      const want = out ? 0.02 : lamp.dim * (lamp.flicker ? flicker(time * lamp.flicker + lamp.x) : 1);
      lamp.k = lamp.k === undefined ? want : lamp.k + (want - lamp.k) * Math.min(1, dt * (out ? 3 : 8));
    }
    for (const wd of this.welds.values()) {
      if (wd.t > 5) continue;
      wd.t += dt;
      wd.mesh.material.emissiveIntensity = 3 * Math.max(0.02, 1 - wd.t / 5) ** 2;
    }
    for (const f of this.lampObjs) {
      const want = rooms[f.room]?.powerOut ? 0.04 : 1;
      if (Math.abs(f.k - want) < 1e-3) continue;
      f.k += (want - f.k) * Math.min(1, dt * 3);
      for (const { m, e } of f.mats) m.emissiveIntensity = e * f.k;
    }
  }

  /** A fresh weld bead over a door seam or a vent: white-hot, cooling to dark metal. */
  weld(key, x, y, w, h, z) {
    this.unweld(key);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.45, metalness: 0.75, emissive: 0xff7a2a, emissiveIntensity: 3 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), mat);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this.welds.set(key, { mesh, t: 0 });
  }

  unweld(key) {
    const w = this.welds.get(key);
    if (!w) return;
    this.group.remove(w.mesh);
    this.welds.delete(key);
  }

  /** A doorway on fire: its own flickering orange light (the lamp pool picks it up). */
  addFireLight(portal) {
    const y = Math.min(this.level.rooms[portal.a].y0, this.level.rooms[portal.b].y0);
    this.lamps.push({ x: portal.x, y: y + 1.3, z: 0.5, color: 0xff6a20, room: portal.a, flicker: 3.3, dim: 1.6, fire: portal.id });
  }

  removeFireLight(portal) { this.lamps = this.lamps.filter((l) => l.fire !== portal.id); }

  /** A blast's fire on the deck (sim/hazards.js): its own flickering light while it burns. */
  addBlastLight(id, x, y, room) {
    this.lamps.push({ x, y: y + 0.8, z: 0.5, color: 0xff6a20, room, flicker: 3.3, dim: 1.5, blaze: id });
  }

  removeBlastLight(id) { this.lamps = this.lamps.filter((l) => l.blaze !== id); }

  /** A flare on the deck: a hot red light low in the room, flickering, for the rest of the mission. */
  addFlareLight(room, x, y) {
    this.lamps.push({ x, y: y + 0.5, z: 0.6, color: 0xff3a28, room: room.id, flicker: 5.2, dim: 1.8, flare: room.id });
  }
}

const easeOut = (t) => 1 - (1 - t) ** 3;
function flicker(t) {
  const s = Math.sin(t * 7.1) + Math.sin(t * 13.7) * 0.6 + Math.sin(t * 2.3);
  // Mostly steady; an occasional brown-out sag. No per-frame buzz: at 60 fps a fast sine
  // aliases into frame-to-frame brightness jitter that reads as flicker on everything lit.
  const x = Math.min(1, Math.max(0, (s - 1.6) / 0.6));
  return 0.92 - 0.42 * x * x * (3 - 2 * x);
}
