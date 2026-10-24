// Kestrel events: something happens aboard between runs, now and then - a stowaway, a dealer,
// a contract on the wire, a row in the mess. One card on the launch screen with two or three
// choices, each with a plain effect on the profile. Rolled at the debrief (rollEvent), kept
// as profile.pendingEvent until answered (applyEvent).
import { Rng } from '../core/rng.js';
import { makeCandidate } from './candidates.js';
import { QUIRKS, QUIRK_KEYS } from './quirks.js';
import { RELICS, rollRelic } from './relics.js';
import { rollWeapon } from '../sim/loot.js';

export const EVENT_CHANCE = 0.6;

export const EVENTS = {
  stowaway: {
    title: 'Stowaway',
    text: 'Someone came back aboard in the cargo cradle: a deserter from the last ship, by the look of the rank tabs. Wants to sign on. No pay asked.',
    options: [
      { id: 'sign', label: 'Sign them on', note: 'a trooper, for nothing' },
      { id: 'turn', label: 'Turn them in at the next port', note: '+40 cr' },
    ],
  },
  dealer: {
    title: 'A dealer on the band',
    text: 'A salvage tender hails with a cargo manifest nobody asked about. Weapons, mostly. One sealed case "from a liner that is not coming back".',
    options: [
      { id: 'weapon', label: 'Buy a weapon', note: '140 cr: a rare one at least', cost: 140 },
      { id: 'relic', label: 'Buy the sealed case', note: '220 cr: a relic', cost: 220 },
      { id: 'decline', label: 'Decline' },
    ],
  },
  wire: {
    title: 'A contract on the wire',
    text: 'An underwriter wants the next job done loud and quick, and will pay for it. The ship is nastier than the manifest says.',
    options: [
      { id: 'take', label: 'Take the terms', note: 'next run: pay x1.5, danger +1' },
      { id: 'pass', label: 'Let it pass' },
    ],
  },
  row: {
    title: 'A row in the mess',
    text: 'Two of the squad came to blows over who left whom on the deck. The mess is wrecked and nobody is talking.',
    options: [
      { id: 'leave', label: 'Shore leave for everyone', note: '-50 cr; everyone comes back steadier (+0.3 Nerve progress)', cost: 50 },
      { id: 'fester', label: 'Let it fester', note: 'one of them picks up a bad habit' },
    ],
  },
  auction: {
    title: 'Salvage auction',
    text: 'A port auctioneer will take every weapon in the armoury off your hands, sight unseen, at a fair price.',
    options: [
      { id: 'sell', label: 'Sell the lot', note: '60 cr a weapon, 120 if rare or better' },
      { id: 'keep', label: 'Keep them' },
    ],
  },
  drop: {
    title: 'Supply drop',
    text: 'A crate of Corps surplus turns up on the manifest: nobody signed for it, so it is yours.',
    options: [
      { id: 'stims', label: 'Stim-packs', note: '+1 stim supply tier (if any left to buy)' },
      { id: 'credits', label: 'Sell it', note: '+90 cr' },
    ],
  },
};
export const EVENT_KEYS = Object.keys(EVENTS);

/** Maybe an event after this run (deterministic from the profile): {key} or null. */
export function rollEvent(profile) {
  const rng = new Rng(`${profile.seed}/${profile.runs}`, 'kestrel-event');
  if (!rng.chance(EVENT_CHANCE)) return null;
  const last = profile.lastEvent ?? null;
  const pool = EVENT_KEYS.filter((k) => k !== last);
  return { key: rng.pick(pool), seed: `${profile.seed}/${profile.runs}` };
}

/** Which options the profile can take right now (a cost it can't pay is off). */
export function eventOptions(profile, ev) {
  return EVENTS[ev.key].options.map((o) => ({ ...o, off: !!o.cost && profile.credits < o.cost }));
}

/**
 * Answer the pending event. Returns a line for the screen, and clears it.
 */
export function applyEvent(profile, optionId) {
  const ev = profile.pendingEvent;
  if (!ev) return null;
  const def = EVENTS[ev.key];
  const o = def.options.find((q) => q.id === optionId);
  if (!o || (o.cost && profile.credits < o.cost)) return null;
  const rng = new Rng(ev.seed, `event-${ev.key}`);
  let line = '';
  if (o.cost) profile.credits -= o.cost;
  switch (`${ev.key}/${o.id}`) {
    case 'stowaway/sign': {
      const t = makeCandidate(rng, { archetype: 'rookie' });
      profile.roster.push(t);
      line = `${t.name} signs on.`;
      break;
    }
    case 'stowaway/turn': profile.credits += 40; line = 'Forty credits for a deserter. Nobody feels good about it.'; break;
    case 'dealer/weapon': {
      const w = rollWeapon(rng, { luck: 1.4 });
      profile.stash.push(w);
      line = `${w.name} in the armoury.`;
      break;
    }
    case 'dealer/relic': {
      const k = rollRelic(rng, new Set(profile.relics ?? []));
      if (k) { profile.relics = [...(profile.relics ?? []), k]; line = `The case holds a ${RELICS[k].label}.`; } else { profile.credits += o.cost; line = 'The case is empty. The dealer refunds, sheepish.'; }
      break;
    }
    case 'wire/take': profile.boon = { pay: 1.5, danger: 1 }; line = 'Terms taken: the next job pays half again, and bites.'; break;
    case 'row/leave': for (const t of profile.roster) { t.progress ??= {}; t.progress.nrv = Math.min(0.99, (t.progress.nrv ?? 0) + 0.3); } line = 'Three days ashore. Steadier for it.'; break;
    case 'row/fester': {
      const bad = QUIRK_KEYS.filter((k) => !QUIRKS[k].good);
      const who = profile.roster.filter((t) => t.alive && (t.quirks ?? []).length < 3);
      if (who.length) { const t = who[rng.int(0, who.length - 1)]; const q = bad[rng.int(0, bad.length - 1)]; t.quirks = [...(t.quirks ?? []), q]; line = `${t.name} is ${QUIRKS[q].label.toLowerCase()} now.`; } else line = 'It blows over.';
      break;
    }
    case 'auction/sell': {
      const n = profile.stash.length;
      const cr = profile.stash.reduce((s, w) => s + (w.rarity === 'common' ? 60 : 120), 0);
      profile.stash = [];
      profile.credits += cr;
      line = n ? `${n} weapon${n === 1 ? '' : 's'} sold: +${cr} cr.` : 'Nothing to sell.';
      break;
    }
    case 'drop/stims': if (profile.upgrades.stims < 3) { profile.upgrades.stims++; line = 'Stim supply up a tier.'; } else { profile.credits += 90; line = 'The lockers are full: sold for 90 cr.'; } break;
    case 'drop/credits': profile.credits += 90; line = 'Sold: +90 cr.'; break;
    default: line = 'Nothing comes of it.';
  }
  profile.lastEvent = ev.key;
  profile.pendingEvent = null;
  return { key: ev.key, option: o.id, line };
}
