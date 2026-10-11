import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rollItem, rollDrops, rollRarity, compareItems, validateItem, itemProblems, formatMod, rarityWeights,
} from '../src/systems/Loot.js';
import { RARITY, SLOTS, MOD_SCALE } from '../src/data/items.js';
import Stats from '../src/systems/Stats.js';

// mulberry32: tiny seeded PRNG so distributions are reproducible.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('rolled items are valid and deterministic with an injected rng', () => {
  const a = rollItem(5, { rng: seeded(42) });
  const b = rollItem(5, { rng: seeded(42) });
  assert.deepEqual(a, b);
  assert.ok(validateItem(a), itemProblems(a).join(', '));
  const rng = seeded(7);
  for (let i = 0; i < 2000; i++) {
    const item = rollItem(1 + (i % 30), { luck: (i % 5) * 0.3, rng });
    assert.ok(validateItem(item), `${JSON.stringify(item)}: ${itemProblems(item).join(', ')}`);
    assert.ok(SLOTS.includes(item.slot));
    assert.ok(item.name.length > 3);
    assert.match(item.name, /^[A-Za-z' -]+$/, 'names must only use glyphs the bitmap fonts contain');
  }
});

test('rarity distribution with no luck stays within expected bounds', () => {
  const rng = seeded(1234);
  const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
  const N = 20000;
  for (let i = 0; i < N; i++) counts[rollRarity(0, rng)] += 1;
  const w = rarityWeights(0);
  const total = Object.values(w).reduce((s, v) => s + v, 0);
  for (const r of Object.keys(counts)) {
    const expected = w[r] / total;
    const got = counts[r] / N;
    // generous tolerance: within 25% relative or 1 percentage point absolute
    assert.ok(Math.abs(got - expected) < Math.max(0.01, expected * 0.25), `${r}: got ${got.toFixed(4)} expected ${expected.toFixed(4)}`);
  }
  assert.ok(counts.common > counts.rare && counts.rare > counts.epic && counts.epic > counts.legendary);
});

test('luck improves rarity odds', () => {
  const N = 20000;
  const count = (luck, seed) => {
    const rng = seeded(seed);
    const c = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (let i = 0; i < N; i++) c[rollRarity(luck, rng)] += 1;
    return c;
  };
  const base = count(0, 99);
  const lucky = count(1, 99);
  assert.ok(lucky.common < base.common);
  assert.ok(lucky.legendary > base.legendary * 1.5);
  assert.ok(lucky.epic > base.epic);
});

test('mod counts follow rarity', () => {
  const rng = seeded(555);
  for (const rarity of Object.keys(RARITY)) {
    const [lo, hi] = RARITY[rarity].mods;
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      const item = rollItem(10, { rng, rarity });
      assert.equal(item.rarity, rarity);
      const n = Object.keys(item.mods).length;
      assert.ok(n >= lo && n <= hi, `${rarity} rolled ${n} mods`);
      seen.add(n);
    }
    if (rarity === 'legendary') { assert.ok(seen.has(3) && seen.has(4), 'legendary should roll both 3 and 4 mods'); }
  }
  // the signature mod is always present
  const claws = rollItem(3, { rng, slot: 'claws' });
  assert.ok(claws.mods.damage > 0);
  const hide = rollItem(3, { rng, slot: 'hide' });
  assert.ok(hide.mods.hp > 0);
  const charm = rollItem(3, { rng, slot: 'charm' });
  assert.ok(charm.mods.goldFind > 0);
});

test('mod values scale with level and rarity and respect caps', () => {
  const low = rollItem(1, { rng: seeded(3), slot: 'claws', rarity: 'common' });
  const high = rollItem(25, { rng: seeded(3), slot: 'claws', rarity: 'common' });
  assert.ok(high.mods.damage > low.mods.damage);
  let sumCommon = 0, sumLegendary = 0;
  for (let i = 0; i < 200; i++) {
    sumCommon += rollItem(10, { rng: seeded(i), slot: 'claws', rarity: 'common' }).mods.damage;
    sumLegendary += rollItem(10, { rng: seeded(i), slot: 'claws', rarity: 'legendary' }).mods.damage;
  }
  assert.ok(sumLegendary > sumCommon * 1.5);
  const rng = seeded(8);
  for (let i = 0; i < 500; i++) {
    const item = rollItem(200, { rng, rarity: 'legendary' });
    for (const [k, v] of Object.entries(item.mods)) assert.ok(v <= MOD_SCALE[k].max + 1e-9, `${k} ${v} exceeds cap`);
  }
});

test('items plug into Stats.equip', () => {
  const s = new Stats();
  const dmg0 = s.baseDamage;
  const claws = rollItem(4, { rng: seeded(11), slot: 'claws' });
  const prev = s.equip(claws);
  assert.equal(prev, null);
  assert.ok(s.baseDamage > dmg0);
  const hide = rollItem(4, { rng: seeded(12), slot: 'hide' });
  s.equip(hide);
  assert.ok(s.maxHp > 90 + 5 * 12);
  const json = JSON.parse(JSON.stringify(s));
  const s2 = new Stats(json);
  assert.ok(validateItem(s2.gear.claws));
  assert.equal(s2.baseDamage, s.baseDamage);
});

test('drop rates are sane', () => {
  const rng = seeded(2024);
  const N = 10000;
  const tally = (tier) => {
    const c = { gold: 0, potion: 0, item: 0, goldTotal: 0 };
    for (let i = 0; i < N; i++) {
      for (const d of rollDrops(tier, 5, { rng })) {
        c[d.type] += 1;
        if (d.type === 'gold') { assert.ok(Number.isInteger(d.amount) && d.amount > 0); c.goldTotal += d.amount; }
        if (d.type === 'item') assert.ok(validateItem(d.item), itemProblems(d.item).join(', '));
      }
    }
    return c;
  };
  const t1 = tally(1), t2 = tally(2), t3 = tally(3);
  assert.ok(t1.gold / N > 0.8 && t1.gold / N < 0.9, `gold rate ${t1.gold / N}`);
  assert.ok(t1.potion / N > 0.06 && t1.potion / N < 0.10, `potion rate ${t1.potion / N}`);
  assert.ok(t1.item / N > 0.10 && t1.item / N < 0.14, `item rate ${t1.item / N}`);
  assert.ok(t2.item > t1.item * 1.6 && t3.item > t2.item * 1.2, 'item chance scales with tier');
  assert.ok(t2.goldTotal > t1.goldTotal * 1.5, 'gold scales with tier');
});

test('bosses always drop an epic or better item', () => {
  const rng = seeded(77);
  for (let i = 0; i < 500; i++) {
    const drops = rollDrops('boss', 8, { rng });
    const items = drops.filter((d) => d.type === 'item');
    assert.ok(items.length >= 1);
    assert.ok(RARITY[items[0].item.rarity].rank >= RARITY.epic.rank, `boss dropped ${items[0].item.rarity}`);
    assert.ok(drops.some((d) => d.type === 'gold'));
  }
  const numeric = rollDrops(4, 8, { rng });
  assert.ok(numeric.some((d) => d.type === 'item' && RARITY[d.item.rarity].rank >= 2));
});

test('luck raises gold and item drops', () => {
  const N = 10000;
  const run = (luck, seed) => {
    const rng = seeded(seed);
    let gold = 0, items = 0;
    for (let i = 0; i < N; i++) for (const d of rollDrops(1, 5, { rng, luck })) { if (d.type === 'gold') gold += d.amount; if (d.type === 'item') items += 1; }
    return { gold, items };
  };
  const a = run(0, 5), b = run(1, 5);
  assert.ok(b.gold > a.gold * 1.5);
  assert.ok(b.items > a.items);
});

test('compareItems produces readable differences', () => {
  const a = { id: 'a', slot: 'claws', name: 'A', rarity: 'rare', level: 1, mods: { damage: 10, crit: 0.05 } };
  const b = { id: 'b', slot: 'claws', name: 'B', rarity: 'common', level: 1, mods: { damage: 6, reach: 0.04 } };
  const s = compareItems(a, b);
  assert.match(s, /DMG \+4/);
  assert.match(s, /CRIT \+5%/);
  assert.match(s, /REACH -4%/);
  assert.equal(compareItems(a, a), 'No change');
  assert.match(compareItems(a, null), /^New: DMG \+10/);
  assert.equal(compareItems(a, { ...b, slot: 'hide' }), 'Different slot');
  assert.equal(formatMod('armor', 15), 'ARMOR +15%');
  assert.equal(formatMod('regen', 1.25), 'REGEN +1.3');
  assert.equal(formatMod('goldFind', 0.12, { signed: false }), 'GOLD 12%');
});

test('validateItem rejects malformed items', () => {
  const good = rollItem(3, { rng: seeded(1) });
  assert.ok(validateItem(good));
  assert.ok(!validateItem(null));
  assert.ok(!validateItem({ ...good, slot: 'boots' }));
  assert.ok(!validateItem({ ...good, rarity: 'mythic' }));
  assert.ok(!validateItem({ ...good, mods: {} }));
  assert.ok(!validateItem({ ...good, mods: { ...good.mods, wings: 3 } }));
  assert.ok(!validateItem({ ...good, mods: { ...good.mods, damage: -1 } }));
  assert.ok(!validateItem({ ...good, rarity: 'legendary', mods: { damage: 1 } }), 'legendary needs 3+ mods');
});
