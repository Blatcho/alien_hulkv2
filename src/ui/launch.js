// The launch screen: one screen before every run, campaign and quick play alike, with one
// DEPLOY. Top to bottom: the derelict (the campaign's three offers, or quick play's hull
// picker), the troopers (compact cards: click to pick, the order of picking is the line, drag
// a card or click its slot badge to move it up), and beside them the contract card, who does
// what, how you command (SQUAD: they run themselves by your orders, you point and click; LEAD:
// you walk one marine, the others follow), and the run's settings folded into one line of
// chips (orders and difficulty, remembered) that unfolds on CHANGE. In the campaign a KESTREL
// tab holds the shopping (ui/kestrel.js): roster, recruits, armoury, upgrades, memorial.
import { STATS } from '../core/config.js';
import { HULL_CLASSES } from '../gen/classes.js';
import { DIFFICULTY, fitDifficulty } from '../meta/difficulty.js';
import { buyUpgrade, deployable, equipFromStash, levelFor, rankFor, recruit, recruitOffers, saveProfile } from '../meta/profile.js';
import { MODIFIERS } from '../meta/ships.js';
import { portraitMap } from '../render/portraits.js';
import { KNOBS, LEAD_KNOBS, PRESETS, disabledOptions, fitOrders, isManual } from '../sim/doctrine.js';
import { esc, rolesHtml, trooperCard } from './cards.js';
import { helpButton } from './help.js';
import { bindKestrel, kestrelHtml } from './kestrel.js';
import { allDefault, presetOf, sameOrders, settingsChips } from './settings.js';

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const SLOTS = ['POINT', '#2', '#3', 'REAR'];
const LEAD_SLOTS = ['YOU', '#2', '#3', '#4'];
const BARS_KEY = 'hullbreach.cardbars';
// How to command the mission (sim/world.js control).
const COMMAND = {
  squad: { label: 'SQUAD', text: 'The four run themselves by your standing orders; you point and click.' },
  lead: { label: 'LEAD', text: 'You walk one marine with a controller (or keys and mouse); up to three follow you.' },
};
// What a ship modifier asks of the squad.
const HINTS = {
  infested: ['acc', 'nrv'], blackout: ['per'], treasure: ['int', 'lck'], armory: ['lck'],
  refugees: ['spd', 'nrv'], hive: ['per', 'nrv'], restless: ['per', 'sta'], volatile: ['acc'],
};
/** The contract's pay (meta/profile.js applyRun): the base, the threat bonus and the ship's multiplier. */
export const contractPay = (threat, reward = 1) => Math.round((250 + 120 * (threat ?? 0)) * (reward ?? 1));

export class LaunchScreen {
  /**
   * @param {object} o
   *   Campaign: profile, assets, offers (meta/ships.js shipOffers), onDeploy(offer, ids, doctrine, difficulty, control).
   *   Quick play: heading, ship {name, size, cls, blurb, story, threat, modifiers}, pool, portraits (Map id -> url),
   *   hull, onHull(cls), onReroll() -> {pool, portraits}, onDeploy(null, ids, doctrine, difficulty, control).
   *   Both: selected (ids, in order), doctrine, difficulty, control, onBack(), backLabel.
   */
  constructor(root, o) {
    this.o = o;
    this.root = root;
    this.profile = o.profile ?? null;
    this.campaign = !!this.profile;
    this.offers = o.offers ?? null;
    this.pick = 0;
    this.portraits = o.portraits ?? new Map();
    this.pool = this.campaign ? this.rosterPool() : o.pool;
    if (this.campaign) this.renderPortraits();
    const want = o.selected ?? (this.campaign ? deployable(this.profile).map((t) => t.id) : []);
    this.selected = [...want].filter((id) => this.pool.some((t) => t.id === id)).slice(0, 4);
    this.doctrine = fitOrders({ ...(o.doctrine ?? PRESETS.standard.doctrine) });
    this.preset = presetOf(this.doctrine);
    this.difficulty = fitDifficulty(o.difficulty);
    this.control = o.control === 'lead' ? 'lead' : 'squad';
    this.tab = 'launch';
    this.settingsOpen = false;
    this.bars = (() => { try { return localStorage.getItem(BARS_KEY) === 'on'; } catch { return false; } })();
    this.armed = null;
    this.offersOpen = false;
    this.recruitPool = [];
    this.el = root.appendChild(h('<div class="command launch briefing"></div>'));
    this.render();
  }

  get lead() { return this.control === 'lead'; }
  get max() { return Math.min(4, this.pool.length); }
  /** How many must be picked: the four (squad), or just yourself (lead). */
  get need() { return this.lead ? 1 : this.max; }
  /** The derelict this launch is for. */
  get ship() { return this.campaign ? this.offers[this.pick] : this.o.ship; }

  rosterPool() { return this.profile.roster.filter((t) => t.alive).map((t) => ({ ...t, rank: rankFor(levelFor(t.xp)) })); }

  /** Portraits from the 3D model via a throwaway renderer (same look as in-game). */
  renderPortraits() {
    const missing = [...this.profile.roster, ...(this.offersOpen ? this.recruitPool : [])].filter((t) => !this.portraits.has(t.id));
    if (!missing.length || !this.o.assets) return;
    for (const [id, url] of portraitMap(this.o.assets, missing)) this.portraits.set(id, url);
  }

  save() { if (this.profile) saveProfile(this.profile); }

  // ------------------------------------------------------------------ pieces

  offersHtml() {
    return `<h2>CHOOSE DERELICT <small>three on offer; the one you take decides the next three</small></h2>
      <div class="offers">${this.offers.map((o, i) => `<button class="ship ${this.pick === i ? 'on' : ''}" data-ship="${i}">
        <div class="sn">${esc(o.name)}</div>
        <div class="sz">${esc(o.size)} · threat ${o.threat} · <b>${esc(o.story?.title ?? '')}</b></div>
        <div class="mods">${o.modifiers.map((k) => `<span title="${esc(MODIFIERS[k].text)}">${MODIFIERS[k].label}</span>`).join('') || '<span class="plain">No known anomalies</span>'}</div>
        <div class="risk">DANGER ${'▮'.repeat(1 + o.danger)}${'▯'.repeat(Math.max(0, 4 - o.danger))} · PAY <b>${contractPay(o.threat, o.reward)} cr</b> (×${o.reward})</div>
      </button>`).join('')}</div>`;
  }

  /** The contract card: the ship, its story, anomalies, what matters, the objective, the pay. */
  contractHtml() {
    const ship = this.ship;
    if (!ship) return '';
    const o = this.o;
    const hintKeys = new Set([...(ship.modifiers ?? []).flatMap((k) => HINTS[k] ?? []), ...(HULL_CLASSES[ship.cls]?.hints ?? [])]);
    const hulls = o.onHull ? `<div class="hulls"><button data-hull="" class="${!o.hull ? 'on' : ''}" title="Whatever the seed makes of it">AUTO</button>${Object.entries(HULL_CLASSES).map(([k, c]) => `<button data-hull="${k}" class="${o.hull === k ? 'on' : ''}" title="${esc(c.blurb)}">${esc(c.label)}</button>`).join('')}</div>` : '';
    const pay = this.campaign ? `<div class="pay">PAY <b>${contractPay(ship.threat, ship.reward)} cr</b> on extraction · danger ${'▮'.repeat(1 + (ship.danger ?? 0))}${'▯'.repeat(Math.max(0, 4 - (ship.danger ?? 0)))}</div>` : '';
    return `<h2>CONTRACT${o.onHull ? ' <small>the hull: auto rolls it from the seed</small>' : ''}</h2>${hulls}<div class="intel">
      <div class="sn">${esc(ship.name)}</div>
      <div class="sz">${esc(ship.size ?? '')} · threat ${ship.threat ?? 0}</div>
      ${ship.blurb ? `<div class="bl">${esc(ship.blurb)}</div>` : ''}
      ${ship.story ? `<div class="story"><b>${esc(ship.story.title)}.</b> ${esc(ship.story.blurb)}</div>` : ''}
      <div class="mods">${(ship.modifiers ?? []).map((k) => `<span title="${esc(MODIFIERS[k].text)}">${MODIFIERS[k].label}</span>`).join('') || '<span class="plain">No known anomalies</span>'}</div>
      ${hintKeys.size ? `<div class="hint">Matters here: ${[...hintKeys].map((k) => `<b>${STATS.LABEL[k]}</b>`).join(', ')}</div>` : ''}
      <div class="obj"><span>OBJECTIVE</span> ${esc(ship.contract?.text ?? 'Reach the command deck and hold it for the nav-lock uplink.')}</div>
      ${pay}
    </div>`;
  }

  /** The line: one chip per slot (click to move up), then who does what. */
  lineHtml(chosen) {
    const slots = this.lead ? LEAD_SLOTS : SLOTS;
    const chips = slots.slice(0, this.lead ? Math.max(1, chosen.length) : this.max).map((label, i) => {
      const t = chosen[i];
      return `<button class="ln ${t ? '' : 'empty'} ${i === 0 && this.lead ? 'you' : ''}" ${t && i > 0 ? `data-up="${t.id}" title="Move up the line"` : 'disabled'}><b>${label}</b><span>${t ? esc(t.name) : '—'}</span></button>`;
    }).join('');
    return `<h2>LINE-UP <small>${this.lead ? 'you, then who follows in what order' : 'slot 1 walks point, 4 is the rear guard · click a slot or drag a card to move up'}</small></h2>
      <div class="line">${chips}</div>${rolesHtml(chosen, this.lead)}`;
  }

  settingsHtml() {
    const chips = settingsChips(this.doctrine, this.difficulty, this.control, this.preset);
    const row = `<div class="chiprow">${chips.map((c) => `<span class="schip ${c.changed ? 'changed' : ''}" title="${esc(c.title)}">${esc(c.label)} <b>${esc(c.value)}</b></span>`).join('')}
      <button class="change">${this.settingsOpen ? 'DONE' : allDefault(chips) ? 'CHANGE' : 'CHANGE'}</button></div>`;
    if (!this.settingsOpen) return `<h2>SETTINGS <small>remembered from last time</small></h2>${row}`;
    // Manual is point and click: the route is the player's, and some orders can't apply.
    // Lead: the route, the pace and the looting are the player's own legs and hands.
    const off = disabledOptions(this.doctrine);
    const manual = isManual(this.doctrine);
    const knobs = Object.entries(KNOBS).filter(([k]) => !this.lead || LEAD_KNOBS.includes(k)).map(([k, knob]) => {
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
    const ptext = manual ? '' : this.preset
      ? `${esc(PRESETS[this.preset].text)}${sameOrders(PRESETS[this.preset].doctrine, this.doctrine) ? '' : ' · orders adjusted'}`
      : 'Custom orders - the squad runs itself.';
    const presets = Object.entries(PRESETS).map(([k, p]) => `<button data-preset="${k}" class="${this.preset === k ? 'on' : ''}" title="${esc(p.text)}">${esc(p.label)}</button>`).join('');
    return `<h2>SETTINGS <small>remembered for next time</small></h2>${row}
      <div class="settings">
        ${this.lead ? '<h3>FOLLOWERS\' ORDERS <small>they handle the rest themselves</small></h3>' : `<h3>STANDING ORDERS</h3><div class="presets">${presets}</div>${ptext ? `<p class="ptext">${ptext}</p>` : ''}`}
        <div class="knobs">${knobs}</div>
        <h3>DIFFICULTY</h3>
        <div class="knobs diff">${diff}</div>
      </div>`;
  }

  // ------------------------------------------------------------------ render

  render() {
    const o = this.o;
    if (this.campaign) this.pool = this.rosterPool();
    this.selected = this.selected.filter((id) => this.pool.some((t) => t.id === id));
    const chosen = this.selected.map((id) => this.pool.find((t) => t.id === id));
    const p = this.profile;
    const stats = this.campaign
      ? `<b>${p.credits}</b> CREDITS · THREAT <b>${p.threat}</b> · ${chosen.length}/${this.max} SELECTED · ${COMMAND[this.control].label}`
      : `${chosen.length}/${this.max} SELECTED · ${COMMAND[this.control].label}`;
    const tabs = this.campaign ? `<nav class="tabs"><button data-tab="launch" class="${this.tab === 'launch' ? 'on' : ''}">LAUNCH</button><button data-tab="kestrel" class="${this.tab === 'kestrel' ? 'on' : ''}">KESTREL${this.armed !== null ? ' ·' : ''}</button></nav>` : '';
    const ready = chosen.length >= this.need;
    const deployText = ready ? 'DEPLOY ▶' : this.lead ? 'PICK YOUR MARINE' : `PICK ${this.need - chosen.length} MORE`;
    const slots = this.lead ? LEAD_SLOTS : SLOTS;
    const cards = this.pool.map((t) => trooperCard(t, { slot: this.selected.indexOf(t.id), slots, lead: this.lead, img: this.portraits.get(t.id), bars: this.bars, cls: 'pick', drag: true })).join('');
    const command = Object.entries(COMMAND).map(([k, c]) => `<button data-control="${k}" class="${this.control === k ? 'on' : ''}" title="${esc(c.text)}">${c.label}</button>`).join('');
    const launch = `${this.campaign ? this.offersHtml() : ''}
      <div class="cols">
        <div class="col">
          <h2>TROOPERS <small>${this.lead ? 'click to add or remove · the first you pick is you, up to three more follow' : 'click to add or remove · the order you pick is the line'}</small>
            <button class="barsmode" title="Chips show what stands out; bars show all eight stats">${this.bars ? 'BARS' : 'CHIPS'}</button></h2>
          <div class="roster">${cards}</div>
          ${o.onReroll ? '<button class="reroll" title="A fresh set of troopers to choose from">⟳ RANDOMIZE TROOPERS</button>' : ''}
        </div>
        <div class="col">
          ${this.contractHtml()}
          ${this.lineHtml(chosen)}
          <h2>COMMAND <small>${esc(COMMAND[this.control].text)}</small></h2>
          <div class="cmdchoice seg">${command}</div>
          ${this.settingsHtml()}
          <button class="deploy" ${ready ? '' : 'disabled'}>${deployText}</button>
        </div>
      </div>`;
    const kestrel = this.campaign && this.tab === 'kestrel' ? kestrelHtml(p, { portraits: this.portraits, armed: this.armed, offersOpen: this.offersOpen, recruitPool: this.recruitPool, bars: true }) : '';
    this.el.innerHTML = `<div class="cmd panel">
      <div class="top"><h1>${esc(o.heading ?? (this.campaign ? 'KESTREL 21 · LAUNCH' : 'BRIEFING'))}</h1><div class="stats">${stats}</div>${tabs}<span class="help-slot"></span>
        <button class="quit">${esc(o.backLabel ?? 'BACK')}</button></div>
      ${this.tab === 'kestrel' ? kestrel : launch}
    </div>`;
    this.el.querySelector('.help-slot').replaceWith(helpButton(this.el, this.control));
    this.bind(chosen);
  }

  bind(chosen) {
    const el = this.el;
    el.querySelector('.quit').addEventListener('click', () => this.o.onBack?.());
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.render(); }));
    if (this.tab === 'kestrel') { this.bindKestrel(); return; }
    el.querySelectorAll('[data-ship]').forEach((b) => b.addEventListener('click', () => { this.pick = +b.dataset.ship; this.render(); }));
    el.querySelectorAll('.rt.pick').forEach((c) => {
      c.addEventListener('click', () => this.toggle(c.dataset.id));
      c.addEventListener('dragstart', (e) => { this.dragId = c.dataset.id; e.dataTransfer?.setData('text/plain', c.dataset.id); c.classList.add('dragging'); });
      c.addEventListener('dragend', () => { c.classList.remove('dragging'); el.querySelectorAll('.rt.over').forEach((q) => q.classList.remove('over')); });
      c.addEventListener('dragover', (e) => { if (this.dragId && c.classList.contains('in') && c.dataset.id !== this.dragId) { e.preventDefault(); c.classList.add('over'); } });
      c.addEventListener('dragleave', () => c.classList.remove('over'));
      c.addEventListener('drop', (e) => { e.preventDefault(); this.swap(this.dragId, c.dataset.id); this.dragId = null; });
    });
    el.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.moveUp(b.dataset.up); }));
    el.querySelectorAll('[data-control]').forEach((b) => b.addEventListener('click', () => { this.control = b.dataset.control; this.render(); }));
    el.querySelectorAll('[data-hull]').forEach((b) => b.addEventListener('click', () => this.o.onHull?.(b.dataset.hull || null)));
    el.querySelector('.barsmode').addEventListener('click', () => { this.bars = !this.bars; try { localStorage.setItem(BARS_KEY, this.bars ? 'on' : 'off'); } catch { /* private mode */ } this.render(); });
    el.querySelector('.change').addEventListener('click', () => { this.settingsOpen = !this.settingsOpen; this.render(); });
    el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      this.preset = b.dataset.preset;
      this.doctrine = { ...PRESETS[this.preset].doctrine };
      this.render();
    }));
    el.querySelectorAll('[data-knob]').forEach((b) => b.addEventListener('click', () => {
      if (b.disabled) return;
      this.doctrine = fitOrders({ ...this.doctrine, [b.dataset.knob]: b.dataset.v });
      this.preset = presetOf(this.doctrine);
      this.render();
    }));
    el.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => { this.difficulty = { ...this.difficulty, [b.dataset.diff]: b.dataset.v }; this.render(); }));
    el.querySelector('.reroll')?.addEventListener('click', () => this.reroll());
    el.querySelector('.deploy').addEventListener('click', () => {
      if (this.selected.length < this.need) return;
      this.o.onDeploy(this.campaign ? this.offers[this.pick] : null, [...this.selected], { ...this.doctrine }, { ...this.difficulty }, this.control);
    });
    void chosen;
  }

  bindKestrel() {
    const p = this.profile;
    bindKestrel(this.el, {
      onTrooper: (id) => { if (this.armed === null) return; equipFromStash(p, id, this.armed); this.armed = null; this.save(); this.render(); },
      onStash: (i) => { this.armed = this.armed === i ? null : i; this.render(); },
      onUpgrade: (k) => { if (buyUpgrade(p, k)) { this.save(); this.render(); } },
      onRecruitToggle: () => {
        this.offersOpen = !this.offersOpen;
        if (this.offersOpen) { this.recruitPool = recruitOffers(p); this.renderPortraits(); }
        this.render();
      },
      onRecruitPick: (id) => {
        const t = recruit(p, this.recruitPool.find((q) => q.id === id));
        if (!t) return;
        this.offersOpen = false;
        this.save();
        this.renderPortraits();
        this.render();
      },
    });
  }

  // ------------------------------------------------------------------ the line

  toggle(id) {
    const i = this.selected.indexOf(id);
    if (i >= 0) this.selected.splice(i, 1);
    else if (this.selected.length < 4) this.selected.push(id);
    this.render();
  }

  moveUp(id) {
    const i = this.selected.indexOf(id);
    if (i <= 0) return;
    [this.selected[i - 1], this.selected[i]] = [this.selected[i], this.selected[i - 1]];
    this.render();
  }

  swap(a, b) {
    const i = this.selected.indexOf(a);
    const j = this.selected.indexOf(b);
    if (i < 0 || j < 0 || i === j) return;
    [this.selected[i], this.selected[j]] = [this.selected[j], this.selected[i]];
    this.render();
  }

  /** A fresh set of troopers to choose from (quick play); the first four step up. */
  reroll() {
    const { pool, portraits } = this.o.onReroll();
    this.pool = pool;
    this.portraits = portraits;
    this.selected = pool.slice(0, this.need).map((t) => t.id);
    this.render();
  }

  dispose() { this.el.remove(); }
}
