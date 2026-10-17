// Stat display shared by the Command, Briefing and Debrief screens: eight mini bars (1-10),
// a tick where learning by doing tops out (core + STATS.CEILING), the archetype chip.
import { MELEE, STATS } from '../core/config.js';
import { ARCHETYPES } from '../meta/candidates.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Eight labelled bars. `gains` ({key: +n}) highlights stats that just grew. */
export function statBars(t, { gains = null } = {}) {
  return `<div class="sb">${STATS.KEYS.map((k) => {
    const v = t.stats?.[k] ?? STATS.BASE;
    const cap = Math.min(STATS.MAX, (t.core?.[k] ?? v) + STATS.CEILING);
    const up = gains?.[k] ? ' up' : '';
    const prog = v < cap ? (t.progress?.[k] ?? 0) : 0; // practice banked toward the next point
    return `<div class="s${up}" title="${esc(STATS.LABEL[k])} ${v}/10${prog ? ` (+${Math.round(prog * 100)}% to ${v + 1})` : ''} - ${esc(STATS.TEXT[k])}"><span>${STATS.SHORT[k]}</span>`
      + `<i><b style="width:${v * 10}%"></b>${prog ? `<s style="left:${v * 10}%;width:${prog * 10}%"></s>` : ''}<u style="left:${cap * 10}%"></u></i><em>${v}${gains?.[k] ? `<sup>+${gains[k]}</sup>` : ''}</em></div>`;
  }).join('')}</div>`;
}

/** A power sword carried as well as the gun (config MELEE): ' + Power sword'. */
export const meleeSuffix = (t) => (t.loadout?.melee && MELEE[t.loadout.melee] ? ` + ${MELEE[t.loadout.melee].label}` : '');

export function archetypeChip(t) {
  const a = ARCHETYPES[t.archetype];
  return a ? `<i class="arch" title="${esc(a.text)}">${esc(a.label)}</i>` : '';
}
