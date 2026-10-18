// Rapier 2D wrapper. Rapier is the authority for "what does a ray hit": line of sight,
// hitscan bullets, and tumbling debris (casings, gibs). Characters are NOT physics-driven -
// they move along the nav graph and just drag kinematic hitboxes around for the raycasts.
//
// Collision groups are 32-bit (membership << 16) | filter.
import RAPIER from '@dimforge/rapier2d-compat';

export const G = { WORLD: 1, MARINE: 2, ALIEN: 4, CRITTER: 8, DEBRIS: 16, PROP: 32, SURVIVOR: 64 };
const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);

let ready = null;
/** Must resolve before constructing Physics (loads the embedded WASM). */
export function initPhysics() {
  ready ??= RAPIER.init();
  return ready;
}

export class Physics {
  constructor(level) {
    this.world = new RAPIER.World({ x: 0, y: -18 });
    this.doors = new Map();       // portal id -> collider
    this.breaches = new Map();    // breach id -> the weak bulkhead's lower collider (gone once blown)
    this.hitboxes = new Map();    // entity id -> {body, collider, entity}
    this.byCollider = new Map();  // collider handle -> entity
    this.debris = [];
    this.maxDebris = 90;

    const fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const s of level.solids) {
      const desc = RAPIER.ColliderDesc.cuboid((s.x1 - s.x0) / 2, (s.y1 - s.y0) / 2)
        .setTranslation((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2)
        .setCollisionGroups(groups(G.WORLD, 0xffff))
        .setFriction(0.8)
        .setRestitution(0.15);
      const col = this.world.createCollider(desc, fixed);
      if (s.kind === 'door') this.doors.set(s.portal, col);
      if (s.kind === 'breach') this.breaches.set(s.breach, col);
    }
    // Every floor gets a thin solid lip on the walking line so debris lands on the walkway,
    // even above shaft openings (the openings sit behind the walkway in depth).
    for (const r of level.rooms) {
      const desc = RAPIER.ColliderDesc.cuboid((r.x1 - r.x0) / 2, 0.05)
        .setTranslation((r.x0 + r.x1) / 2, r.y0 - 0.05)
        .setCollisionGroups(groups(G.DEBRIS, G.DEBRIS));
      this.world.createCollider(desc, fixed);
    }
    for (const p of level.portals) if (p.kind === 'door') this.setDoor(p.id, p.open);
  }

  setDoor(portalId, open) {
    this.doors.get(portalId)?.setEnabled(!open);
  }

  /** A weak bulkhead blown open: a doorway-sized hole (the lintel above stays). */
  openBreach(id) {
    this.breaches.get(id)?.setEnabled(false);
  }

  /** Kinematic box that follows an entity (bottom-centre anchored). */
  addHitbox(entity, w, h, group) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(entity.x, entity.y + h / 2),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2).setCollisionGroups(groups(group, G.WORLD)).setSensor(true),
      body,
    );
    const hb = { body, collider, entity, h };
    this.hitboxes.set(entity.id, hb);
    this.byCollider.set(collider.handle, entity);
    return hb;
  }

  /** Follow the entity: box standing on its feet, or centred on `center` (aliens on walls/ceilings). */
  moveHitbox(entity, height, center = null) {
    const hb = this.hitboxes.get(entity.id);
    if (!hb) return;
    if (height && Math.abs(height - hb.h) > 0.01) {
      hb.collider.setHalfExtents({ x: hb.collider.halfExtents().x, y: height / 2 });
      hb.h = height;
    }
    hb.body.setNextKinematicTranslation(center ?? { x: entity.x, y: entity.y + hb.h / 2 });
  }

  setHitboxEnabled(entity, on) { this.hitboxes.get(entity.id)?.collider.setEnabled(on); }

  removeHitbox(entity) {
    const hb = this.hitboxes.get(entity.id);
    if (!hb) return;
    this.byCollider.delete(hb.collider.handle);
    this.world.removeRigidBody(hb.body);
    this.hitboxes.delete(entity.id);
  }

  step(dt) {
    this.world.timestep = dt;
    this.world.step();
  }

  /**
   * First thing hit along a ray. `mask` = which groups can be hit (default: world only).
   * @returns {{x:number,y:number,dist:number,entity:object|null}|null}
   */
  raycast(x, y, dx, dy, maxDist, mask = G.WORLD) {
    const len = Math.hypot(dx, dy) || 1;
    const ray = new RAPIER.Ray({ x, y }, { x: dx / len, y: dy / len });
    const hit = this.world.castRay(ray, maxDist, true, undefined, groups(0xffff, mask),
      undefined, undefined, (c) => !c.isSensor() || this.byCollider.has(c.handle));
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return { x: x + (dx / len) * d, y: y + (dy / len) * d, dist: d, entity: this.byCollider.get(hit.collider.handle) ?? null };
  }

  /** Clear line between two points (walls and closed doors block). */
  los(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 1e-3) return true;
    return !this.raycast(x0, y0, x1 - x0, y1 - y0, d - 0.05, G.WORLD);
  }

  /** Spawn a tumbling debris piece (casing, gib). Oldest pieces are recycled. */
  spawnDebris(kind, x, y, vx, vy, spin, size = 0.06) {
    if (this.debris.length >= this.maxDebris) {
      const old = this.debris.shift();
      this.world.removeRigidBody(old.body);
    }
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).setLinvel(vx, vy).setAngvel(spin).setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size, size * 0.6).setDensity(2).setRestitution(0.35).setFriction(0.7)
        .setCollisionGroups(groups(G.DEBRIS, G.WORLD | G.DEBRIS)),
      body,
    );
    const d = { kind, body, born: performance.now?.() ?? 0, size };
    this.debris.push(d);
    return d;
  }

  dispose() {
    this.world.free();
  }
}
