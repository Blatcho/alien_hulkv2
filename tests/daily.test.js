// The daily derelict (meta/daily.js): one seed a day for everyone, the same four troopers, a
// scored run, and the ledger that keeps the day's best, the attempts and the streak.
import { describe, expect, it } from 'vitest';
import { candidatePool } from '../src/meta/candidates.js';
import { DAILY_IDS, LEDGER_DAYS, dailySeed, dailySquad, dailyStatus, dailyStreak, dayKey, dayLabel, foldDaily, newLedger, scoreRun } from '../src/meta/daily.js';
import { heatPay } from '../src/meta/heat.js';

describe('the daily derelict', () => {
  it('one seed a day: six characters, the same every time, nothing like the date', () => {
    const s = dailySeed('2026-10-24');
    expect(s).toMatch(/^[A-Z0-9]{6}$/);
    expect(dailySeed('2026-10-24')).toBe(s);
    expect(dailySeed('2026-10-25')).not.toBe(s);
    expect(dailySeed('2025-10-24')).not.toBe(s);
    expect(dayKey(new Date(2026, 9, 24, 23, 59))).toBe('2026-10-24');
    expect(dayLabel('2026-10-24')).toBe('24 OCT 2026');
    expect(dayLabel('2027-01-05')).toBe('5 JAN 2027');
  });

  it('the same four for everyone, in line order: the ship\'s first four candidates', () => {
    const seed = dailySeed('2026-10-24');
    const four = dailySquad(seed);
    expect(four.map((t) => t.id)).toEqual(DAILY_IDS);
    expect(four.map((t) => t.name)).toEqual(candidatePool(seed, 8).slice(0, 4).map((t) => t.name));
    expect(JSON.stringify(dailySquad(seed))).toBe(JSON.stringify(four));
  });

  it('scores a run: kills, finds, the contract, the people home, the time saved - times the heat', () => {
    const r = { status: 'won', kills: 20, credits: 100, salvage: 50, rescued: 2, cleared: true, time: 500, troopers: [{ alive: true }, { alive: true }, { alive: false }], contract: { kind: 'uplink', label: 'Nav-lock', done: true } };
    const s = scoreRun(r);
    expect(s.won).toBe(true);
    expect(s.lines.map((l) => l.value)).toEqual([200, 150, 500, 300, 300, 200, 200]);
    expect(s.base).toBe(1850);
    expect(s.mult).toBe(1);
    expect(s.total).toBe(1850);
    const h = ['lights_out', 'thin_air'];
    expect(scoreRun(r, h).total).toBe(Math.round(1850 * heatPay(h)));
    // A contract not done pays nothing; a squad lost keeps its kills and what it had in hand.
    expect(scoreRun({ ...r, contract: { kind: 'rescue', done: false } }).base).toBe(1350);
    const lost = scoreRun({ status: 'lost', kills: 7, credits: 300, salvage: 900, rescued: 1, cleared: false, time: 100, troopers: [{ alive: false }] });
    expect(lost.won).toBe(false);
    expect(lost.lines.map((l) => [l.label, l.value])).toEqual([['Hostiles killed', 70], ['Credits and salvage', 300], ['Squad lost', 0]]);
    expect(lost.total).toBe(370);
  });

  it('the ledger keeps the day\'s best, the attempts and the streak - and no more than the last days', () => {
    let L = newLedger();
    expect(dailyStatus(L, '2026-10-24')).toEqual({ plays: 0, best: null });
    L = foldDaily(L, '2026-10-24', { score: 100, won: true });
    L = foldDaily(L, '2026-10-24', { score: 80, won: false });
    expect(dailyStatus(L, '2026-10-24')).toMatchObject({ plays: 2, best: { score: 100 } });
    expect(L.days['2026-10-24'].last.score).toBe(80);
    L = foldDaily(L, '2026-10-24', { score: 150, won: true });
    expect(dailyStatus(L, '2026-10-24').best.score).toBe(150);
    // Three days in a row; a day not yet run counts back from yesterday; a gap ends it.
    L = foldDaily(L, '2026-10-22', { score: 1 });
    L = foldDaily(L, '2026-10-23', { score: 1 });
    expect(dailyStreak(L, '2026-10-24')).toBe(3);
    expect(dailyStreak(L, '2026-10-25')).toBe(3);
    expect(dailyStreak(L, '2026-10-27')).toBe(0);
    expect(dailyStreak(newLedger(), '2026-10-24')).toBe(0);
    // Only the last LEDGER_DAYS kept.
    const d = new Date(2026, 0, 1);
    for (let i = 0; i < LEDGER_DAYS + 5; i++) { L = foldDaily(L, dayKey(d), { score: i }); d.setDate(d.getDate() + 1); }
    expect(Object.keys(L.days).length).toBe(LEDGER_DAYS);
    expect(L.days['2026-01-01']).toBeUndefined(); // (the oldest go)
    expect(L.days['2026-10-24'].plays).toBe(3);     // (the latest stay)
  });
});
