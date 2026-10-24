// Contracts: what the Kestrel is paid for aboard a derelict. Every run has one, rolled from
// the seed (or named: a sector node, or ?job= in quick play), and the generator makes it true
// (gen/populate.js placeContract): the target is placed, the crew it needs is aboard. The
// simulation plays it (sim/contract.js): the squad goes to the target, does the work, and
// for every contract but the nav-lock walks back to the Kestrel with the job done.
//
//   uplink    reach the command deck, hold it for the nav-lock upload (the original)
//   blackbox  pull the black box from the bridge console, carry it home
//   reactor   set a charge on the reactor; it blows FUSE seconds later - everyone out by then
//   beacon    plant a beacon in the deepest nest (they wake), then home
//   rescue    find the crew still alive aboard (CREW of them), get them home
//   escort    one named survivor knows what we came for: find them, get them home
//   queen     the boss hulk's: kill the queen in her nest, then everyone out
//
// Bonus objectives (BONUSES) ride on an offer: extra pay for what the debrief can check.
import { Rng } from '../core/rng.js';

export const CONTRACTS = {
  uplink: { label: 'Nav-lock', verb: 'Start the uplink', pay: 1, weight: 3, extract: false,
    text: 'Reach the command deck and hold it for the nav-lock uplink.' },
  blackbox: { label: 'Black box', verb: 'Pull the black box', pay: 1.15, weight: 2, extract: true, work: { stat: 'int', time: 7 },
    text: 'Recover the black box from the bridge console and bring it back to the Kestrel.' },
  reactor: { label: 'Scuttle', verb: 'Set the charge', pay: 1.35, weight: 1.5, extract: true, work: { stat: 'str', time: 9 }, fuse: 110,
    text: 'Set a charge on the reactor and get everyone back to the Kestrel before it goes.' },
  beacon: { label: 'Beacon', verb: 'Plant the beacon', pay: 1.25, weight: 1.5, extract: true, work: { stat: 'int', time: 8 },
    text: 'Plant a beacon in the deepest nest aboard - they will not like it - and get back to the Kestrel.' },
  rescue: { label: 'Crew rescue', pay: 1.15, weight: 1.5, extract: true, crew: 2,
    text: 'Find the crew still alive aboard and get them back to the Kestrel.' },
  escort: { label: 'Escort', pay: 1.1, weight: 1, extract: true, vip: true,
    text: 'One of the crew knows where the manifest is: find them and get them home alive.' },
  queen: { label: 'The queen', pay: 1.6, weight: 0, extract: true, boss: true,
    text: 'Kill the queen in her nest, then get everyone out.' },
};
export const CONTRACT_KEYS = Object.keys(CONTRACTS);

export const BONUSES = {
  clear: { label: 'Clear the ship', pay: 150, text: 'every hostile aboard dead', check: (r) => !!r.cleared },
  civilians: { label: 'Every civilian home', pay: 100, text: 'nobody left behind', check: (r) => (r.survivorsAboard ?? 0) > 0 && r.rescued === r.survivorsAboard },
  noloss: { label: 'Nobody lost', pay: 120, text: 'the whole squad walks off', check: (r) => r.troopers.length > 0 && r.troopers.every((t) => t.alive) },
  quiet: { label: 'Quiet', pay: 100, text: 'no horde called', check: (r) => !(r.hordes > 0) },
  fast: { label: 'Fast', pay: 100, text: 'done inside ten minutes', check: (r) => r.time < 600 },
};
export const BONUS_KEYS = Object.keys(BONUSES);

/** The contract a seed rolls on a hull (threat deepens the crew to find). `want` names one. */
export function contractFor(bare, { want = null, boss = false, threat = 0 } = {}) {
  const key = boss ? 'queen' : want && CONTRACTS[want] && !CONTRACTS[want].boss ? want
    : new Rng(bare, 'contract').weighted(CONTRACT_KEYS.filter((k) => CONTRACTS[k].weight > 0).map((k) => [k, CONTRACTS[k].weight]));
  const c = { kind: key, ...CONTRACTS[key] };
  if (c.crew) c.crew = Math.min(4, c.crew + Math.floor(threat / 4));
  return c;
}

/** Two bonus objectives for an offer (none twice). */
export function rollBonuses(rng, n = 2) {
  const pool = [...BONUS_KEYS];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
  return out;
}

/** Which bonuses a finished run earned, and what they pay: [{key, label, pay, earned}]. */
export function evaluateBonuses(keys, result) {
  if (!result || result.status !== 'won') return (keys ?? []).map((k) => ({ key: k, label: BONUSES[k].label, pay: BONUSES[k].pay, earned: false }));
  return (keys ?? []).filter((k) => BONUSES[k]).map((k) => ({ key: k, label: BONUSES[k].label, pay: BONUSES[k].pay, earned: BONUSES[k].check(result) }));
}

/** The contract's text with the crew count or the name filled in. */
export function contractText(c) {
  if (!c) return CONTRACTS.uplink.text;
  if (c.kind === 'rescue') return `Find the crew still alive aboard - ${c.crew} of them - and get them back to the Kestrel.`;
  if (c.kind === 'escort' && c.vipName) return `${c.vipName} knows where the manifest is: find them and get them home alive.`;
  return c.text;
}
