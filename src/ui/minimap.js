// Minimap + motion tracker. Shows only rooms the squad has seen, the objective marker, the
// squad, and tracker blips: anything MOVING within tracker range, seen or not (it can't tell
// an alien from vermin). Display only: the squad is steered in the scene (ui/interact.js).
const TRACKER_BASE = 30; // + 5 m per Tracker boost upgrade tier

export class Minimap {
  constructor(el, game) {
    this.game = game;
    this.canvas = document.createElement('canvas');
    this.label = document.createElement('div');
    this.label.className = 'label';
    el.append(this.canvas, this.label);
    this.ctx = this.canvas.getContext('2d');
    this.ping = 0;
  }

  bind(world) {
    this.world = world;
    const b = world.level.bounds;
    this.W = 300;
    this.H = 120;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.sx = (this.W - 12) / (b.x1 - b.x0);
    this.sy = Math.min(this.sx * 2.6, (this.H - 12) / (b.y1 - b.y0));
    this.ox = 6 - b.x0 * this.sx;
    this.oy = this.H / 2 + ((b.y0 + b.y1) / 2) * this.sy;
  }

  X(x) { return this.ox + x * this.sx; }
  Y(y) { return this.oy - y * this.sy; }

  get range() { return TRACKER_BASE + 5 * (this.world?.upgrades?.tracker ?? 0); }

  blips() {
    const w = this.world;
    const lead = w.squad.leader;
    if (!lead) return [];
    const out = [];
    for (const e of [...w.aliens, ...w.critters]) {
      if (!e.alive || e.state === 'vent') continue;
      const moving = e.moving || e.state === 'emerge' || e.state === 'leap' || e.state === 'attack';
      if (!moving) continue;
      const d = Math.hypot(e.x - lead.x, e.y - lead.y);
      if (d < this.range) out.push({ x: e.x, y: e.y, d, seen: e.visible, vermin: e.kind === 'critter' && !!w.relics?.has('tracker_filter') }); // (a scrubbed tracker tells vermin apart)
    }
    if (w.aliens.some((a) => a.vent && a.alive)) {
      for (const a of w.aliens) {
        if (a.state !== 'vent' || !a.alive) continue;
        const v0 = w.level.vents[a.vent.from];
        const v1 = w.level.vents[a.vent.to];
        const k = Math.min(1, a.vent.t / a.vent.dur);
        const x = v0.x + (v1.x - v0.x) * k;
        const y = v0.y + (v1.y - v0.y) * k;
        if (Math.hypot(x - lead.x, y - lead.y) < this.range) out.push({ x, y, d: 0, seen: false });
      }
    }
    return out;
  }

  update(dt) {
    const w = this.world;
    if (!w) return;
    const c = this.ctx;
    const L = w.level;
    c.clearRect(0, 0, this.W, this.H);
    c.fillStyle = 'rgba(4,8,8,0.9)';
    c.fillRect(0, 0, this.W, this.H);

    for (const r of L.rooms) {
      if (!r.explored && !r.seen) continue;
      const x = this.X(r.x0) + 1;
      const y = this.Y(r.y1 + 0.5) + 1;
      const wd = (r.x1 - r.x0) * this.sx - 2;
      const ht = (r.y1 + 0.5 - r.y0) * this.sy - 2;
      c.fillStyle = r.explored ? (r.nest ? 'rgba(90,40,60,.55)' : 'rgba(70,95,80,.5)') : 'rgba(40,55,50,.25)';
      if (r.powerOut) c.fillStyle = r.explored ? 'rgba(25,32,30,.75)' : 'rgba(18,22,22,.5)'; // power out
      c.fillRect(x, y, wd, ht);
      c.strokeStyle = r.explored ? '#7f9a86' : '#3f5048';
      c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 0.5, wd - 1, ht - 1);
    }
    for (const p of L.portals) {
      const a = L.rooms[p.a];
      const b = L.rooms[p.b];
      if (!(a.explored || a.seen) || !(b.explored || b.seen)) continue;
      c.fillStyle = p.kind === 'door' ? (p.open ? '#9fb89f' : '#d9a32b') : '#c9cfc4';
      if (p.kind === 'door') c.fillRect(this.X(p.x) - 1.5, this.Y(p.y + 2.2), 3, 2.2 * this.sy);
      else {
        const x = p.kind === 'ladder' ? p.x : (p.xb + p.xt) / 2;
        c.fillRect(this.X(x) - 1, this.Y(p.yHigh + 1.5), 2, (p.yHigh - p.yLow) * this.sy);
      }
    }

    // Ship events: a burning door, and a distress beacon.
    const blink = 0.5 + 0.5 * Math.sin(performance.now() / 160);
    for (const p of L.portals) {
      if (!p.fire || !(L.rooms[p.a].seen || L.rooms[p.a].explored || L.rooms[p.b].seen || L.rooms[p.b].explored)) continue;
      c.fillStyle = `rgba(255,${90 + 80 * blink},30,1)`;
      c.fillRect(this.X(p.x) - 2.5, this.Y(p.y + 2.6), 5, 2.6 * this.sy);
    }
    // Locked storeroom doors the squad knows of: a gold bar.
    for (const p of L.portals) {
      if (!p.locked || p.open || !(L.rooms[p.a].seen || L.rooms[p.a].explored || L.rooms[p.b].seen || L.rooms[p.b].explored)) continue;
      c.fillStyle = '#e0c060';
      c.fillRect(this.X(p.x) - 1.5, this.Y(p.y + 2.4), 3, 2.4 * this.sy);
    }
    const call = w.shipEvents?.distress;
    if (call) {
      const cy = L.rooms[call.room].y0 + 1.8;
      c.strokeStyle = `rgba(255,200,80,${0.4 + 0.6 * blink})`;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(this.X(call.x), this.Y(cy), 3 + 4 * blink, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = '#ffd060';
      c.fillRect(this.X(call.x) - 1.5, this.Y(cy) - 1.5, 3, 3);
    }

    // Deck plans from a terminal (sim/encounters.js): every unsearched cache.
    if (w.intel) {
      c.fillStyle = '#d9b860';
      for (const r of L.rooms) for (const p of r.props) if (p.loot && !p.searched) c.fillRect(this.X(p.x) - 1.5, this.Y(r.y0 + 1.2), 3, 3);
    }

    // Objective marker (the bridge location is known from the ship schematic).
    const obj = L.objective;
    const oy = L.rooms[obj.room].y0;
    const t = performance.now() / 1000;
    c.fillStyle = `rgba(127,194,90,${0.6 + 0.4 * Math.sin(t * 4)})`;
    c.beginPath();
    c.moveTo(this.X(obj.x), this.Y(oy + 3.2));
    c.lineTo(this.X(obj.x) - 5, this.Y(oy + 0.8));
    c.lineTo(this.X(obj.x) + 5, this.Y(oy + 0.8));
    c.fill();

    // Tracker sweep + blips.
    const lead = w.squad.leader;
    const blips = this.blips();
    this.ping -= dt;
    if (lead && this.ping <= 0) {
      this.ping = blips.length ? Math.max(0.35, Math.min(1.4, Math.min(...blips.map((b) => b.d)) / 18)) : 1.6;
      this.sweep = 1;
      this.game.onTrackerPing?.(blips);
    }
    this.sweep = Math.min(1, Math.max(0, (this.sweep ?? 0) - Math.max(0, dt) * 1.2));
    if (lead && this.sweep > 0) {
      c.strokeStyle = `rgba(127,194,90,${this.sweep * 0.5})`;
      c.beginPath();
      c.arc(this.X(lead.x), this.Y(lead.y + 1), Math.max(0, 1 - this.sweep) * this.range * this.sx, 0, Math.PI * 2);
      c.stroke();
    }
    for (const b of blips) {
      c.fillStyle = b.vermin ? `rgba(180,180,120,${0.4 + 0.4 * (this.sweep ?? 0)})` : b.seen ? '#ff4a3a' : `rgba(255,74,58,${0.45 + 0.55 * (this.sweep ?? 0)})`;
      c.beginPath();
      c.arc(this.X(b.x), this.Y(b.y + 0.8), b.seen ? 2.6 : 2.2, 0, Math.PI * 2);
      c.fill();
    }
    for (const m of w.marines) {
      if (!m.alive) continue;
      c.fillStyle = m === lead ? '#e7ffd8' : '#8fd070';
      c.fillRect(this.X(m.x) - 1.5, this.Y(m.y + 1.4), 3, 3);
    }
    const explored = L.rooms.filter((r) => r.explored).length;
    this.label.innerHTML = `<span>DECK ${lead ? L.rooms[lead.room].deck + 1 : '-'} · ${lead ? L.rooms[lead.room].type.toUpperCase() : ''}</span><span>${explored}/${L.rooms.length} ROOMS · SEED ${L.seed}</span>`;
  }
}
