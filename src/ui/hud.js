// DOM HUD: squad cards top-left (portrait, name in rank colour, health, magazine, breath, a
// glyph for anything wrong), the tracker/minimap top-right, a message ticker top-centre fed by
// the ship's log (sim/journal.js - only a man down or a horde still shouts across the screen),
// the controls bottom-centre in three clusters - ACT (Cover, Turn back, the map), KIT, and the
// standing orders (the briefing's orders, changeable mid-mission: the squad runs itself by
// them - sim/doctrine.js) - the weapon bottom-left, and bottom-right the objective over a strip
// of meters: lifesigns, the ship's danger (how close a horde is), energy, morale, the kit.
// Reads sim state every frame.
//
// Lead mode (#hud.lead): the player's marine is marked YOU; the bar shows Cover (LT) and Hold /
// Follow (B) with the kit on the pad's buttons, and only the followers' orders; the weapon panel
// is his own gun and magazine; a reticle rides his line of aim, and a prompt sits on whatever
// he could use (ui/interact.js).
import { ENERGY, HORDE, MELEE, ROE } from '../core/config.js';
import { tierOf } from '../meta/ranks.js';
import { BREAK_TAGS } from '../sim/breakdown.js';
import { KNOBS, LEAD_KNOBS, isManual, missionOptions } from '../sim/doctrine.js';
import { ICONS, portrait } from './icons.js';
import { RARITY, affixText } from '../sim/loot.js';
import { bodyPoint } from '../vis/sight.js';
import { helpButton } from './help.js';
import { Minimap } from './minimap.js';
import { ORDER_TILES } from './orders.js';

export { ORDER_TILES };

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// key: squad mode (keyboard); pad / lkey: lead mode (the controller / its keyboard fallback).
const ACTIONS = [
  { id: 'cover', icon: 'cover', label: 'Cover', key: 'C', pad: 'LT', lkey: 'SHIFT' },
  { id: 'turn', icon: 'turn', label: 'Turn back', key: 'T' },
  { id: 'hold', icon: 'hold', label: 'Hold', key: 'T', pad: 'B', lkey: 'T', lead: true },
  { id: 'map', icon: 'map', label: 'Map', key: 'TAB', pad: 'BACK', lkey: 'TAB' },
];

// The kit (sim/kit.js): one slim button each, with what's left.
const KIT_BUTTONS = [
  { id: 'grenade', icon: 'grenade', label: 'Grenade', key: 'Q', pad: 'X', lkey: 'Q', kit: 'grenades', title: 'Frag grenade into the thick of them (never with one of ours near it)' },
  { id: 'flare', icon: 'flare', label: 'Flare', key: 'E', pad: 'Y', lkey: 'F', kit: 'flares', title: 'Flare ahead of the point man: lights the room for good - creepers hate it' },
  { id: 'defend', icon: 'defend', label: 'Defend', key: 'D', pad: 'LB', lkey: 'G', kit: 'defend', none: 'NO DEFEND KIT', title: 'Two sentry guns either side of the squad - the answer to a horde. They stay and keep firing after you move on. You carry one; more are found aboard' },
];
const REFUSED = { grenade: 'NO CLEAR THROW', flare: 'ROOM ALREADY LIT', defend: 'CAN\'T SET UP HERE' };

const LOG_LINES = 4;     // lines the ticker keeps
const LOG_SECS = 7;      // ... and for how long
const LIFE_TREND = 30;   // seconds the lifesigns trend looks back

export class Hud {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    root.innerHTML = '';
    this.squadEl = root.appendChild(h('<div id="squad"></div>'));
    const mm = root.appendChild(h('<div id="minimap" class="panel interactive"></div>'));
    this.minimap = new Minimap(mm, game);
    this.logEl = root.appendChild(h('<div id="log"></div>'));
    this.actionsEl = root.appendChild(h('<div id="actions" class="panel interactive"><div class="cluster cl-act"><small>ACT</small><div class="acts"></div></div><div class="cluster cl-kit"><small>KIT</small><div class="kitbar"></div></div><div class="cluster cl-ord"><small>ORDERS</small><div class="orders"></div></div></div>'));
    this.buttons = {};
    const acts = this.actionsEl.querySelector('.acts');
    for (const a of ACTIONS) {
      const b = h(`<button class="act" data-id="${a.id}"><div class="ico">${ICONS[a.icon]}</div><div class="lbl">${a.label}</div><div class="key">[${a.key}]</div></button>`);
      b.addEventListener('click', () => game.command(a.id));
      acts.appendChild(b);
      this.buttons[a.id] = b;
    }
    this.kitEl = this.actionsEl.querySelector('.kitbar');
    this.kitButtons = {};
    for (const k of KIT_BUTTONS) {
      const b = h(`<button class="kitb" data-id="${k.id}" title="${k.title}"><i>${ICONS[k.icon]}</i><span>${k.label}</span><b></b><kbd>${k.key}</kbd></button>`);
      b.addEventListener('click', () => game.command(k.id));
      this.kitEl.appendChild(b);
      this.kitButtons[k.id] = { el: b, n: b.querySelector('b'), kit: k.kit, last: null };
    }
    this.ordersEl = this.actionsEl.querySelector('.orders');
    this.tiles = {};
    for (const t of ORDER_TILES) {
      const el = h(`<button class="ord" data-knob="${t.knob}"><span class="k"><i class="ico">${ICONS[t.icon] ?? ''}</i><em>${t.label}</em><kbd>${t.key}</kbd></span><span class="v"></span><i class="m"><b></b></i></button>`);
      el.addEventListener('click', (e) => { e.stopPropagation(); this.orderMenu(this.menuKnob === t.knob ? null : t.knob); });
      this.ordersEl.appendChild(el);
      this.tiles[t.knob] = { el, v: el.querySelector('.v'), meter: el.querySelector('.m b'), key: '' };
    }
    this.menuEl = this.actionsEl.appendChild(h('<div class="ordmenu"></div>'));
    this.menuKnob = null;
    document.addEventListener('pointerdown', (e) => { if (this.menuKnob && !this.actionsEl.contains(e.target)) this.orderMenu(null); });
    this.weaponEl = root.appendChild(h(`<div id="weapon"><div class="gun panel">${ICONS.rifle}<small class="wname"></small></div><div class="ammo panel"><span>0</span><small>ROUNDS</small></div><div class="credits panel"><span>0</span><small>CREDITS</small></div></div>`));
    this.reticleEl = root.appendChild(h('<div id="reticle"></div>'));
    this.objEl = root.appendChild(h(`<div id="objective"><div class="obj"></div><div id="uplink"><i></i></div>
      <div class="strip">
        <span class="mt life" title="Hostiles aboard, the horde included; the arrow: fewer than half a minute ago"><small>LIFESIGNS</small><b>0</b><i class="trend"></i></span>
        <span class="mt civ" hidden title="Civilians found aboard: safe on the Kestrel / all"><small>CIVILIANS</small><b>0/0</b></span>
        <span class="mt danger" title="How hot the ship is: noise brings the horde, quiet cools it (sim/director.js)"><small>DANGER</small><i class="meter"><b></b></i></span>
        <span class="mt energy" title="High alert burns it; kills, vermin, food and drinks refill it"><small>ENERGY</small><i class="meter"><b></b></i></span>
        <span class="mt morale" title="Kills and comrades back on their feet lift it; men lost and screams in the dark wear it down"><small>MORALE</small><b class="mor">HOLDING</b></span>
        <span class="mt stims" title="Stim-packs left"><small>STIMS</small><b>0</b></span>
        <span class="mt charges" title="Welding charges left"><small>CHARGES</small><b>0</b></span>
        <span class="mt key" hidden title="A keycard: somewhere aboard there's a door for it">KEYCARD</span>
        <span class="mt sentry" hidden title="A sentry gun of ours still has ammo">SENTRY</span>
      </div>
      <div class="roe"></div></div>`));
    this.barksEl = root.appendChild(h('<div id="barks"></div>'));
    this.lootEl = root.appendChild(h('<div id="lootcard" class="panel"><div class="tier"></div><div class="name"></div><div class="info"></div></div>'));
    this.toastEl = root.appendChild(h('<div id="toast"></div>'));
    this.hordeEl = root.appendChild(h('<div id="horde"><small>HORDE INBOUND</small><b></b></div>'));
    this.pausedEl = root.appendChild(h('<div id="paused">PAUSED</div>'));
    this.startEl = root.appendChild(h('<div class="screen title"></div>'));
    this.endEl = root.appendChild(h('<div class="screen"></div>'));
    this.troopers = [];
    this.ui = 1;
    this.logSeen = 0;
    this.lifeLog = [];
    window.addEventListener('resize', () => this.fitToScreen());
    document.fonts?.ready.then(() => this.fitToScreen());
    this.fitToScreen();
  }

  /**
   * Scale the HUD panels to the window: 1 at 1920x1080, smaller on laptop screens (gently, so the
   * text stays readable), and never so big that the bottom row's panels run into each other.
   * Each panel scales from its own corner (--ui in hud.css), so none leaves its anchor.
   */
  fitToScreen() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const actions = this.actionsEl.offsetWidth; // unscaled: offsetWidth ignores transforms
    const fitRow = (W / 2 - 26) / (this.weaponEl.offsetWidth + actions / 2); // weapon panel beside the centred bar
    this.ui = Math.max(0.5, Math.min(1.5, Math.min(W / 1920, H / 1080) ** 0.6, fitRow || 1));
    this.root.style.setProperty('--ui', this.ui.toFixed(3));
    // The objective (bottom right) gets the room left beside the action bar.
    this.objEl.style.maxWidth = `${Math.max(200, (W / 2 - 34 - (actions * this.ui) / 2) / this.ui)}px`;
  }

  // ------------------------------------------------------------------ binding

  bind(world, view) {
    this.world = world;
    this.view = view;
    this.minimap.bind(world);
    const lead = !!world.lead;
    this.root.classList.toggle('lead', lead);
    const pad = () => lead && (this.game.input?.padSeen ?? false);
    this.relabel();
    this.fitToScreen();
    this.logEl.innerHTML = '';
    this.logSeen = world.journal?.entries.length ?? 0;
    this.lifeLog = [];
    this.squadEl.innerHTML = '';
    this.troopers = world.marines.map((m, i) => {
      // His rank's colour (meta/ranks.js) on the frame and the name.
      const el = h(`<div class="trooper" style="--rank:${tierOf(m.rank).color}"><div class="portrait">${portrait(m.tint, i)}<div class="point" hidden>POINT</div></div>
        <div class="info"><div class="line"><span class="who"></span><small class="role"></small><span class="status"></span></div>
        <div class="bar"><i class="trail"></i><i class="fill"></i><b class="hpnum"></b></div>
        <div class="ammo"><div class="mag"></div><small class="res"></small></div>
        <div class="breath"><i></i></div><small class="wpn"></small></div></div>`);
      this.squadEl.appendChild(el);
      return { m, el, who: el.querySelector('.who'), role: el.querySelector('.role'), status: el.querySelector('.status'), fill: el.querySelector('.fill'), trail: el.querySelector('.trail'), bar: el.querySelector('.bar'), hpnum: el.querySelector('.hpnum'), breath: el.querySelector('.breath i'), mag: el.querySelector('.mag'), res: el.querySelector('.res'), wpn: el.querySelector('.wpn'), point: el.querySelector('.point'), lastHp: m.hp, hpShown: -9, key: '' };
    });
    world.on('bark', ({ marine, text }) => this.bark(marine, text));
    world.on('hit', ({ entity }) => {
      if (entity.kind !== 'marine') return;
      const t = this.troopers.find((q) => q.m === entity);
      t?.el.classList.remove('hurt');
      void t?.el.offsetWidth;
      t?.el.classList.add('hurt');
    });
    // Cards for finds and set pieces (the log carries the line as well).
    world.on('loot', ({ loot }) => {
      if (loot.type === 'food') this.lootCard('Supplies', 'Ration packs', `+${ENERGY.FOOD} energy for high alert`, '#e0a050');
      if (loot.type === 'drink') this.lootCard('Supplies', 'Energy drinks', `+${ENERGY.DRINK} energy for high alert`, '#e0a050');
      if (loot.type === 'weapon') this.lootCard(RARITY[loot.item.rarity].label + ' weapon', loot.item.name, affixText(loot.item) || 'Standard issue', RARITY[loot.item.rarity].color);
      if (loot.type === 'defend') this.lootCard('Defend kit', 'Twin sentry guns', 'Press D to set them up either side of the squad - save them for a horde', '#7fd0ff');
      if (loot.type === 'treasure') this.lootCard('Salvage', loot.item.name, `Worth ${loot.item.value} cr if we get it home`, '#e0b040');
    });
    world.on('survivor-found', ({ survivor }) => this.lootCard('Survivor', survivor.name, 'Heading for the Kestrel - keep the route clear', '#7fc25a'));
    world.on('survivor-rescued', ({ survivor }) => this.lootCard('Civilian safe', survivor.name, 'Aboard the Kestrel. +200 cr on extraction', '#7fc25a'));
    world.on('keycard', () => this.lootCard('Keycard', 'Crew access: stores', 'Somewhere aboard there\'s a door for this.', '#d8c070'));
    world.on('brood-dead', ({ bonus }) => this.lootCard('Brood mother', 'Killed', `The nest dies with her. +${bonus} cr`, '#c890e0'));
    world.on('power-out', ({ deck }) => this.lootCard('Ship event', `Deck ${deck + 1}: power failure`, 'Torches only - you see less, and they hear more. Find the power junction to restore it.', '#e0a050'));
    world.on('distress', ({ room }) => this.lootCard('Distress call', `A survivor on deck ${room.deck + 1}`, 'Marked on the tracker. Point at the beacon to answer it.', '#e0a050'));
    world.on('distress-answered', ({ survivor, bonus }) => this.lootCard('Caller found', survivor.name, `Heading for the Kestrel. +${bonus} cr`, '#7fc25a'));
    // What still shouts across the screen: a man down or taken, the horde, the ship cleared.
    world.on('downed', ({ marine }) => this.toast(`${marine.name} DOWN`, 1.6));
    world.on('taken', ({ marine }) => this.toast(`${marine.name} TAKEN`, 2));
    world.on('horde', () => this.toast('HERE THEY COME', 1.6));
    world.on('horde-over', () => this.toast('HORDE DOWN', 2));
    world.on('ship-clear', () => this.toast('SHIP CLEAR', 2.4));
    world.on('uplink-start', () => this.toast('HOLD THE DECK', 2.2));
    world.on('kit-refused', ({ item }) => {
      const k = KIT_BUTTONS.find((q) => q.id === item);
      this.toast(world.kit[k.kit] > 0 ? REFUSED[item] : k.none ?? `NO ${k.label.toUpperCase()}S LEFT`, 1.2);
    });
    world.journal?.add('Kestrel 21 docked: boarding', 'info');
    if (world.lead) {
      setTimeout(() => this.toast(pad() ? 'YOU HAVE POINT · LEFT STICK WALKS · RIGHT STICK AIMS · RT FIRES · A USES' : 'YOU HAVE POINT · WASD WALKS · MOUSE AIMS · CLICK FIRES · E USES', 4.5), 1400);
      world.on('use-refused', () => this.toast('NOTHING TO USE HERE', 0.9));
      world.on('downed', ({ marine }) => { if (marine === world.player) setTimeout(() => this.toast('YOU ARE DOWN - YOUR SQUAD IS COMING', 2.4), 1700); });
    } else if (world.doctrine?.manual) setTimeout(() => this.toast('YOUR CALL: CLICK A SPOT OR AN OBJECT TO MOVE THE SQUAD', 4), 1400);
    world.on('won', (e) => { if (!this.campaign) this.showEnd(true, e); });
    world.on('lost', (e) => { if (!this.campaign) this.showEnd(false, e); });
  }

  /**
   * The bar's buttons and their keys for this mode: the keyboard's in squad mode; in lead mode
   * the keyboard fallback's, with the pad's buttons once a controller has spoken (update).
   */
  relabel() {
    const lead = !!this.world?.lead;
    const pad = lead && (this.game.input?.padSeen ?? false);
    this.labelKey = `${lead}|${pad}`;
    const keyOf = (a) => (lead ? (pad ? `${a.pad} · ${a.lkey}` : a.lkey) : a.key);
    for (const a of ACTIONS) {
      const b = this.buttons[a.id];
      b.hidden = lead ? a.id === 'turn' : !!a.lead;
      b.querySelector('.key').textContent = `[${keyOf(a)}]`;
    }
    for (const k of KIT_BUTTONS) this.kitButtons[k.id].el.querySelector('kbd').textContent = keyOf(k);
    for (const t of ORDER_TILES) {
      const tile = this.tiles[t.knob];
      tile.el.hidden = lead && !LEAD_KNOBS.includes(t.knob);
      tile.el.querySelector('kbd').textContent = keyOf(t);
    }
  }

  /** Swap the SVG placeholders for portraits rendered from the 3D model. */
  setPortraits(urls) {
    if (!urls) return;
    this.troopers.forEach((t, i) => {
      const svgEl = t.el.querySelector('.portrait svg');
      if (!svgEl || !urls[i]) return;
      const img = document.createElement('img');
      img.src = urls[i];
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;display:block;image-rendering:auto';
      svgEl.replaceWith(img);
    });
  }

  // ------------------------------------------------------------------ per frame

  update(dt, paused) {
    const w = this.world;
    if (!w) return;
    this.pausedEl.classList.toggle('show', !!paused && w.status === 'playing');
    const sq = w.squad;
    if (w.lead && this.labelKey !== `true|${this.game.input?.padSeen ?? false}`) this.relabel(); // a controller spoke up

    for (const t of this.troopers) {
      const m = t.m;
      const pct = Math.max(0, m.hp / m.maxHp) * 100;
      // Personal breath (Stamina stat): the squad runs only while everyone has some.
      t.breath.style.width = `${m.staminaMax ? Math.max(0, m.stamina / m.staminaMax) * 100 : 0}%`;
      t.breath.parentNode.classList.toggle('low', m.staminaMax && m.stamina / m.staminaMax < 0.3);
      if (Math.round(m.hp) !== Math.round(t.lastHp)) { t.lastHp = m.hp; t.hpShown = w.time; }
      t.hpnum.classList.toggle('show', m.alive && (m.hp < m.maxHp || w.time - t.hpShown < 2.5));
      const broke = m.breakdown && BREAK_TAGS[m.breakdown.phase === 'hide' ? 'hide' : m.breakdown.mode];
      const status = !m.alive ? 'KIA' : m.down ? 'DOWN' : broke || (m.panicT > 0 ? 'PANIC' : m.reloadT > 0 ? 'RELOAD' : m.dry ? 'DRY' : '');
      const key = `${m.alive}|${Math.round(m.hp)}|${m.mag}|${m.reserve}|${status}|${sq.leader === m}|${m.controlled}|${m.weapon.label}|${m.wound}`;
      if (key === t.key) continue;
      t.key = key;
      t.who.textContent = `${m.rank} ${m.name}`;
      t.role.textContent = m.archetype ?? '';
      // Glyphs for what's wrong: reloading, dry, panic, a wound, down, dead.
      const glyph = (cls, text, title) => `<span class="st ${cls}" title="${esc(title)}">${text}</span>`;
      let st = '';
      if (status === 'RELOAD') st += glyph('reload', '⟳', 'Changing mags');
      else if (status === 'DRY') st += glyph('dry', 'DRY', 'No rounds left');
      else if (status === 'PANIC') st += glyph('panic', '!', 'Panicking: firing wild');
      else if (status === 'DOWN') st += glyph('down', 'DOWN', 'Down: stays down until a squad-mate gets him up');
      else if (status === 'KIA') st += glyph('kia', 'KIA', 'Killed in action');
      else if (broke) st += glyph(`broke ${m.breakdown.mode}`, broke, 'Broken down');
      if (m.alive && !m.down && m.wound) st += glyph('wound', m.wound === 'leg' ? '✚ LEG' : '✚ ARM', m.wound === 'leg' ? 'A bad leg: slower, climbs worse' : 'A bad arm: worse aim and reloads');
      t.status.innerHTML = st;
      t.hpnum.textContent = `${Math.max(0, Math.round(m.hp))}/${m.maxHp}`;
      t.fill.style.width = `${pct}%`;
      t.trail.style.width = `${pct}%`;
      t.bar.classList.toggle('low', pct < 35);
      t.el.classList.toggle('dead', !m.alive);
      t.el.classList.toggle('downed', !!m.down);
      t.point.hidden = sq.leader !== m && !m.controlled;
      t.point.textContent = m.controlled ? 'YOU' : 'POINT';
      t.point.classList.toggle('you', !!m.controlled);
      // 20 pips show the magazine fill fraction for any weapon size; the reserve beside them.
      const pips = m.weapon.mag ? Math.ceil((m.mag / m.weapon.mag) * 20) : 0;
      t.mag.innerHTML = Array.from({ length: 20 }, (_, i) => `<span class="${i < pips ? '' : 'empty'}"></span>`).join('');
      t.res.textContent = m.weapon.melee ? '' : `+${m.reserve}`;
      const blade = m.loadout?.melee ? ` + ${MELEE[m.loadout.melee]?.label ?? m.loadout.melee}` : '';
      t.wpn.textContent = `${m.weapon.label}${blade}`;
      t.wpn.style.color = RARITY[m.weapon.rarity ?? 'common'].color;
    }

    // The controls.
    const b = this.buttons;
    const roe = w.settings.roe;
    b.cover.classList.toggle('on', sq.cover);
    b.cover.querySelector('.lbl').textContent = sq.cover ? 'In cover' : 'Cover';
    b.turn.classList.toggle('warn', sq.turnPending || w.doctrine?.override?.verb === 'turn');
    b.hold.classList.toggle('on', !!sq.followersHold);
    b.hold.querySelector('.lbl').textContent = sq.followersHold ? 'Follow' : 'Hold';
    b.map.classList.toggle('on', !!this.game.map?.open);
    for (const k of Object.values(this.kitButtons)) {
      const n = w.kit[k.kit];
      if (n === k.last) continue;
      k.last = n;
      k.n.textContent = n;
      k.el.classList.toggle('empty', n <= 0);
    }
    this.updateOrders();
    this.updateLog();

    // A horde coming: the countdown.
    const horde = w.director.horde;
    const left = horde?.phase === 'warn' ? Math.max(1, Math.ceil(horde.left)) : 0;
    this.hordeEl.classList.toggle('show', !!left);
    if (left && this.hordeEl.lastChild.textContent !== String(left)) this.hordeEl.lastChild.textContent = left;

    const you = w.lead ? w.player : null;
    if (you) {
      // His own gun: the magazine, the reserve, and what he's carrying.
      const melee = you.weapon.melee;
      this.weaponEl.querySelector('.ammo span').textContent = melee ? '-' : you.mag;
      this.weaponEl.querySelector('.ammo small').textContent = melee ? 'FISTS' : you.reloadT > 0 ? 'RELOADING' : `+${you.reserve} RESERVE`;
      const wn = this.weaponEl.querySelector('.wname');
      if (wn.textContent !== you.weapon.label) wn.textContent = you.weapon.label;
      this.weaponEl.querySelector('.ammo').classList.toggle('low', !melee && you.mag <= you.weapon.mag * 0.25);
    } else {
      const rounds = w.marines.reduce((s, m) => s + (m.alive ? m.mag + m.reserve : 0), 0);
      this.weaponEl.querySelector('.ammo span').textContent = rounds;
    }
    this.updateReticle(you);
    const salvage = w.salvage.reduce((s, t) => s + t.value, 0);
    this.weaponEl.querySelector('.credits span').textContent = w.credits;
    this.weaponEl.querySelector('.credits small').textContent = salvage ? `CREDITS · +${salvage} SALVAGE` : 'CREDITS';

    // Objective.
    const lead = sq.leader;
    const obj = w.level.objective;
    const dist = lead ? Math.max(0, Math.round(Math.abs(obj.x - lead.x) + Math.abs(w.level.rooms[obj.room].y0 - lead.y))) : 0;
    const ship = w.shipName ? `<small class="ship">${esc(w.shipName)} · THREAT ${w.level.threat}</small><br>` : '';
    const objText = ship + (w.uplink ? 'UPLOAD NAV-LOCK.<br>HOLD THE COMMAND DECK.' : `REACH THE COMMAND DECK.<br>${dist}M TO GO.`);
    if (this.objKey !== objText) { this.objEl.querySelector('.obj').innerHTML = objText; this.objKey = objText; }
    const up = this.objEl.querySelector('#uplink');
    up.style.display = w.uplink ? 'block' : 'none';
    if (w.uplink && sq.action?.type === 'uplink') up.firstChild.style.width = `${(sq.action.t / sq.action.dur) * 100}%`;
    this.updateStrip();

    // The state line: fire discipline, and what the squad is doing about its orders.
    const d = w.doctrine?.cfg;
    const route = w.lead ? (you?.down ? '<b class="await">YOU ARE DOWN</b> · ' : sq.followersHold ? '<b class="await">FOLLOWERS HOLDING</b> · ' : `${Math.max(0, sq.order.length - 1)} ON YOU · `)
      : isManual(d) ? (sq.state === 'hold' && !w.doctrine.override ? '<b class="await">AWAITING ORDERS</b> · ' : 'MOVING ON YOUR ORDER · ') : '';
    const state = `${route}${sq.pace === 'run' && sq.leader?.moving ? 'RUNNING · ' : ''}STATE: <b class="${roe}">${roe === 'alert' ? 'HIGH ALERT' : roe.toUpperCase()}</b>`;
    if (this.stateKey !== state) { this.objEl.querySelector('.roe').innerHTML = state; this.stateKey = state; }

    // Keep barks attached to their speakers; stack any that would overlap.
    const placed = [];
    for (const el of this.barksEl.children) {
      const m = el._marine;
      if (!m) continue;
      const p = this.view.toScreen(m.x, m.y + 2.6, m.z);
      const w2 = el.offsetWidth || 160;
      let y = p.y;
      while (placed.some((q) => Math.abs(q.x - p.x) < (q.w + w2) / 2 + 6 && Math.abs(q.y - y) < 22)) y -= 24;
      placed.push({ x: p.x, y, w: w2 });
      el.style.left = `${p.x}px`;
      el.style.top = `${y}px`;
    }
    this.minimap.update(dt);
  }

  /** The strip of meters under the objective: lifesigns, danger, energy, morale, the kit. */
  updateStrip() {
    const w = this.world;
    const S = this.objEl;
    const life = w.lifesigns();
    const t = w.time;
    this.lifeLog.push({ t, life });
    while (this.lifeLog.length > 2 && this.lifeLog[1].t < t - LIFE_TREND) this.lifeLog.shift();
    const before = this.lifeLog[0].life;
    const lifeEl = S.querySelector('.life');
    lifeEl.querySelector('b').textContent = life || 'CLEAR';
    lifeEl.querySelector('b').className = life ? 'hot' : 'clear';
    lifeEl.querySelector('.trend').textContent = life < before ? '▼' : '';
    const found = w.survivors.filter((s) => s.identified || !s.alive);
    const civ = S.querySelector('.civ');
    civ.hidden = !(w.survivors.length && found.length);
    if (!civ.hidden) civ.querySelector('b').textContent = `${w.survivors.filter((s) => s.state === 'rescued').length}/${w.survivors.length}`;
    // Danger: how hot the ship is against what brings the horde; a horde under way or spent pins it.
    const dg = S.querySelector('.danger');
    const f = w.level.mods?.hordes ?? 1;
    const none = w.director.hordeSize <= 0 || f <= 0;
    const hd = w.director.horde;
    const heat = hd ? 1 : none ? 0 : Math.min(1, w.director.heat / (HORDE.START / f));
    dg.querySelector('b').style.width = `${heat * 100}%`;
    dg.classList.toggle('hot', heat > 0.75);
    dg.classList.toggle('warm', heat > 0.4 && heat <= 0.75);
    dg.classList.toggle('none', none);
    dg.title = none ? 'No horde aboard this ship' : hd ? (hd.phase === 'warn' ? 'The horde is coming' : 'The horde is here') : `The ship is ${Math.round(heat * 100)}% of the way to calling its horde: noise heats it, quiet cools it`;
    const en = S.querySelector('.energy');
    en.querySelector('b').style.width = `${(w.energy / ENERGY.MAX) * 100}%`;
    en.classList.toggle('low', w.energy < ENERGY.MAX * 0.25);
    const mor = w.morale.level.name;
    const me = S.querySelector('.mor');
    if (me.textContent !== mor.toUpperCase()) { me.textContent = mor.toUpperCase(); me.className = `mor ${mor}`; }
    S.querySelector('.stims b').textContent = w.stims;
    S.querySelector('.charges b').textContent = w.kit.charges;
    S.querySelector('.key').hidden = !w.kit.keycards;
    S.querySelector('.sentry').hidden = !w.sentries.some((s) => s.ammo > 0);
  }

  /** The ticker: the ship's log as it grows, the last few lines, each fading after a while. */
  updateLog() {
    const j = this.world.journal;
    if (!j) return;
    const es = j.entries;
    // (The log is capped: if it was trimmed under us, catch up from the newest few.)
    if (this.logSeen > es.length) this.logSeen = Math.max(0, es.length - LOG_LINES);
    while (this.logSeen < es.length) {
      const e = es[this.logSeen++];
      const el = h(`<div class="ln ${e.kind}">${esc(e.text)}</div>`);
      el._t = this.world.time;
      this.logEl.appendChild(el);
      while (this.logEl.children.length > LOG_LINES) this.logEl.firstChild.remove();
    }
    for (const el of [...this.logEl.children]) if (this.world.time - el._t > LOG_SECS) el.remove();
  }

  /** Lead: the reticle on his line of aim - or on the hostile his aim is drawn to (sim/combat.js). */
  updateReticle(you) {
    const el = this.reticleEl;
    const show = you?.alive && !you.down && (you.aiming || you.target);
    el.classList.toggle('show', !!show);
    if (!show) return;
    const t = you.target?.alive ? you.target : null;
    const reach = 7;
    const at = t ? bodyPoint(t, 0.5) : { x: you.x + you.facing * Math.cos(you.aimAngle ?? 0) * reach, y: you.y + 1.45 * (you.scale ?? 1) + Math.sin(you.aimAngle ?? 0) * reach };
    const p = this.view.toScreen(at.x, at.y, t ? t.z : you.z);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.classList.toggle('lock', !!t);
  }

  /**
   * The orders bar: each tile shows its knob's current order; Fire carries the energy meter and
   * Pace the squad's breath (its most winded trooper). A high-alert order the squad has no
   * energy for shows as spent.
   */
  updateOrders() {
    const w = this.world;
    const cfg = w.doctrine?.cfg;
    if (!cfg) return;
    const low = w.squad.order.reduce((a, m) => (!a || m.stamina / m.staminaMax < a.stamina / a.staminaMax ? m : a), null);
    for (const t of ORDER_TILES) {
      const tile = this.tiles[t.knob];
      const spent = t.knob === 'roe' && cfg.roe === 'alert' && w.settings.roe !== ROE.ALERT;
      const key = `${cfg[t.knob]}|${spent}`;
      if (key !== tile.key) {
        tile.key = key;
        tile.v.textContent = t.short[cfg[t.knob]] + (spent ? ' (spent)' : '');
        tile.el.dataset.v = cfg[t.knob];
        tile.el.title = `${KNOBS[t.knob].label}: ${t.detail[cfg[t.knob]]} - click to change, or press ${t.key}`;
      }
      if (t.knob === 'roe') {
        tile.meter.style.width = `${(w.energy / ENERGY.MAX) * 100}%`;
        tile.el.classList.toggle('low', w.energy < ENERGY.MAX * 0.25);
      } else if (t.knob === 'pace') {
        tile.meter.style.width = `${low ? Math.max(0, low.stamina / low.staminaMax) * 100 : 0}%`;
        tile.el.classList.toggle('low', !!low && low.stamina / low.staminaMax < 0.3);
        tile.el.classList.toggle('running', w.squad.pace === 'run');
      }
    }
    if (this.menuKnob) for (const b of this.menuEl.querySelectorAll('[data-v]')) b.classList.toggle('on', b.dataset.v === cfg[this.menuKnob]);
  }

  /** Open (or close, with null) the options of one order, above its tile. */
  orderMenu(knob) {
    this.menuKnob = knob;
    for (const [k, t] of Object.entries(this.tiles)) t.el.classList.toggle('open', k === knob);
    this.menuEl.classList.toggle('show', !!knob);
    if (!knob) return;
    const cfg = this.world?.doctrine?.cfg ?? {};
    const tile = ORDER_TILES.find((t) => t.knob === knob);
    this.menuEl.innerHTML = `<div class="mt">${KNOBS[knob].label}</div>${missionOptions(cfg, knob).map((o) => `<button data-v="${o.v}" class="${cfg[knob] === o.v ? 'on' : ''}" ${o.off ? 'disabled title="Not with Manual orders"' : ''}><b>${tile.short[o.v]}</b><small>${tile.detail[o.v]}</small></button>`).join('')}`;
    for (const b of this.menuEl.querySelectorAll('[data-v]')) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (b.disabled) return;
        this.game.command('order', { knob, value: b.dataset.v });
        this.orderMenu(null);
      });
    }
    const el = this.tiles[knob].el;
    const bar = this.actionsEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    this.menuEl.style.left = `${(r.left + r.width / 2 - bar.left) / this.ui}px`;
  }

  bark(marine, text) {
    if (!marine) return;
    for (const el of [...this.barksEl.children]) if (el._marine === marine) el.remove();
    const el = h(`<div class="bark">${marine.name}: ${text}</div>`);
    el._marine = marine;
    this.barksEl.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  /** Rarity-coloured pickup card (weapons, salvage, survivors). */
  lootCard(tier, name, info, color) {
    const el = this.lootEl;
    el.querySelector('.tier').textContent = tier;
    el.querySelector('.name').textContent = name;
    el.querySelector('.info').textContent = info;
    el.style.setProperty('--tier', color);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.lootT);
    this.lootT = setTimeout(() => el.classList.remove('show'), 3800);
  }

  /** Big red words across the screen: only for what can't wait (a man down, the horde). */
  toast(text, secs = 1.5) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => this.toastEl.classList.remove('show'), secs * 1000);
  }

  // ------------------------------------------------------------------ screens

  showStart(seed, { hasCampaign = false } = {}) {
    this.startEl.innerHTML = `<div class="box">
      <h1>HULL BREACH</h1><h2>DERELICT BOARDING ACTION · SQUAD ROGUELIKE</h2>
      <p class="pitch">Four marines, a derelict, and whatever is still aboard. Board it, reach the command deck, hold it for the uplink, and get them home.</p>
      <div class="menu">
        ${hasCampaign ? '<button id="continue">CONTINUE CAMPAIGN</button>' : ''}
        <button id="newcamp" class="${hasCampaign ? 'alt' : ''}">NEW CAMPAIGN</button>
      </div>
      <div class="row"><input id="seed" value="${seed}" maxlength="10" aria-label="Ship seed" /><button id="deploy" class="alt">QUICK PLAY</button></div>
      <div class="row helprow"></div>
    </div>`;
    this.startEl.querySelector('.helprow').appendChild(helpButton(this.startEl, 'squad'));
    this.startEl.classList.add('show');
    this.root.classList.add('menu');
    const go = () => this.game.showQuickBriefing(this.startEl.querySelector('#seed').value.trim().toUpperCase() || seed);
    this.startEl.querySelector('#deploy').addEventListener('click', go);
    this.startEl.querySelector('#seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    this.startEl.querySelector('#continue')?.addEventListener('click', () => this.game.showCommand());
    this.startEl.querySelector('#newcamp').addEventListener('click', () => {
      if (hasCampaign && !confirm('Start a new campaign? Your current squad, credits and armoury will be lost.')) return;
      this.game.newCampaign();
    });
  }

  hideStart() { this.startEl.classList.remove('show'); this.root.classList.remove('menu'); }

  showEnd(won, { stats, time }) {
    const w = this.world;
    const alive = w.marines.filter((m) => m.alive).length;
    const mins = Math.floor(time / 60);
    const secs = String(Math.floor(time % 60)).padStart(2, '0');
    setTimeout(() => {
      this.endEl.className = `screen show ${won ? 'won' : 'lost'}`;
      this.endEl.innerHTML = `<div class="box panel">
        <h1>${won ? 'NAV-LOCK SECURED' : 'SQUAD LOST'}</h1>
        <h2>${won ? 'THE DERELICT IS OURS' : 'THE HULK CLAIMS FOUR MORE'} · SEED ${w.level.seed}</h2>
        <table>
          <tr><td>Time</td><td>${mins}:${secs}</td></tr>
          <tr><td>Troopers extracted</td><td>${won ? alive : 0} / ${w.marines.length}</td></tr>
          <tr><td>Hostiles killed</td><td>${stats.kills}</td></tr>
          <tr><td>Vermin killed</td><td>${stats.critters}</td></tr>
          <tr><td>Caches looted</td><td>${stats.loot}</td></tr>
          <tr><td>Credits</td><td>${w.credits}</td></tr>
          <tr><td>Rooms explored</td><td>${stats.rooms + 1} / ${w.level.rooms.length}</td></tr>
        </table>
        <div class="row"><button id="again">NEW SHIP</button><button class="alt" id="retry">RETRY SEED</button></div>
      </div>`;
      this.endEl.querySelector('#again').addEventListener('click', () => this.game.newRun());
      this.endEl.querySelector('#retry').addEventListener('click', () => location.reload());
    }, won ? 900 : 1800);
  }
}
