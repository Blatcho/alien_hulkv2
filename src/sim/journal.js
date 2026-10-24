// The ship's log: what happened aboard and when, kept by the simulation (world.journal) from the
// events it emits, so the HUD's message ticker (ui/hud.js), the map overlay (ui/map.js) and the
// debrief's timeline (ui/debrief.js) all read the same record - and tests can read it with no
// DOM at all. Entries are {id, t (mission seconds), kind, text}; kinds colour the line:
// info, good, warn, danger, loot.
export const JOURNAL_MAX = 400;

// How a trooper's breakdown reads (sim/breakdown.js modes).
const BROKE = { freeze: 'froze', flee: 'bolted', berserk: 'went berserk' };
// What the dead left behind, by what the squad found (world 'loot').
const FINDS = {
  food: () => ['Ration packs: energy for high alert', 'loot'],
  drink: () => ['Energy drinks: energy for high alert', 'loot'],
  weapon: (e) => [`Found a weapon: ${e.loot.item?.name ?? 'unknown'}`, 'loot'],
  defend: () => ['Found a Defend kit: twin sentry guns', 'loot'],
  treasure: (e) => [`Salvage: ${e.loot.item?.name ?? 'a crate'}, ${e.loot.item?.value ?? 0} cr`, 'loot'],
};
// Room types that read better without "the" ("Into engineering").
const BARE = new Set(['engineering', 'hydroponics', 'cargo', 'storage', 'quarters', 'barracks', 'specimens']);
// How an encounter's choice reads (sim/encounters.js kinds).
const PLACES = {
  locker: 'the sealed locker', terminal: 'the crew terminal', turret: 'the sentry turret', autodoc: 'the autodoc', eggs: 'the egg cluster',
  pod: 'the cryo pod', storeroom: 'the storeroom door', medbay: 'the sealed medbay', breach: 'the weak bulkhead', doorctl: 'the door controls',
  vent: 'the duct vent', junction: 'the power junction', firedoor: 'the burning doorway', hiding: 'the container',
};

export class Journal {
  constructor(world = null) {
    this.world = world;
    this.entries = [];
    this.seq = 0;
    this.lastContact = -9;
    if (world) this.listen(world);
  }

  /** One line, stamped with the mission clock. */
  add(text, kind = 'info', t = this.world?.time ?? 0) {
    const e = { id: ++this.seq, t, kind, text };
    this.entries.push(e);
    if (this.entries.length > JOURNAL_MAX) this.entries.splice(0, this.entries.length - JOURNAL_MAX);
    return e;
  }

  /** The last n lines, newest last. */
  recent(n = 4) { return this.entries.slice(-n); }

  /** The lines of one kind or more. */
  ofKind(...kinds) { return this.entries.filter((e) => kinds.includes(e.kind)); }

  listen(w) {
    const on = (ev, fn) => w.on(ev, (e) => { const r = fn(e ?? {}); if (r) this.add(r[0], r[1] ?? 'info'); });
    const name = (m) => m?.name ?? 'Someone';
    on('alien-wake', ({ alien }) => {
      if (!alien?.visible || w.time - this.lastContact < 3) return null;
      this.lastContact = w.time;
      return ['Contact', 'warn'];
    });
    on('ambush', () => ['Ambush', 'danger']);
    on('scream', ({ woke, called }) => ((woke ?? 0) + (called ?? 0) ? ['A scream: the deck is awake', 'danger'] : null));
    on('uplink-start', () => ['Uplink running: hold the command deck', 'warn']);
    on('uplink-done', () => ['Nav-lock secured', 'good']);
    on('loot', ({ loot }) => (loot && FINDS[loot.type] ? FINDS[loot.type]({ loot }) : null));
    on('keycard', () => ['Found a keycard: crew access, stores', 'loot']);
    on('brood-dead', ({ bonus }) => [`Brood mother killed: the nest dies with her${bonus ? `, +${bonus} cr` : ''}`, 'good']);
    on('survivor-found', ({ survivor }) => [`Survivor found: ${name(survivor)}, heading for the Kestrel`, 'good']);
    on('survivor-rescued', ({ survivor }) => [`${name(survivor)} aboard the Kestrel`, 'good']);
    on('survivor-died', ({ friendly }) => [friendly ? 'Friendly fire: a civilian killed' : 'A civilian lost', 'danger']);
    on('distress', ({ room }) => [`Distress call from deck ${(room?.deck ?? 0) + 1}`, 'warn']);
    on('distress-answered', ({ survivor }) => [`Distress call answered: ${name(survivor)} found`, 'good']);
    on('downed', ({ marine }) => [`${name(marine)} down`, 'danger']);
    on('revived', ({ marine, by, stim }) => [`${name(marine)} back on his feet${by ? `, ${name(by)}'s work` : ''}${stim ? ' (stim)' : ''}`, 'good']);
    on('mended', ({ marine }) => [`${name(marine)}'s wound mended`, 'good']);
    on('marine-died', ({ marine }) => [`${name(marine)} killed in action`, 'danger']);
    on('dragged', ({ marine }) => [`${name(marine)} dragged off`, 'danger']);
    on('drag-dropped', ({ marine }) => [`${name(marine)} dropped: shot off him`, 'good']);
    on('taken', ({ marine }) => [`${name(marine)} taken into the vents`, 'danger']);
    on('breakdown', ({ marine, mode }) => [`${name(marine)} ${BROKE[mode] ?? 'broke'}`, 'danger']);
    on('breakdown-over', ({ marine }) => [`${name(marine)} pulled himself together`, 'good']);
    on('morale', ({ level, worse }) => (worse && (level === 'shaken' || level === 'breaking') ? [`Squad ${level}`, 'warn'] : !worse && level === 'holding' ? ['Squad rallied', 'good'] : null));
    on('sentry-online', () => ['Sentry turret online: it fights for the squad', 'good']);
    on('sentry-dry', ({ sentry }) => [sentry?.deployed ? 'A sentry gun is dry' : 'The sentry turret is dry', 'warn']);
    on('defend', () => ['Sentry guns set up either side of the squad', 'good']);
    on('horde-warning', ({ size, seconds }) => [`Horde inbound: ${size ?? 'many'} in ${Math.round(seconds ?? 10)} s`, 'danger']);
    on('horde', () => ['Here they come', 'danger']);
    on('horde-over', () => ['Horde down', 'good']);
    on('hatch', ({ count }) => [count > 1 ? `${count} hatched from the eggs` : 'One hatched from the eggs', 'danger']);
    on('eggs-burnt', () => ['Egg cluster burnt out', 'good']);
    on('eggs-shot', () => ['Egg cluster shot up', 'info']);
    on('autodoc', ({ ok }) => [ok ? 'Autodoc cycle: everyone healed' : 'Autodoc cycle botched', ok ? 'good' : 'warn']);
    on('pod-opened', ({ pod }) => [`Cryo pod opened: ${pod?.kind === 'alien' ? 'something hostile' : pod?.kind === 'survivor' ? 'a survivor' : pod?.kind === 'cache' ? 'a sealed cache' : 'empty'}`, 'info']);
    on('unlocked', ({ cut }) => [cut ? 'Storeroom cut open' : 'Storeroom unlocked with the keycard', 'good']);
    on('welded', () => ['Door welded shut', 'info']);
    on('cut', () => ['Welded door cut open', 'info']);
    on('breach', () => ['Weak bulkhead blown: a doorway the ship never had', 'warn']);
    on('explosion', ({ grenade }) => (grenade ? null : ['Explosion', 'warn']));
    on('fuse-blown', ({ room }) => [`Fuse box shot out: ${room?.type ?? 'the room'} dark for good`, 'warn']);
    on('power-out', ({ deck }) => [`Deck ${(deck ?? 0) + 1}: power failure`, 'warn']);
    on('power-on', () => ['Power restored', 'good']);
    on('fire', () => ['A doorway on fire', 'warn']);
    on('fire-out', () => ['Fire out', 'good']);
    on('ship-clear', () => ['Ship clear: every hostile dead', 'good']);
    on('airlock-cycle', () => ['The lock cycled behind the squad', 'info']);
    on('enter-room', ({ room, first }) => (first && room ? [`Into ${room.type === 'cockpit' ? 'the command deck' : room.nest ? `a nest (${room.type})` : BARE.has(room.type) ? room.type : `the ${room.type}`}`, 'info'] : null));
    on('encounter', ({ kind, option, ok, marine }) => [`${name(marine)} at ${PLACES[kind] ?? kind}: ${String(option).replace(/-/g, ' ')}${ok === false ? ', failed' : ok === true ? ', done' : ''}`, ok === false ? 'warn' : 'info']);
    on('equip', ({ marine, item }) => [`${name(marine)} takes the ${item?.name ?? 'weapon'}`, 'loot']);
    on('control', ({ marine }) => [`${name(marine)} has point`, 'info']);
    on('hold', ({ on: held }) => [held ? 'Followers holding' : 'Followers on you', 'info']);
    on('contract', ({ kind, phase, why }) => (phase === 'return' ? ['Job done: back to the Kestrel', 'good'] : phase === 'failed' ? [`Contract failed: ${why ?? ''}`, 'danger'] : null));
    on('work-start', ({ marine, dur }) => [`${name(marine)} at the target: ${Math.round(dur ?? 0)} s of work`, 'info']);
    on('fuse-set', ({ seconds }) => [`Reactor charge set: ${Math.round(seconds ?? 0)} seconds`, 'danger']);
    on('beacon-planted', () => ['Beacon planted: the nest is awake', 'warn']);
    on('reactor-blown', () => ['The reactor went', 'danger']);
    on('extracted', ({ done }) => [done ? 'Everyone aboard the Kestrel: job done' : 'Everyone aboard the Kestrel', 'good']);
    on('won', () => ['Extraction: the derelict is ours', 'good']);
    on('lost', () => ['Squad lost', 'danger']);
  }
}

/** mm:ss of a mission clock. */
export const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
