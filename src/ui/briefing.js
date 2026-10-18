// Briefing (before every run, campaign and quick play): read the ship intel, choose how to
// command - SQUAD: pick the four who go and their order (slot 1 walks point, slot 4 is the rear
// guard) and set the standing orders they run themselves by; LEAD: pick the marine you'll walk
// yourself with a controller and up to three who follow you, and the orders they keep - then
// the difficulty. This screen is where a squad mission is won or lost.
import { STATS } from '../core/config.js';
import { DIFFICULTY, fitDifficulty } from '../meta/difficulty.js';
import { tierOf } from '../meta/ranks.js';
import { MODIFIERS } from '../meta/ships.js';
import { HULL_CLASSES } from '../gen/classes.js';
import { KNOBS, LEAD_KNOBS, PRESETS, disabledOptions, fitOrders, isManual } from '../sim/doctrine.js';
import { RARITY } from '../sim/loot.js';
import { portrait } from './icons.js';
import { archetypeChip, meleeSuffix, statBars } from './statbars.js';

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SLOTS = ['POINT', '#2', '#3', 'REAR'];
const LEAD_SLOTS = ['YOU', '#2', '#3', '#4'];
// How to command the mission (sim/world.js control).
const COMMAND = {
  squad: { label: 'SQUAD', text: 'The four run themselves by your standing orders; you point and click.' },
  lead: { label: 'LEAD', text: 'You walk one marine with a controller (or keys and mouse); up to three follow you.' },
};
const CONTROLS = [
  ['L stick', 'walk, run (push it all the way) · up or down at a ladder or stairwell'],
  ['R stick', 'aim (a hostile near your line draws the fire)'],
  ['RT', 'fire'], ['LT', 'cover: everyone crouches'],
  ['A', 'use: a crate, terminal, door, the console, a man down'],
  ['B', 'followers hold where they are / fall in again'],
  ['X · Y · LB', 'grenade, flare, defend'], ['RB', 'reload'],
  ['D-pad', 'the followers\' orders · an encounter\'s options (A picks)'],
  ['Start', 'pause'],
  ['Keyboard', 'WASD walk · mouse aims · click fires · Shift cover · E use · R reload · T hold · Q F G kit'],
];
// What a ship modifier asks of the squad.
const HINTS = {
  infested: ['acc', 'nrv'], blackout: ['per'], treasure: ['int', 'lck'], armory: ['lck'],
  refugees: ['spd', 'nrv'], hive: ['per', 'nrv'], restless: ['per', 'sta'], volatile: ['acc'],
};

export class BriefingScreen {
  /**
   * @param {object} o
   *   heading, ship {name, size, threat, reward, modifiers}, pool (troopers), selected (ids, in
   *   order), doctrine, difficulty, control ('squad' | 'lead'), portraits (Map id -> url),
   *   onDeploy(ids, doctrine, difficulty, control), onBack(), backLabel,
   *   onReroll() -> { pool, portraits } (quick play: a fresh set of troopers)
   */
  constructor(root, o) {
    this.o = o;
    this.selected = [...(o.selected ?? [])].filter((id) => o.pool.some((t) => t.id === id)).slice(0, 4);
    this.doctrine = fitOrders({ ...o.doctrine });
    this.preset = presetOf(this.doctrine);
    this.difficulty = fitDifficulty(o.difficulty);
    this.control = o.control === 'lead' ? 'lead' : 'squad';
    this.el = root.appendChild(h('<div class="command briefing"></div>'));
    this.render();
  }

  get lead() { return this.control === 'lead'; }
  get max() { return Math.min(4, this.o.pool.length); }
  /** How many must be picked: the four (squad), or just yourself (lead). */
  get need() { return this.lead ? 1 : this.max; }

  render() {
    const o = this.o;
    const lead = this.lead;
    const slots = lead ? LEAD_SLOTS : SLOTS;
    const chosen = this.selected.map((id) => o.pool.find((t) => t.id === id));
    const card = (t) => {
      const slot = this.selected.indexOf(t.id);
      const img = o.portraits?.get(t.id);
      const w = t.weaponItem;
      const rank = tierOf(t.rank); // (meta/ranks.js: the card in his rank's colour)
      return `<div class="rt pick ranked ${slot >= 0 ? 'in' : ''}" data-id="${t.id}" style="--rank:${rank.color}">
        <div class="pf">${img ? `<img src="${img}" alt="">` : portrait(t.tint, 0)}${slot >= 0 ? `<div class="slot ${slot === 0 && lead ? 'you' : ''}">${slots[slot]}</div>` : ''}</div>
        <div class="rtb">
          <div class="nm">${esc(rank.abbr)} ${esc(t.name)} ${archetypeChip(t)}<i class="rank-tag">${esc(rank.name)}</i></div>
          <div class="wp" style="color:${RARITY[w.rarity].color}">${esc(w.name + meleeSuffix(t))}</div>
          ${statBars(t)}
        </div>
      </div>`;
    };
    const lineup = slots.map((label, i) => {
      const t = chosen[i];
      return `<div class="ln ${t ? '' : 'empty'}"><b>${label}</b><span>${t ? esc(t.name) : '—'}</span>
        ${t ? `<button data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">▲</button><button data-down="${i}" ${i === chosen.length - 1 ? 'disabled' : ''} title="Move down">▼</button>` : ''}</div>`;
    }).join('');
    const ship = o.ship;
    const hintKeys = new Set([...(ship?.modifiers ?? []).flatMap((k) => HINTS[k] ?? []), ...(HULL_CLASSES[ship?.cls]?.hints ?? [])]);
    // Quick play: the hull is the player's to pick (or the seed's to roll).
    const hulls = o.onHull ? `<div class="hulls"><button data-hull="" class="${!o.hull ? 'on' : ''}" title="Whatever the seed makes of it">AUTO</button>${Object.entries(HULL_CLASSES).map(([k, c]) => `<button data-hull="${k}" class="${o.hull === k ? 'on' : ''}" title="${esc(c.blurb)}">${esc(c.label)}</button>`).join('')}</div>` : '';
    const intel = ship ? `<div class="intel">
        <div class="sn">${esc(ship.name)}</div>
        <div class="sz">${esc(ship.size ?? '')} · threat ${ship.threat ?? 0}${ship.reward ? ` · pay ×${ship.reward}` : ''}</div>
        ${ship.blurb ? `<div class="bl">${esc(ship.blurb)}</div>` : ''}
        <div class="mods">${(ship.modifiers ?? []).map((k) => `<span title="${esc(MODIFIERS[k].text)}">${MODIFIERS[k].label}</span>`).join('') || '<span class="plain">No known anomalies</span>'}</div>
        ${hintKeys.size ? `<div class="hint">Matters here: ${[...hintKeys].map((k) => `<b>${STATS.LABEL[k]}</b>`).join(', ')}</div>` : ''}
      </div>` : '';
    // Manual is point and click: the route is the player's, and some orders can't apply.
    // Lead: the route, the pace and the looting are the player's own legs and hands.
    const off = disabledOptions(this.doctrine);
    const manual = isManual(this.doctrine);
    const knobs = Object.entries(KNOBS).filter(([k]) => !lead || LEAD_KNOBS.includes(k)).map(([k, knob]) => {
      const opts = Object.entries(knob.options).filter(([v]) => v !== 'manual');
      const allOff = opts.every(([v]) => off[k]?.includes(v));
      return `<div class="knob ${allOff ? 'off' : ''}"><span>${knob.label}</span><div class="seg">${
        opts.map(([v, label]) => {
          const dis = off[k]?.includes(v);
          return `<button data-knob="${k}" data-v="${v}" class="${this.doctrine[k] === v && !dis ? 'on' : ''}" ${dis ? 'disabled' : ''} title="${esc(dis ? 'Not with Manual orders' : label)}">${esc(label.split(' - ')[0].split(' (')[0])}</button>`;
        }).join('')}</div></div>`;
    }).join('');
    const diff = Object.entries(DIFFICULTY).map(([k, knob]) => `<div class="knob"><span>${knob.label}</span><div class="seg">${
      Object.entries(knob.options).map(([v, label]) => `<button data-diff="${k}" data-v="${v}" class="${this.difficulty[k] === v ? 'on' : ''}">${esc(label)}</button>`).join('')}</div></div>`).join('');
    // (Manual needs no explaining: the squad goes where you click.)
    const ptext = manual ? '' : this.preset
      ? `${esc(PRESETS[this.preset].text)}${same(PRESETS[this.preset].doctrine, this.doctrine) ? '' : ' · orders adjusted'}`
      : 'Custom orders - the squad runs itself.';
    const presets = Object.entries(PRESETS).map(([k, p]) => `<button data-preset="${k}" class="${this.preset === k ? 'on' : ''}" title="${esc(p.text)}">${esc(p.label)}</button>`).join('');
    const command = Object.entries(COMMAND).map(([k, c]) => `<button data-control="${k}" class="${this.control === k ? 'on' : ''}"><b>${c.label}</b><small>${esc(c.text)}</small></button>`).join('');
    const controls = `<div class="controls">${CONTROLS.map(([k, t]) => `<div><kbd>${esc(k)}</kbd><span>${esc(t)}</span></div>`).join('')}</div>`;
    const ready = chosen.length >= this.need;
    const deployText = ready ? 'DEPLOY ▶' : lead ? 'PICK YOUR MARINE' : `PICK ${this.need - chosen.length} MORE`;

    this.el.innerHTML = `<div class="cmd panel">
      <div class="top"><h1>${esc(o.heading ?? 'BRIEFING')}</h1><div class="stats">${chosen.length}/${this.max} SELECTED · ${COMMAND[this.control].label}</div>
        <button class="quit">${esc(o.backLabel ?? 'BACK')}</button></div>
      <div class="cols">
        <div class="col">
          <h2>COMMAND <small>how you run this one</small></h2>
          <div class="cmdchoice">${command}</div>
          <h2>TROOPERS <small>${lead ? 'click to add or remove · the first you pick is you, up to three more follow' : 'click to add or remove · order = who walks point'}</small></h2>
          <div class="roster">${o.pool.map(card).join('')}</div>
          ${o.onReroll ? '<button class="reroll" title="A fresh set of troopers to choose from">⟳ RANDOMIZE TROOPERS</button>' : ''}
          <h2>DIFFICULTY</h2>
          <div class="knobs diff">${diff}</div>
        </div>
        <div class="col">
          ${intel ? `<h2>INTEL${o.onHull ? ' <small>the hull: auto rolls it from the seed</small>' : ''}</h2>${hulls}${intel}` : ''}
          <h2>LINE-UP${lead ? ' <small>you, then who follows in what order</small>' : ''}</h2>
          <div class="lineup">${lineup}</div>
          ${this.summary(chosen)}
          ${lead ? `<h2>FOLLOWERS' ORDERS <small>they handle the rest themselves</small></h2>
          <div class="knobs">${knobs}</div>
          <h2>CONTROLS</h2>
          ${controls}` : `<h2>STANDING ORDERS</h2>
          <div class="presets">${presets}</div>
          ${ptext ? `<p class="ptext">${ptext}</p>` : ''}
          <div class="knobs">${knobs}</div>`}
          <button class="deploy" ${ready ? '' : 'disabled'}>${deployText}</button>
        </div>
      </div>
    </div>`;

    this.el.querySelectorAll('.pick').forEach((el) => el.addEventListener('click', () => this.toggle(el.dataset.id)));
    this.el.querySelectorAll('[data-control]').forEach((el) => el.addEventListener('click', () => { this.control = el.dataset.control; this.render(); }));
    this.el.querySelectorAll('[data-hull]').forEach((el) => el.addEventListener('click', () => this.o.onHull?.(el.dataset.hull || null)));
    this.el.querySelectorAll('[data-up]').forEach((el) => el.addEventListener('click', () => this.move(+el.dataset.up, -1)));
    this.el.querySelectorAll('[data-down]').forEach((el) => el.addEventListener('click', () => this.move(+el.dataset.down, 1)));
    this.el.querySelectorAll('[data-preset]').forEach((el) => el.addEventListener('click', () => {
      this.preset = el.dataset.preset;
      this.doctrine = { ...PRESETS[this.preset].doctrine };
      this.render();
    }));
    this.el.querySelectorAll('[data-knob]').forEach((el) => el.addEventListener('click', () => {
      if (el.disabled) return;
      this.doctrine = fitOrders({ ...this.doctrine, [el.dataset.knob]: el.dataset.v });
      this.preset = presetOf(this.doctrine);
      this.render();
    }));
    this.el.querySelectorAll('[data-diff]').forEach((el) => el.addEventListener('click', () => {
      this.difficulty = { ...this.difficulty, [el.dataset.diff]: el.dataset.v };
      this.render();
    }));
    this.el.querySelector('.reroll')?.addEventListener('click', () => this.reroll());
    this.el.querySelector('.deploy').addEventListener('click', () => { if (this.selected.length >= this.need) this.o.onDeploy([...this.selected], { ...this.doctrine }, { ...this.difficulty }, this.control); });
    this.el.querySelector('.quit').addEventListener('click', () => this.o.onBack?.());
  }

  /** Who does what once they're aboard: the stats that decide it, made visible. */
  summary(chosen) {
    if (!chosen.length) return '';
    const best = (k) => chosen.reduce((a, b) => ((b.stats[k] > a.stats[k]) ? b : a));
    const worst = (k) => chosen.reduce((a, b) => ((b.stats[k] < a.stats[k]) ? b : a));
    const tech = best('int');
    const eyes = best('per');
    const slow = worst('spd');
    const breath = worst('sta');
    const you = chosen[0];
    const rows = this.lead ? [
      ['You', `${you.name} · ${you.weaponItem.name}`, `SPD ${you.stats.spd} is your pace, STA ${you.stats.sta} your breath, ACC ${you.stats.acc} your aim`],
      ['Tech & medic', `${tech.name} · INT ${tech.stats.int}`, tech === you ? 'you: searches, the uplink, stims' : 'searches, the uplink, gets you up'],
      ['Sharpest eyes', `${eyes.name} · PER ${eyes.stats.per}`, 'spots them first'],
    ] : [
      ['Tech & medic', `${tech.name} · INT ${tech.stats.int}`, 'searches, the uplink, stims'],
      ['Sharpest eyes', `${eyes.name} · PER ${eyes.stats.per}`, chosen[0] === eyes ? 'walking point - good' : 'best on point'],
      ['Sets the pace', `${slow.name} · SPD ${slow.stats.spd}`, 'the squad walks at its slowest'],
      ['First winded', `${breath.name} · STA ${breath.stats.sta}`, 'the squad runs while everyone can'],
    ];
    const avg = (k) => (chosen.reduce((s, t) => s + t.stats[k], 0) / chosen.length).toFixed(1);
    return `<div class="sum">${rows.map(([a, b, c]) => `<div><span>${a}</span><b>${esc(b)}</b><small>${c}</small></div>`).join('')}</div>
      <div class="avg">${STATS.KEYS.map((k) => `<span title="${STATS.LABEL[k]} (squad average)">${STATS.SHORT[k]} <b>${avg(k)}</b></span>`).join('')}</div>`;
  }

  /** A fresh set of troopers to choose from (quick play); the first four step up. */
  reroll() {
    const { pool, portraits } = this.o.onReroll();
    this.o.pool = pool;
    this.o.portraits = portraits;
    this.selected = pool.slice(0, this.need).map((t) => t.id);
    this.render();
  }

  toggle(id) {
    const i = this.selected.indexOf(id);
    if (i >= 0) this.selected.splice(i, 1);
    else if (this.selected.length < 4) this.selected.push(id);
    this.render();
  }

  move(i, d) {
    const j = i + d;
    if (j < 0 || j >= this.selected.length) return;
    [this.selected[i], this.selected[j]] = [this.selected[j], this.selected[i]];
    this.render();
  }

  dispose() { this.el.remove(); }
}

const same = (a, b) => Object.keys(KNOBS).every((k) => a[k] === b[k]);
/** Manual whenever the route is the player's; otherwise the autonomous preset it matches (or custom). */
const presetOf = (d) => (isManual(d) ? 'standard' : Object.keys(PRESETS).find((k) => same(PRESETS[k].doctrine, d)) ?? null);
