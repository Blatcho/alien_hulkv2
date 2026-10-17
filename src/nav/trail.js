// Breadcrumb trail: the leader appends points as it moves (including how it moved: walking,
// climbing, stairs, jumping, crouching); followers sample it at an arclength behind the
// leader. Everything the leader does - ladders included - is replayed exactly by the squad.

export class Trail {
  constructor() {
    this.pts = []; // {x, y, z, s, mode, room}
  }

  get length() { return this.pts.length ? this.pts[this.pts.length - 1].s : 0; }
  get start() { return this.pts.length ? this.pts[0].s : 0; }
  get last() { return this.pts[this.pts.length - 1]; }

  /** Append a point; arclength grows by the 2D distance travelled. */
  push(x, y, z, mode, room) {
    const last = this.last;
    if (!last) { this.pts.push({ x, y, z, s: 0, mode, room }); return; }
    const d = Math.hypot(x - last.x, y - last.y, (z - last.z) * 0.5);
    if (d < 0.05 && mode === last.mode && room === last.room) return;
    this.pts.push({ x, y, z, s: last.s + d, mode, room });
  }

  /** Interpolated state at arclength s (clamped). */
  sample(s) {
    const p = this.pts;
    if (!p.length) return null;
    if (s <= p[0].s) return { ...p[0], dir: 0 };
    if (s >= p[p.length - 1].s) return { ...p[p.length - 1], dir: this.dirAt(p.length - 1) };
    let lo = 0;
    let hi = p.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (p[mid].s <= s) lo = mid; else hi = mid;
    }
    const a = p[lo];
    const b = p[hi];
    const t = (s - a.s) / Math.max(1e-6, b.s - a.s);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      s,
      mode: b.mode,
      room: b.room, // segments belong to the room they arrive in
      dir: Math.sign(b.x - a.x),
    };
  }

  dirAt(i) {
    for (let j = i; j > 0; j--) {
      const dx = this.pts[j].x - this.pts[j - 1].x;
      if (Math.abs(dx) > 1e-4) return Math.sign(dx);
    }
    return 0;
  }

  /** Reverse in place: arclengths become (L - s). Returns L for converting follower positions. */
  reverse() {
    const L = this.length;
    this.pts.reverse();
    // Modes describe the segment *arriving* at a point; shift them so segments keep their mode.
    const modes = this.pts.map((p) => p.mode);
    for (let i = 0; i < this.pts.length; i++) {
      this.pts[i].s = L - this.pts[i].s;
      this.pts[i].mode = i === 0 ? modes[0] : modes[i - 1];
    }
    return L;
  }

  /** Drop points beyond arclength s (keeps an interpolated end point). */
  truncateAfter(s) {
    if (s >= this.length) return;
    const end = this.sample(s);
    this.pts = this.pts.filter((p) => p.s < s);
    this.pts.push({ x: end.x, y: end.y, z: end.z, s, mode: end.mode, room: end.room });
  }

  /** Forget history older than s - keep (bounded memory). Arclengths are left unchanged. */
  forgetBefore(s) {
    let i = 0;
    while (i < this.pts.length - 2 && this.pts[i + 1].s < s) i++;
    if (i > 0) this.pts.splice(0, i);
  }

  /**
   * Is the stretch s0..s1 plain walking on one room's floor? Then it's a straight line, and a
   * follower may walk straight to any point on it (lead mode, sim/squad.js stepFlat) rather than
   * retrace a fold in it. Doors (a room change), climbs, vaults and crouch-passes are never flat.
   */
  flat(s0, s1) {
    const p = this.pts;
    if (!p.length || s1 < s0) return false;
    let room;
    for (let k = 1; k < p.length; k++) {
      if (p[k].s <= s0) continue;        // ends before the stretch starts
      if (p[k - 1].s >= s1) break;       // starts after it ends
      if (p[k].mode !== 'walk') return false;
      if (room === undefined) room = p[k].room;
      else if (p[k].room !== room) return false;
    }
    return true;
  }

  /** Smallest arclength >= s whose segment is plain walking (end of any traversal). */
  nextWalkable(s) {
    for (const p of this.pts) if (p.s >= s && (p.mode === 'walk' || p.mode === 'crouch')) return p.s;
    return this.length;
  }
}
