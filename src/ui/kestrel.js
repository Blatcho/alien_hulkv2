// The Kestrel tab of the launch screen (ui/launch.js): the shopping, kept out of the way of
// launching - the whole roster with their records, recruiting, the armoury (weapons brought
// home, equipped with a click on a weapon then a trooper), the upgrades, and the memorial.
import { UPGRADES, levelFor, recruitCost, upgradeCost } from '../meta/profile.js';
import { tierForLevel, tierOf } from '../meta/ranks.js';
import { RARITY, affixText } from '../sim/loot.js';
import { esc, trooperCard } from './cards.js';
import { RELICS } from '../meta/relics.js';
import { QUIRKS, TREAT_COST } from '../meta/quirks.js';

/**
 * The tab's HTML. `s`: portraits (Map id -> url), armed (stash index waiting for a trooper, or
 * null), offersOpen, recruitPool (the volunteers while open), bars (full stat bars on the cards).
 */
export function kestrelHtml(p, s) {
  const card = (t, cls) => trooperCard(withRank(t), {
    slot: -1, img: s.portraits?.get(t.id), bars: s.bars, level: levelFor(t.xp), cls: `in ${cls} ${s.armed !== null && cls === 'crew' ? 'armable' : ''}`,
    extra: `<div class="st">${t.kills} kills · ${t.runs} ops</div>${cls === 'crew' ? treat(t) : ''}`,
  });
  // A bad quirk treated for credits (meta/quirks.js).
  const treat = (t) => (t.quirks ?? []).filter((k) => QUIRKS[k] && !QUIRKS[k].good).map((k) => `<button class="treat" data-treat="${k}" data-who="${t.id}" ${p.credits < TREAT_COST ? 'disabled' : ''} title="${esc(QUIRKS[k].text)}">TREAT ${esc(QUIRKS[k].label.toUpperCase())} · ${TREAT_COST} cr</button>`).join('');
  const relics = (p.relics ?? []).filter((k) => RELICS[k]).map((k) => `<div class="relic"><b>${esc(RELICS[k].label)}</b><small>${esc(RELICS[k].text)}</small></div>`).join('')
    || '<div class="empty">No relics yet. They turn up in locked storerooms and sealed cryo caches - and come home with the squad, as long as it keeps coming home.</div>';
  const stash = p.stash.map((it, i) => `<button class="si ${s.armed === i ? 'armed' : ''}" data-i="${i}" style="--c:${RARITY[it.rarity].color}">
    <b>${esc(it.name)}</b><small>${RARITY[it.rarity].label} · ${esc(affixText(it) || 'no mods')}</small></button>`).join('')
    || '<div class="empty">Nothing stashed yet. Weapons the squad sends back to the ship end up here.</div>';
  const upgrades = Object.entries(UPGRADES).map(([k, u]) => {
    const cost = upgradeCost(p, k);
    const tier = p.upgrades[k];
    return `<div class="up"><div><b>${u.label}</b> <span class="tier">${'■'.repeat(tier)}${'□'.repeat(u.costs.length - tier)}</span><small>${u.text}</small></div>
      <button data-up="${k}" ${cost === null || p.credits < cost ? 'disabled' : ''}>${cost === null ? 'MAX' : `${cost} cr`}</button></div>`;
  }).join('');
  const memorial = p.memorial.slice(-8).reverse().map((m) => `<li><span style="color:${tierOf(m.rank).color}">${m.rank} ${esc(m.name)}</span> <small>${m.kills} kills · ${m.runs} ops · threat ${m.threat}</small></li>`).join('');
  return `<div class="cols kestrel">
    <div class="col">
      <h2>ROSTER <small>${s.armed !== null ? 'now click a trooper to equip' : `everyone aboard the Kestrel · ${p.wins}/${p.runs} extractions · ${p.totals.kills} kills`}</small></h2>
      <div class="roster">${p.roster.map((t) => card(t, 'crew')).join('')}</div>
      <div class="row2"><button class="recruit">${s.offersOpen ? 'CLOSE' : 'RECRUIT TROOPER'} · ${p.roster.length < 4 ? 'FREE' : `${recruitCost(p)} cr`}</button></div>
      ${s.offersOpen ? `<h2>VOLUNTEERS <small>pick one to sign on</small></h2><div class="roster recruits">${(s.recruitPool ?? []).map((t) => card(t, 'volunteer')).join('')}</div>` : ''}
    </div>
    <div class="col">
      <h2>RELICS <small>every run, for as long as nobody is wiped out</small></h2>
      <div class="relics">${relics}</div>
      <h2>ARMOURY <small>click a weapon, then a trooper</small></h2>
      <div class="stash">${stash}</div>
      <h2>UPGRADES</h2>
      <div class="ups">${upgrades}</div>
      ${memorial ? `<h2>MEMORIAL</h2><ul class="mem">${memorial}</ul>` : ''}
    </div>
  </div>`;
}

/** A roster entry with the rank its level earns (the cards read t.rank). */
export const withRank = (t) => ({ ...t, rank: t.rank ?? tierForLevel(levelFor(t.xp)).abbr });

/** Wire the tab's clicks. `a`: onTrooper(id), onStash(i), onUpgrade(k), onRecruitToggle(), onRecruitPick(id), onTreat(id, key). */
export function bindKestrel(el, a) {
  el.querySelectorAll('.roster:not(.recruits) .rt').forEach((c) => c.addEventListener('click', () => a.onTrooper(c.dataset.id)));
  el.querySelectorAll('.recruits .rt').forEach((c) => c.addEventListener('click', () => a.onRecruitPick(c.dataset.id)));
  el.querySelectorAll('.si').forEach((c) => c.addEventListener('click', () => a.onStash(+c.dataset.i)));
  el.querySelectorAll('[data-up]').forEach((c) => c.addEventListener('click', () => a.onUpgrade(c.dataset.up)));
  el.querySelector('.recruit')?.addEventListener('click', () => a.onRecruitToggle());
  el.querySelectorAll('[data-treat]').forEach((c) => c.addEventListener('click', (e) => { e.stopPropagation(); a.onTreat?.(c.dataset.who, c.dataset.treat); }));
}
