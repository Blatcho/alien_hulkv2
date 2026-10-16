// The 2D overlay, drawn at art resolution on a canvas over the WebGL view: portrait and bars, ammo,
// item slots, minimap, motion tracker, barks, damage numbers, prompts, the objective, plus the title,
// pause, death and extraction screens.
import { BitmapFont } from './Font.js';
import { TILE } from '../gen/Ship.js';
import { WEAPONS } from '../entities/Player.js';

const COL = { hp: '#c43a2e', hp2: '#ff6a4a', shield: '#3a8cd6', shield2: '#7fd0ff', dim: '#6a737d', text: '#d8dee4', warn: '#ffb340', green: '#66d9a0', red: '#ff5a3a' };

export class HUD {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.fonts = {}; this.images = {};
    this.w = 800; this.h = 450; this.scale = 1;
    this.flashT = 0; this.flashColor = '#f00';
    this.notice = null;
  }

  async load() {
    const [title, body, small] = await Promise.all([new BitmapFont('title').load(), new BitmapFont('body').load(), new BitmapFont('small').load()]);
    this.fonts = { title, body, small };
    const names = ['panel', 'slot', 'slot_selected', 'button_a', 'button_b', 'button_x', 'button_y', 'button_lb', 'button_rb', 'button_start', 'vignette', 'emblem', 'cursor'];
    await Promise.all(names.map((n) => new Promise((res) => { const i = new Image(); i.onload = () => { this.images[n] = i; res(); }; i.onerror = () => res(); i.src = `assets/ui/${n}.png`; })));
  }

  resize(w, h, scale) {
    this.w = w; this.h = h; this.scale = scale;
    this.canvas.width = w; this.canvas.height = h;
    this.canvas.style.width = w * scale + 'px'; this.canvas.style.height = h * scale + 'px';
    this.ctx.imageSmoothingEnabled = false;
  }

  flash(color = '#ff2a1a', t = 0.12) { this.flashT = t; this.flashColor = color; }

  text(font, s, x, y, opts) { return this.fonts[font] && this.fonts[font].draw(this.ctx, s, x, y, opts); }

  bar(x, y, w, h, frac, c1, c2, back = '#1a1d22') {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0c0f'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = back; ctx.fillRect(x, y, w, h);
    const fw = Math.round(w * Math.max(0, Math.min(1, frac)));
    if (fw > 0) {
      ctx.fillStyle = c1; ctx.fillRect(x, y, fw, h);
      ctx.fillStyle = c2; ctx.fillRect(x, y, fw, Math.max(1, Math.floor(h / 3)));
    }
    // ticks
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let t = 10; t < w; t += 10) ctx.fillRect(x + t, y, 1, h);
  }

  panel(x, y, w, h, alpha = 0.78) {
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(8,10,14,${alpha})`; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(120,135,150,0.55)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = 'rgba(120,135,150,0.35)'; ctx.fillRect(x + 2, y + 2, w - 4, 1);
  }

  draw(game, dt) {
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    if (!game) return;
    if (game.screen === 'title') { this.drawTitle(game); return; }
    if (!game.player) return;
    this.drawWorldOverlays(game);
    this.drawVignette(game);
    this.drawStatus(game);
    this.drawSlots(game);
    this.drawMinimap(game);
    this.drawTracker(game);
    this.drawObjective(game);
    this.drawPrompt(game);
    if (this.flashT > 0) { this.flashT -= dt; ctx.fillStyle = this.flashColor; ctx.globalAlpha = Math.min(0.35, this.flashT * 2); ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
    if (game.screen === 'pause') this.drawPause(game);
    else if (game.screen === 'dead') this.drawDead(game);
    else if (game.screen === 'extracted') this.drawExtracted(game);
    if (game.demo && game.screen === 'play') this.drawDemoBadge(game);
  }

  drawVignette(game) {
    const v = this.images.vignette;
    if (!v) return;
    const ctx = this.ctx;
    ctx.globalAlpha = 0.55 + (game.player.hp < 30 ? 0.25 * (0.5 + 0.5 * Math.sin(game.time * 6)) : 0);
    ctx.drawImage(v, 0, 0, this.w, this.h);
    ctx.globalAlpha = 1;
    if (game.player.hurtT > 0) { ctx.fillStyle = `rgba(200,30,20,${0.35 * game.player.hurtT})`; ctx.fillRect(0, 0, this.w, this.h); }
  }

  drawStatus(game) {
    const ctx = this.ctx, p = game.player;
    const x = 10, y = 10;
    this.panel(x, y, 214, 60);
    // portrait
    ctx.fillStyle = '#121519'; ctx.fillRect(x + 6, y + 6, 46, 46);
    if (game.portrait) ctx.drawImage(game.portrait, x + 6, y + 6, 46, 46);
    ctx.strokeStyle = p.hp < 30 ? COL.red : '#5a6670'; ctx.strokeRect(x + 6.5, y + 6.5, 45, 45);
    this.text('small', p.name, x + 60, y + 4, { color: COL.text });
    this.text('small', `${Math.ceil(p.hp)}`, x + 208, y + 4, { color: p.hp < 30 ? COL.red : COL.text, align: 'right' });
    this.bar(x + 60, y + 24, 148, 8, p.hp / p.hpMax, COL.hp, COL.hp2);
    this.bar(x + 60, y + 36, 148, 6, p.shield / p.shieldMax, p.shieldUp ? COL.shield2 : COL.shield, '#b0e8ff');
    // ammo
    const wd = p.weaponDef, am = p.ammo;
    const ammoCol = am.mag === 0 ? COL.red : am.mag <= wd.mag * 0.25 ? COL.warn : COL.text;
    this.text('body', `${am.mag}`, x + 60, y + 42, { color: ammoCol });
    const mw = this.fonts.body.width(`${am.mag}`);
    this.text('small', `/ ${am.reserve}`, x + 60 + mw + 4, y + 47, { color: COL.dim });
    this.text('small', wd.short, x + 208, y + 47, { color: p.reload ? COL.warn : COL.dim, align: 'right' });
    if (p.reload) { const f = Math.min(1, p.reload.t / p.reload.dur); this.bar(x + 120, y + 52, 88, 3, f, COL.warn, '#ffe0a0'); }
    if (p.healing > 0) this.text('small', 'HEALING', x + 120, y + 46, { color: COL.green });
  }

  drawSlots(game) {
    const ctx = this.ctx, p = game.player;
    const kinds = ['rifle', 'shotgun', 'smg'];
    const sw = 30, gap = 6;
    const total = kinds.length * (sw + gap) + 40;
    let x = Math.round(this.w / 2 - total / 2), y = this.h - 38;
    kinds.forEach((k) => {
      const owned = !!p.weapons[k];
      const sel = p.weapon === k;
      this.panel(x, y, sw, sw, sel ? 0.85 : 0.6);
      if (sel) { ctx.strokeStyle = COL.warn; ctx.strokeRect(x + 1.5, y + 1.5, sw - 3, sw - 3); }
      this.text('small', k === 'rifle' ? 'RFL' : k === 'shotgun' ? 'SHG' : 'SMG', x + sw / 2, y + 6, { color: owned ? (sel ? COL.text : COL.dim) : '#333a40', align: 'center' });
      if (owned) this.text('small', `${p.weapons[k].mag}`, x + sw / 2, y + 17, { color: sel ? COL.warn : COL.dim, align: 'center' });
      x += sw + gap;
    });
    this.panel(x + 4, y, sw, sw, 0.6);
    this.text('small', 'MED', x + 4 + sw / 2, y + 6, { color: p.medkits > 0 ? COL.green : '#333a40', align: 'center' });
    this.text('small', `${p.medkits}`, x + 4 + sw / 2, y + 17, { color: p.medkits > 0 ? COL.text : '#333a40', align: 'center' });
    this.text('small', 'Y  X  RB  LB', this.w / 2, this.h - 9, { color: '#3e464e', align: 'center' });
  }

  drawMinimap(game) {
    const ctx = this.ctx, ship = game.ship, p = game.player;
    const mw = 150, mh = 44;
    const x = this.w - mw - 10, y = 10;
    this.panel(x, y, mw, mh);
    const sx = (mw - 8) / (ship.W * TILE), sy = (mh - 8) / (ship.H * TILE);
    const px = x + 4, py = y + mh - 4;
    for (const room of ship.rooms) {
      const seen = game.world.seen.has(room.id);
      if (!seen) continue;
      const rx = px + room.x0 * TILE * sx, rw = (room.x1 - room.x0 + 1) * TILE * sx;
      const ry = py - (room.y1 + 1) * TILE * sy, rh = (room.y1 - room.y0 + 1) * TILE * sy;
      ctx.fillStyle = room.type === 'hive' ? 'rgba(160,40,40,0.55)' : room.type === 'bridge' ? 'rgba(70,110,170,0.6)' : room.type === 'airlock' ? 'rgba(60,140,100,0.6)' : 'rgba(110,125,140,0.45)';
      ctx.fillRect(Math.round(rx), Math.round(ry), Math.max(2, Math.round(rw)), Math.max(2, Math.round(rh)));
    }
    for (const d of ship.doors) {
      const room = ship.rooms[d.a];
      if (!game.world.seen.has(d.a) && !game.world.seen.has(d.b)) continue;
      ctx.fillStyle = '#c0c8d0'; ctx.fillRect(Math.round(px + d.col * TILE * sx), Math.round(py - (d.row + 2) * TILE * sy), 1, 2);
    }
    for (const s of game.survivors) if (s.alive && s.state !== 'rescued' && (s.visibleToPlayer || s.state === 'follow')) { ctx.fillStyle = COL.green; ctx.fillRect(Math.round(px + s.cx * sx) - 1, Math.round(py - s.cy * sy) - 1, 2, 2); }
    const obj = game.objectivePoint();
    if (obj && (Math.floor(game.time * 2) % 2 === 0)) { ctx.fillStyle = COL.warn; ctx.fillRect(Math.round(px + obj.x * sx) - 1, Math.round(py - obj.y * sy) - 2, 3, 3); }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(px + p.cx * sx) - 1, Math.round(py - p.cy * sy) - 1, 3, 3);
    // camera window
    const r = game.renderer;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(Math.round(px + (r.camera.position.x - r.width / 2) * sx) + 0.5, Math.round(py - (r.camera.position.y + r.height / 2) * sy) + 0.5, Math.round(r.width * sx), Math.round(r.height * sy));
  }

  drawTracker(game) {
    const ctx = this.ctx, tr = game.tracker;
    const R = 34, cx = 10 + R + 4, cy = this.h - R - 14;
    this.panel(cx - R - 4, cy - R - 4, R * 2 + 8, R * 2 + 8, 0.7);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#05100c'; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.strokeStyle = 'rgba(80,200,140,0.25)';
    for (const rr of [R / 3, (R * 2) / 3, R - 1]) { ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    // sweep
    const a = tr.sweep;
    const grad = ctx.createConicalGradient ? null : null;
    ctx.fillStyle = 'rgba(80,220,150,0.18)';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a - 0.9, a); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(120,255,180,0.8)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy - Math.sin(a) * R); ctx.stroke();
    for (const b of tr.blips) {
      const k = b.d / tr.range;
      const bx = cx + (b.dx / tr.range) * R, by = cy - (b.dy / tr.range) * R;
      const bright = Math.min(1, 0.35 + b.strength);
      ctx.fillStyle = b.hidden ? `rgba(120,160,120,${0.5 * bright})` : `rgba(140,255,170,${bright})`;
      ctx.fillRect(Math.round(bx) - 1, Math.round(by) - 1, 3, 3);
      if (!b.hidden) { ctx.fillStyle = `rgba(140,255,170,${0.25 * bright})`; ctx.fillRect(Math.round(bx) - 2, Math.round(by) - 2, 5, 5); }
    }
    ctx.restore();
    const n = tr.blips.filter((b) => !b.hidden).length;
    this.text('small', n ? `${n} CONTACT${n > 1 ? 'S' : ''}` : 'CLEAR', cx, cy + R + 6, { color: n ? COL.red : 'rgba(100,160,120,0.8)', align: 'center' });
    if (tr.nearest < 140) this.text('small', `${Math.round(tr.nearest / 10)}m`, cx, cy - R - 12, { color: COL.red, align: 'center' });
  }

  drawObjective(game) {
    const obj = game.objectiveText();
    if (!obj) return;
    this.text('small', obj, this.w / 2, 8, { color: COL.warn, align: 'center' });
    const sub = game.objectiveSub();
    if (sub) this.text('small', sub, this.w / 2, 22, { color: COL.dim, align: 'center' });
  }

  drawPrompt(game) {
    const it = game.interactable;
    if (!it || !it.label) return;
    const p = game.player;
    const s = game.renderer.worldToScreen(p.cx, p.body.top + 26);
    const wdt = this.fonts.small.width(it.label) + 26;
    this.panel(Math.round(s.x - wdt / 2), Math.round(s.y) - 8, wdt, 16, 0.8);
    const b = this.images.button_x;
    if (b) this.ctx.drawImage(b, Math.round(s.x - wdt / 2) + 3, Math.round(s.y) - 6, 12, 12);
    this.text('small', it.label, Math.round(s.x - wdt / 2) + 18, Math.round(s.y) - 7, { color: COL.text });
  }

  drawWorldOverlays(game) {
    const ctx = this.ctx, r = game.renderer;
    // barks
    for (const b of game.barks.list) {
      if (b.t < 0) continue;
      const who = b.who;
      const top = who.body ? who.body.top : who.y + 20;
      const s = r.worldToScreen(who.cx !== undefined ? who.cx : who.x, top + 8);
      const font = this.fonts.small;
      const wdt = font.width(b.text) + 12;
      const a = Math.min(1, b.t * 6, (b.dur - b.t) * 4);
      ctx.globalAlpha = Math.max(0, a);
      let bx = Math.round(s.x - wdt / 2);
      bx = Math.max(4, Math.min(this.w - wdt - 4, bx));
      const by = Math.round(s.y) - 20;
      ctx.fillStyle = '#e8ecef'; ctx.fillRect(bx, by, wdt, 15);
      ctx.fillStyle = '#0c0e12'; ctx.fillRect(bx + 1, by + 1, wdt - 2, 13);
      ctx.fillStyle = '#e8ecef';
      ctx.beginPath(); ctx.moveTo(Math.round(s.x) - 3, by + 15); ctx.lineTo(Math.round(s.x) + 3, by + 15); ctx.lineTo(Math.round(s.x), by + 19); ctx.closePath(); ctx.fill();
      font.draw(ctx, b.text, bx + 6, by + 2, { color: who === game.player ? '#fff6d0' : '#d0f0e0' });
      ctx.globalAlpha = 1;
    }
    // damage numbers
    for (const n of game.fx.numbers) {
      const s = r.worldToScreen(n.x, n.y);
      const a = Math.max(0, 1 - Math.max(0, n.t - 0.6) / 0.5);
      const col = '#' + n.color.toString(16).padStart(6, '0');
      this.text(n.big ? 'body' : 'small', n.text, Math.round(s.x), Math.round(s.y), { color: col, align: 'center', alpha: a, scale: n.big ? 1 : 0.85 });
    }
    // crosshair when aiming by hand
    const p = game.player;
    if ((p.aimMode === 'stick' || p.aimMode === 'mouse') && !p.dead) {
      const s = r.worldToScreen(p.cx + p.aim.x * 90, p.cy + p.aim.y * 90);
      ctx.strokeStyle = p.target ? COL.red : 'rgba(220,230,240,0.8)';
      ctx.strokeRect(Math.round(s.x) - 3.5, Math.round(s.y) - 3.5, 7, 7);
    }
    // target bracket
    if (p.target && p.target.alive) {
      const t = p.target, b = t.body;
      const s0 = r.worldToScreen(b.left - 3, b.top + 3), s1 = r.worldToScreen(b.right + 3, b.y - 3);
      ctx.strokeStyle = 'rgba(255,90,58,0.8)';
      const L = 4;
      const corners = [[s0.x, s0.y, 1, 1], [s1.x, s0.y, -1, 1], [s0.x, s1.y, 1, -1], [s1.x, s1.y, -1, -1]];
      for (const [x, y, dx, dy] of corners) { ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, Math.round(y) + 0.5 + dy * L); ctx.lineTo(Math.round(x) + 0.5, Math.round(y) + 0.5); ctx.lineTo(Math.round(x) + 0.5 + dx * L, Math.round(y) + 0.5); ctx.stroke(); }
    }
    // survivor names
    for (const s of game.survivors) {
      if (!s.alive || s.hidden || !s.visibleToPlayer) continue;
      const sc = r.worldToScreen(s.cx, s.body.top + 4);
      this.text('small', s.name.toUpperCase(), Math.round(sc.x), Math.round(sc.y) - 10, { color: s.state === 'follow' ? COL.green : COL.dim, align: 'center' });
    }
  }

  drawDemoBadge(game) {
    const label = game.autopilot && game.autopilot.label ? game.autopilot.label : '';
    this.text('small', `DEMO  ${label}`, this.w - 12, this.h - 14, { color: 'rgba(200,210,220,0.7)', align: 'right' });
    if (game.humanOverride) this.text('small', 'MANUAL', this.w - 12, this.h - 26, { color: COL.warn, align: 'right' });
  }

  dim(alpha = 0.6) { this.ctx.fillStyle = `rgba(2,3,5,${alpha})`; this.ctx.fillRect(0, 0, this.w, this.h); }

  drawTitle(game) {
    const ctx = this.ctx, w = this.w, h = this.h;
    this.dim(0.35);
    const t = game.time;
    this.text('title', 'DERELICT', w / 2, h * 0.2, { color: '#e8ecef', align: 'center' });
    this.text('small', 'DROPSHIP KESTREL 21  —  DOCKING AT THE REAR AIRLOCK', w / 2, h * 0.2 + 56, { color: COL.dim, align: 'center' });
    const blink = Math.floor(t * 2) % 2 === 0;
    this.text('body', 'A / ENTER   START MISSION', w / 2, h * 0.52, { color: blink ? COL.warn : COL.text, align: 'center' });
    this.text('body', 'Y / D   DEMO (NO CONTROLLER)', w / 2, h * 0.52 + 26, { color: COL.text, align: 'center' });
    this.text('small', `SEED ${game.seed}     N  NEW SHIP`, w / 2, h * 0.52 + 58, { color: COL.dim, align: 'center' });
    const lines = ['LEFT STICK / WASD  move   RIGHT STICK / MOUSE  aim   RT / MOUSE1  fire   LT / SHIFT  shield',
      'A / SPACE  jump   B / K  dodge   Y / Q  weapon   X / E  interact   RB / R  reload   LB / H  medkit'];
    lines.forEach((l, i) => this.text('small', l, w / 2, h - 44 + i * 14, { color: '#5a6670', align: 'center' }));
    if (game.loading) this.text('small', game.loading, w / 2, h * 0.52 + 90, { color: COL.green, align: 'center' });
  }

  drawPause(game) {
    this.dim(0.55);
    this.text('title', 'PAUSED', this.w / 2, this.h * 0.3, { color: '#e8ecef', align: 'center' });
    this.text('body', 'START / ESC  RESUME', this.w / 2, this.h * 0.3 + 60, { color: COL.text, align: 'center' });
    this.text('small', 'B / BACKSPACE  ABANDON MISSION', this.w / 2, this.h * 0.3 + 86, { color: COL.dim, align: 'center' });
  }

  drawDead(game) {
    const p = game.player;
    this.dim(Math.min(0.75, p.deadT * 0.4));
    if (p.deadT < 1.2) return;
    this.text('title', 'KIA', this.w / 2, this.h * 0.26, { color: COL.red, align: 'center' });
    this.text('small', `SGT. VANCE   ${p.kills} HOSTILES   ${p.rescued} RESCUED   ${Math.round(p.shots ? (100 * p.hits) / p.shots : 0)}% ACCURACY`, this.w / 2, this.h * 0.26 + 56, { color: COL.dim, align: 'center' });
    this.text('body', 'A / ENTER  TRY AGAIN', this.w / 2, this.h * 0.6, { color: COL.text, align: 'center' });
    this.text('small', 'B / BACKSPACE  TITLE', this.w / 2, this.h * 0.6 + 26, { color: COL.dim, align: 'center' });
  }

  drawExtracted(game) {
    const p = game.player;
    this.dim(0.7);
    this.text('title', 'EXTRACTED', this.w / 2, this.h * 0.22, { color: COL.green, align: 'center' });
    const rows = [
      ['SHIP\'S LOG', p.hasLog ? 'RECOVERED' : 'LEFT BEHIND'],
      ['SURVIVORS', `${p.rescued} / ${game.ship.survivors.length}`],
      ['HOSTILES', `${p.kills}`],
      ['ACCURACY', `${Math.round(p.shots ? (100 * p.hits) / p.shots : 0)}%`],
      ['TIME', `${Math.floor(game.time / 60)}:${String(Math.floor(game.time % 60)).padStart(2, '0')}`],
      ['SCORE', `${game.score()}`],
    ];
    rows.forEach(([k, v], i) => {
      this.text('small', k, this.w / 2 - 20, this.h * 0.22 + 60 + i * 18, { color: COL.dim, align: 'right' });
      this.text('small', v, this.w / 2 + 20, this.h * 0.22 + 60 + i * 18, { color: COL.text });
    });
    this.text('body', 'A / ENTER  NEW SHIP', this.w / 2, this.h * 0.82, { color: COL.text, align: 'center' });
  }
}
