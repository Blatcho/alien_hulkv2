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

  it.each([
    ['A1', 240, { autoplay: true, god: true }, '19aad869'],
    ['G7', 240, { autoplay: true }, 'e798c7d0'],
  ])('golden digest: %s', (seed, seconds, params, golden) => {
    const h = hashString(digest(play(seed, seconds, params))).toString(16);
    expect(h).toBe(golden);
  });
});
