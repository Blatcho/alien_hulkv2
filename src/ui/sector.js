// The sector map on the launch screen (meta/sector.js): the derelicts column by column on
// their routes, the Kestrel where it sits, the hive front creeping up behind it, the boss hulk
// at the end. The nodes the Kestrel can launch at are lit and clickable; the rest are dimmed,
// crossed off once visited or lost to the front.
import { HULL_CLASSES } from '../gen/classes.js';
import { CONTRACTS } from '../gen/contracts.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const W = 1240;
const H = 230;
const NODE_W = 196;
const NODE_H = 58;

/** The SVG as a string (no DOM needed: tests can read it). */
export function sectorSvg(sector, { reachable = new Set(), selected = null } = {}) {
  const cols = sector.cols;
  const colX = (c) => 60 + (c * (W - 120 - NODE_W)) / Math.max(1, cols - 1);
  const rowsIn = (c) => sector.nodes.filter((n) => n.col === c).length;
  const rowY = (n) => { const k = rowsIn(n.col); return H / 2 + (n.row - (k - 1) / 2) * (NODE_H + 14) - NODE_H / 2; };
  const pos = (n) => ({ x: colX(n.col), y: rowY(n) });
  const parts = [];
  // The front: what the hive has swallowed.
  if (sector.front >= 0) {
    const x1 = colX(sector.front) + NODE_W + 14;
    parts.push(`<rect class="front" x="0" y="0" width="${x1}" height="${H}"/>`);
    parts.push(`<text class="frontlbl" x="${Math.max(8, x1 - 8)}" y="${H - 8}" text-anchor="end">HIVE FRONT</text>`);
  }
  for (const [a, b] of sector.edges) {
    const A = pos(sector.nodes[a]);
    const B = pos(sector.nodes[b]);
    const lit = sector.at === a && reachable.has(b);
    parts.push(`<path class="edge ${lit ? 'lit' : ''} ${sector.nodes[a].visited && sector.nodes[b].visited ? 'done' : ''}" d="M${A.x + NODE_W} ${A.y + NODE_H / 2} C ${A.x + NODE_W + 40} ${A.y + NODE_H / 2}, ${B.x - 40} ${B.y + NODE_H / 2}, ${B.x} ${B.y + NODE_H / 2}"/>`);
  }
  // The Kestrel, before the first column or at its node.
  const here = sector.at === null ? { x: 22, y: H / 2 - 12 } : (() => { const p = pos(sector.nodes[sector.at]); return { x: p.x + NODE_W / 2 - 12, y: p.y - 22 }; })();
  parts.push(`<g class="kestrel" transform="translate(${here.x} ${here.y})"><path d="M0 12 L18 6 L24 12 L18 18 Z"/><text x="12" y="30" text-anchor="middle">KESTREL</text></g>`);
  for (const n of sector.nodes) {
    const { x, y } = pos(n);
    const lost = n.col <= sector.front && !n.visited;
    const cls = ['node', n.boss ? 'boss' : '', n.visited ? 'visited' : '', lost ? 'lost' : '', reachable.has(n.id) ? 'open' : '', selected === n.id ? 'selected' : ''].filter(Boolean).join(' ');
    const C = CONTRACTS[n.contract?.kind] ?? CONTRACTS.uplink;
    const mods = (n.modifiers ?? []).length ? n.modifiers.length === 1 ? '1 anomaly' : `${n.modifiers.length} anomalies` : 'no anomalies';
    parts.push(`<g class="${cls}" data-node="${n.id}" transform="translate(${x} ${y})">
      <rect width="${NODE_W}" height="${NODE_H}" rx="3"/>
      <text class="nm" x="8" y="17">${esc(n.name).toUpperCase().slice(0, 24)}</text>
      <text class="cl" x="8" y="31">${n.boss ? 'Brood ship · ' : ''}${esc(HULL_CLASSES[n.cls]?.label ?? n.cls)} · ${esc(C.label)}</text>
      <text class="dg" x="8" y="46">${'▮'.repeat(1 + (n.danger ?? 0))}${'▯'.repeat(Math.max(0, 4 - (n.danger ?? 0)))} · ${esc(mods)}${n.visited ? ' · CLEARED' : lost ? ' · LOST' : ''}</text>
    </g>`);
  }
  return `<svg class="sectormap" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
}

/** Mount the map into `el`; a click on an open node calls onPick(id). */
export function renderSector(el, sector, { reachable, selected, onPick }) {
  el.innerHTML = sectorSvg(sector, { reachable, selected });
  el.querySelectorAll('.node.open').forEach((g) => g.addEventListener('click', () => onPick?.(+g.dataset.node)));
}
