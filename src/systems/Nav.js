// Navigation for anything that walks: the demo autopilot, following survivors and aliens on the deck.
// Rooms are the graph (doors, ladders, stairs); inside a room an agent walks straight to its waypoint.
// The agent writes a controller-shaped intent: {moveX, moveY, jump}.
import { roomPath, TILE } from '../gen/Ship.js';

// Moves a body by an intent the way the AI characters do: accelerate towards moveX * speed, jump
// on request, enter ladders on moveY and climb them, step off at either end. Shared by survivors,
// aliens and the walkability test.
export function walk(body, it, dt, physics, { speed = 120, climb = 140, jump = 560 } = {}) {
  if (it.moveY !== 0 && !body.onLadder) {
    const lad = physics.ladderNear(body, it.moveY > 0);
    if (lad) { body.onLadder = true; body.ladder = lad; body.vy = 0; body.vx = 0; if (it.moveY < 0 && body.onHatch) body.y -= 2; }
  }
  if (body.onLadder) {
    const lad = body.ladder;
    body.x += (lad.x - body.x) * Math.min(1, dt * 12); body.vx = 0;
    body.vy = it.moveY * climb;
    if (body.y >= lad.yTop - 1 && it.moveY > 0) { body.y = lad.yTop; body.onLadder = false; body.ladder = null; body.onGround = true; body.vy = 0; }
    else if (body.y <= lad.yBottom + 1 && it.moveY < 0) { body.y = lad.yBottom; body.onLadder = false; body.ladder = null; body.vy = 0; }
    else if (it.moveY === 0 && Math.abs(it.moveX) > 0.2) { body.onLadder = false; body.ladder = null; if (body.y < lad.yTop && body.y > lad.yTop - TILE) body.y = lad.yTop - TILE - 1; }
    if (body.onLadder) { body.y += body.vy * dt; return; }
  }
  const want = it.moveX * speed;
  body.vx += (want - body.vx) * Math.min(1, dt * (body.onGround ? 10 : 3));
  if (it.jump && body.onGround) body.vy = jump;
  physics.step(body, dt);
}

export class NavAgent {
  constructor(world, physics) {
    this.world = world; this.physics = physics; this.ship = world.ship;
    this.path = null; this.goal = null; this.leg = null;
    this.stuckT = 0; this.lastX = 0; this.lastY = 0;
    this.intent = { moveX: 0, moveY: 0, jump: false };
    this.arrived = false;
    this.replanT = 0;
  }

  setGoal(x, y, roomId) {
    if (roomId === undefined || roomId < 0) roomId = this.world.roomIdAt(x, y + 4);
    if (this.goal && this.goal.room === roomId && Math.abs(this.goal.x - x) < 8 && Math.abs(this.goal.y - y) < 8) return;
    this.goal = { x, y, room: roomId };
    this.path = null; this.leg = null; this.arrived = false;
  }

  clear() { this.goal = null; this.path = null; this.leg = null; this.intent.moveX = 0; this.intent.moveY = 0; this.intent.jump = false; }

  // body: a Physics Body. Returns the intent for this frame.
  update(body, dt) {
    const it = this.intent;
    it.moveX = 0; it.moveY = 0; it.jump = false;
    if (!this.goal) return it;
    const here = this.world.roomIdAt(body.x, body.y + 4);
    this.replanT -= dt;
    if (!this.path || this.replanT <= 0) {
      this.path = here >= 0 ? roomPath(this.ship.rooms, here, this.goal.room) : null;
      this.replanT = 1.5;
      if (this.path && this.path.length && this.path[0] !== here) this.path = null;
    }
    // stuck watchdog
    const moved = Math.hypot(body.x - this.lastX, body.y - this.lastY);
    this.lastX = body.x; this.lastY = body.y;
    if (moved < 0.4 * dt * 60) this.stuckT += dt; else this.stuckT = 0;
    if (!this.path) { this.wander(body, dt); return it; }
    // on a ladder: climb to whichever end has the shorter route to the goal, before anything else
    if (body.onLadder && body.ladder) {
      const lad = body.ladder;
      const key = lad.id + ':' + this.goal.room;
      if (this.ladderChoice === undefined || this.ladderChoice.key !== key) {
        const pa = roomPath(this.ship.rooms, lad.a, this.goal.room), pb = roomPath(this.ship.rooms, lad.b, this.goal.room);
        const la = pa ? pa.length : 999, lb = pb ? pb.length : 999;
        this.ladderChoice = { key, up: lb < la };
      }
      it.moveY = this.ladderChoice.up ? 1 : -1;
      it.moveX = 0;
      return it;
    }
    // find the current leg: the edge from `here` to the next room on the path
    if (this.path.length <= 1 || here === this.goal.room) {
      // inside the goal room: walk to the goal x
      if (here !== this.goal.room) { this.path = null; return it; }
      const dx = this.goal.x - body.x;
      if (Math.abs(dx) > 6) it.moveX = Math.sign(dx) * Math.min(1, Math.abs(dx) / 40 + 0.35);
      else this.arrived = true;
      if (body.onLadder && body.ladder) it.moveY = Math.abs(this.goal.y - body.ladder.yBottom) <= Math.abs(this.goal.y - body.ladder.yTop) ? -1 : 1;
      else if (body.onLadder) it.moveY = this.goal.y >= body.y ? 1 : -1;
      this.unstick(body, it);
      return it;
    }
    const idx = this.path.indexOf(here);
    if (idx < 0) { this.path = null; return it; }
    const next = this.path[idx + 1];
    if (next === undefined) { this.path = null; return it; }
    const room = this.ship.rooms[here];
    let edge = room.edges.find((e) => e.to === next);
    if (!edge) { this.path = null; return it; }
    this.followEdge(body, edge, it, here);
    this.unstick(body, it);
    return it;
  }

  followEdge(body, edge, it, here) {
    const toRoom = this.ship.rooms[edge.to];
    if (edge.via === 'door') {
      const d = this.world.doors[edge.door];
      // walk through the door: aim past it into the next room
      const dir = toRoom.x0 > this.ship.rooms[here].x0 ? 1 : -1;
      const tx = edge.x + dir * (TILE + 10);
      const dx = tx - body.x;
      it.moveX = Math.sign(dx) * Math.min(1, Math.abs(dx) / 30 + 0.5);
      if (d) this.world.requestOpen(d, 0.6);
    } else if (edge.via === 'ladder') {
      const lad = this.ship.ladders[edge.ladder];
      const up = toRoom.deck > this.ship.rooms[here].deck;
      const dx = lad.x - body.x;
      if (body.onLadder) {
        it.moveY = up ? 1 : -1;
        it.moveX = Math.abs(dx) > 1 ? Math.sign(dx) * 0.3 : 0;
      } else if (Math.abs(dx) > 3) {
        it.moveX = Math.sign(dx) * Math.min(1, Math.abs(dx) / 24 + 0.35);
      } else {
        it.moveY = up ? 1 : -1;
        it.moveX = 0;
      }
    } else if (edge.via === 'stairs') {
      const st = this.ship.stairs[edge.stairs];
      const up = toRoom.deck > this.ship.rooms[here].deck;
      // walk to the foot (edge.x), then keep walking in the run direction until exitX
      const dir = Math.sign(edge.exitX - edge.x);
      const before = (body.x - edge.x) * dir < -4;
      if (before) { const dx = edge.x - body.x; it.moveX = Math.sign(dx) * Math.min(1, Math.abs(dx) / 30 + 0.5); }
      else it.moveX = dir * 0.9;
      if (up && body.onSlope === false && body.onGround && !before && Math.abs(body.vx) < 5 && this.stuckT > 0.4) it.jump = true;
    }
  }

  unstick(body, it) {
    if (this.stuckT > 0.8 && body.onGround && !body.onLadder) {
      it.jump = this.stuckT > 1.2 && (Math.floor(this.stuckT * 4) % 3 === 0);
      if (this.stuckT > 2.5) { this.path = null; this.replanT = 0; this.stuckT = 0; }
    }
  }

  wander(body, dt) {
    const it = this.intent;
    this.wanderT = (this.wanderT || 0) - dt;
    if (this.wanderT <= 0) { this.wanderDir = Math.random() < 0.5 ? -1 : 1; this.wanderT = 0.8 + Math.random() * 1.5; }
    it.moveX = this.wanderDir * 0.5;
    if (body.hitWall) this.wanderDir = -this.wanderDir;
  }
}
