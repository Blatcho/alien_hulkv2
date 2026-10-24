// The service record panel (title screen, ui/hud.js): what the player has done across every
// campaign, and the unlocks (meta/record.js) - earned, or still to earn, with the deed.
import { newRecord, recordSummary, unlockRows } from '../meta/record.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KINDS = [['archetype', 'ARCHETYPES', 'recruits the campaign can sign on'], ['weapon', 'ISSUE WEAPONS', 'in a new campaign\'s armoury from the start'], ['hull', 'HULLS', 'on the quick-play picker (the auto roll and a named seed always work)']];

export function recordHtml(record) {
  const r = record ?? newRecord();
  const rows = unlockRows(r);
  const groups = KINDS.map(([kind, title, note]) => `<h3>${title} <small>${note}</small></h3><div class="ul">${rows.filter((q) => q.kind === kind).map((q) => `<div class="${q.done ? 'done' : 'todo'}"><b>${esc(q.label)}${q.done ? '' : ' · locked'}</b><span>${esc(q.text)}<small> · ${q.done ? 'earned: ' : ''}${esc(q.deed)}</small></span></div>`).join('')}</div>`).join('');
  const hulls = Object.entries(r.hulls).map(([k, n]) => `${k} ${n}`).join(', ');
  return `<div class="recordbox">
    <div class="line">${esc(recordSummary(r))}${r.campaigns ? ` · ${r.campaigns} campaign${r.campaigns === 1 ? '' : 's'}` : ''}${r.sectors ? ` · ${r.sectors} sector${r.sectors === 1 ? '' : 's'} cleared` : ''}</div>
    <div class="line">${r.rescued} civilians home · ${r.cleared} ships cleared · ${r.hordes} hordes survived · ${r.relics} relics found · best ${r.bestKills} kills by one trooper${r.heatWon ? ` · extracted under ${r.heatWon} heat` : ''}${r.leadWins ? ` · ${r.leadWins} lead-mode extraction${r.leadWins === 1 ? '' : 's'}` : ''}${r.dailies ? ` · ${r.dailies} dailies, best ${r.bestDaily}` : ''}${hulls ? ` · extractions by hull: ${esc(hulls)}` : ''}</div>
    ${groups}
  </div>`;
}
