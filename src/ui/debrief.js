// Debrief (end of a campaign run): the payout, each trooper's XP and rank, what they learned
// by doing (stats grown, and why), the fallen, and what came home.
import { STATS } from '../core/config.js';
import { EARNED_BY } from '../meta/growth.js';
import { LEVELS, levelFor, rankFor } from '../meta/profile.js';
import { tierForLevel } from '../meta/ranks.js';
import { archetypeChip, statBars } from './statbars.js';
import { RARITY } from '../sim/loot.js';

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The stats a trooper is closest to improving (practice banked toward the next point). */
function learning(t, gains = {}) {
  const near = Object.entries(t.progress ?? {}).filter(([k, v]) => v >= 0.15 && !gains[k]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!near.length) return '';
  return `<p class="nogrow">Getting better at ${near.map(([k, v]) => `${STATS.LABEL[k]} <b>${Math.round(v * 100)}%</b>`).join(', ')}</p>`;
}

export class DebriefScreen {
  constructor(root, { profile, debrief, result, shipName, onContinue }) {
    this.root = root;
    this.profile = profile;
    this.debrief = debrief;
    this.result = result;
    this.shipName = shipName;
    this.onContinue = onContinue;
    this.el = root.appendChild(h('<div class="command debrief"></div>'));
    this.render();
  }

  render() {
    const { profile: p, debrief: d, result: r } = this;
    const lines = d.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="${l.value < 0 ? 'neg' : ''}">${l.value > 0 ? '+' : ''}${l.value}</td></tr>`).join('');
    const troopers = d.troopers.map((t) => {
      if (t.died) return `<div class="dt dead"><b>${esc(t.name)}</b><span>KILLED IN ACTION</span></div>`;
      const tr = p.roster.find((q) => q.id === t.id);
      const lvl = levelFor(tr.xp);
      const lo = LEVELS[lvl - 1] ?? 0;
      const hi = LEVELS[lvl] ?? lo + 1;
      const frac = Math.min(1, (tr.xp - lo) / (hi - lo));
      const grew = Object.entries(t.gains ?? {}).map(([k, n]) => `<li><b>${STATS.LABEL[k]} ${tr.stats[k] - n} → ${tr.stats[k]}</b> <small>${EARNED_BY[k]}</small></li>`).join('');
      return `<div class="dt"><b style="color:${tierForLevel(lvl).color}">${rankFor(lvl)} ${esc(t.name)}</b> ${archetypeChip(tr)}<span>+${t.xp} XP${t.after > t.before ? ` · <em>PROMOTED to LV ${t.after}</em>` : ''}</span>
        <div class="xp"><i style="width:${frac * 100}%"></i></div>
        ${statBars(tr, { gains: t.gains })}
        ${grew ? `<ul class="grew">${grew}</ul>` : ''}${learning(tr, t.gains)}</div>`;
    }).join('');
    const loot = [...r.stash, ...(r.status === 'won' ? r.salvageItems : [])]
      .map((it) => `<li style="color:${it.type === 'weapon' ? RARITY[it.rarity].color : '#e0b040'}">${esc(it.name)}${it.type === 'treasure' ? ` <small>${it.value} cr</small>` : ''}</li>`).join('');

    this.el.innerHTML = `<div class="cmd panel ${d.won ? 'won' : 'lost'}">
      <div class="top"><h1>${d.won ? 'EXTRACTION SUCCESSFUL' : 'SQUAD LOST'}</h1>
        <div class="stats">${esc(this.shipName ?? '')} · ${Math.floor(r.time / 60)}:${String(Math.floor(r.time % 60)).padStart(2, '0')} · ${r.kills} KILLS${r.rescued ? ` · ${r.rescued} RESCUED` : ''}${r.cleared ? ' · SHIP CLEARED' : ''}</div></div>
      <div class="cols">
        <div class="col">
          <h2>PAYOUT</h2>
          <table class="pay">${lines}<tr class="tot"><td>Total</td><td>${d.earned >= 0 ? '+' : ''}${d.earned}</td></tr><tr><td>Balance</td><td>${p.credits} cr</td></tr></table>
          ${loot ? `<h2>RECOVERED</h2><ul class="loot">${loot}</ul>` : ''}
          ${d.won ? `<p class="next">Threat level rises to <b>${p.threat}</b>. The next derelicts will be nastier - and pay better.</p>` : '<p class="next">The Kestrel waits for survivors that will not come. Recruit, re-arm, try again.</p>'}
        </div>
        <div class="col">
          <h2>SQUAD</h2>
          <div class="dts">${troopers}</div>
          <button class="deploy">RETURN TO THE KESTREL ▶</button>
        </div>
      </div>
    </div>`;
    this.el.querySelector('.deploy').addEventListener('click', () => this.onContinue());
  }
}
