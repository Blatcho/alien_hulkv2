// DOM HUD laid out like the reference: squad top-left, tracker/minimap top-right, the controls
// bottom-centre - Cover, Turn back and the standing orders bar (the briefing's orders, changeable
// mid-mission: the squad runs itself by them - sim/doctrine.js) - weapon bottom-left, objective
// bottom-right. Reads sim state every frame.
//
// Lead mode (#hud.lead): the player's marine is marked YOU; the bar shows Cover (LT) and Hold /
// Follow (B) with the kit on the pad's buttons, and only the followers' orders; the weapon panel
// is his own gun and magazine; a reticle rides his line of aim, and a prompt sits on whatever
// he could use (ui/interact.js).
import { ENERGY, KIT, MELEE, ROE } from '../core/config.js';
import { tierOf } from '../meta/ranks.js';
import { BREAK_TAGS } from '../sim/breakdown.js';
import { KNOBS, LEAD_KNOBS, isManual, missionOptions } from '../sim/doctrine.js';
import { ICONS, portrait } from './icons.js';
import { RARITY, affixText } from '../sim/loot.js';
import { bodyPoint } from '../vis/sight.js';
import { Minimap } from './minimap.js';

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// key: squad mode (keyboard); pad / lkey: lead mode (the controller / its keyboard fallback).
const ACTIONS = [
  { id: 'cover', icon: 'cover', label: 'Cover', key: 'C', pad: 'LT', lkey: 'SHIFT' },
  { id: 'turn', icon: 'turn', label: 'Turn back', key: 'T' },
  { id: 'hold', icon: 'hold', label: 'Hold', key: 'T', pad: 'B', lkey: 'T', lead: true },
];

// The kit (sim/kit.js): one slim button each, with what's left.
const KIT_BUTTONS = [
  { id: 'grenade', icon: 'grenade', label: 'Grenade', key: 'Q', pad: 'X', lkey: 'Q', kit: 'grenades', title: 'Frag grenade into the thick of them (never with one of ours near it)' },
  { id: 'flare', icon: 'flare', label: 'Flare', key: 'E', pad: 'Y', lkey: 'F', kit: 'flares', title: 'Flare ahead of the point man: lights the room for good - creepers hate it' },
  { id: 'defend', icon: 'defend', label: 'Defend', key: 'D', pad: 'LB', lkey: 'G', kit: 'defend', none: 'NO DEFEND KIT', title: 'Two sentry guns either side of the squad - the answer to a horde. They stay and keep firing after you move on. You carry one; more are found aboard' },
];
const REFUSED = { grenade: 'NO CLEAR THROW', flare: 'ROOM ALREADY LIT', defend: 'CAN\'T SET UP HERE' };

// The standing orders bar: one tile per knob, its hotkey (cycles it - core/input.js), and each
// option's short name and what it means.
export const ORDER_TILES = [
  { knob: 'route', label: 'Route', key: 'R',
    short: { manual: 'Your call', direct: 'Direct', thorough: 'Sweep' },
    detail: { manual: 'They go where you click, then hold', direct: 'Straight for the command deck', thorough: 'Sweep the side rooms on the way' } },
  { knob: 'roe', label: 'Fire', key: 'F', pad: '◀', lkey: 'X',
    short: { cautious: 'Cautious', normal: 'Normal', alert: 'High alert' },
    detail: { cautious: 'Only return fire', normal: 'Shoot anything that moves - vermin too', alert: 'Weapons up, fastest reactions - burns energy' } },
  { knob: 'pace', label: 'Pace', key: 'G',
    short: { stealthy: 'Stealthy', steady: 'Steady', fast: 'Fast' },
    detail: { stealthy: 'Slow and quiet - hard to hear', steady: 'A steady jog', fast: 'Sprint while everyone has breath - drains stamina' } },
  { knob: 'loot', label: 'Loot', key: 'L',
    short: { leave: 'Leave it', way: 'On the way', all: 'Everything' },
    detail: { leave: 'Search nothing', way: 'Search what they pass, unless in a fight', all: 'Go out of the way for every container' } },
  { knob: 'stims', label: 'Stims', key: 'H', pad: '▶', lkey: 'H',
    short: { early: 'Early', critical: 'Critical', hoard: 'Hoard' },
    detail: { early: 'Stim anyone under 60% health', critical: 'Stim anyone under 35%', hoard: 'Only under 15%' } },
  { knob: 'light', label: 'Lights', key: 'V', pad: '▲', lkey: 'V',
    short: { on: 'On', auto: 'Auto', off: 'Off' },
    detail: { on: 'Torches on', auto: 'Off in lit, quiet rooms', off: 'Dark - harder to spot them, harder to be spotted' } },
  { knob: 'kit', label: 'Kit', key: 'K', pad: '▼', lkey: 'K',
    short: { use: 'Use it', save: 'Save it' },
    detail: { use: 'Grenades into packs, flares into dark rooms - by themselves', save: 'Grenades and flares only on your call' } },
];

export class Hud {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    root.innerHTML = '';
    this.squadEl = root.appendChild(h('<div id="squad"></div>'));
    const mm = root.appendChild(h('<div id="minimap" class="panel interactive"></div>'));
    this.minimap = new Minimap(mm, game);
    this.actionsEl = root.appendChild(h('<div id="actions" class="panel interactive"></div>'));
    this.buttons = {};
    for (const a of ACTIONS) {
      const b = h(`<button class="act" data-id="${a.id}"><div class="ico">${ICONS[a.icon]}</div><div class="lbl">${a.label}</div><div class="key">[${a.key}]</div></button>`);
      b.addEventListener('click', () => game.command(a.id));
      this.actionsEl.appendChild(b);
      this.buttons[a.id] = b;
    }
    this.kitEl = this.actionsEl.appendChild(h('<div class="kitbar"></div>'));
    this.kitButtons = {};
    for (const k of KIT_BUTTONS) {
      const b = h(`<button class="kitb" data-id="${k.id}" title="${k.title}"><i>${ICONS[k.icon]}</i><span>${k.label}</span><b></b><kbd>${k.key}</kbd></button>`);
      b.addEventListener('click', () => game.command(k.id));
      this.kitEl.appendChild(b);
      this.kitButtons[k.id] = { el: b, n: b.querySelector('b'), kit: k.kit, last: null };
    }
    this.ordersEl = this.actionsEl.appendChild(h('<div class="orders"></div>'));
    this.tiles = {};
    for (const t of ORDER_TILES) {
      const el = h(`<button class="ord" data-knob="${t.knob}"><span class="k">${t.label}<kbd>${t.key}</kbd></span><span class="v"></span><i class="m"><b></b></i></button>`);
      el.addEventListener('click', (e) => { e.stopPropagation(); this.orderMenu(this.menuKnob === t.knob ? null : t.knob); });
      this.ordersEl.appendChild(el);
      this.tiles[t.knob] = { el, v: el.querySelector('.v'), meter: el.querySelector('.m b'), key: '' };
    }
    this.menuEl = this.actionsEl.appendChild(h('<div class="ordmenu"></div>'));
    this.menuKnob = null;
    document.addEventListener('pointerdown', (e) => { if (this.menuKnob && !this.actionsEl.contains(e.target)) this.orderMenu(null); });
    this.weaponEl = root.appendChild(h(`<div id="weapon"><div class="gun panel">${ICONS.rifle}<small class="wname"></small></div><div class="ammo panel"><span>0</span><small>ROUNDS</small></div><div class="credits panel"><span>0</span><small>CREDITS</small></div></div>`));
    this.reticleEl = root.appendChild(h('<div id="reticle"></div>'));
    this.objEl = root.appendChild(h('<div id="objective"><div class="obj"></div><div id="uplink"><i></i></div><div class="roe"></div></div>'));
    this.barksEl = root.appendChild(h('<div id="barks"></div>'));
    this.lootEl = root.appendChild(h('<div id="lootcard" class="panel"><div class="tier"></div><div class="name"></div><div class="info"></div></div>'));
    this.toastEl = root.appendChild(h('<div id="toast"></div>'));
    this.hordeEl = root.appendChild(h('<div id="horde"><small>HORDE INBOUND</small><b></b></div>'));
    this.pausedEl = root.appendChild(h('<div id="paused">PAUSED</div>'));
    this.startEl = root.appendChild(h('<div class="screen title"></div>'));
    this.endEl = root.appendChild(h('<div class="screen"></div>'));
    this.troopers = [];
    this.ui = 1;
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
    this.objEl.style.maxWidth = `${Math.max(160, (W / 2 - 34 - (actions * this.ui) / 2) / this.ui)}px`;
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
    this.squadEl.innerHTML = '';
    this.troopers = world.marines.map((m, i) => {
      // His rank's colour (meta/ranks.js) on the frame and the name.
      const el = h(`<div class="trooper" style="--rank:${tierOf(m.rank).color}"><div class="portrait">${portrait(m.tint, i)}<div class="point" hidden>POINT</div></div>
        <div class="info"><div class="line"></div><div class="bar"><i class="trail"></i><i class="fill"></i></div><div class="breath"><i></i></div><div class="mag"></div></div></div>`);
      this.squadEl.appendChild(el);
      return { m, el, line: el.querySelector('.line'), fill: el.querySelector('.fill'), trail: el.querySelector('.trail'), bar: el.querySelector('.bar'), breath: el.querySelector('.breath i'), mag: el.querySelector('.mag'), point: el.querySelector('.point'), lastHp: m.hp, key: '' };
    });
    world.on('bark', ({ marine, text }) => this.bark(marine, text));
    world.on('marine-hit', () => {});
    world.on('hit', ({ entity }) => {
      if (entity.kind !== 'marine') return;
      const t = this.troopers.find((q) => q.m === entity);
      t?.el.classList.remove('hurt');
      void t?.el.offsetWidth;
      t?.el.classList.add('hurt');
    });
    world.on('alien-wake', ({ alien }) => { if (alien.visible) this.toast('CONTACT', 1.2); });
    world.on('ambush', ({ prop }) => { if (prop) this.toast('AMBUSH', 1.4); });
    world.on('uplink-start', () => this.toast('HOLD THE DECK', 2.2));
    world.on('loot', ({ loot }) => {
      if (loot.type === 'food') this.lootCard('Supplies', 'Ration packs', `+${ENERGY.FOOD} energy for high alert`, '#e0a050');
      if (loot.type === 'drink') this.lootCard('Supplies', 'Energy drinks', `+${ENERGY.DRINK} energy for high alert`, '#e0a050');
      if (loot.type === 'weapon') this.lootCard(RARITY[loot.item.rarity].label + ' weapon', loot.item.name, affixText(loot.item) || 'Standard issue', RARITY[loot.item.rarity].color);
      if (loot.type === 'defend') this.lootCard('Defend kit', 'Twin sentry guns', 'Press D to set them up either side of the squad - save them for a horde', '#7fd0ff');
      if (loot.type === 'treasure') this.lootCard('Salvage', loot.item.name, `Worth ${loot.item.value} cr if we get it home`, '#e0b040');
    });
    world.on('survivor-found', ({ survivor }) => this.lootCard('Survivor', survivor.name, 'Heading for the Kestrel - keep the route clear', '#7fc25a'));
    world.on('survivor-rescued', ({ survivor }) => this.lootCard('Civilian safe', survivor.name, 'Aboard the Kestrel. +200 cr on extraction', '#7fc25a'));
    world.on('survivor-died', ({ friendly }) => this.toast(friendly ? 'FRIENDLY FIRE' : 'CIVILIAN LOST', 1.8));
    world.on('downed', ({ marine }) => this.toast(`${marine.name} DOWN`, 1.6));
    world.on('breakdown', ({ marine, mode }) => this.toast(`${marine.name} ${{ freeze: 'FROZE', flee: 'BOLTED', berserk: 'WENT BERSERK' }[mode]}`, 1.6));
    world.on('dragged', ({ marine }) => this.toast(`${marine.name} DRAGGED`, 1.6));
    // Set pieces.
    world.on('sentry-online', () => this.toast('SENTRY ONLINE', 1.6));
    world.on('sentry-dry', ({ sentry }) => this.toast(sentry.deployed ? 'TURRET DRY' : 'SENTRY DRY', 1.2));
    world.on('defend', () => this.toast('TURRETS UP', 1.4));
    world.on('horde', () => this.toast('HERE THEY COME', 1.6));
    world.on('horde-over', () => this.toast('HORDE DOWN', 2));
    world.on('keycard', () => this.lootCard('Keycard', 'Crew access: stores', 'Somewhere aboard there\'s a door for this.', '#d8c070'));
    world.on('hatch', ({ count }) => this.toast(count > 1 ? 'THEY\'RE HATCHING' : 'ONE HATCHED', 1.4));
    world.on('autodoc', ({ ok }) => { if (ok) this.toast('AUTODOC CYCLE', 1.4); });
    world.on('kit-refused', ({ item }) => {
      const k = KIT_BUTTONS.find((q) => q.id === item);
      this.toast(world.kit[k.kit] > 0 ? REFUSED[item] : k.none ?? `NO ${k.label.toUpperCase()}S LEFT`, 1.2);
    });
    world.on('morale', ({ level, worse }) => {
      if (worse && (level === 'shaken' || level === 'breaking')) this.toast(`SQUAD ${level.toUpperCase()}`, 1.8);
      else if (!worse && level === 'holding') this.toast('SQUAD RALLIED', 1.4);
    });
    world.on('taken', ({ marine }) => this.toast(`${marine.name} TAKEN`, 2));
    world.on('scream', ({ woke, called }) => { if (woke + called) this.toast('THE DECK IS AWAKE', 1.8); });
    world.on('brood-dead', ({ bonus }) => this.lootCard('Brood mother', 'Killed', `The nest dies with her. +${bonus} cr`, '#c890e0'));
    // Ship events.
    world.on('power-out', ({ deck }) => {
      this.toast('POWER FAILURE', 2);
      this.lootCard('Ship event', `Deck ${deck + 1}: power failure`, 'Torches only - you see less, and they hear more. Find the power junction to restore it.', '#e0a050');
    });
    world.on('power-on', () => this.toast('POWER RESTORED', 1.6));
    world.on('fire', () => this.toast('FIRE', 1.4));
    world.on('distress', ({ room }) => this.lootCard('Distress call', `A survivor on deck ${room.deck + 1}`, 'Marked on the tracker. Point at the beacon to answer it.', '#e0a050'));
    world.on('distress-answered', ({ survivor, bonus }) => this.lootCard('Caller found', survivor.name, `Heading for the Kestrel. +${bonus} cr`, '#7fc25a'));
    world.on('ship-clear', () => this.toast('SHIP CLEAR', 2.4));
    world.on('airlock-cycle', () => this.toast('LOCK CYCLED', 1.2));
    setTimeout(() => this.toast('KESTREL 21 DOCKED - BOARDING', 2.4), 300);
    if (world.lead) {
      setTimeout(() => this.toast(pad() ? 'YOU HAVE POINT · LEFT STICK WALKS · RIGHT STICK AIMS · RT FIRES · A USES' : 'YOU HAVE POINT · WASD WALKS · MOUSE AIMS · CLICK FIRES · E USES', 4.5), 2900);
      world.on('control', ({ marine }) => this.toast(`${marine.name}: YOU HAVE POINT`, 2.4));
      world.on('hold', ({ on }) => this.toast(on ? 'FOLLOWERS HOLD' : 'FOLLOWERS ON YOU', 1.2));
      world.on('use-refused', () => this.toast('NOTHING TO USE HERE', 0.9));
      world.on('downed', ({ marine }) => { if (marine === world.player) setTimeout(() => this.toast('YOU ARE DOWN - YOUR SQUAD IS COMING', 2.4), 1700); });
    } else if (world.doctrine?.manual) setTimeout(() => this.toast('YOUR CALL: CLICK A SPOT OR AN OBJECT TO MOVE THE SQUAD', 4), 2900);
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
      const broke = m.breakdown && BREAK_TAGS[m.breakdown.phase === 'hide' ? 'hide' : m.breakdown.mode];
      const status = !m.alive ? 'KIA' : m.down ? 'DOWN' : broke || (m.panicT > 0 ? 'PANIC' : m.reloadT > 0 ? 'RELOADING' : m.dry ? 'DRY' : '');
      const wound = m.alive && !m.down && m.wound ? `<span class="tag wound">${m.wound === 'leg' ? 'LEG WOUND' : 'ARM WOUND'}</span>` : '';
      const key = `${m.alive}|${Math.round(m.hp)}|${m.mag}|${m.reserve}|${status}|${sq.leader === m}|${m.controlled}|${m.weapon.label}|${m.wound}`;
      if (key === t.key) continue;
      t.key = key;
      // (Power fists: no ammo. A power sword carried as well goes after the gun's name.)
      const ammo = m.weapon.melee ? '-' : m.mag + m.reserve;
      const blade = m.loadout?.melee ? ` + ${MELEE[m.loadout.melee]?.label ?? m.loadout.melee}` : '';
      t.line.innerHTML = `<span class="who">${m.rank} ${m.name}</span>${m.archetype ? ` <small class="role">${m.archetype}</small>` : ''} - HP: <b>${Math.max(0, Math.round(m.hp))}/${m.maxHp}</b> | AMMO: <b>${ammo}</b>${status ? `<span class="tag ${status === 'DOWN' ? 'down' : broke ? `broke ${m.breakdown.mode}` : ''}">${status}</span>` : ''}${wound}<span class="wpn" style="color:${RARITY[m.weapon.rarity ?? 'common'].color}">${m.weapon.label}${blade}</span>`;
      t.fill.style.width = `${pct}%`;
      t.trail.style.width = `${pct}%`;
      t.bar.classList.toggle('low', pct < 35);
      t.el.classList.toggle('dead', !m.alive);
      t.el.classList.toggle('downed', !!m.down);
      t.point.hidden = sq.leader !== m && !m.controlled;
      t.point.textContent = m.controlled ? 'YOU' : 'POINT';
      t.point.classList.toggle('you', !!m.controlled);
      // 20 pips show the magazine fill fraction for any weapon size.
      const pips = m.weapon.mag ? Math.ceil((m.mag / m.weapon.mag) * 20) : 0;
      t.mag.innerHTML = Array.from({ length: 20 }, (_, i) => `<span class="${i < pips ? '' : 'empty'}"></span>`).join('');
    }

    // The two controls.
    const b = this.buttons;
    const roe = w.settings.roe;
    b.cover.classList.toggle('on', sq.cover);
    b.cover.querySelector('.lbl').textContent = sq.cover ? 'In cover' : 'Cover';
    b.turn.classList.toggle('warn', sq.turnPending || w.doctrine?.override?.verb === 'turn');
    b.hold.classList.toggle('on', !!sq.followersHold);
    b.hold.querySelector('.lbl').textContent = sq.followersHold ? 'Follow' : 'Hold';
    for (const k of Object.values(this.kitButtons)) {
      const n = w.kit[k.kit];
      if (n === k.last) continue;
      k.last = n;
      k.n.textContent = n;
      k.el.classList.toggle('empty', n <= 0);
    }
    this.updateOrders();

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
    const ship = w.shipName ? `<small class="ship">${w.shipName} · THREAT ${w.level.threat}</small><br>` : '';
    const objText = ship + (w.uplink ? 'OBJECTIVE:<br>UPLOAD NAV-LOCK.<br>HOLD THE COMMAND DECK.' : `OBJECTIVE:<br>REACH THE COMMAND DECK.<br>${dist}M TO GO.`);
    if (this.objKey !== objText) { this.objEl.querySelector('.obj').innerHTML = objText; this.objKey = objText; }
    const up = this.objEl.querySelector('#uplink');
    up.style.display = w.uplink ? 'block' : 'none';
    if (w.uplink && sq.action?.type === 'uplink') up.firstChild.style.width = `${(sq.action.t / sq.action.dur) * 100}%`;
    const life = w.lifesigns();
    const found = w.survivors.filter((s) => s.identified || !s.alive);
    const civ = w.survivors.length && found.length ? ` · CIVILIANS: <b>${w.survivors.filter((s) => s.state === 'rescued').length}/${w.survivors.length} SAFE</b>` : '';
    // Standing orders (read-only: set in the briefing) and what the squad is doing about them.
    // The orders themselves are on the orders bar; here, what the squad is doing about them.
    const d = w.doctrine?.cfg;
    const route = w.lead ? (you?.down ? '<b class="await">YOU ARE DOWN</b> · ' : sq.followersHold ? '<b class="await">FOLLOWERS HOLDING</b> · ' : `${Math.max(0, sq.order.length - 1)} ON YOU · `)
      : isManual(d) ? (sq.state === 'hold' && !w.doctrine.override ? '<b class="await">AWAITING ORDERS</b> · ' : 'MOVING ON YOUR ORDER · ') : '';
    const energy = `ENERGY <i class="energy ${w.energy < ENERGY.MAX * 0.25 ? 'low' : ''}" title="High alert burns it; kills, vermin, food and drinks refill it"><b style="width:${(w.energy / ENERGY.MAX) * 100}%"></b></i>`;
    const mor = w.morale.level.name;
    const status = `${route}${sq.pace === 'run' && sq.leader?.moving ? 'RUNNING · ' : ''}${energy} · MORALE <b class="morale ${mor}" title="Kills and comrades back on their feet lift it; men lost and screams in the dark wear it down">${mor.toUpperCase()}</b> · ${w.stims} STIMS · ${w.kit.charges} CHARGES${w.kit.keycards ? ' · KEYCARD' : ''}${w.sentries.some((s) => s.ammo > 0) ? ' · SENTRY' : ''}`;
    this.objEl.querySelector('.roe').innerHTML = `${civ ? `${civ.slice(3)} · ` : ''}LIFESIGNS: <b class="${life ? 'chaotic' : ''}">${life || 'CLEAR'}</b> · STATE: <b class="${roe}">${roe === 'alert' ? 'HIGH ALERT' : roe.toUpperCase()}</b><br><span class="orders">${status}</span>`;

    // Keep barks attached to their speakers; stack any that would overlap.
    const placed = [];
    for (const el of this.barksEl.children) {
      const m = el._marine;
      if (!m) continue;
      const p = this.view.toScreen(m.x, m.y + 2.6, m.z);
      const w = el.offsetWidth || 160;
      let y = p.y;
      while (placed.some((q) => Math.abs(q.x - p.x) < (q.w + w) / 2 + 6 && Math.abs(q.y - y) < 22)) y -= 24;
      placed.push({ x: p.x, y, w });
      el.style.left = `${p.x}px`;
      el.style.top = `${y}px`;
    }
    this.minimap.update(dt);
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
    this.menuEl.style.left = `${el.offsetLeft + el.offsetWidth / 2}px`;
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
      <div class="keys">
        <kbd>C</kbd><span>cover: stop and crouch</span><kbd>T</kbd><span>turn back</span>
        <kbd>Q E D</kbd><span>grenade, flare, defend</span><kbd>K</kbd><span>kit: use it or save it</span>
        <kbd>R F G</kbd><span>route, fire discipline, pace</span><kbd>L H V</kbd><span>loot, stims, flashlights</span>
        <kbd>1-3</kbd><span>choose at an encounter</span><kbd>Space</kbd><span>pause</span>
        <kbd>P</kbd><span>pixel mode on/off</span><kbd>+ −</kbd><span>zoom (or wheel)</span>
      </div>
      <div class="keys pad"><b>Lead mode</b><span>pick it in the briefing: you walk one marine with a controller, up to three follow you</span>
        <kbd>L stick</kbd><span>walk, run; up / down at a ladder</span><kbd>R stick · RT</kbd><span>aim, fire</span>
        <kbd>A · B</kbd><span>use · followers hold / follow</span><kbd>LT · RB</kbd><span>cover · reload</span>
        <kbd>X Y LB</kbd><span>grenade, flare, defend</span><kbd>D-pad</kbd><span>followers' orders; an encounter's options</span>
        <kbd>keys</kbd><span>WASD walk · mouse aims · click fires · Shift cover · E use · R reload · T hold</span>
      </div>
      <div class="menu">
        ${hasCampaign ? '<button id="continue">CONTINUE CAMPAIGN</button>' : ''}
        <button id="newcamp" class="${hasCampaign ? 'alt' : ''}">NEW CAMPAIGN</button>
      </div>
      <div class="row"><input id="seed" value="${seed}" maxlength="10" aria-label="Ship seed" /><button id="deploy" class="alt">QUICK PLAY</button></div>
    </div>`;
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
