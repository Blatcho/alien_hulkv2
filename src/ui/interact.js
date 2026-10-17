// In-world interactions: no buttons for navigation - the player points at things in the scene.
// Hovering near a door, ladder, stairwell, crate, terminal, survivor or fuel barrel the squad
// has seen shows a ring and what the squad would do ("Breach the door"); a click makes it their
// goal (world.nudge -> sim/doctrine.js). A marker stays on the target until they've done it.
// Encounters (sim/encounters.js) put their choices in the scene too: a card over the object,
// each option with who'd do it and the odds, and a clock - when it runs out, the orders decide.

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const PICK_PX = 34; // how close (screen px) the cursor must be to an object

export class Interact {
  constructor(stage, hudRoot, game) {
    this.stage = stage;
    this.game = game;
    this.el = hudRoot.appendChild(h('<div id="interact"><div class="ring"></div><div class="tag"></div><div class="order"><i></i><span></span></div></div>'));
    this.ring = this.el.querySelector('.ring');
    this.tag = this.el.querySelector('.tag');
    this.orderEl = this.el.querySelector('.order');
    this.encEl = this.el.appendChild(h('<div class="enc"></div>'));
    this.encId = null;
    this.mouse = null;
    this.hover = null;
    stage.addEventListener('mousemove', (e) => { this.mouse = { x: e.clientX, y: e.clientY }; });
    stage.addEventListener('mouseleave', () => { this.mouse = null; });
    stage.addEventListener('click', () => {
      if (!this.hover || this.world?.status !== 'playing') return;
      if (this.hover.kind === 'move') this.game.command('move', this.hover.move);
      else this.game.command('nudge', this.hover.id);
    });
  }

  /** The encounter card: choices in the scene, with odds and a clock. */
  encounter(w) {
    const sq = w.squad;
    const d = sq.state === 'decision' && sq.decision?.encounter ? sq.decision : null;
    this.encEl.style.display = d ? 'block' : 'none';
    if (!d) { this.encId = null; return; }
    if (d.id !== this.encId) {
      this.encId = d.id;
      const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      this.encEl.innerHTML = `<div class="et">${esc(d.title)}</div><div class="ex">${esc(d.text)}</div>`
        + d.options.map((o, i) => `<button data-i="${i}" ${o.off ? 'disabled' : ''}><kbd>${i + 1}</kbd><b>${esc(o.label)}</b>`
          + `${o.note ? `<small>${esc(o.off ? 'nothing left in the kit for it' : o.note)}</small>` : ''}`
          + `${o.odds !== undefined ? `<span class="odds ${o.odds >= 0.65 ? 'good' : o.odds < 0.4 ? 'bad' : ''}">${esc(o.who)} · ${Math.round(o.odds * 100)}%</span>` : ''}</button>`).join('')
        + '<div class="clock"><i></i></div><div class="auto">or the squad follows its orders</div>';
      this.encEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.game.command(`option${+b.dataset.i + 1}`);
      }));
    }
    // Over the object, but kept on screen (the card scales with the HUD - ui/hud.js).
    const p = this.view.toScreen(d.x, d.y + 2.6);
    const ui = this.game.hud?.ui ?? 1;
    const half = (this.encEl.offsetWidth / 2) * ui + 10;
    this.encEl.style.left = `${Math.max(half, Math.min(window.innerWidth - half, p.x))}px`;
    this.encEl.style.top = `${Math.max(this.encEl.offsetHeight * ui + 10, p.y)}px`;
    const left = Math.max(0, (d.deadline - w.time) / (d.deadline - (d.askedAt ?? d.deadline - 8)));
    this.encEl.querySelector('.clock i').style.width = `${left * 100}%`;
  }

  /** The walkable spot under the cursor, in a room the squad has seen (screen -> world). */
  floorAt(w, mx, my, rect) {
    const b = this.view.camera.bounds();
    const wx = b.x0 + (mx / rect.width) * (b.x1 - b.x0);
    const wy = b.y1 - (my / rect.height) * (b.y1 - b.y0);
    const room = w.level.rooms.find((r) => (r.seen || r.explored) && wx >= r.x0 && wx <= r.x1 && wy >= r.y0 - 0.3 && wy <= r.y1 + 0.2);
    const spot = room && w.floorSpot(room.id, wx);
    if (!spot) return null;
    const p = this.view.toScreen(spot.x, room.y0 + 0.05);
    return { kind: 'move', id: 'move', move: spot, label: 'Move here', sx: p.x, sy: p.y };
  }

  bind(world, view) {
    this.world = world;
    this.view = view;
  }

  update() {
    const w = this.world;
    if (!w || !this.view) return;
    this.encounter(w);
    // Hover: the nearest interactable to the cursor, on screen.
    this.hover = null;
    if (this.mouse && w.status === 'playing') {
      const rect = this.stage.getBoundingClientRect();
      const mx = this.mouse.x - rect.left;
      const my = this.mouse.y - rect.top;
      let best = PICK_PX;
      for (const t of w.interactables()) {
        const p = this.view.toScreen(t.x, t.y);
        const d = Math.hypot(p.x - mx, p.y - my);
        if (d < best) { best = d; this.hover = { ...t, sx: p.x, sy: p.y }; }
      }
      // Manual orders: anywhere on the floor of a room the squad knows is somewhere to go.
      if (!this.hover && w.doctrine?.manual) this.hover = this.floorAt(w, mx, my, rect);
    }
    const hv = this.hover;
    this.stage.style.cursor = hv ? 'pointer' : '';
    this.ring.style.display = this.tag.style.display = hv ? 'block' : 'none';
    if (hv) {
      this.ring.style.left = this.tag.style.left = `${hv.sx}px`;
      this.ring.style.top = this.tag.style.top = `${hv.sy}px`;
      this.ring.dataset.kind = hv.kind;
      if (this.tag.textContent !== hv.label) this.tag.textContent = hv.label;
    }
    // The standing nudge: where the squad is heading on the player's word.
    const d = w.doctrine;
    const o = d?.override && d.override.verb !== 'turn' && d.override.target?.label ? d.override.target : null;
    const target = d?.forced?.alive ? { x: d.forced.x, y: d.forced.y + 0.7, label: 'Shoot the barrel' } : o;
    this.orderEl.style.display = target ? 'block' : 'none';
    if (target) {
      const p = this.view.toScreen(target.x, target.y);
      this.orderEl.style.left = `${p.x}px`;
      this.orderEl.style.top = `${p.y}px`;
      const text = `ORDER: ${target.label}`;
      const span = this.orderEl.querySelector('span');
      if (span.textContent !== text) span.textContent = text;
    }
  }
}
