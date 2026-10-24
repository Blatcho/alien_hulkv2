// The daily derelict: one ship a day, the same for everyone - its seed from the date, its four
// troopers the seed's first four candidates (meta/candidates.js), standard orders, normal
// difficulty. The player's choices are the command (squad or lead) and the heat
// (meta/heat.js), which multiplies the score. The run is scored at the end (scoreRun) and
// the day's best, the attempts and the streak of days are kept in the browser (the ledger).
import { hashString } from '../core/rng.js';
import { candidatePool } from './candidates.js';
import { heatPay } from './heat.js';

export const DAILY_KEY = 'hullbreach.daily.v1';
export const LEDGER_DAYS = 90; // days kept
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** 'YYYY-MM-DD' in local time: the day as the player sees it. */
export function dayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** '24 OCT 2026'. */
export function dayLabel(day) {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[m - 1] ?? '?'} ${y}`;
}

/** The day's seed: six characters nobody could read off the date. */
export function dailySeed(day = dayKey()) {
  const h = hashString(`daily/${day}`);
  return (h.toString(36) + hashString(`daily/${day}/b`).toString(36)).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

/** The day's four, in line order (everyone gets the same squad). */
export const dailySquad = (seed) => candidatePool(seed, 8).slice(0, 4);
export const DAILY_IDS = ['c0', 'c1', 'c2', 'c3'];

/**
 * The run's score (`r`: World.results()): kills, what was found, the contract, the people
 * brought home and the time saved - times the heat. A squad lost keeps only its kills.
 */
export function scoreRun(r, heat = []) {
  const won = r.status === 'won';
  const lines = [];
  const add = (label, value) => { if (value > 0) lines.push({ label, value: Math.round(value) }); };
  add('Hostiles killed', r.kills * 10);
  add('Credits and salvage', (r.credits ?? 0) + (won ? r.salvage ?? 0 : 0));
  if (won) {
    const contract = r.contract ?? { done: true };
    if (contract.done !== false) add(`Contract done${contract.label ? `: ${contract.label}` : ''}`, 500);
    add('Civilians home', (r.rescued ?? 0) * 150);
    if (r.cleared) add('Ship cleared', 300);
    add('Troopers home', r.troopers.filter((t) => t.alive).length * 100);
    add('Time saved', Math.max(0, (900 - r.time) / 2));
  } else lines.push({ label: 'Squad lost', value: 0 });
  const base = lines.reduce((s, l) => s + l.value, 0);
  const mult = heatPay(heat);
  return { lines, base, mult, total: Math.round(base * mult), won };
}

// ------------------------------------------------------------------ the ledger

export const newLedger = () => ({ version: 1, days: {} });

/**
 * Fold a finished daily into the ledger (a new one): the day's best run, its attempts, its last.
 * `entry`: {score, won, kills, time, lead, heat}.
 */
export function foldDaily(ledger, day, entry) {
  const out = { ...(ledger ?? newLedger()), days: { ...(ledger?.days ?? {}) } };
  const d = out.days[day] ?? { plays: 0, best: null, last: null };
  const best = !d.best || entry.score > d.best.score ? { ...entry } : d.best;
  out.days[day] = { plays: d.plays + 1, best, last: { ...entry } };
  // Only the last LEDGER_DAYS days kept.
  const keys = Object.keys(out.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - LEDGER_DAYS))) delete out.days[k];
  return out;
}

/** Today's standing: {plays, best} (plays 0 and best null before the first run). */
export const dailyStatus = (ledger, day) => ({ plays: ledger?.days?.[day]?.plays ?? 0, best: ledger?.days?.[day]?.best ?? null });

/** Days run in a row, counting back from `day` (today counts if it was run; else from yesterday). */
export function dailyStreak(ledger, day = dayKey()) {
  const days = ledger?.days ?? {};
  const d = new Date(`${day}T12:00:00`);
  if (!days[dayKey(d)]) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

const storage = () => (typeof localStorage !== 'undefined' ? localStorage : null);
export function loadDaily() {
  try { return JSON.parse(storage()?.getItem(DAILY_KEY) ?? 'null') ?? newLedger(); } catch { return newLedger(); }
}
export function saveDaily(ledger) {
  try { storage()?.setItem(DAILY_KEY, JSON.stringify(ledger)); } catch { /* private mode */ }
}
