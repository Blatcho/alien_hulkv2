// The sector (meta/sector.js): a dozen derelicts on branching routes, the Kestrel moving along
// them a column a run, the hive front behind it, the boss hulk at the end - and what a run does
// to the profile (meta/profile.js applyRun): the contract's pay, the bonuses, the sector's turn.
import { describe, expect, it } from 'vitest';
import { CONTRACTS } from '../src/gen/contracts.js';
import { makeOffer, shipOffers } from '../src/meta/ships.js';
import { applyRun, migrate, newProfile } from '../src/meta/profile.js';
import { SECTOR, advanceSector, makeSector, nodeOffer, reachable, sectorCleared } from '../src/meta/sector.js';
import { sectorSvg } from '../src/ui/sector.js';
import { Rng } from '../src/core/rng.js';

describe('the sector', () => {
  it('is the same from its seed: columns of derelicts, every one reachable, one boss hulk at the end', () => {
    const s = makeSector('kestrel');
    expect(JSON.stringify(makeSector('kestrel'))).toBe(JSON.stringify(s));
    expect(s.nodes.length).toBe(SECTOR.COLS.reduce((a, b) => a + b, 0));
    expect(s.cols).toBe(SECTOR.COLS.length);
    for (let c = 0; c < s.cols; c++) expect(s.nodes.filter((n) => n.col === c).length).toBe(SECTOR.COLS[c]);
    const bosses = s.nodes.filter((n) => n.boss);
    expect(bosses.length).toBe(1);
    expect(bosses[0].col).toBe(s.cols - 1);
    expect(bosses[0].contract.kind).toBe('queen');
    expect(bosses[0].mods.boss).toBe(true);
    expect(bosses[0].modifiers).toEqual(['hive']);
    // Every node past the first column has a way in; every node before the last a way out.
    for (const n of s.nodes) {
      if (n.col > 0) expect(s.edges.some(([, b]) => b === n.id)).toBe(true);
      if (n.col < s.cols - 1) expect(s.edges.some(([a]) => a === n.id)).toBe(true);
      expect(n.contract.kind).not.toBe(n.boss ? 'x' : 'queen');
      expect(n.bonuses.length).toBe(2);
      expect(n.seed).toContain('-');
      expect(n.story.key).toBeTruthy();
    }
    for (const [a, b] of s.edges) expect(s.nodes[b].col).toBe(s.nodes[a].col + 1);
    const kinds = new Set(s.nodes.map((n) => n.contract.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it('the Kestrel launches at the first column, then along the routes; the front takes what it leaves', () => {
    const s = makeSector('kestrel');
    const first = reachable(s);
    expect(first.every((n) => n.col === 0)).toBe(true);
    expect(first.length).toBe(SECTOR.COLS[0]);
    // A win: the Kestrel moves there, the front comes up a column.
    const r1 = advanceSector(s, first[0].id, true);
    expect(s.at).toBe(first[0].id);
    expect(s.nodes[first[0].id].visited).toBe(true);
    expect(r1).toMatchObject({ moved: true, front: 0, cleared: false });
    expect(r1.lost).toBe(SECTOR.COLS[0] - 1); // the other first-column ship is gone
    const next = reachable(s);
    expect(next.length).toBeGreaterThanOrEqual(1);
    expect(next.every((n) => n.col === 1 && s.edges.some(([a, b]) => a === s.at && b === n.id))).toBe(true);
    // A loss: the Kestrel stays; the front comes on; the second column is now in its teeth.
    const r2 = advanceSector(s, next[0].id, false);
    expect(s.at).toBe(first[0].id);
    expect(r2.moved).toBe(false);
    expect(s.front).toBe(1);
    const after = reachable(s);
    expect(after.length).toBeGreaterThanOrEqual(1);
    expect(after.every((n) => n.col > s.front)).toBe(true);
  });

  it('the boss hulk cleared ends the sector; the next is deeper', () => {
    const s = makeSector('kestrel');
    // Walk a route to the end.
    let guard = 0;
    while (!sectorCleared(s) && guard++ < 10) {
      const r = reachable(s);
      expect(r.length).toBeGreaterThan(0);
      advanceSector(s, r[0].id, true);
    }
    expect(sectorCleared(s)).toBe(true);
    expect(s.nodes.filter((n) => n.visited).length).toBe(s.cols);
    const p = newProfile('kestrel');
    expect(p.sector.index).toBe(0);
    const s2 = makeSector('kestrel', 1);
    expect(s2.index).toBe(1);
    expect(s2.nodes[0].seed).not.toBe(s.nodes[0].seed);
    expect(s2.nodes[0].threatBonus).toBeGreaterThan(s.nodes[0].threatBonus);
    const o = nodeOffer(s2, s2.nodes.find((n) => n.boss).id, 3);
    expect(o.name.startsWith('Brood ship ')).toBe(true);
    expect(o.threat).toBe(3 + o.threatBonus);
    expect(o.node).toBe(o.id);
  });

  it('draws as an SVG with the front, the routes, the Kestrel and every node', () => {
    const s = makeSector('kestrel');
    advanceSector(s, reachable(s)[0].id, true);
    const svg = sectorSvg(s, { reachable: new Set(reachable(s).map((n) => n.id)), selected: reachable(s)[0].id });
    expect(svg).toContain('class="front"');
    expect(svg).toContain('KESTREL');
    expect((svg.match(/class="node/g) ?? []).length).toBe(s.nodes.length);
    expect(svg).toContain('node boss');
    expect(svg).toContain('node visited');
    expect(svg).toContain('selected');
    expect(svg).toContain('Brood ship');
  });

  it('an offer carries its seed, class, story and twists; a boss offer is a hive ship with the queen', () => {
    const rng = new Rng('offer', 'x');
    const o = makeOffer(rng, 'liner', 'AB123', { twists: 2 });
    expect(o.seed).toBe('LNR-AB123');
    expect(o.bare).toBe('AB123');
    expect(o.modifiers.length).toBe(2);
    expect(o.mods.cls).toBe('liner');
    const b = makeOffer(rng, 'freighter', 'AB124', { boss: true });
    expect(b.mods.boss).toBe(true);
    expect(b.modifiers).toEqual(['hive']);
    expect(b.reward).toBeGreaterThan(o.reward - 1);
    const p = newProfile('kestrel');
    expect(shipOffers(p).length).toBe(3);
  });
});

describe('a run folded into the profile', () => {
  const result = (over = {}) => ({
    status: 'won', time: 400, kills: 10, credits: 100, salvage: 50, salvageItems: [], rescued: 1, cleared: true, stash: [], rewardMult: 1.2,
    troopers: [], contract: { kind: 'blackbox', label: 'Black box', done: true, pay: CONTRACTS.blackbox.pay }, hordes: 0, survivorsAboard: 1, journal: [], ...over,
  });

  it('pays the contract done, nothing for one failed, and the bonuses earned; the sector turns', () => {
    const p = newProfile('kestrel');
    const node = reachable(p.sector)[0].id;
    const d = applyRun(p, result(), { node, bonuses: ['clear', 'quiet'] });
    expect(d.lines.find((l) => l.label.startsWith('Contract: Black box')).value).toBe(Math.round(250 * 1.2 * CONTRACTS.blackbox.pay));
    expect(d.lines.filter((l) => l.label.startsWith('Bonus')).map((l) => l.label)).toEqual(['Bonus: Clear the ship', 'Bonus: Quiet']);
    expect(d.sector).toMatchObject({ moved: true, front: 0 });
    expect(p.sector.at).toBe(node);
    expect(p.threat).toBe(1);
    const p2 = newProfile('kestrel');
    const d2 = applyRun(p2, result({ contract: { kind: 'rescue', label: 'Crew rescue', done: false, failedWhy: 'the crew could not be found', pay: 1.15 } }), { node: reachable(p2.sector)[0].id, bonuses: ['noloss'] });
    expect(d2.lines.some((l) => l.label.startsWith('Contract:'))).toBe(false);
    expect(d2.lines.some((l) => l.label.startsWith('Contract failed'))).toBe(true);
    expect(d2.lines.some((l) => l.label.startsWith('Bonus'))).toBe(false); // no troopers listed: nobody "walked off"
    const p3 = newProfile('kestrel');
    const d3 = applyRun(p3, result({ status: 'lost', contract: { kind: 'uplink', done: false } }), { node: reachable(p3.sector)[0].id, bonuses: ['fast'] });
    expect(d3.sector.moved).toBe(false);
    expect(p3.sector.front).toBe(0);
    expect(d3.lines.some((l) => l.label.startsWith('Bonus'))).toBe(false);
  });

  it('an old profile gets a sector', () => {
    const p = migrate({ version: 2, seed: 'old', roster: [], stash: [], memorial: [], upgrades: {}, totals: {}, credits: 0, threat: 0, runs: 0, wins: 0 });
    expect(p.version).toBe(3);
    expect(p.sector.nodes.length).toBeGreaterThan(0);
    expect(p.sectors).toBe(0);
  });
});
