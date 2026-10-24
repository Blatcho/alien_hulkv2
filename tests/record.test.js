// The service record (meta/record.js): what the player has done across every campaign, and
// the unlocks it earns - archetypes the campaign recruits, issue weapons a new campaign
// starts with, hulls on the quick-play picker.
import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../src/meta/candidates.js';
import { newProfile, recruitOffers } from '../src/meta/profile.js';
import {
  GATED_ARCHETYPES, GATED_HULLS, UNLOCKS, UNLOCK_KEYS, issueWeapons, lockedHulls, newRecord, recordRun, recordSummary,
  unlockRows, unlockedArchetypes, unlockedHulls,
} from '../src/meta/record.js';
import { recordHtml } from '../src/ui/record.js';

const won = (over = {}) => ({
  status: 'won', kills: 10, credits: 100, salvage: 50, rescued: 0, cleared: false, time: 400, hordes: 0, relics: [],
  troopers: [{ alive: true, kills: 6 }, { alive: true, kills: 4 }], contract: { kind: 'uplink', done: true }, ...over,
});

describe('the service record', () => {
  it('starts empty: the gated archetypes and hulls locked, nothing issued', () => {
    const r = newRecord();
    expect(GATED_ARCHETYPES).toEqual(['medic', 'gunner', 'duelist', 'brawler']);
    expect(GATED_HULLS).toEqual(['research', 'station']);
    const archs = unlockedArchetypes(r);
    for (const a of GATED_ARCHETYPES) expect(archs).not.toContain(a);
    for (const a of ['veteran', 'heavy', 'breacher', 'marksman', 'scout', 'tech', 'rookie']) expect(archs).toContain(a);
    expect(archs.length + GATED_ARCHETYPES.length).toBe(Object.keys(ARCHETYPES).length);
    expect(unlockedHulls(r)).toEqual(['corvette', 'freighter', 'liner']);
    expect(Object.keys(lockedHulls(r))).toEqual(['research', 'station']);
    expect(lockedHulls(r).station).toBe(UNLOCKS.station.deed);
    expect(issueWeapons(r)).toEqual([]);
    expect(recordSummary(r)).toBe('No runs on record yet.');
  });

  it('counts a run, win or lose - and only a win\'s deeds', () => {
    const r = newRecord();
    const fresh = recordRun(r, won({ rescued: 2 }), { mode: 'quick', cls: 'liner' });
    expect(r).toMatchObject({ runs: 1, wins: 1, kills: 10, rescued: 2, bestKills: 6, hulls: { liner: 1 }, contracts: { uplink: 1 } });
    expect(fresh).toEqual(['research']); // (a liner extracted from)
    recordRun(r, won({ status: 'lost', rescued: 3, cleared: true }), { cls: 'corvette' });
    expect(r).toMatchObject({ runs: 2, wins: 1, kills: 20, rescued: 2, cleared: 0 });
    expect(r.hulls.corvette).toBeUndefined();
    expect(recordSummary(r)).toContain('2 runs · 1 extraction · 20 kills · 1/');
  });

  it('every deed unlocks once, and stays unlocked', () => {
    const r = newRecord();
    expect(recordRun(r, won({ rescued: 5 }))).toContain('medic');
    expect(recordRun(r, won({ rescued: 5 }))).not.toContain('medic');
    expect(r.unlocked).toContain('medic');
    expect(recordRun(r, won({ cleared: true }))).toContain('brawler');
    expect(recordRun(r, won({ hordes: 3 }))).toContain('gunner');
    expect(recordRun(r, won({ kills: 150 }))).toContain('duelist');
    expect(unlockedArchetypes(r).length).toBe(Object.keys(ARCHETYPES).length);
    // Three extractions by now: the Mk.II carbine came with the third.
    expect(r.wins).toBeGreaterThanOrEqual(3);
    expect(r.unlocked).toContain('carbine_mk2');
    expect(recordRun(r, won({ troopers: [{ alive: true, kills: 20 }] }))).toContain('marksman_mk2');
    expect(recordRun(r, won(), { heat: ['lights_out', 'thin_air', 'skeleton_crew'] })).toContain('breacher_mk3');
    expect(recordRun(r, won({ contract: { kind: 'queen', done: true } }))).toContain('heavy_mk3');
    expect(r.queens).toBe(1);
    expect(recordRun(r, won(), { cls: 'corvette' })).toEqual([]);
    expect(recordRun(r, won(), { cls: 'freighter' })).toEqual(['station']);
    expect(r.unlocked.length).toBe(UNLOCK_KEYS.length - 1); // (the research vessel: no liner yet)
    expect(unlockedHulls(r)).toEqual(['corvette', 'freighter', 'liner', 'station']);
    // A loss with the deed done doesn't count it.
    expect(recordRun(newRecord(), won({ status: 'lost', cleared: true, rescued: 9 }))).toEqual([]);
  });

  it('the campaign recruits from the unlocked archetypes; a new campaign is issued the record\'s weapons', () => {
    const open = unlockedArchetypes(newRecord());
    const seen = new Set();
    for (let i = 0; i < 30; i++) for (const t of recruitOffers(newProfile(`REC${i}`), open)) { expect(open).toContain(t.archetype); seen.add(t.archetype); }
    expect(seen.size).toBeGreaterThan(3);
    const all = new Set();
    for (let i = 0; i < 30; i++) for (const t of recruitOffers(newProfile(`REC${i}`))) all.add(t.archetype);
    expect(GATED_ARCHETYPES.some((a) => all.has(a))).toBe(true); // (nothing gated by default)
    const r = newRecord();
    r.unlocked.push('carbine_mk2', 'heavy_mk3');
    const issue = issueWeapons(r);
    expect(issue.map((w) => w.cls)).toEqual(['carbine', 'heavy']);
    const p = newProfile('ISSUE', { issue });
    expect(p.stash.map((w) => [w.cls, w.rarity])).toEqual([['carbine', 'rare'], ['heavy', 'epic']]);
    expect(JSON.stringify(newProfile('ISSUE', { issue }).stash)).toBe(JSON.stringify(p.stash));
    expect(newProfile('ISSUE').stash).toEqual([]);
    expect(p.heat).toEqual([]);
  });

  it('the daily counts too, and the panel lists every unlock with its deed', () => {
    const r = newRecord();
    recordRun(r, won(), { mode: 'daily', score: 1234 });
    recordRun(r, won({ status: 'lost' }), { mode: 'daily', score: 99 });
    expect(r).toMatchObject({ dailies: 2, bestDaily: 1234 });
    const rows = unlockRows(r);
    expect(rows.length).toBe(UNLOCK_KEYS.length);
    expect(rows.filter((q) => q.done).length).toBe(r.unlocked.length);
    const html = recordHtml(r);
    for (const k of UNLOCK_KEYS) { expect(html).toContain(UNLOCKS[k].label); expect(html).toContain(UNLOCKS[k].deed); }
    expect(html).toContain('2 dailies, best 1234');
  });
});
