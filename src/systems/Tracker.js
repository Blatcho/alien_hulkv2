// The motion tracker: blips for moving hostiles within range, a sweep that pings when it crosses one.
export class Tracker {
  constructor(game) { this.game = game; this.range = 480; this.sweep = 0; this.blips = []; this.pingT = 0; this.nearest = Infinity; }
  update(dt) {
    const g = this.game, p = g.player;
    this.sweep = (this.sweep + dt * 1.1) % (Math.PI * 2);
    this.blips.length = 0;
    this.nearest = Infinity;
    for (const a of g.aliens) {
      if (!a.alive) continue;
      const dx = a.cx - p.cx, dy = a.cy - p.cy, d = Math.hypot(dx, dy);
      if (d > this.range) continue;
      const moving = a.hidden ? 0.4 : Math.min(1, a.speed / 120 + (a.state === 'attack' ? 1 : 0));
      if (moving < 0.15 && !a.hidden) continue;
      this.blips.push({ dx, dy, d, strength: moving, hidden: a.hidden });
      this.nearest = Math.min(this.nearest, d);
    }
    this.pingT -= dt;
    if (this.blips.length && this.pingT <= 0) {
      const k = Math.max(0, 1 - this.nearest / this.range);
      this.pingT = 1.6 - k * 1.2;
      g.audio.play('tracker_ping', { volume: 0.25 + k * 0.35, rate: 1 + k * 0.4, minGap: 150 });
    }
  }
}
