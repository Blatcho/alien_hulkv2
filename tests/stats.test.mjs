import test from 'node:test';
import assert from 'node:assert/strict';
import Stats, { XP_CURVE } from '../src/systems/Stats.js';

test('levelling raises stats and carries xp over', () => {
  const s = new Stats();
  const hp0 = s.maxHp;
  const gained = s.addXp(XP_CURVE(1) + 5);
  assert.equal(gained, 1);
  assert.equal(s.level, 2);
  assert.equal(s.xp, 5);
  assert.ok(s.maxHp > hp0);
  assert.equal(s.points, 2);
});

test('gear mods feed derived stats', () => {
  const s = new Stats();
  const base = s.baseDamage;
  s.equip({ slot: 'claws', name: 'Test Claws', mods: { damage: 10, crit: 0.1 } });
  assert.equal(s.baseDamage, base + 10);
  assert.ok(s.critChance > 0.1);
  s.equip({ slot: 'hide', name: 'Hide', mods: { armor: 30 } });
  assert.ok(s.damageTakenMult < 1);
  const json = JSON.parse(JSON.stringify(s));
  const s2 = new Stats(json);
  assert.equal(s2.baseDamage, s.baseDamage);
});
