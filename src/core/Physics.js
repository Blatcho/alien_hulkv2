// Axis-aligned bodies against the ship's tile grid. The grid is the Ship's Uint8Array; the world
// supplies door state. Tile semantics:
//   SOLID, AIRLOCK, VENT   solid for everyone (vents are only solid; aliens teleport through them)
//   DOOR                   solid while the door is closed
//   HATCH                  one-way: a floor from above, passable while climbing a ladder through it
//   STAIR_R / STAIR_L      a slope under the feet only: walk up it, walk beneath it
//   LADDER                 not solid; climbable
import { T, TILE, CELL_W, DECK_H } from '../gen/Ship.js';

export const GRAVITY = 1900;
export const MAX_FALL = 900;

export class Body {
  constructor(x, y, w, h) {
    this.x = x; this.y = y;                     // feet centre
    this.w = w; this.h = h;
    this.vx = 0; this.vy = 0;
    this.onGround = false; this.onSlope = false; this.onHatch = false;
    this.onLadder = false; this.ladder = null;
    this.hitWall = 0; this.hitHead = false;
    this.gravityScale = 1;
    this.groundTile = T.EMPTY;
    this.noClip = false;
  }
  get left() { return this.x - this.w / 2; }
  get right() { return this.x + this.w / 2; }
  get top() { return this.y + this.h; }
  get cx() { return this.x; }
  get cy() { return this.y + this.h / 2; }
  get col() { return Math.floor(this.x / TILE); }
  get row() { return Math.floor((this.y + 1) / TILE); }
}

export class Physics {
  constructor(ship, world) {
    this.ship = ship; this.world = world;
    this.W = ship.W; this.H = ship.H;
  }

  tile(c, r) { return this.ship.tileAt(c, r); }

  // Is the tile solid for a body moving with the given state? (not slopes: they are handled apart)
  solidTile(c, r, body, dir) {
    const t = this.tile(c, r);
    switch (t) {
      case T.SOLID: case T.AIRLOCK: case T.VENT: return true;
      case T.DOOR: return !this.world.doorOpenAt(c, r);
      case T.HATCH:
        if (body.onLadder || body.noClip) return false;
        // a floor only when coming down onto it from above (the feet were at or above its top)
        return dir === 'down' && body.y >= (r + 1) * TILE - 0.5;
      default: return false;
    }
  }

  isSlope(t) { return t === T.STAIR_R || t === T.STAIR_L; }

  // Height of the stair surface at x inside tile (c, r), in world y.
  slopeY(t, c, r, x) {
    const fx = Math.min(TILE, Math.max(0, x - c * TILE));
    return r * TILE + (t === T.STAIR_R ? fx : TILE - fx);
  }

  // Resolve a step of motion. dt in seconds. Sets onGround/onSlope/hitWall/hitHead.
  step(body, dt) {
    const ship = this.ship;
    body.hitWall = 0; body.hitHead = false;
    if (body.noClip) { body.x += body.vx * dt; body.y += body.vy * dt; return; }
    if (!body.onLadder) {
      body.vy -= GRAVITY * body.gravityScale * dt;
      if (body.vy < -MAX_FALL) body.vy = -MAX_FALL;
    }
    // ---- horizontal ----
    let nx = body.x + body.vx * dt;
    const eps = 0.01;
    if (body.vx !== 0) {
      const dir = Math.sign(body.vx);
      const edge = dir > 0 ? nx + body.w / 2 : nx - body.w / 2;
      const c = Math.floor(edge / TILE);
      const r0 = Math.floor((body.y + 2) / TILE), r1 = Math.floor((body.y + body.h - 1) / TILE);
      let blocked = false;
      for (let r = r0; r <= r1; r++) {
        const t = this.tile(c, r);
        if (this.isSlope(t)) continue;                // slopes never block sideways
        if (this.solidTile(c, r, body, 'side')) {
          // a low step (one tile) is climbed; otherwise block
          blocked = true;
          break;
        }
      }
      if (blocked) {
        // a low ledge (the landing at the top of a stair run, a hatch lip) is stepped onto
        let stepped = false;
        if (body.onGround || body.onSlope) {
          const top = (r0 + 1) * TILE;
          if (top - body.y <= 14 && top > body.y) {
            let clear = true;
            for (let r = r0 + 1; r <= Math.floor((top + body.h - 1) / TILE) && clear; r++) {
              if (this.solidTile(c, r, body, 'side') && !this.isSlope(this.tile(c, r))) clear = false;
            }
            const cc0 = Math.floor((nx - body.w / 2 + 1) / TILE), cc1 = Math.floor((nx + body.w / 2 - 1) / TILE);
            for (let cc = cc0; cc <= cc1 && clear; cc++) for (let r = r0 + 1; r <= Math.floor((top + body.h - 1) / TILE) && clear; r++) {
              if (this.solidTile(cc, r, body, 'side') && !this.isSlope(this.tile(cc, r))) clear = false;
            }
            if (clear) { body.y = top; stepped = true; }
          }
        }
        if (!stepped) {
          nx = dir > 0 ? c * TILE - body.w / 2 - eps : (c + 1) * TILE + body.w / 2 + eps;
          body.hitWall = dir;
          body.vx = 0;
        }
      }
    }
    body.x = nx;
    // ---- vertical ----
    let ny = body.y + body.vy * dt;
    body.onGround = false; body.onSlope = false; body.onHatch = false; body.groundTile = T.EMPTY;
    const c0 = Math.floor((body.x - body.w / 2 + 1) / TILE), c1 = Math.floor((body.x + body.w / 2 - 1) / TILE);
    if (body.vy <= 0) {
      // slopes: by the feet centre
      const sc = Math.floor(body.x / TILE);
      for (const sr of [Math.floor(body.y / TILE), Math.floor(body.y / TILE) - 1, Math.floor(ny / TILE)]) {
        const t = this.tile(sc, sr);
        if (!this.isSlope(t)) continue;
        const sy = this.slopeY(t, sc, sr, body.x);
        if (ny <= sy + 0.5 && body.y >= sy - 14) {
          ny = sy; body.vy = 0; body.onGround = true; body.onSlope = true; body.groundTile = t;
          break;
        }
      }
      if (!body.onGround) {
        const r = Math.floor((ny - 0.5) / TILE);
        for (let c = c0; c <= c1; c++) {
          const t = this.tile(c, r);
          if (this.isSlope(t)) {
            // the feet edge over a slope tile: only stand if the centre is on it (handled above),
            // but the top of a slope run is flush with the floor, so treat its top-row as floor when
            // the body comes from above the tile top
            if (body.y >= (r + 1) * TILE - 0.5 && ny < (r + 1) * TILE && this.slopeTopFlush(t, c, r, body.x)) {
              ny = (r + 1) * TILE; body.vy = 0; body.onGround = true; body.groundTile = t;
              break;
            }
            continue;
          }
          if (this.solidTile(c, r, body, 'down')) {
            ny = (r + 1) * TILE; body.vy = 0; body.onGround = true; body.groundTile = t; body.onHatch = t === T.HATCH;
            break;
          }
        }
      }
      // ladder: hold position if climbing
    } else {
      const r = Math.floor((ny + body.h) / TILE);
      for (let c = c0; c <= c1; c++) {
        const t = this.tile(c, r);
        if (this.isSlope(t)) continue;               // the underside of stairs never bonks
        if (this.solidTile(c, r, body, 'up')) {
          ny = r * TILE - body.h - eps; body.vy = 0; body.hitHead = true;
          break;
        }
      }
    }
    body.y = ny;
    // unstick: if the body's middle is inside a solid tile (doors closing on it), push out sideways
    const mc = Math.floor(body.x / TILE), mr = Math.floor((body.y + body.h / 2) / TILE);
    const mt = this.tile(mc, mr);
    if ((mt === T.SOLID || (mt === T.DOOR && !this.world.doorOpenAt(mc, mr))) && !body.onLadder) {
      const leftFree = !this.solidTile(mc - 1, mr, body, 'side'), rightFree = !this.solidTile(mc + 1, mr, body, 'side');
      if (leftFree && (!rightFree || body.x - mc * TILE < TILE / 2)) body.x = mc * TILE - body.w / 2 - 1;
      else if (rightFree) body.x = (mc + 1) * TILE + body.w / 2 + 1;
      else body.y = (mr + 1) * TILE;
    }
  }

  slopeTopFlush(t, c, r, x) {
    // the high end of the slope tile: x beyond its top edge counts as the flat landing
    const fx = x - c * TILE;
    return t === T.STAIR_R ? fx >= TILE - 4 : fx <= 4;
  }

  // Ladder under or just around the body's centre (returns the ladder record or null).
  ladderAt(x, y, { below = false } = {}) {
    const c = Math.floor(x / TILE);
    const r = Math.floor((y + (below ? -2 : 8)) / TILE);
    for (const l of this.ship.ladders) {
      if (l.col !== c) continue;
      if (r >= l.rBottom && r <= l.rTop) return l;
      if (below && r === l.rTop) return l;
    }
    return null;
  }

  // Ladder whose column matches and whose tiles contain y (or the hatch above it).
  ladderNear(body, wantUp) {
    const c = Math.floor(body.x / TILE);
    const rFeet = Math.floor((body.y + 2) / TILE), rMid = Math.floor((body.y + body.h / 2) / TILE);
    for (const l of this.ship.ladders) {
      if (l.col !== c) continue;
      if (Math.abs(body.x - l.x) > 12) continue;
      if (wantUp && (rFeet >= l.rBottom && rFeet < l.rTop)) return l;
      if (wantUp && rMid >= l.rBottom && rMid < l.rTop) return l;
      if (!wantUp && body.onHatch && rFeet - 1 === l.rTop) return l;
      if (!wantUp && rFeet > l.rBottom && rFeet <= l.rTop) return l;
      if (!wantUp && body.onGround && rFeet - 1 === l.rTop) return l;
    }
    return null;
  }

  // Is there a line of sight between two points through non-solid tiles? (doors count when open)
  lineOfSight(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 8);
    for (let i = 1; i < n; i++) {
      const x = x0 + (dx * i) / n, y = y0 + (dy * i) / n;
      const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
      const t = this.tile(c, r);
      if (t === T.SOLID || t === T.AIRLOCK || t === T.VENT || t === T.HATCH) return false;
      if (t === T.DOOR && !this.world.doorOpenAt(c, r)) return false;
    }
    return true;
  }

  // Raycast against solid tiles and door leaves; returns the hit point and distance or null.
  raycast(x0, y0, dx, dy, maxDist) {
    const n = Math.ceil(maxDist / 4);
    for (let i = 1; i <= n; i++) {
      const d = (maxDist * i) / n;
      const x = x0 + dx * d, y = y0 + dy * d;
      const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
      const t = this.tile(c, r);
      const solid = t === T.SOLID || t === T.AIRLOCK || t === T.VENT || t === T.HATCH || (t === T.DOOR && !this.world.doorOpenAt(c, r)) ||
        (this.isSlope(t) && y < this.slopeY(t, c, r, x));
      if (solid) return { x, y, d, c, r, t };
    }
    return null;
  }
}

export { TILE, CELL_W, DECK_H };
