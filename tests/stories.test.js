// Phase 5 of the procedural generation: derelict stories (gen/stories.js), the classes' set-piece
// pools, offers that avoid streaks (meta/ships.js), and halls two decks tall (gen/layout.js).
import { beforeAll, describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/config.js';
import { CLASS_KEYS, HULL_CLASSES, parseSeed, seedCode } from '../src/gen/classes.js';
import { generateLevel, roomAt } from '../src/gen/level.js';
import { STORIES, STORY_KEYS, storyFor } from '../src/gen/stories.js';
import { MODIFIERS, shipOffers } from '../src/meta/ships.js';
import { initPhysics } from '../src/physics/physics.js';
import { World } from '../src/sim/world.js';

const { DECK_H, SLAB } = WORLD;
const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const seeds = [...Array.from({ length: 40 }, (_, i) => `ST${i}`), ...CLASS_KEYS.flatMap((k) => Array.from({ length: 8 }, (_, i) => seedCode(k, `ST${i}`)))];

describe('derelict stories', () => {
  it('every ship tells one its class tells, the same from the seed alone, and the briefing can read it', () => {
    for (const s of seeds) {
      const L = generateLevel(s);
      expect(STORY_KEYS).toContain(L.story.key);
      expect((HULL_CLASSES[L.cls].stories ?? {})[L.story.key] ?? 1).toBeGreaterThan(0);
      const again = storyFor(parseSeed(L.seed).seed, L.cls);
      expect(again.key).toBe(L.story.key);
      expect(again.title).toBe(STORIES[L.story.key].title);
      expect(again.blurb.length).toBeGreaterThan(20);
    }
  });

  it('the story shapes the ship: the dead and what they carry, a sealed medbay, nests, survivors, the sentry', () => {
    const seen = new Set();
    const salvage = { ships: 0, sentries: 0 };
    for (const s of seeds) {
      const L = generateLevel(s);
      const S = L.story;
      seen.add(S.key);
      const bodies = L.rooms.flatMap((r) => r.props.filter((p) => p.kind === 'body'));
      // (A keycard carrier may add one; a crowded ship may lose one.)
      expect(bodies.length).toBeLessThanOrEqual(S.bodies[1] + 1);
      if (S.key === 'silence') expect(bodies.length).toBeLessThanOrEqual(2);
      for (const b of bodies) {
        // (Later passes hand some of the dead a keycard, rations or the sentry kit.)
        expect([...S.bodyLoot, 'empty', 'keycard', 'food', 'drink', 'defend']).toContain(b.loot.type);
      }
      if (S.key === 'quarantine') {
        const sealed = L.rooms.find((r) => r.sealed !== undefined);
        if (sealed) {
          expect(sealed.type).toBe('medbay');
          expect(L.portals[sealed.sealed].welded).toBe(true);
          expect(L.mainPath).not.toContain(sealed.id);
        }
      }
      if (S.key === 'salvage') { salvage.ships++; if (L.rooms.some((r) => r.props.some((p) => p.encounter === 'turret'))) salvage.sentries++; }
      if (S.key === 'evacuation') expect(L.spawns.survivors.length).toBeGreaterThanOrEqual(1);
      if (S.key === 'mutiny' || S.key === 'outbreak' || S.key === 'quarantine') expect(L.spawns.survivors.length).toBeLessThanOrEqual(2);
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
    // A salvage crew's sentry is a sure thing wherever a room suits one.
    expect(salvage.sentries).toBeGreaterThanOrEqual(salvage.ships * 0.7);
  });

  it('a sealed medbay is still a ship the squad can finish', () => {
    const L = seeds.map(generateLevel).find((l) => l.rooms.some((r) => r.sealed !== undefined));
    if (!L) return;
    const w = new World(L, { params: { autoplay: true, god: true } });
    for (let i = 0; i < 60 * 600 && w.status === 'playing'; i++) w.step(STEP);
    expect(w.status).toBe('won');
  }, 120000);
});

describe('the classes\' set pieces', () => {
  it('a research vessel keeps more on ice than a corvette; a corvette keeps more sentries', () => {
    let pods = { research: 0, corvette: 0 };
    let turrets = { research: 0, corvette: 0 };
    for (const cls of ['research', 'corvette']) {
      for (let i = 0; i < 40; i++) {
        const L = generateLevel(seedCode(cls, `OD${i}`));
        const props = L.rooms.flatMap((r) => r.props);
        pods[cls] += props.filter((p) => p.kind === 'cryopod').length;
        turrets[cls] += props.filter((p) => p.encounter === 'turret').length;
      }
    }
    expect(pods.research).toBeGreaterThan(pods.corvette);
    expect(turrets.corvette).toBeGreaterThan(turrets.research);
  });
});

describe('the offers', () => {
  const profile = (seedCounter, recent = []) => ({ seed: 'offers', seedCounter, threat: 1, recent });

  it('three ships, one plain, one twisted, one twisted twice, each with its story', () => {
    for (let i = 0; i < 30; i++) {
      const offers = shipOffers(profile(i));
      expect(offers).toHaveLength(3);
      expect(offers.map((o) => o.modifiers.length).sort()).toEqual([0, 1, 2]);
      expect(new Set(offers.map((o) => o.cls)).size).toBe(3);
      for (const o of offers) {
        expect(STORY_KEYS).toContain(o.story.key);
        expect(o.story.key).toBe(generateLevel(o.seed).story.key);
        for (const k of o.modifiers) expect(MODIFIERS[k]).toBeTruthy();
      }
    }
  });

  it('what was played lately comes up less', () => {
    let plain = 0;
    let steered = 0;
    for (let i = 0; i < 60; i++) {
      plain += shipOffers(profile(i)).filter((o) => o.cls === 'corvette').length;
      steered += shipOffers(profile(i, [{ cls: 'corvette', modifiers: ['infested'] }, { cls: 'corvette', modifiers: [] }])).filter((o) => o.cls === 'corvette').length;
    }
    expect(steered).toBeLessThan(plain * 0.7);
  });
});

describe('halls two decks tall', () => {
  it('some ships have one: nothing over it, no slab over it, walls either side of the void, both bands its own', () => {
    let halls = 0;
    for (const s of seeds) {
      const L = generateLevel(s);
      const tall = L.rooms.filter((r) => r.tall);
      expect(tall.length).toBeLessThanOrEqual(1);
      for (const h of tall) {
        halls++;
        expect(h.deck).toBeLessThan(L.decks - 1);
        expect(h.y1).toBeCloseTo(h.y0 + 2 * DECK_H - SLAB, 5);
        expect(h.type).not.toBe('airlock');
        expect(h.id).not.toBe(L.objective.room);
        expect(L.rooms.some((r) => r.deck === h.deck + 1 && r.x0 < h.x1 - 0.01 && r.x1 > h.x0 + 0.01)).toBe(false);
        const y = (h.deck + 1) * DECK_H;
        expect(L.solids.some((q) => q.kind === 'slab' && Math.abs(q.y1 - y) < 0.01 && q.x0 < h.x1 - 0.01 && q.x1 > h.x0 + 0.01)).toBe(false);
        for (const wx of [h.x0, h.x1]) {
          expect(L.solids.some((q) => q.kind === 'bulkhead' && Math.abs((q.x0 + q.x1) / 2 - wx) < 0.01 && q.y0 === y && q.y1 > y + 4)).toBe(true);
        }
        expect(roomAt(L, (h.x0 + h.x1) / 2, h.y0 + DECK_H + 1)).toBe(h.id);
        expect(roomAt(L, (h.x0 + h.x1) / 2, h.y0 + 1)).toBe(h.id);
        // No door across the void on the deck above, and no weak wall there either.
        const above = L.rooms.filter((r) => r.deck === h.deck + 1).sort((a, b) => a.x0 - b.x0);
        const left = above.filter((r) => r.x1 <= h.x0 + 0.01).pop();
        const right = above.find((r) => r.x0 >= h.x1 - 0.01);
        expect(left && right).toBeTruthy();
        expect(L.portals.some((p) => p.kind === 'door' && p.a === left.id && p.b === right.id)).toBe(false);
        expect(L.breaches.some((b) => b.a === left.id && b.b === right.id)).toBe(false);
      }
    }
    expect(halls).toBeGreaterThan(seeds.length / 5);
  });

  it('a ship with a hall plays through', () => {
    const L = seeds.map(generateLevel).find((l) => l.rooms.some((r) => r.tall && l.mainPath.includes(r.id)));
    expect(L).toBeTruthy();
    const w = new World(L, { params: { autoplay: true, god: true } });
    for (let i = 0; i < 60 * 600 && w.status === 'playing'; i++) w.step(STEP);
    expect(w.status).toBe('won');
  }, 120000);
});
