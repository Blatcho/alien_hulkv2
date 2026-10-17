// Builds the ship's 3D scenery from level data + the Blender room kit (roomkit.glb, props.glb).
// Static pieces are batched per room; doors, props with hinged lids and lamps stay separate
// so they can animate. Every kit piece has a box fallback, so the game runs without art.
import * as THREE from 'three';
import { WORLD } from '../core/config.js';
import { Rng } from '../core/rng.js';
import { PROPS, ROOM_TYPES } from '../gen/templates.js';
import { RARITY } from '../sim/loot.js';
import { shaftOpening } from '../gen/level.js';
import { Batch, boxGeo } from './batch.js';

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
    this.glowMats = [];
  }

  dockPiece(name) {
    const e = this.assets?.gltf.get('dock');
    return e ? e.gltf.scene.getObjectByName(name) ?? null : null;
  }

  /** Boarding ship + tube sections between its collar and the derelict's hull. */
  buildDock(room) {
    const b = new Batch();
    const M = new THREE.Matrix4();
    const ship = this.dockPiece('dropship');
    if (ship) b.addObject(ship, M.makeTranslation(room.collar, room.y0, 0));
    else b.add(boxGeo(room.collar - room.x0 + 6, 5.2, 3.6, 0x3a4436), M.makeTranslation(room.x0 + (room.collar - room.x0) / 2 - 2, room.y0 + 2.1, -0.6), this.fallbackMat);
    const tube = this.dockPiece('dock_tube');
    for (let x = room.collar; x < room.x1 - 0.01; x += 2) {
      if (tube) b.addObject(tube, M.makeTranslation(x, room.y0, 0));
      else b.add(boxGeo(2, 0.3, 3, 0x2a2e30), M.makeTranslation(x + 1, room.y0 + 3.35, -0.5), this.fallbackMat);
    }
    for (const lx of [room.collar - 3, room.collar - 7, room.collar - 11]) {
      this.lamps.push({ x: lx, y: room.y0 + 3.6, z: 0.4, color: 0xdfeaff, room: room.id, flicker: 0, dim: 1 });
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
    const tpl = ROOM_TYPES[room.type];
    const M = new THREE.Matrix4();
    const at = (x, y, z = 0, sx = 1, sy = 1) => M.makeScale(sx, sy, 1).setPosition(x, y, z);

    // Back wall panels, 2 m modules.
    const variants = Object.entries(tpl.backdrop);
    let lastWindow = -99;
    for (let x = room.x0 + 1, i = 0; x < room.x1; x += 2, i++) {
      let v = rng.weighted(variants);
      if (v === 'window' && i - lastWindow < 3) v = 'plain';
      if (v === 'window') lastWindow = i;
      const piece = this.kit(`wall_${v}`) ?? this.kit('wall_plain');
      if (piece) b.addObject(piece, at(x, room.y0));
      else b.add(boxGeo(2, INNER_H, 0.3, v === 'window' ? 0x1a2a3a : COL.wall), at(x, room.y0 + INNER_H / 2, BACK_Z - 0.15), this.fallbackMat);
    }

    // Lamps along the back wall. On a deck whose power can fail (ship events) the fixtures stay
    // separate objects, so they can go dark with the deck.
    const lampColor = room.light === 'red' ? 0xff2a1a : 0xcfe8ff;
    const lampPiece = this.kit(room.light === 'red' ? 'lamp_red' : 'lamp_white');
    const canFail = this.level.events?.some((e) => e.kind === 'power' && e.rooms.includes(room.id));
    for (let x = room.x0 + 3; x < room.x1 - 1; x += 6) {
      const lx = x + rng.float(-0.6, 0.6);
      if (lampPiece && canFail) {
        const o = lampPiece.clone(true);
        o.position.set(lx, room.y0, 0);
        const mats = [];
        o.traverse((n) => { if (n.isMesh) { n.material = n.material.clone(); mats.push({ m: n.material, e: n.material.emissiveIntensity ?? 1 }); } });
        this.loose.push(o);
        this.lampObjs.push({ room: room.id, mats, k: 1 });
      } else if (lampPiece) b.addObject(lampPiece, at(lx, room.y0));
      this.lamps.push({ x: lx, y: room.y0 + 3.5, z: BACK_Z + 0.6, color: lampColor, room: room.id,
        flicker: room.light === 'flicker' ? rng.float(0.5, 3) : 0, dim: (room.light === 'dim' ? 0.5 : 1) * (this.level.mods?.blackout ? 0.2 : 1) });
    }

    // Ceiling clutter and organic dressing.
    for (let x = room.x0 + 1; x < room.x1; x += 2) {
      if (rng.chance(0.35)) {
        const piece = this.kit(rng.chance(0.6) || canFail ? 'ceiling_pipes' : 'ceiling_lamp');
        if (piece) b.addObject(piece, at(x, room.y0));
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
      if (piece) b.addObject(piece, at(v.x, room.y0));
      else b.add(boxGeo(1, v.ceiling ? 0.1 : 0.6, 0.1, 0x111416), at(v.x, v.ceiling ? room.y1 - 0.05 : room.y0 + 0.45, BACK_Z + 0.1), this.fallbackMat);
    }

    // Ladders & stairs whose lower end is in this room.
    for (const pid of room.portals) {
      const p = this.level.portals[pid];
      if (p.a !== room.id || p.kind === 'door') continue;
      if (p.kind === 'ladder') {
        const piece = this.kit('ladder');
        if (piece) b.addObject(piece, at(p.x, p.yLow));
        else {
          for (const dx of [-0.35, 0.35]) b.add(boxGeo(0.08, 6, 0.08, COL.ladder), at(p.x + dx, p.yLow + 3, WORLD.LADDER_Z), this.fallbackMat);
          for (let y = 0.3; y < 6; y += 0.35) b.add(boxGeo(0.7, 0.05, 0.05, COL.ladder), at(p.x, p.yLow + y, WORLD.LADDER_Z), this.fallbackMat);
        }
      } else {
        const x0 = Math.min(p.xb, p.xt);
        const piece = this.kit('stairs');
        if (piece) b.addObject(piece, at(p.dir > 0 ? x0 : x0 + WORLD.STAIRS_RUN, p.yLow, 0, p.dir));
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
    for (const s of L.solids) {
      const w = s.x1 - s.x0;
      const h = s.y1 - s.y0;
      const cx = (s.x0 + s.x1) / 2;
      const cy = (s.y0 + s.y1) / 2;
      if (s.kind === 'slab') {
        b.add(boxGeo(w, h, depth, COL.slab), M.makeTranslation(cx, cy, zc), this.fallbackMat);
        if (trim) for (let x = s.x0 + 1; x <= s.x1 - 1; x += 2) b.addObject(trim, M.makeTranslation(x, s.y1, 0));
      } else if (s.kind === 'hull') {
        const air = this.isAirlockHull(s);
        if (air === 'upper') continue; // part of the docking hull piece below
        const piece = air === 'dock' ? (this.dockPiece('hull_dock') ?? this.kit('hull_airlock')) : this.kit(air ? 'hull_airlock' : 'hull_end');
        if (piece) b.addObject(piece, M.makeTranslation(cx, air === 'dock' ? this.level.rooms[this.level.airlock].y0 : s.y0, 0));
        else b.add(boxGeo(w, h, depth, COL.hull), M.makeTranslation(cx, cy, zc), this.fallbackMat);
      }
    }
    // Walkways over shaft openings (the opening is behind the walkway in depth).
    for (const p of L.portals) {
      if (p.kind === 'door') continue;
      const [h0, h1] = shaftOpening(p);
      const back = -0.55;
      b.add(boxGeo(h1 - h0, SLAB, front - back, COL.slab), M.makeTranslation((h0 + h1) / 2, p.yHigh - SLAB / 2, (front + back) / 2), this.fallbackMat);
      if (p.kind === 'ladder') {
        const rim = this.kit('shaft_rim');
        if (rim) b.addObject(rim, M.makeTranslation(p.x, p.yHigh, 0));
      }
    }
    // Bulkheads between neighbouring rooms.
    for (let d = 0; d < L.decks; d++) {
      const rooms = L.rooms.filter((r) => r.deck === d && !r.exterior).sort((a, c) => a.x0 - c.x0);
      for (let i = 0; i + 1 < rooms.length; i++) {
        const xb = rooms[i].x1;
        const door = L.portals.find((p) => p.kind === 'door' && p.a === rooms[i].id);
        const piece = this.kit(door ? 'bulkhead_door' : 'bulkhead_solid');
        if (piece) b.addObject(piece, M.makeTranslation(xb, rooms[i].y0, 0));
        else {
          const y0 = rooms[i].y0 + (door ? DOOR_H : 0);
          const y1 = rooms[i].y0 + INNER_H;
          b.add(boxGeo(WALL, y1 - y0, depth, COL.bulk), M.makeTranslation(xb, (y0 + y1) / 2, zc), this.fallbackMat);
          if (door) b.add(boxGeo(WALL, DOOR_H, 0.4, COL.bulk), M.makeTranslation(xb, rooms[i].y0 + DOOR_H / 2, BACK_Z + 0.2), this.fallbackMat);
        }
      }
    }
    // Outer plating above the roof and below the keel gives the ship a silhouette against space.
    for (const s of L.solids.filter((q) => q.kind === 'slab')) {
      if (Math.abs(s.y1 - L.decks * DECK_H) < 0.01) b.add(boxGeo(s.x1 - s.x0, 1.4, depth, COL.plating), M.makeTranslation((s.x0 + s.x1) / 2, s.y1 + 0.7, zc - 0.4), this.fallbackMat);
      if (Math.abs(s.y1) < 0.01) b.add(boxGeo(s.x1 - s.x0, 1.6, depth, COL.plating), M.makeTranslation((s.x0 + s.x1) / 2, s.y0 - 0.8, zc - 0.4), this.fallbackMat);
    }
    return b.build('structure');
  }

  /** 'dock' / 'upper' for the docking hull (door cut through it), true for a plain airlock hull. */
  isAirlockHull(s) {
    const air = this.level.rooms[this.level.airlock];
    if (Math.abs(s.x1 - air.x0) > 0.01) return false;
    if (this.level.dock === undefined) return Math.abs(s.y0 - air.y0) < 0.01;
    return Math.abs(s.y0 - air.y0) < 0.01 ? 'dock' : 'upper';
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
      const h = prop.kind === 'locker' ? 2.2 : prop.kind === 'reactor' ? 4 : prop.kind === 'beam' ? 0.35 : 1.0;
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
      const out = !lamp.fire && rooms[lamp.room]?.powerOut;
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
