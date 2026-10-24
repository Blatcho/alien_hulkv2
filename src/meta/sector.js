// The sector: the campaign's map (ui/sector.js). A dozen derelicts on branching routes, column
// by column, from where the Kestrel sits to the boss hulk at the far end; every run moves the
// Kestrel one column on. Behind it the hive front advances a column a run: nodes it has reached
// are gone, and a Kestrel it catches up with runs for the next column with no choice of ship.
// The boss hulk cleared, the sector is done: the next one is deeper (threat carries on) and
// the front resets. Nodes are offers (meta/ships.js makeOffer) with a contract and bonuses.
import { Rng } from '../core/rng.js';
import { CLASS_KEYS, HULL_CLASSES } from '../gen/classes.js';
import { contractFor, rollBonuses } from '../gen/contracts.js';
import { makeOffer } from './ships.js';

export const SECTOR = { COLS: [2, 3, 3, 2, 1], FRONT_START: -1 };

/** A fresh sector `index` for a campaign seed. */
export function makeSector(seed, index = 0) {
  const rng = new Rng(`${seed}/sector${index}`, 'sector');
  const nodes = [];
  const cols = SECTOR.COLS;
  const recent = [];
  const names = new Set();
  for (let c = 0; c < cols.length; c++) {
    const boss = c === cols.length - 1;
    for (let r = 0; r < cols[c]; r++) {
      // Classes vary down a column; a boss hulk is a liner or a freighter (big enough for a hall).
      const pool = boss ? ['liner', 'freighter', 'station'] : CLASS_KEYS.filter((k) => !recent.slice(-1).includes(k));
      const cls = rng.pick(pool);
      recent.push(cls);
      const seedBare = `${seed.slice(0, 2).toUpperCase()}${index}${c}${r}${rng.int(100, 999)}`;
      const twists = boss ? 1 : rng.weighted([[0, 3], [1, 3], [2, 2]]);
      const offer = makeOffer(rng, cls, seedBare, { twists, boss, lastMods: [], avoid: names });
      const contract = contractFor(offer.bare, { want: boss ? null : rng.weighted([[null, 2], ['blackbox', 1], ['reactor', 1], ['beacon', 1], ['rescue', 1], ['escort', 0.7]]), boss, threat: index * 4 + c });
      nodes.push({ id: nodes.length, col: c, row: r, boss, visited: false, ...offer, contract: { kind: contract.kind, label: contract.label, crew: contract.crew ?? null }, bonuses: rollBonuses(rng), threatBonus: c + index * cols.length });
    }
  }
  // Edges: each node reaches one or two of the next column; every node has a way in.
  const edges = [];
  const byCol = (c) => nodes.filter((n) => n.col === c);
  for (let c = 0; c < cols.length - 1; c++) {
    const here = byCol(c);
    const next = byCol(c + 1);
    const reached = new Set();
    here.forEach((n, i) => {
      const a = Math.min(next.length - 1, Math.floor((i * next.length) / here.length));
      const picks = new Set([a]);
      if (rng.chance(0.6)) picks.add(Math.min(next.length - 1, a + 1));
      if (rng.chance(0.35) && a > 0) picks.add(a - 1);
      for (const j of picks) { edges.push([n.id, next[j].id]); reached.add(next[j].id); }
    });
    for (const m of next) if (!reached.has(m.id)) edges.push([rng.pick(here).id, m.id]);
  }
  return { seed, index, nodes, edges, at: null, front: SECTOR.FRONT_START, cols: cols.length };
}

/** The nodes the Kestrel can launch at: the next column on from where it sits, ahead of the front. */
export function reachable(sector) {
  const { nodes, edges, at, front } = sector;
  const ahead = (n) => n.col > front && !n.visited;
  let out;
  if (at === null) out = nodes.filter((n) => n.col === 0 && ahead(n));
  else out = edges.filter(([a]) => a === at).map(([, b]) => nodes[b]).filter(ahead);
  if (!out.length) {
    // The front has it: run for the nearest column still ahead, any ship there.
    const col = Math.max(front + 1, (at === null ? -1 : nodes[at].col) + 1);
    out = nodes.filter((n) => n.col === col && !n.visited);
    if (!out.length) out = nodes.filter((n) => n.col > front && !n.visited).sort((a, b) => a.col - b.col).filter((n, i, arr) => n.col === arr[0]?.col);
  }
  return out;
}

/** Is the sector done - the boss hulk cleared? */
export const sectorCleared = (sector) => sector.nodes.some((n) => n.boss && n.visited);

/**
 * After a run at node `id`: a win moves the Kestrel there and marks the node; a loss leaves it
 * where it was. Either way the front advances a column. Returns what changed.
 */
export function advanceSector(sector, id, won) {
  const n = sector.nodes[id];
  if (won && n) { sector.at = id; n.visited = true; }
  sector.front = Math.min(sector.cols - 1, sector.front + 1);
  // The front never swallows the Kestrel's own column while it still has somewhere to go.
  const lost = sector.nodes.filter((q) => q.col <= sector.front && !q.visited).length;
  return { moved: !!won, front: sector.front, lost, cleared: sectorCleared(sector) };
}

/** The offer for a node at the campaign's threat (the deeper the column, the harder). */
export function nodeOffer(sector, id, threat) {
  const n = sector.nodes[id];
  return { ...n, threat: threat + n.threatBonus, node: id, name: n.boss ? `Brood ship ${n.name}` : n.name };
}

export const classLabel = (cls) => HULL_CLASSES[cls]?.label ?? cls;
