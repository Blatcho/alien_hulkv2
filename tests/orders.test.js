// Standing orders changed mid-mission (the orders bar), energy for high alert, and running.
import { beforeAll, describe, expect, it } from 'vitest';
import { ENERGY, PACE, ROE } from '../src/core/config.js';
import { generateLevel } from '../src/gen/level.js';
import { initPhysics } from '../src/physics/physics.js';
import { PRESETS, nextOrder } from '../src/sim/doctrine.js';
import { makeCritter } from '../src/sim/entities.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };

describe('orders bar: standing orders changed mid-mission', () => {
  it('fire discipline and flashlights change at once; the squad acknowledges', () => {
    const w = new World(generateLevel('A1'), { params: { god: true } });
    let told = null;
    w.on('orders', (e) => { told = e; });
    run(w, 1);
    w.setOrder('roe', 'cautious');
    w.setOrder('light', 'off');
    run(w, 0.1);
    expect(w.settings.roe).toBe(ROE.CAUTIOUS);
    expect(w.settings.flashlight).toBe(false);
    expect(w.doctrine.cfg.roe).toBe('cautious');
    expect(told.cfg.light).toBe('off');
    w.setOrder('roe', 'bogus');
    run(w, 0.1);
    expect(w.doctrine.cfg.roe).toBe('cautious');
  });

  it('switching Standard to Direct sends the squad off on its own; back to Standard, it holds', () => {
    const w = new World(generateLevel('A1'), { params: { god: true }, doctrine: PRESETS.standard.doctrine });
    run(w, 10);
    expect(w.squad.state).toBe('hold');
    w.setOrder('route', 'direct');
    run(w, 60);
    expect(w.squad.leader.room).not.toBe(w.level.dock);
    w.setOrder('route', 'manual');
    // Let the current door or ladder finish, then they hold where they are.
    run(w, 15);
    const x = w.squad.leader.x;
    const room = w.squad.leader.room;
    run(w, 10);
    expect(w.squad.leader.room).toBe(room);
    expect(Math.abs(w.squad.leader.x - x)).toBeLessThan(0.5);
    // ...and Direct again finishes the job.
    w.setOrder('route', 'direct');
    run(w, 900);
    expect(w.status).toBe('won');
  }, 60000);

  it('hotkeys cycle an order, skipping what Standard cannot do', () => {
    const std = { ...PRESETS.standard.doctrine, loot: 'way' };
    expect(nextOrder(std, 'loot')).toBe('leave'); // way -> (all is off) -> leave
    expect(nextOrder({ ...std, route: 'direct' }, 'loot')).toBe('all');
    expect(nextOrder(std, 'roe')).toBe('alert');
    expect(nextOrder({ ...std, roe: 'alert' }, 'roe')).toBe('cautious');
  });

  it('under Standard nobody can be ordered to search everything', () => {
    const w = new World(generateLevel('A1'), { params: { god: true }, doctrine: PRESETS.standard.doctrine });
    w.setOrder('loot', 'all');
    run(w, 0.1);
    expect(w.doctrine.cfg.loot).toBe('way');
  });
});

describe('energy: high alert burns it; kills, vermin, food and drinks bring it back', () => {
  it('high alert drains energy until the squad stands down to normal', () => {
    const w = new World(generateLevel('A1'), { params: { god: true }, doctrine: { route: 'manual', roe: 'alert' } });
    expect(w.settings.roe).toBe(ROE.ALERT);
    w.energy = 3;
    run(w, 3);
    expect(w.energy).toBe(0);
    expect(w.settings.roe).toBe(ROE.NORMAL);
    // Too little left to go back on alert: refused until the squad has eaten.
    w.energy = ENERGY.MIN_TO_ENTER - 1;
    expect(w.setROE(ROE.ALERT)).toBe(false);
  });

  it('an alien kill, an animal, food and drinks all refill it', () => {
    const w = new World(generateLevel('A1'), { params: { god: true } });
    w.energy = 0;
    const alien = w.aliens.find((a) => a.alive);
    w.damage(alien, 9999, w.marines[0]);
    expect(w.energy).toBe(ENERGY.PER_KILL);
    const rat = makeCritter(w.rng, 0, 0, w.level.airlock);
    w.critters.push(rat);
    w.kill(rat, w.marines[0]);
    let e = ENERGY.PER_KILL + ENERGY.PER_CRITTER;
    expect(w.energy).toBe(e);
    w.resolveLoot({ loot: { type: 'food' } }, w.marines[0]);
    expect(w.energy).toBe((e += ENERGY.FOOD));
    w.resolveLoot({ loot: { type: 'drink' } }, w.marines[0]);
    expect(w.energy).toBe(Math.min(ENERGY.MAX, e + ENERGY.DRINK));
  });

  it('emptied on high alert, the bar comes back as the squad kills - and so does high alert', () => {
    const w = new World(generateLevel('A1'), { params: { god: true }, doctrine: { route: 'manual', roe: 'alert' } });
    w.energy = 1;
    run(w, 2);
    expect(w.energy).toBe(0);
    expect(w.settings.roe).toBe(ROE.NORMAL);
    const kills = Math.ceil((ENERGY.MAX * 0.5) / ENERGY.PER_KILL);
    for (const a of w.aliens.filter((q) => q.alive).slice(0, kills)) w.damage(a, 9999, w.marines[0]);
    expect(w.energy).toBeGreaterThanOrEqual(ENERGY.MAX * 0.5);
    run(w, 0.5);
    expect(w.settings.roe).toBe(ROE.ALERT); // the orders still say high alert: back on it
  });

  it('ships stock food and energy drinks in some containers', () => {
    let rations = 0;
    for (let i = 0; i < 20; i++) {
      rations += generateLevel(`FOOD${i}`).rooms.flatMap((r) => r.props).filter((p) => p.loot?.type === 'food' || p.loot?.type === 'drink').length;
    }
    expect(rations / 20).toBeGreaterThan(1.5);
  });
});

describe('fast pace and stamina', () => {
  it('on Fast the bar drains slowly while they run, and barely recovers at the stops', () => {
    const w = new World(generateLevel('A1'), { params: { god: true }, doctrine: { ...PRESETS.assault.doctrine, roe: 'normal' } });
    let ran = 0;
    let spent = 0;
    let lowest = Infinity;
    for (let i = 0; i < 70 * 60 && w.status === 'playing'; i++) {
      const m = w.marines[0];
      const before = m.stamina;
      const running = w.squad.pace === 'run' && w.squad.leader.moving;
      w.step(STEP);
      if (running && m.stamina > 0) { ran += STEP; spent += before - m.stamina; }
      lowest = Math.min(lowest, w.stamina);
    }
    expect(ran).toBeGreaterThan(20);
    // ~3 a second: a full bar lasts half a minute of running.
    expect(spent / ran).toBeCloseTo(PACE.DRAIN * w.marines[0].mods.drain, 1);
    expect(lowest).toBeLessThan(PACE.STAMINA_MAX * 0.6);
  }, 60000);

  it('out of breath, the squad drops to a walk until it has the wind to run again', () => {
    const w = new World(generateLevel('A1'), { params: { god: true }, doctrine: { ...PRESETS.assault.doctrine, roe: 'normal' } });
    for (let i = 0; i < 60 * 60 && !(w.squad.pace === 'run' && w.squad.leader.moving); i++) w.step(STEP);
    expect(w.squad.pace).toBe('run');
    for (const m of w.marines) m.stamina = 0.5;
    run(w, 1);
    expect(w.squad.pace).toBe('normal');
    run(w, 3);
    expect(w.squad.pace).toBe('normal'); // not before half a bar
  }, 60000);
});
