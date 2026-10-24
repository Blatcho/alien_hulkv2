// The service record: what the player has done across every campaign, quick play and daily,
// kept outside the profile (a new campaign doesn't touch it), and what it has unlocked -
// archetypes the campaign can recruit, issue weapons a new campaign starts with, hull classes
// on the quick-play picker. Deeds are plain counts (recordRun folds a run in); an unlock is
// earned once and kept for good. Shown on the title screen and in the debrief.
import { ARCHETYPES } from './candidates.js';
import { CLASS_KEYS, HULL_CLASSES } from '../gen/classes.js';

export const RECORD_VERSION = 1;
export const RECORD_KEY = 'hullbreach.record.v1';

export function newRecord() {
  return {
    version: RECORD_VERSION,
    campaigns: 0, runs: 0, wins: 0, kills: 0, rescued: 0, cleared: 0, queens: 0, hordes: 0, relics: 0,
    bestKills: 0, heatWon: 0, leadWins: 0, dailies: 0, bestDaily: 0, sectors: 0,
    hulls: {}, contracts: {}, // extractions by hull class; contracts done by kind
    unlocked: [],
  };
}

export const UNLOCKS = {
  // Archetypes (meta/candidates.js): the campaign's recruits can be these once earned.
  medic:   { kind: 'archetype', key: 'medic', label: 'Medic', text: ARCHETYPES.medic.text, deed: 'bring five civilians home', when: (r) => r.rescued >= 5 },
  gunner:  { kind: 'archetype', key: 'gunner', label: 'Gunner', text: ARCHETYPES.gunner.text, deed: 'come home from three hordes', when: (r) => r.hordes >= 3 },
  duelist: { kind: 'archetype', key: 'duelist', label: 'Duelist', text: ARCHETYPES.duelist.text, deed: 'a hundred and fifty kills', when: (r) => r.kills >= 150 },
  brawler: { kind: 'archetype', key: 'brawler', label: 'Brawler', text: ARCHETYPES.brawler.text, deed: 'clear a ship of every hostile', when: (r) => r.cleared >= 1 },
  // Issue weapons: a new campaign starts with one in the armoury (meta/profile.js newProfile).
  carbine_mk2:  { kind: 'weapon', cls: 'carbine', rarity: 'rare', label: 'Mk.II carbine', text: 'A rare carbine in a new campaign\'s armoury', deed: 'three extractions', when: (r) => r.wins >= 3 },
  marksman_mk2: { kind: 'weapon', cls: 'marksman', rarity: 'rare', label: 'Mk.II marksman rifle', text: 'A rare marksman rifle in a new campaign\'s armoury', deed: 'twenty kills by one trooper on one run', when: (r) => r.bestKills >= 20 },
  breacher_mk3: { kind: 'weapon', cls: 'breacher', rarity: 'epic', label: 'Mk.III breacher', text: 'An epic breacher in a new campaign\'s armoury', deed: 'extract with three heat conditions on', when: (r) => r.heatWon >= 3 },
  heavy_mk3:    { kind: 'weapon', cls: 'heavy', rarity: 'epic', label: 'Mk.III heavy repeater', text: 'An epic heavy repeater in a new campaign\'s armoury', deed: 'kill a queen', when: (r) => r.queens >= 1 },
  // Hulls: the quick-play picker (the auto roll and a named seed code always work).
  research: { kind: 'hull', key: 'research', label: HULL_CLASSES.research.label, text: 'On the quick-play hull picker', deed: 'extract from a liner', when: (r) => (r.hulls.liner ?? 0) >= 1 },
  station:  { kind: 'hull', key: 'station', label: HULL_CLASSES.station.label, text: 'On the quick-play hull picker', deed: 'extract from a corvette and a freighter', when: (r) => (r.hulls.corvette ?? 0) >= 1 && (r.hulls.freighter ?? 0) >= 1 },
};
export const UNLOCK_KEYS = Object.keys(UNLOCKS);
export const GATED_ARCHETYPES = UNLOCK_KEYS.filter((k) => UNLOCKS[k].kind === 'archetype').map((k) => UNLOCKS[k].key);
export const GATED_HULLS = UNLOCK_KEYS.filter((k) => UNLOCKS[k].kind === 'hull').map((k) => UNLOCKS[k].key);

export const isUnlocked = (record, key) => (record?.unlocked ?? []).includes(key);

/**
 * Fold a finished run in (`r`: World.results()) and return the unlocks it earned (keys, new
 * this run only). `ctx`: mode ('campaign' | 'quick' | 'daily'), cls (hull class), heat
 * (meta/heat.js keys), lead, score (a daily's).
 */
export function recordRun(record, r, { mode = 'quick', cls = null, heat = [], lead = false, score = 0 } = {}) {
  const won = r.status === 'won';
  record.runs++;
  record.kills += r.kills ?? 0;
  record.bestKills = Math.max(record.bestKills, ...r.troopers.map((t) => t.kills ?? 0));
  record.relics += (r.relics ?? []).length;
  if (won) {
    record.wins++;
    record.rescued += r.rescued ?? 0;
    if (r.cleared) record.cleared++;
    record.hordes += r.hordes ?? 0;
    record.heatWon = Math.max(record.heatWon, heat.length);
    if (lead) record.leadWins++;
    if (cls) record.hulls[cls] = (record.hulls[cls] ?? 0) + 1;
    const c = r.contract;
    if (c && c.done !== false) {
      record.contracts[c.kind] = (record.contracts[c.kind] ?? 0) + 1;
      if (c.kind === 'queen') record.queens++;
    }
  }
  if (mode === 'daily') { record.dailies++; record.bestDaily = Math.max(record.bestDaily, score); }
  return claimUnlocks(record);
}

/** Every unlock the record now earns and didn't have: added, and returned. */
export function claimUnlocks(record) {
  const fresh = [];
  for (const k of UNLOCK_KEYS) {
    if (record.unlocked.includes(k)) continue;
    if (UNLOCKS[k].when(record)) { record.unlocked.push(k); fresh.push(k); }
  }
  return fresh;
}

export function campaignStarted(record) { record.campaigns++; }
export function sectorCleared(record) { record.sectors++; }

/** The archetypes the campaign can recruit: all but the gated ones still locked. */
export const unlockedArchetypes = (record) => Object.keys(ARCHETYPES).filter((a) => !GATED_ARCHETYPES.includes(a) || isUnlocked(record, a));
/** The hull classes the picker offers. */
export const unlockedHulls = (record) => CLASS_KEYS.filter((c) => !GATED_HULLS.includes(c) || isUnlocked(record, c));
/** The locked hulls and their deeds: {station: 'extract from...'}. */
export const lockedHulls = (record) => Object.fromEntries(GATED_HULLS.filter((c) => !isUnlocked(record, c)).map((c) => [c, UNLOCKS[c].deed]));
/** The issue weapons a new campaign starts with: [{key, cls, rarity, label}]. */
export const issueWeapons = (record) => UNLOCK_KEYS.filter((k) => UNLOCKS[k].kind === 'weapon' && isUnlocked(record, k)).map((k) => ({ key: k, ...UNLOCKS[k] }));

/** One line for the title screen. */
export function recordSummary(record) {
  const r = record ?? newRecord();
  if (!r.runs) return 'No runs on record yet.';
  const n = r.unlocked.length;
  return `${r.runs} run${r.runs === 1 ? '' : 's'} · ${r.wins} extraction${r.wins === 1 ? '' : 's'} · ${r.kills} kills${r.queens ? ` · ${r.queens} queen${r.queens === 1 ? '' : 's'}` : ''} · ${n}/${UNLOCK_KEYS.length} unlocked`;
}

/** How far along each deed is, for the record panel: [{key, label, kind, text, deed, done}]. */
export const unlockRows = (record) => UNLOCK_KEYS.map((k) => ({ key: k, kind: UNLOCKS[k].kind, label: UNLOCKS[k].label, text: UNLOCKS[k].text, deed: UNLOCKS[k].deed, done: isUnlocked(record, k) }));

const storage = () => (typeof localStorage !== 'undefined' ? localStorage : null);
export function loadRecord() {
  try {
    const raw = JSON.parse(storage()?.getItem(RECORD_KEY) ?? 'null');
    return raw ? { ...newRecord(), ...raw, hulls: raw.hulls ?? {}, contracts: raw.contracts ?? {}, unlocked: raw.unlocked ?? [] } : newRecord();
  } catch { return newRecord(); }
}
export function saveRecord(record) {
  try { storage()?.setItem(RECORD_KEY, JSON.stringify(record)); } catch { /* private mode */ }
}
