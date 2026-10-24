// The ship map (Tab, or Back on the pad): the whole derelict deck by deck, drawn from what the
// squad has seen - rooms, doors and ladders, the objective, the squad, the tracker's blips,
// caches once the deck plans are pulled, survivors and sentries - with the contract beside it
// (ship, story, anomalies, objective), what's been found, the kit, and the ship's log
// (sim/journal.js). The sim pauses while it's open. mapModel() is the data; MapOverlay draws it.
import { MODIFIERS } from '../meta/ships.js';
import { HULL_CLASSES } from '../gen/classes.js';
import { clock } from '../sim/journal.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

/** Everything the map shows, read from the world (pure: no DOM). */
export function mapModel(w) {
  const L = w.level;
  const known = (r) => r.explored || r.seen;
  const decks = Array.from({ length: L.decks }, (_, d) => ({
    index: d,
    rooms: L.rooms.filter((r) => r.deck === d && known(r)),
    // Hostiles the squad has seen and left alive on this deck (what it knows, not what's there).
    hostiles: w.aliens.filter((a) => a.alive && a.visible && L.rooms[a.room]?.deck === d).length,
  }));
  const blips = [];
  const lead = w.squad.leader;
  const range = 30 + 5 * (w.upgrades?.tracker ?? 0);
  if (lead) {
    for (const e of [...w.aliens, ...w.critters]) {
      if (!e.alive || e.state === 'vent') continue;
      const moving = e.moving || e.state === 'emerge' || e.state === 'leap' || e.state === 'attack';
      if (moving && Math.hypot(e.x - lead.x, e.y - lead.y) < range) blips.push({ x: e.x, y: e.y, seen: e.visible });
    }
  }
  const caches = w.intel ? L.rooms.flatMap((r) => r.props.filter((p) => p.loot && !p.searched).map((p) => ({ x: p.x, y: r.y0 }))) : [];
  const survivors = w.survivors.filter((s) => s.alive && (s.identified || s.visible) && s.state !== 'rescued').map((s) => ({ x: s.x, y: s.y, name: s.name }));
  const sentries = w.sentries.filter((s) => s.ammo > 0).map((s) => ({ x: s.x, y: s.y }));
  const portals = L.portals.filter((p) => known(L.rooms[p.a]) && known(L.rooms[p.b]));
  return {
    seed: L.seed, name: w.shipName ?? `Derelict ${L.seed}`, cls: L.cls, story: L.story, modifiers: Object.keys(L.mods ?? {}).filter((k) => MODIFIERS[k]),
    threat: L.threat, decks, portals, blips, caches, survivors, sentries,
    objective: { x: L.objective.x, y: L.rooms[L.objective.room].y0, room: L.objective.room, known: known(L.rooms[L.objective.room]) },
    squad: w.marines.filter((m) => m.alive).map((m) => ({ x: m.x, y: m.y, name: m.name, lead: m === lead, down: !!m.down })),
    explored: L.rooms.filter((r) => r.explored).length, rooms: L.rooms.length,
    lifesigns: w.lifesigns(), uplink: !!w.uplink,
    found: { credits: w.credits, salvage: w.salvage.map((t) => `${t.name} (${t.value} cr)`), stash: w.stash.map((it) => it.name), rescued: w.survivors.filter((s) => s.state === 'rescued').length, survivors: w.survivors.length },
    kit: { ...w.kit, stims: w.stims },
    log: w.journal?.entries.slice(-14) ?? [],
    bounds: L.bounds, deckH: L.rooms[0] ? L.rooms[0].y1 - L.rooms[0].y0 + 0.5 : 5.5,
  };
}

export class MapOverlay {
  constructor(root, game) {
    this.game = game;
    this.el = root.appendChild(h('<div id="map" class="interactive"><div class="mapbox panel"><div class="maptop"><h2>SHIP MAP</h2><span class="sub"></span><button class="close">CLOSE [TAB]</button></div><div class="mapcols"><div class="chart"><canvas></canvas><div class="legend"></div></div><div class="side"></div></div></div></div>'));
    this.canvas = this.el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.side = this.el.querySelector('.side');
    this.sub = this.el.querySelector('.sub');
    this.legend = this.el.querySelector('.legend');
    this.open = false;
    this.el.querySelector('.close').addEventListener('click', () => this.game.command('map'));
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.game.command('map'); });
    this.legend.innerHTML = ['<i class="sq"></i> squad', '<i class="obj"></i> objective', '<i class="blip"></i> tracker', '<i class="cache"></i> cache (deck plans)', '<i class="surv"></i> survivor', '<i class="door"></i> door · <i class="dlock"></i> locked · <i class="dweld"></i> welded'].map((t) => `<span>${t}</span>`).join('');
  }

  bind(world) { this.world = world; }

  toggle(on = !this.open) {
    this.open = on;
    this.el.classList.toggle('show', on);
    if (on) this.draw();
  }

  /** Redraw while open (the blips move, the log grows). */
  update() { if (this.open) this.draw(); }

  draw() {
    const w = this.world;
    if (!w) return;
    const M = mapModel(w);
    const box = this.canvas.parentElement.getBoundingClientRect();
    const W = Math.max(300, Math.floor(box.width));
    const H = Math.max(200, Math.floor(box.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== W * dpr || this.canvas.height !== H * dpr) { this.canvas.width = W * dpr; this.canvas.height = H * dpr; }
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const b = M.bounds;
    const pad = 36;
    // Decks are short next to the ship's length: stretch them (up to 4x) and centre the ship.
    const sx = (W - pad * 2) / (b.x1 - b.x0);
    const sy = Math.min(sx * 4, (H - pad * 2) / (b.y1 - b.y0));
    const cy = (b.y0 + b.y1) / 2;
    const X = (x) => pad + (x - b.x0) * sx;
    const Y = (y) => H / 2 - (y - cy) * sy;
    const deckH = M.deckH;
    // Deck labels (in the band) and floor lines.
    c.font = '11px "Share Tech Mono", monospace';
    for (const d of M.decks) {
      const y0 = Y(d.index * deckH);
      const ym = Y(d.index * deckH + deckH / 2);
      c.fillStyle = 'rgba(143,154,140,.8)';
      c.fillText(`DECK ${d.index + 1}`, 4, ym + 4);
      if (d.hostiles) { c.fillStyle = '#ff6a50'; c.fillText(`${d.hostiles} seen`, 4, ym + 16); }
      c.strokeStyle = 'rgba(75,86,80,.35)';
      c.beginPath(); c.moveTo(pad, y0 + 0.5); c.lineTo(W - pad, y0 + 0.5); c.stroke();
    }
    for (const d of M.decks) {
      for (const r of d.rooms) {
        const x = X(r.x0) + 1;
        const y = Y(r.y1 + 0.5) + 1;
        const wd = (r.x1 - r.x0) * sx - 2;
        const ht = (r.y1 + 0.5 - r.y0) * sy - 2;
        c.fillStyle = r.explored ? (r.nest ? 'rgba(110,40,70,.6)' : 'rgba(70,95,80,.55)') : 'rgba(40,55,50,.3)';
        if (r.powerOut) c.fillStyle = r.explored ? 'rgba(25,32,30,.8)' : 'rgba(18,22,22,.55)';
        c.fillRect(x, y, wd, ht);
        c.strokeStyle = r.explored ? '#7f9a86' : '#3f5048';
        c.lineWidth = 1;
        c.strokeRect(x + 0.5, y + 0.5, wd - 1, ht - 1);
        if (wd > 40) {
          c.fillStyle = r.explored ? '#c9d2c4' : '#6f7d74';
          c.fillText(r.type.toUpperCase().slice(0, Math.max(3, Math.floor((wd - 6) / 7))), x + 4, y + 12);
        }
      }
    }
    for (const p of M.portals) {
      const A = w.level.rooms[p.a];
      if (p.kind === 'door') {
        c.fillStyle = p.welded ? '#c890e0' : p.locked && !p.open ? '#e0c060' : p.fire ? '#ff7a20' : p.open ? '#9fb89f' : '#d9a32b';
        c.fillRect(X(p.x) - 2, Y(p.y + 2.4), 4, 2.4 * sy);
      } else {
        const x = p.kind === 'ladder' ? p.x : (p.xb + p.xt) / 2;
        c.fillStyle = '#c9cfc4';
        c.fillRect(X(x) - 1.5, Y(p.yHigh + 1.5), 3, (p.yHigh - p.yLow) * sy);
        c.fillText(p.kind === 'ladder' ? '≡' : '⟋', X(x) + 4, Y(p.yLow + (p.yHigh - p.yLow) / 2));
      }
      void A;
    }
    for (const q of M.caches) { c.fillStyle = '#d9b860'; c.fillRect(X(q.x) - 2, Y(q.y + 1.2) - 2, 4, 4); }
    for (const s of M.survivors) { c.fillStyle = '#7fc25a'; c.beginPath(); c.arc(X(s.x), Y(s.y + 1), 3.5, 0, Math.PI * 2); c.fill(); }
    for (const s of M.sentries) { c.fillStyle = '#7fd0ff'; c.fillRect(X(s.x) - 2.5, Y(s.y + 1) - 2.5, 5, 5); }
    { // the objective: the bridge is on the schematic from the start
      const t = performance.now() / 1000;
      c.fillStyle = `rgba(127,194,90,${0.6 + 0.4 * Math.sin(t * 4)})`;
      const ox = X(M.objective.x);
      const oy = Y(M.objective.y + 0.4);
      c.beginPath();
      c.moveTo(ox, oy - 14);
      c.lineTo(ox - 6, oy);
      c.lineTo(ox + 6, oy);
      c.fill();
    }
    for (const bl of M.blips) {
      c.fillStyle = bl.seen ? '#ff4a3a' : 'rgba(255,74,58,.6)';
      c.beginPath(); c.arc(X(bl.x), Y(bl.y + 0.8), 3, 0, Math.PI * 2); c.fill();
    }
    for (const m of M.squad) {
      c.fillStyle = m.down ? '#c6362a' : m.lead ? '#e7ffd8' : '#8fd070';
      c.fillRect(X(m.x) - 2.5, Y(m.y + 1.4) - 2.5, 5, 5);
    }
    // The side panel.
    const C = HULL_CLASSES[M.cls];
    const mods = M.modifiers.map((k) => `<span class="mod" title="${esc(MODIFIERS[k].text)}">${esc(MODIFIERS[k].label)}</span>`).join('') || '<span class="mod plain">No known anomalies</span>';
    this.sub.textContent = `${M.name} · ${C?.label ?? M.cls} · threat ${M.threat} · ${M.explored}/${M.rooms} rooms · seed ${M.seed}`;
    const kit = `${M.kit.grenades} grenades · ${M.kit.flares} flares · ${M.kit.charges} charges · ${M.kit.defend} defend · ${M.kit.stims} stims${M.kit.keycards ? ' · keycard' : ''}`;
    this.side.innerHTML = `
      <h3>CONTRACT</h3>
      <p class="story"><b>${esc(M.story?.title ?? '')}.</b> ${esc(M.story?.blurb ?? '')}</p>
      <div class="mods">${mods}</div>
      <p class="obj">${M.uplink ? 'Upload the nav-lock: hold the command deck.' : 'Reach the command deck and hold it for the uplink.'}</p>
      <h3>ABOARD</h3>
      <p>Lifesigns <b class="${M.lifesigns ? 'hot' : ''}">${M.lifesigns || 'clear'}</b> · civilians <b>${M.found.rescued}/${M.found.survivors}</b> safe</p>
      <p>Kit: ${kit}</p>
      <h3>FOUND</h3>
      <p><b>${M.found.credits}</b> credits${M.found.salvage.length ? ` · salvage: ${esc(M.found.salvage.join(', '))}` : ''}${M.found.stash.length ? ` · sent back: ${esc(M.found.stash.join(', '))}` : ''}</p>
      <h3>LOG</h3>
      <ul class="log">${[...M.log].reverse().map((e) => `<li class="${e.kind}"><span>${clock(e.t)}</span>${esc(e.text)}</li>`).join('') || '<li class="info"><span>0:00</span>Boarding.</li>'}</ul>`;
  }
}
