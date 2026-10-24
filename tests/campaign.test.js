// What a campaign carries between runs (phase C): relics (meta/relics.js) found aboard and
// applied to a run, quirks troopers pick up and treat (meta/quirks.js), wounds carried home
// (meta/profile.js), Kestrel events between runs (meta/events.js), and a field workshop's mods
// for the run (sim/fieldmods.js).
import { beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng.js';
import { generateLevel } from '../src/gen/level.js';
import { EVENTS, EVENT_KEYS, applyEvent, eventOptions, rollEvent } from '../src/meta/events.js';
import { UPGRADES, applyRun, deployable, fit, newProfile, treatQuirk, trooperMods } from '../src/meta/profile.js';
import { QUIRKS, QUIRK_MAX, TREAT_COST, earnQuirk, quirkMods } from '../src/meta/quirks.js';
import { RELICS, RELIC_KEYS, applyRelic, applyRelics, rollRelic } from '../src/meta/relics.js';
import { reachable } from '../src/meta/sector.js';
import { initPhysics } from '../src/physics/physics.js';
import { roeAllows } from '../src/sim/combat.js';
import { ROE } from '../src/core/config.js';
import { FIELD_MODS, applyFieldMod, benchOffer } from '../src/sim/fieldmods.js';
import { World } from '../src/sim/world.js';
import { traitChips } from '../src/ui/cards.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const until = (w, pred, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) { w.step(STEP); if (pred()) return true; } return false; };
function calm(seed, opts = {}) {
  const w = new World(generateLevel(seed), { params: { autoplay: true, god: true }, ...opts });
  for (const a of [...w.aliens, ...w.critters]) { a.alive = false; w.physics.removeHitbox(a); }
  w.reserve = 0;
  w.director.hordeSize = 0;
  w.shipEvents.list.length = 0;
  return w;
}
const result = (over = {}) => ({
  status: 'won', time: 400, kills: 10, credits: 100, salvage: 0, salvageItems: [], rescued: 0, cleared: false, stash: [], rewardMult: 1,
  troopers: [], contract: { kind: 'uplink', done: true, pay: 1 }, hordes: 0, survivorsAboard: 0, journal: [], relics: [], flags: {}, ...over,
});
const line = (t, over = {}) => ({ id: t.id, name: t.name, alive: true, wound: null, kills: 0, weaponItem: t.weaponItem, usage: {}, downs: 0, dragged: 0, escapesUsed: 0, searches: 0, lowAfterHorde: false, ...over });

describe('relics', () => {
  it('roll from a seed, never twice in one ship, never the queen\'s', () => {
    const rng = new Rng('relic', 'x');
    const taken = new Set();
    const got = [];
    for (let i = 0; i < RELIC_KEYS.length; i++) { const k = rollRelic(rng, taken); if (k) got.push(k); }
    expect(new Set(got).size).toBe(got.length);
    expect(got).not.toContain('queens_tooth');
    expect(rollRelic(rng, new Set(RELIC_KEYS))).toBe(null);
  });

  it('apply to a run as it starts, and the ship\'s cat keeps the vermin alive', () => {
    const w = calm('A1', { relics: ['surgeons_bag', 'charge_case', 'flare_rack', 'captains_key', 'plating', 'lucky_coin', 'ships_cat'] });
    expect(w.relics.size).toBe(7);
    expect(w.stims).toBe(3 + 2);
    expect(w.kit.charges).toBe(5);
    expect(w.kit.flares).toBe(5);
    expect(w.kit.keycards).toBe(1);
    expect(w.marines.every((m) => m.maxHp >= 115 && m.escapes >= 1)).toBe(true);
    const critter = { kind: 'critter', alive: true, moving: true };
    expect(roeAllows(ROE.NORMAL, critter, { attackedRecently: false })).toBe(true);
    expect(roeAllows(ROE.NORMAL, critter, { attackedRecently: false, quietVermin: true })).toBe(false);
    expect(applyRelic(w, 'surgeons_bag')).toBe(false); // not twice
    expect(applyRelic(w, 'nothing')).toBe(false);
    applyRelics(w, ['hive_scent']);
    expect(w.relics.has('hive_scent')).toBe(true);
  });

  it('a relic found aboard applies at once and comes home - unless the squad is wiped out', () => {
    const w = calm('A1');
    const prop = { id: 999, kind: 'safe', x: 0, room: 0, loot: { type: 'relic', key: 'flare_rack' } };
    const flares = w.kit.flares;
    w.resolveLoot(prop, w.marines[0]);
    expect(w.kit.flares).toBe(flares + 2);
    expect(w.relicsFound).toEqual(['flare_rack']);
    expect(w.results().relics).toEqual(['flare_rack']);
    expect(w.journal.entries.some((e) => e.text.includes('Flare rack'))).toBe(true);
    const p = newProfile('kestrel');
    applyRun(p, result({ relics: ['flare_rack', 'plating'] }), { node: reachable(p.sector)[0].id });
    expect(p.relics).toEqual(['flare_rack', 'plating']);
    applyRun(p, result({ relics: ['plating'] }), { node: reachable(p.sector)[0].id });
    expect(p.relics).toEqual(['flare_rack', 'plating']);
    applyRun(p, result({ status: 'lost', contract: { kind: 'uplink', done: false } }), { node: reachable(p.sector)[0].id });
    expect(p.relics).toEqual([]);
  });

  it('ships hold relics in their caches now and then, and the queen drops her tooth', () => {
    let relics = 0;
    for (let i = 0; i < 40; i++) {
      const L = generateLevel(`RL${i}`);
      const keys = L.rooms.flatMap((r) => r.props.filter((p) => p.loot?.type === 'relic').map((p) => p.loot.key));
      relics += keys.length;
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) expect(RELICS[k]).toBeTruthy();
    }
    expect(relics).toBeGreaterThan(4);
    const w = calm('Q0', { level: undefined });
    const q = { kind: 'alien', alive: true, hp: 1, maxHp: 1, births: true, royal: true, x: 0, y: 0, room: 0, type: 'queen' };
    w.aliens.push(q);
    w.physics.addHitbox(q, 1, 2, 4);
    w.kill(q, w.marines[0]);
    expect(w.relics.has('queens_tooth')).toBe(true);
    expect(w.relicsFound).toContain('queens_tooth');
  });
});

describe('quirks', () => {
  const T = (over = {}) => ({ id: 'x', name: 'X', stats: { str: 5, spd: 5, sta: 5, acc: 5, per: 5, int: 5, nrv: 5, lck: 5 }, loadout: { weapon: 'carbine' }, runs: 0, quirks: [], ...over });

  it('fold into a trooper\'s modifiers, multiplying or adding as the term wants', () => {
    const base = trooperMods(T());
    const mods = quirkMods(base, ['steady_hands', 'lucky', 'flinch']);
    expect(mods.spread).toBeCloseTo(base.spread * 0.92, 6);
    expect(mods.crit).toBeCloseTo(base.crit + 0.03, 6);
    expect(mods.aura).toBeCloseTo(base.aura - 1, 6);
    expect(trooperMods(T({ quirks: ['shaky'] })).reload).toBeCloseTo(base.reload * 1.12, 6);
    expect(quirkMods(base, ['nothing'])).toEqual(base);
  });

  it('are earned from what happened, one at most, never past the cap, never when dead', () => {
    const rng = new Rng('q', 'x');
    const sure = Object.assign(new Rng('q', 'y'), { chance: () => true });
    expect(earnQuirk(T(), line(T(), { kills: 20 }), {}, sure)).toBe('steady_hands');
    expect(earnQuirk(T(), line(T(), { downs: 1 }), {}, sure)).toBe('shaky');
    expect(earnQuirk(T(), line(T(), { dragged: 1 }), {}, sure)).toBe('flinch');
    expect(earnQuirk(T(), line(T()), { brood: true }, sure)).toBe('nightmares');
    expect(earnQuirk(T({ runs: 3 }), line(T()), {}, sure)).toBe('hardened');
    expect(earnQuirk(T(), line(T(), { alive: false, kills: 30 }), {}, sure)).toBe(null);
    expect(earnQuirk(T({ quirks: ['steady_hands'] }), line(T(), { kills: 30 }), {}, sure)).toBe(null);
    expect(earnQuirk(T({ quirks: ['a', 'b', 'c'] }), line(T(), { kills: 30 }), {}, sure)).toBe(null);
    expect(earnQuirk(T(), line(T()), {}, rng)).toBe(null);
    expect(QUIRK_MAX).toBe(3);
  });

  it('a bad one is treated at the Kestrel for credits; a good one stays', () => {
    const p = newProfile('kestrel');
    const t = p.roster[0];
    t.quirks = ['shaky', 'lucky'];
    p.credits = TREAT_COST - 1;
    expect(treatQuirk(p, t.id, 'shaky')).toBe(false);
    p.credits = TREAT_COST;
    expect(treatQuirk(p, t.id, 'lucky')).toBe(false);
    expect(treatQuirk(p, t.id, 'shaky')).toBe(true);
    expect(t.quirks).toEqual(['lucky']);
    expect(p.credits).toBe(0);
    expect(traitChips(t)).toContain('quirk good');
    expect(traitChips({ ...t, quirks: [], rest: 1, wound: 'leg' })).toContain('LEG WOUND');
    expect(traitChips({ ...t, quirks: [] })).toBe('');
    expect(Object.values(QUIRKS).every((q) => q.label && q.text && q.mods)).toBe(true);
  });

  it('come home from a run: a man down comes back shaky', () => {
    const p = newProfile('kestrel');
    const t = p.roster[0];
    const sure = () => true;
    let got = null;
    for (let i = 0; i < 12 && !got; i++) {
      const q = newProfile(`k${i}`);
      const d = applyRun(q, result({ troopers: [line(q.roster[0], { downs: 1 })] }), { node: reachable(q.sector)[0].id });
      got = d.troopers[0].quirk;
    }
    expect(got).toBe('shaky');
    void t; void sure;
  });
});

describe('wounds carried home', () => {
  it('without a medbay a wounded trooper sits the next run out, then is fit again', () => {
    const p = newProfile('kestrel');
    const t = p.roster[0];
    const d = applyRun(p, result({ troopers: [line(t, { wound: 'leg' })] }), { node: reachable(p.sector)[0].id });
    expect(d.troopers[0].wound).toBe('leg');
    expect(t.rest).toBe(1);
    expect(fit(t)).toBe(false);
    expect(deployable(p).map((q) => q.id)).not.toContain(t.id);
    // A run he sits out: fit again after it.
    applyRun(p, result({ troopers: p.roster.slice(1).map((q) => line(q)) }), { node: reachable(p.sector)[0].id });
    expect(t.rest).toBe(0);
    expect(t.wound).toBe(null);
    expect(fit(t)).toBe(true);
  });

  it('the Kestrel medbay heals wounds on the way home', () => {
    const p = newProfile('kestrel');
    expect(UPGRADES.medbay.costs.length).toBe(1);
    p.upgrades.medbay = 1;
    const t = p.roster[0];
    const d = applyRun(p, result({ troopers: [line(t, { wound: 'arm' })] }), { node: reachable(p.sector)[0].id });
    expect(d.troopers[0].wound).toBe('healed');
    expect(fit(t)).toBe(true);
  });
});

describe('Kestrel events', () => {
  it('roll now and then after a run, never the same twice running, and each option does what it says', () => {
    let rolled = 0;
    for (let i = 0; i < 30; i++) { const p = newProfile(`e${i}`); p.runs = i; if (rollEvent(p)) rolled++; }
    expect(rolled).toBeGreaterThan(8);
    expect(rolled).toBeLessThan(30);
    for (const key of EVENT_KEYS) {
      for (const o of EVENTS[key].options) {
        const p = newProfile('ev');
        p.credits = 500;
        p.stash = [{ name: 'Old gun', rarity: 'common', cls: 'carbine', affixes: [] }];
        p.pendingEvent = { key, seed: 'ev/1' };
        const before = { credits: p.credits, roster: p.roster.length, stash: p.stash.length, relics: p.relics.length, stims: p.upgrades.stims };
        const r = applyEvent(p, o.id);
        expect(r.key).toBe(key);
        expect(r.line.length).toBeGreaterThan(3);
        expect(p.pendingEvent).toBe(null);
        expect(p.lastEvent).toBe(key);
        if (o.cost) expect(p.credits).toBeLessThanOrEqual(before.credits - o.cost + 90);
        if (key === 'stowaway' && o.id === 'sign') expect(p.roster.length).toBe(before.roster + 1);
        if (key === 'stowaway' && o.id === 'turn') expect(p.credits).toBe(before.credits + 40);
        if (key === 'dealer' && o.id === 'weapon') expect(p.stash.length).toBe(before.stash + 1);
        if (key === 'dealer' && o.id === 'relic') expect(p.relics.length).toBe(before.relics + 1);
        if (key === 'wire' && o.id === 'take') expect(p.boon).toEqual({ pay: 1.5, danger: 1 });
        if (key === 'row' && o.id === 'fester') expect(p.roster.some((t) => (t.quirks ?? []).some((k) => !QUIRKS[k].good))).toBe(true);
        if (key === 'auction' && o.id === 'sell') { expect(p.stash.length).toBe(0); expect(p.credits).toBe(before.credits + 60); }
        if (key === 'drop' && o.id === 'stims') expect(p.upgrades.stims).toBe(before.stims + 1);
      }
    }
    const p = newProfile('poor');
    p.credits = 10;
    p.pendingEvent = { key: 'dealer', seed: 's' };
    expect(eventOptions(p, p.pendingEvent).map((o) => o.off)).toEqual([true, true, false]);
    expect(applyEvent(p, 'weapon')).toBe(null);
    const q = newProfile('ev2');
    const sameTwice = [];
    for (let i = 0; i < 40; i++) { q.runs = i; q.lastEvent = 'wire'; const e = rollEvent(q); if (e) sameTwice.push(e.key); }
    expect(sameTwice).not.toContain('wire');
  });
});

describe('field mods', () => {
  it('the bench offers three from the seed; one fitted changes every weapon for the run', () => {
    const offer = benchOffer('A1');
    expect(offer.length).toBe(3);
    expect(new Set(offer).size).toBe(3);
    expect(benchOffer('A1')).toEqual(offer);
    const w = calm('A1');
    const m = w.marines[0];
    const range = m.weapon.range;
    const mag = m.weapon.mag;
    expect(applyFieldMod(w, 'scope')).toBe(true);
    expect(m.weapon.range).toBeCloseTo(range * 1.2, 5);
    expect(applyFieldMod(w, 'scope')).toBe(false);
    expect(applyFieldMod(w, 'drum')).toBe(true);
    expect(m.weapon.mag).toBe(Math.round(mag * 1.4));
    expect(m.mag).toBe(m.weapon.mag); // the magazine in hand grew with it
    expect(w.results().fieldMods).toEqual(['scope', 'drum']);
    expect(Object.values(FIELD_MODS).every((f) => f.label && f.text && f.apply)).toBe(true);
  });

  it('a workshop aboard: a sweeping squad stops at it, picks a mod, and carries it the rest of the run', () => {
    // (A sweep goes through every room; the bench is wherever the engineers left it.)
    for (let i = 0; i < 30; i++) {
      const L = generateLevel(`WB${i}`);
      if (!L.rooms.some((r) => r.props.some((p) => p.encounter === 'workbench'))) continue;
      const w = new World(L, { params: { autoplay: true, god: true }, doctrine: { route: 'thorough', loot: 'all' } });
      for (const a of [...w.aliens, ...w.critters]) { a.alive = false; w.physics.removeHitbox(a); }
      w.reserve = 0; w.director.hordeSize = 0; w.shipEvents.list.length = 0;
      let offered = null;
      w.on('decision', (d) => { if (d.kind === 'workbench') offered = d; });
      if (!until(w, () => !!offered, 400)) continue;
      expect(offered.options.filter((o) => o.id !== 'leave').length).toBe(3);
      const pick = offered.options[0];
      w.choose(pick.id);
      expect(until(w, () => w.fieldMods.length > 0, 20)).toBe(true);
      expect(w.fieldMods).toEqual([pick.id]);
      expect(w.journal.entries.some((e) => e.text.includes('fitted'))).toBe(true);
      return;
    }
    throw new Error('no ship whose sweep reached a workshop');
  }, 240000);

  it('left to its orders, a quiet squad takes the suppressors and a loud one hits harder', () => {
    const L = generateLevel('A1');
    const w = new World(L, { params: { autoplay: true, god: true }, doctrine: { roe: 'cautious', pace: 'stealthy' } });
    const d = { kind: 'workbench', options: [{ id: 'hollow' }, { id: 'suppressor' }, { id: 'drum' }, { id: 'leave' }] };
    expect(w.doctrine.encounterChoice(d)).toBe('suppressor');
    const loud = new World(L, { params: { autoplay: true, god: true }, doctrine: { roe: 'alert', pace: 'fast' } });
    expect(loud.doctrine.encounterChoice(d)).toBe('hollow');
    expect(loud.doctrine.encounterChoice({ kind: 'workbench', options: [{ id: 'bipod' }, { id: 'leave' }] })).toBe('bipod');
  });
});
