// Determinism safety net. The same seed + squad + doctrine must replay identically, and the
// golden digests pin today's behaviour: a refactor that should change nothing (e.g. stats with
// every trooper at 5) must leave them untouched. Only update a golden value in a commit that
// is MEANT to change behaviour, and say why in the message.
import { beforeAll, describe, expect, it } from 'vitest';
import { hashString } from '../src/core/rng.js';
import { generateLevel } from '../src/gen/level.js';
import { initPhysics } from '../src/physics/physics.js';
import { World } from '../src/sim/world.js';
import { digest } from './helpers.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });

function play(seed, seconds, params) {
  const w = new World(generateLevel(seed), { params });
  for (let i = 0; i < Math.round(seconds / STEP) && w.status === 'playing'; i++) w.step(STEP);
  return w;
}

describe('determinism', () => {
  it('the same seed replays identically', () => {
    const a = digest(play('A1', 120, { autoplay: true, god: true }));
    const b = digest(play('A1', 120, { autoplay: true, god: true }));
    expect(a).toBe(b);
  });

  // One per hull class (gen/classes.js), plus the two bare seeds (which roll a research vessel
  // and a mirrored freighter). The hull classes changed every ship once, deliberately.
  it.each([
    ['A1', 240, { autoplay: true, god: true }, '39e5ff8d'],
    ['G7', 240, { autoplay: true }, '49aa1c6e'],
    ['CRV-A1', 240, { autoplay: true, god: true }, '94d5c974'],
    ['FRT-A1', 240, { autoplay: true, god: true }, '1c5bd7c1'],
    ['LNR-A1', 240, { autoplay: true, god: true }, '8b9f7977'],
    ['STN-A1', 240, { autoplay: true, god: true }, 'f8050daf'],
  ])('golden digest: %s', (seed, seconds, params, golden) => {
    const h = hashString(digest(play(seed, seconds, params))).toString(16);
    expect(h).toBe(golden);
  });
});
