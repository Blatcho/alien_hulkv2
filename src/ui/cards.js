// Trooper cards for the launch screen and the Kestrel (ui/launch.js, ui/kestrel.js): compact by
// default - rank, name, archetype, weapon and the stats that stand out as chips - with the
// eight bars (ui/statbars.js) on request. Also what a picked squad adds up to: who does what
// once aboard (squadRoles), the stats that decide it made visible.
import { STATS } from '../core/config.js';
import { tierOf } from '../meta/ranks.js';
import { RARITY } from '../sim/loot.js';
import { portrait } from './icons.js';
import { archetypeChip, meleeSuffix, statBars } from './statbars.js';
import { quirkChips } from '../meta/quirks.js';

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The stats that stand out: up to two at 7+ (the best first), and the worst if it's 4 or under. */
export function standouts(t) {
  const s = t.stats ?? {};
  const all = STATS.KEYS.map((k) => ({ k, v: s[k] ?? STATS.BASE }));
  const high = [...all].sort((a, b) => b.v - a.v || STATS.KEYS.indexOf(a.k) - STATS.KEYS.indexOf(b.k)).filter((q) => q.v >= 7).slice(0, 2);
  const lowest = [...all].sort((a, b) => a.v - b.v || STATS.KEYS.indexOf(a.k) - STATS.KEYS.indexOf(b.k))[0];
  return { high, low: lowest.v <= 4 ? lowest : null };
}

/** The chips: "PER 10", "INT 7", and a dim "SPD 4". */
export function statChips(t) {
  const { high, low } = standouts(t);
  const chip = (q, cls) => `<span class="chip ${cls}" title="${esc(STATS.LABEL[q.k])} ${q.v}/10 - ${esc(STATS.TEXT[q.k])}">${STATS.SHORT[q.k]} <b>${q.v}</b></span>`;
  return `<div class="chips">${high.map((q) => chip(q, 'hi')).join('')}${low ? chip(low, 'lo') : ''}${!high.length && !low ? '<span class="chip even">Even</span>' : ''}</div>`;
}

/**
 * One card. `o`: slot (index in the line, -1 if not picked), slots (the slot labels), lead,
 * img (portrait url), bars (full stat bars instead of chips), extra (HTML under the stats),
 * cls (extra classes), gains (stats that just grew, for the debrief).
 */
export function trooperCard(t, o = {}) {
  const slot = o.slot ?? -1;
  const rank = tierOf(t.rank);
  const w = t.weaponItem;
  const slots = o.slots ?? ['POINT', '#2', '#3', 'REAR'];
  const badge = slot >= 0 ? `<div class="slot ${slot === 0 && o.lead ? 'you' : ''}" data-up="${t.id}" title="${slot > 0 ? 'Move up the line' : o.lead ? 'You' : 'Walks point'}">${slots[slot]}</div>` : '';
  return `<div class="rt ranked ${o.cls ?? ''} ${slot >= 0 ? 'in' : ''}" data-id="${t.id}" draggable="${slot >= 0 && o.drag ? 'true' : 'false'}" style="--rank:${rank.color}">
    <div class="pf">${o.img ? `<img src="${o.img}" alt="">` : portrait(t.tint, 0)}${badge}</div>
    <div class="rtb">
      <div class="nm">${esc(rank.abbr)} ${esc(t.name)} ${archetypeChip(t)}${o.level ? `<span class="lv">LV ${o.level}</span>` : `<i class="rank-tag">${esc(rank.name)}</i>`}</div>
      ${w ? `<div class="wp" style="color:${RARITY[w.rarity]?.color ?? 'inherit'}">${esc(w.name + meleeSuffix(t))}</div>` : ''}
      ${o.bars ? statBars(t, { gains: o.gains ?? null }) : statChips(t)}
      ${traitChips(t)}
      ${o.extra ?? ''}
    </div>
  </div>`;
}

/** A wound he's resting, and the quirks he carries (meta/quirks.js). */
export function traitChips(t) {
  const quirks = quirkChips(t).map((q) => `<span class="chip quirk ${q.good ? 'good' : 'bad'}" title="${esc(q.text)}">${esc(q.label)}</span>`).join('');
  const wound = t.rest > 0 && t.wound ? `<span class="chip wound" title="Resting a wound: sits this run out (a Kestrel medbay heals them on the way home)">${t.wound === 'leg' ? 'LEG WOUND' : 'ARM WOUND'} · RESTING</span>` : '';
  return quirks || wound ? `<div class="chips traits">${wound}${quirks}</div>` : '';
}

/**
 * Who does what once they're aboard, from the picked four (in line order): rows of
 * [label, who, note], and the squad's average of each stat.
 */
export function squadRoles(chosen, lead = false) {
  if (!chosen.length) return { rows: [], avg: {} };
  const best = (k) => chosen.reduce((a, b) => ((b.stats[k] > a.stats[k]) ? b : a));
  const worst = (k) => chosen.reduce((a, b) => ((b.stats[k] < a.stats[k]) ? b : a));
  const tech = best('int');
  const eyes = best('per');
  const slow = worst('spd');
  const breath = worst('sta');
  const you = chosen[0];
  const rows = lead ? [
    ['You', `${you.name} · ${you.weaponItem?.name ?? ''}`, `SPD ${you.stats.spd} is your pace, STA ${you.stats.sta} your breath, ACC ${you.stats.acc} your aim`],
    ['Tech & medic', `${tech.name} · INT ${tech.stats.int}`, tech === you ? 'you: searches, the uplink, stims' : 'searches, the uplink, gets you up'],
    ['Sharpest eyes', `${eyes.name} · PER ${eyes.stats.per}`, 'spots them first'],
  ] : [
    ['Tech & medic', `${tech.name} · INT ${tech.stats.int}`, 'searches, the uplink, stims'],
    ['Sharpest eyes', `${eyes.name} · PER ${eyes.stats.per}`, chosen[0] === eyes ? 'walking point - good' : 'best on point'],
    ['Sets the pace', `${slow.name} · SPD ${slow.stats.spd}`, 'the squad walks at its slowest'],
    ['First winded', `${breath.name} · STA ${breath.stats.sta}`, 'the squad runs while everyone can'],
  ];
  const avg = {};
  for (const k of STATS.KEYS) avg[k] = +(chosen.reduce((s, t) => s + t.stats[k], 0) / chosen.length).toFixed(1);
  return { rows, avg };
}

/** The roles and averages as HTML (launch screen). */
export function rolesHtml(chosen, lead = false) {
  const { rows, avg } = squadRoles(chosen, lead);
  if (!rows.length) return '';
  return `<div class="sum">${rows.map(([a, b, c]) => `<div><span>${a}</span><b>${esc(b)}</b><small>${c}</small></div>`).join('')}</div>
    <div class="avg">${STATS.KEYS.map((k) => `<span title="${STATS.LABEL[k]} (squad average)">${STATS.SHORT[k]} <b>${avg[k]}</b></span>`).join('')}</div>`;
}
