// The streamlined interface's data: the ship's log (sim/journal.js), the launch screen's
// cards and settings chips (ui/cards.js, ui/settings.js), and the ship map's model (ui/map.js).
// No DOM: everything the screens draw is computed first.
import { beforeAll, describe, expect, it } from 'vitest';
import { STATS } from '../src/core/config.js';
import { generateLevel } from '../src/gen/level.js';
import { DEFAULT_DIFFICULTY } from '../src/meta/difficulty.js';
import { initPhysics } from '../src/physics/physics.js';
import { PRESETS } from '../src/sim/doctrine.js';
import { JOURNAL_MAX, Journal, clock } from '../src/sim/journal.js';
import { World } from '../src/sim/world.js';
import { rolesHtml, squadRoles, standouts, statChips, trooperCard } from '../src/ui/cards.js';
import { mapModel } from '../src/ui/map.js';
import { ORDER_TILES, tileOf } from '../src/ui/orders.js';
import { allDefault, presetOf, settingsChips } from '../src/ui/settings.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const calm = (seed = 'A1', opts = {}) => {
  const w = new World(generateLevel(seed), { params: { god: true }, ...opts });
  for (const a of [...w.aliens, ...w.critters]) { a.alive = false; w.physics.removeHitbox(a); }
  w.reserve = 0;
  w.shipEvents.list.length = 0;
  return w;
};
const T = (name, stats, extra = {}) => ({ id: name.toLowerCase(), name, rank: 'SGT.', archetype: 'veteran', tint: '#888', stats: Object.fromEntries(STATS.KEYS.map((k, i) => [k, stats[i]])), weaponItem: { name: 'Standard Carbine', rarity: 'common' }, loadout: { weapon: 'carbine' }, ...extra });

describe('the ship\'s log', () => {
  it('writes what the world emits, stamped with the clock, and the results carry it', () => {
    const w = calm();
    expect(w.journal).toBeInstanceOf(Journal);
    const n0 = w.journal.entries.length;
    for (let i = 0; i < 90; i++) w.step(STEP);
    w.emit('downed', { marine: w.marines[0] });
    w.emit('loot', { loot: { type: 'treasure', item: { name: 'Gold bars', value: 120 } } });
    w.emit('power-out', { deck: 1 });
    const es = w.journal.entries.slice(n0);
    expect(es.map((e) => e.kind)).toEqual(['danger', 'loot', 'warn']);
    expect(es[0].text).toBe(`${w.marines[0].name} down`);
    expect(es[1].text).toContain('Gold bars');
    expect(es[2].text).toBe('Deck 2: power failure');
    for (const e of es) expect(e.t).toBeCloseTo(1.5, 1);
    expect(w.results().journal).toBe(w.journal.entries);
    expect(clock(es[0].t)).toBe('0:01');
    expect(clock(125)).toBe('2:05');
  });

  it('one contact at a time, nothing for a sleeper nobody saw, and the log never grows past its cap', () => {
    const w = calm();
    const n0 = w.journal.entries.length;
    const a = { visible: true };
    w.emit('alien-wake', { alien: a });
    w.emit('alien-wake', { alien: a });
    w.emit('alien-wake', { alien: { visible: false } });
    expect(w.journal.entries.slice(n0).map((e) => e.text)).toEqual(['Contact']);
    for (let i = 0; i < 60 * 4; i++) w.step(STEP);
    w.emit('alien-wake', { alien: a });
    expect(w.journal.entries.slice(n0).map((e) => e.text)).toEqual(['Contact', 'Contact']);
    for (let i = 0; i < JOURNAL_MAX + 50; i++) w.journal.add(`line ${i}`);
    expect(w.journal.entries.length).toBe(JOURNAL_MAX);
    expect(w.journal.recent(2).map((e) => e.text)).toEqual([`line ${JOURNAL_MAX + 48}`, `line ${JOURNAL_MAX + 49}`]);
    expect(w.journal.ofKind('danger', 'good').every((e) => e.kind === 'danger' || e.kind === 'good')).toBe(true);
  });

  it('a real run writes a boarding and the rooms entered, and the debrief gets only the notable lines', () => {
    const w = calm('A1', { params: { autoplay: true, god: true } });
    for (let i = 0; i < 60 * 40; i++) w.step(STEP);
    const texts = w.journal.entries.map((e) => e.text);
    expect(texts.some((t) => t.startsWith('Into '))).toBe(true);
    expect(texts.some((t) => t.includes('lock cycled'))).toBe(true);
    const notable = w.results().journal.filter((e) => e.kind !== 'info');
    expect(notable.every((e) => ['warn', 'danger', 'good', 'loot'].includes(e.kind))).toBe(true);
  });
});

describe('the cards', () => {
  const eyes = T('Marsh', [5, 7, 7, 6, 10, 7, 6, 4]);
  const slow = T('Park', [9, 3, 10, 5, 5, 3, 7, 4]);
  const even = T('Kane', [5, 5, 5, 5, 5, 5, 5, 5]);

  it('the stats that stand out: the best two at 7+, the worst at 4 or under', () => {
    expect(standouts(eyes).high.map((q) => `${q.k}${q.v}`)).toEqual(['per10', 'spd7']);
    expect(standouts(eyes).low).toEqual({ k: 'lck', v: 4 });
    expect(standouts(slow).high.map((q) => q.k)).toEqual(['sta', 'str']);
    expect(standouts(slow).low).toEqual({ k: 'spd', v: 3 });
    expect(standouts(even)).toEqual({ high: [], low: null });
    expect(statChips(even)).toContain('Even');
    expect(statChips(eyes)).toContain('PER <b>10</b>');
    expect(statChips(eyes)).toContain('chip lo');
  });

  it('a card carries its id, rank colour, slot badge and chips - or the bars on request', () => {
    const html = trooperCard(eyes, { slot: 0, slots: ['POINT', '#2', '#3', 'REAR'] });
    expect(html).toContain('data-id="marsh"');
    expect(html).toContain('--rank:#4f9dff');
    expect(html).toContain('class="slot ');
    expect(html).toContain('>POINT<');
    expect(html).toContain('class="chips"');
    expect(html).not.toContain('class="sb"');
    expect(trooperCard(eyes, { slot: 1, bars: true })).toContain('class="sb"');
    expect(trooperCard(eyes, { slot: 0, lead: true, slots: ['YOU', '#2', '#3', '#4'] })).toContain('slot you');
    expect(trooperCard(eyes, { slot: -1 })).not.toContain('class="slot');
    expect(trooperCard(eyes, { slot: 0, level: 3 })).toContain('LV 3');
  });

  it('who does what: the tech, the eyes, the pace and the breath, from the four picked', () => {
    const { rows, avg } = squadRoles([slow, eyes, even]);
    expect(rows.map((r) => r[0])).toEqual(['Tech & medic', 'Sharpest eyes', 'Sets the pace', 'First winded']);
    expect(rows[0][1]).toContain('Marsh');
    expect(rows[1][1]).toContain('Marsh');
    expect(rows[1][2]).toBe('best on point');
    expect(rows[2][1]).toContain('Park · SPD 3');
    expect(rows[3][1]).toContain('Kane');
    expect(avg.str).toBe(6.3);
    const lead = squadRoles([eyes, slow], true);
    expect(lead.rows[0][0]).toBe('You');
    expect(lead.rows[1][2]).toContain('you');
    expect(squadRoles([]).rows).toEqual([]);
    expect(rolesHtml([eyes])).toContain('class="sum"');
  });
});

describe('the settings chips', () => {
  it('fold the orders and the difficulty into one line, flagging what is not the default', () => {
    const chips = settingsChips(PRESETS.standard.doctrine, DEFAULT_DIFFICULTY);
    expect(chips.map((c) => c.k)).toEqual(['orders', 'enemies', 'strength', 'ship', 'hordes']);
    expect(chips[0].value).toBe('Manual');
    expect(allDefault(chips)).toBe(true);
    const hot = settingsChips(PRESETS.assault.doctrine, { ...DEFAULT_DIFFICULTY, enemies: 'swarm' });
    expect(hot[0]).toMatchObject({ value: 'Assault', changed: true });
    expect(hot.find((c) => c.k === 'enemies')).toMatchObject({ value: 'Swarm', changed: true });
    expect(allDefault(hot)).toBe(false);
    expect(settingsChips({ ...PRESETS.assault.doctrine, pace: 'steady' }, DEFAULT_DIFFICULTY, 'squad', 'assault')[0].value).toBe('Assault (adjusted)');
    expect(settingsChips({ ...PRESETS.assault.doctrine, pace: 'steady' }, DEFAULT_DIFFICULTY)[0].value).toBe('Custom');
    expect(settingsChips({ ...PRESETS.recon.doctrine, light: 'on', loot: 'all' }, DEFAULT_DIFFICULTY)[0].value).toBe('Custom');
  });

  it('lead mode shows the followers\' four orders instead of a preset', () => {
    const chips = settingsChips({ ...PRESETS.standard.doctrine, roe: 'alert' }, DEFAULT_DIFFICULTY, 'lead');
    expect(chips.slice(0, 4).map((c) => c.k)).toEqual(['roe', 'stims', 'light', 'kit']);
    expect(chips[0]).toMatchObject({ label: 'Fire', value: 'High alert', changed: true });
    expect(chips[1].changed).toBe(false);
    expect(presetOf(PRESETS.recon.doctrine)).toBe('recon');
    expect(presetOf({ ...PRESETS.recon.doctrine, kit: 'save' })).toBe(null);
    expect(ORDER_TILES.map((t) => t.knob)).toEqual(['route', 'roe', 'pace', 'loot', 'stims', 'light', 'kit']);
    expect(tileOf('roe').short.alert).toBe('High alert');
  });
});

describe('the ship map', () => {
  it('shows every deck, what the squad has seen, the squad, the objective and the log', () => {
    const w = calm('A1', { params: { autoplay: true, god: true } });
    for (let i = 0; i < 60 * 30; i++) w.step(STEP);
    const M = mapModel(w);
    expect(M.decks.length).toBe(w.level.decks);
    expect(M.decks.every((d) => d.rooms.every((r) => r.explored || r.seen))).toBe(true);
    expect(M.decks.flatMap((d) => d.rooms).length).toBeGreaterThan(0);
    expect(M.decks.flatMap((d) => d.rooms).length).toBeLessThan(w.level.rooms.length);
    expect(M.squad.length).toBe(4);
    expect(M.squad.filter((m) => m.lead).length).toBe(1);
    expect(M.objective.room).toBe(w.level.objective.room);
    expect(M.explored).toBeGreaterThan(1);
    expect(M.rooms).toBe(w.level.rooms.length);
    expect(M.lifesigns).toBe(w.lifesigns());
    expect(M.log.length).toBeGreaterThan(0);
    expect(M.log.length).toBeLessThanOrEqual(14);
    expect(M.story.key).toBe(w.level.story.key);
    expect(M.portals.every((p) => (w.level.rooms[p.a].seen || w.level.rooms[p.a].explored) && (w.level.rooms[p.b].seen || w.level.rooms[p.b].explored))).toBe(true);
    expect(M.caches).toEqual([]); // no deck plans pulled yet
    w.intel = true;
    expect(mapModel(w).caches.length).toBeGreaterThan(0);
    expect(M.kit.stims).toBe(w.stims);
  });
});
