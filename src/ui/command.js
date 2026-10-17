// Command screen (between runs, aboard the Kestrel): the roster, recruits, the armoury,
// upgrades, the fallen, and the choice of derelict. DEPLOY opens the briefing (ui/briefing.js):
// who goes, in what order, under which standing orders.
import {
  UPGRADES, buyUpgrade, deployable, equipFromStash, levelFor, rankFor, recruit,
  recruitCost, recruitOffers, saveProfile, upgradeCost,
} from '../meta/profile.js';
import { tierForLevel, tierOf } from '../meta/ranks.js';
import { MODIFIERS, shipOffers } from '../meta/ships.js';
import { portraitMap } from '../render/portraits.js';
import { PRESETS } from '../sim/doctrine.js';
import { RARITY, affixText } from '../sim/loot.js';
import { BriefingScreen } from './briefing.js';
import { portrait } from './icons.js';
import { archetypeChip, meleeSuffix, statBars } from './statbars.js';

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class CommandScreen {
  constructor(root, { profile, assets, onDeploy, onQuit }) {
    this.root = root;
    this.profile = profile;
    this.assets = assets;
    this.onDeploy = onDeploy;
    this.onQuit = onQuit;
    this.offers = shipOffers(profile);
    this.pick = 0;
    this.armed = null; // stash index waiting for a trooper click
    this.portraits = new Map();
    this.el = root.appendChild(h('<div class="command"></div>'));
    this.renderPortraits();
    this.render();
  }

  /** Portraits from the 3D model via a throwaway renderer (same look as in-game). */
  renderPortraits() {
    const missing = [...this.profile.roster, ...(this.offersOpen ? this.recruitPool : [])].filter((t) => !this.portraits.has(t.id));
    for (const [id, url] of portraitMap(this.assets, missing)) this.portraits.set(id, url);
  }

  save() { saveProfile(this.profile); }

  render() {
    const p = this.profile;
    const trooper = (t) => {
      const lvl = levelFor(t.xp);
      const img = this.portraits.get(t.id);
      const w = t.weaponItem;
      const col = RARITY[w.rarity].color;
      return `<div class="rt in ranked ${this.armed !== null ? 'armable' : ''}" data-id="${t.id}" style="--rank:${tierForLevel(lvl).color}">
        <div class="pf">${img ? `<img src="${img}" alt="">` : portrait(t.tint, 0)}</div>
        <div class="rtb">
          <div class="nm">${rankFor(lvl)} ${esc(t.name)} <span class="lv">LV ${lvl}</span></div>
          <div class="wp" style="color:${col}">${esc(w.name + meleeSuffix(t))}</div>
          <div class="pk">${archetypeChip(t)}</div>
          ${statBars(t)}
          <div class="st">${t.kills} kills · ${t.runs} ops</div>
        </div>
      </div>`;
    };
    const stash = p.stash.map((it, i) => `<button class="si ${this.armed === i ? 'armed' : ''}" data-i="${i}" style="--c:${RARITY[it.rarity].color}">
      <b>${esc(it.name)}</b><small>${RARITY[it.rarity].label} · ${esc(affixText(it) || 'no mods')}</small></button>`).join('') || '<div class="empty">Nothing stashed yet. Weapons you send back to the ship end up here.</div>';
    const upgrades = Object.entries(UPGRADES).map(([k, u]) => {
      const cost = upgradeCost(p, k);
      const tier = p.upgrades[k];
      return `<div class="up"><div><b>${u.label}</b> <span class="tier">${'■'.repeat(tier)}${'□'.repeat(u.costs.length - tier)}</span><small>${u.text}</small></div>
        <button data-up="${k}" ${cost === null || p.credits < cost ? 'disabled' : ''}>${cost === null ? 'MAX' : `${cost} cr`}</button></div>`;
    }).join('');
    const ships = this.offers.map((o, i) => `<button class="ship ${this.pick === i ? 'on' : ''}" data-ship="${i}">
      <div class="sn">${esc(o.name)}</div>
      <div class="sz">${o.size} · threat ${o.threat}</div>
      <div class="mods">${o.modifiers.map((k) => `<span title="${esc(MODIFIERS[k].text)}">${MODIFIERS[k].label}</span>`).join('') || '<span class="plain">No known anomalies</span>'}</div>
      <div class="risk">DANGER ${'▮'.repeat(1 + o.danger)}${'▯'.repeat(Math.max(0, 4 - o.danger))} · PAY ×${o.reward}</div>
    </button>`).join('');
    const memorial = p.memorial.slice(-8).reverse().map((m) => `<li><span style="color:${tierOf(m.rank).color}">${m.rank} ${esc(m.name)}</span> <small>${m.kills} kills · ${m.runs} ops · threat ${m.threat}</small></li>`).join('');

    this.el.innerHTML = `<div class="cmd panel">
      <div class="top"><h1>KESTREL 21 · COMMAND</h1>
        <div class="stats"><b>${p.credits}</b> CREDITS · THREAT <b>${p.threat}</b> · ${p.wins}/${p.runs} EXTRACTIONS · ${p.totals.kills} KILLS</div>
        <button class="quit">MAIN MENU</button></div>
      <div class="cols">
        <div class="col">
          <h2>ROSTER <small>${this.armed !== null ? 'now click a trooper to equip' : 'you pick who deploys in the briefing'}</small></h2>
          <div class="roster">${p.roster.map(trooper).join('')}</div>
          <div class="row2"><button class="recruit">${this.offersOpen ? 'CLOSE' : 'RECRUIT TROOPER'} · ${p.roster.length < 4 ? 'FREE' : `${recruitCost(p)} cr`}</button></div>
          ${this.offersOpen ? `<h2>VOLUNTEERS <small>pick one to sign on</small></h2><div class="roster recruits">${this.recruitPool.map(trooper).join('')}</div>` : ''}
          <h2>ARMOURY <small>click a weapon, then a trooper</small></h2>
          <div class="stash">${stash}</div>
        </div>
        <div class="col">
          <h2>CHOOSE DERELICT</h2>
          <div class="ships">${ships}</div>
          <button class="deploy">DEPLOY ▶</button>
          <h2>UPGRADES</h2>
          <div class="ups">${upgrades}</div>
          ${memorial ? `<h2>MEMORIAL</h2><ul class="mem">${memorial}</ul>` : ''}
        </div>
      </div>
    </div>`;

    this.el.querySelectorAll('.roster:not(.recruits) .rt').forEach((el) => el.addEventListener('click', () => this.clickTrooper(el.dataset.id)));
    this.el.querySelectorAll('.recruits .rt').forEach((el) => el.addEventListener('click', () => {
      const t = recruit(p, this.recruitPool.find((q) => q.id === el.dataset.id));
      if (!t) return;
      this.offersOpen = false;
      this.save();
      this.renderPortraits();
      this.render();
    }));
    this.el.querySelectorAll('.si').forEach((el) => el.addEventListener('click', () => { this.armed = this.armed === +el.dataset.i ? null : +el.dataset.i; this.render(); }));
    this.el.querySelectorAll('[data-up]').forEach((el) => el.addEventListener('click', () => { if (buyUpgrade(p, el.dataset.up)) { this.save(); this.render(); } }));
    this.el.querySelectorAll('.ship').forEach((el) => el.addEventListener('click', () => { this.pick = +el.dataset.ship; this.render(); }));
    this.el.querySelector('.recruit').addEventListener('click', () => {
      this.offersOpen = !this.offersOpen;
      if (this.offersOpen) { this.recruitPool = recruitOffers(p); this.renderPortraits(); }
      this.render();
    });
    this.el.querySelector('.deploy').addEventListener('click', () => this.brief());
    this.el.querySelector('.quit').addEventListener('click', () => this.onQuit());
  }

  clickTrooper(id) {
    if (this.armed === null) return;
    equipFromStash(this.profile, id, this.armed);
    this.armed = null;
    this.save();
    this.render();
  }

  /** The briefing for the chosen derelict: squad, order, standing orders, difficulty. */
  brief() {
    const p = this.profile;
    const offer = this.offers[this.pick];
    this.el.hidden = true;
    const pool = p.roster.filter((t) => t.alive).map((t) => ({ ...t, rank: rankFor(levelFor(t.xp)) }));
    this.briefing = new BriefingScreen(this.root, {
      heading: 'BRIEFING', ship: offer, pool, portraits: this.portraits,
      selected: deployable(p).map((t) => t.id), doctrine: p.doctrine ?? PRESETS.standard.doctrine,
      difficulty: p.difficulty, control: p.control,
      backLabel: 'BACK TO COMMAND',
      onBack: () => { this.briefing.dispose(); this.briefing = null; this.el.hidden = false; },
      onDeploy: (ids, doctrine, difficulty, control) => {
        p.squad = ids;
        p.doctrine = doctrine;
        p.difficulty = difficulty;
        p.control = control;
        this.save();
        this.onDeploy(offer, ids, doctrine, difficulty, control);
      },
    });
  }

  dispose() { this.briefing?.dispose(); this.el.remove(); }
}
