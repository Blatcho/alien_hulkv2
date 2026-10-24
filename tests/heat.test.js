// Heat (meta/heat.js): conditions switched on for pay, folded into the ship's mods like the
// difficulty - what each does to the ship and the squad, what they pay, how they travel.
import { beforeAll, describe, expect, it } from 'vitest';
import { KIT, PACE, SQUAD } from '../src/core/config.js';
import { generateLevel } from '../src/gen/level.js';
import { DEFAULT_DIFFICULTY } from '../src/meta/difficulty.js';
import { HEAT, HEAT_KEYS, fitHeat, heatDanger, heatPay, heatSquad, heatString, parseHeat, withHeat } from '../src/meta/heat.js';
import { initPhysics } from '../src/physics/physics.js';
import { PRESETS } from '../src/sim/doctrine.js';
import { World } from '../src/sim/world.js';
import { Minimap } from '../src/ui/minimap.js';
import { settingsChips } from '../src/ui/settings.js';

beforeAll(async () => { await initPhysics(); });
const ship = (heat, seed = 'A1') => generateLevel(seed, { mods: withHeat({}, heat) });
const world = (heat, opts = {}) => new World(ship(heat), { params: { god: true }, ...opts });

describe('heat', () => {
  it('knows its conditions, in the table\'s order, once each; goes in the URL and comes back', () => {
    expect(fitHeat(['thin_air', 'lights_out', 'lights_out', 'nope'])).toEqual(['lights_out', 'thin_air']);
    expect(fitHeat(null)).toEqual([]);
    expect(heatString(['thin_air', 'lights_out'])).toBe('lights_out.thin_air');
    expect(parseHeat('lights_out.thin_air.x')).toEqual(['lights_out', 'thin_air']);
    expect(parseHeat(null)).toEqual([]);
    for (const k of HEAT_KEYS) { expect(HEAT[k].pay).toBeGreaterThan(0); expect(HEAT[k].danger).toBeGreaterThan(0); expect(HEAT[k].label).toBeTruthy(); }
  });

  it('nothing on changes nothing; everything on folds into the mods and names itself', () => {
    const mods = { cols: 20 };
    expect(withHeat(mods, [])).toBe(mods);
    const m = withHeat({ calm: 0.8 }, HEAT_KEYS);
    expect(m.blackout).toBe(true);
    expect(m.rations).toBe(0.5);
    expect(m.breath).toBe(0.6);
    expect(m.tracker).toBe(0);
    expect(m.calm).toBeCloseTo(0.4);
    expect(m.heat).toEqual(HEAT_KEYS);
  });

  it('pays, and counts danger and heads, by what is on', () => {
    expect(heatPay([])).toBe(1);
    expect(heatPay(['lights_out', 'skeleton_crew'])).toBe(1.5);
    expect(heatDanger(['lights_out', 'skeleton_crew'])).toBe(3);
    expect(heatSquad([])).toBe(4);
    expect(heatSquad(['lights_out'])).toBe(4);
    expect(heatSquad(['skeleton_crew'])).toBe(3);
  });

  it('short rations: half the stims and kit, before the upgrades add theirs', () => {
    const w = world(['short_rations'], { upgrades: { stims: 1 } });
    expect(w.stims).toBe(Math.floor(SQUAD.STIMS / 2) + 1);
    expect(w.kit.charges).toBe(Math.floor(KIT.CHARGES / 2));
    expect(w.kit.grenades).toBe(Math.floor(KIT.GRENADES / 2));
    expect(w.kit.flares).toBe(Math.floor(KIT.FLARES / 2));
    const plain = world([]);
    expect(plain.stims).toBe(SQUAD.STIMS);
    expect(plain.kit.charges).toBe(KIT.CHARGES);
  });

  it('thin air: the squad is winded at 60% of its breath', () => {
    expect(world(['thin_air']).staminaMax).toBeCloseTo(PACE.STAMINA_MAX * 0.6);
    expect(world([]).staminaMax).toBeCloseTo(PACE.STAMINA_MAX);
  });

  it('tracker dead: the motion tracker reaches nothing', () => {
    const range = (w) => { const m = Object.create(Minimap.prototype); m.world = w; return m.range; };
    expect(range(world([]))).toBeGreaterThan(0);
    expect(range(world(['tracker_dead']))).toBe(0);
  });

  it('lights out: the ship is dark; wide awake: the calm between ambushes halves', () => {
    const dark = ship(['lights_out']);
    const inside = dark.rooms.filter((r) => !r.exterior && r.type !== 'airlock');
    expect(inside.length).toBeGreaterThan(5);
    expect(inside.every((r) => r.light === 'dim' || r.light === 'flicker')).toBe(true);
    const calm = world([]).tuning.calm;
    expect(world(['wide_awake']).tuning.calm).toEqual(calm.map((c) => c * 0.5));
  });

  it('the results say what the run was played under; the settings chip counts it', () => {
    expect(world(['lights_out', 'thin_air']).results().heat).toEqual(['lights_out', 'thin_air']);
    expect(world([]).results().heat).toEqual([]);
    const chips = settingsChips(PRESETS.standard.doctrine, DEFAULT_DIFFICULTY, 'squad', 'standard', ['lights_out']);
    const heat = chips.find((c) => c.k === 'heat');
    expect(heat.value).toBe('1 on (+20%)');
    expect(heat.changed).toBe(true);
    expect(settingsChips(PRESETS.standard.doctrine, DEFAULT_DIFFICULTY).find((c) => c.k === 'heat')).toMatchObject({ value: 'Off', changed: false });
  });
});
