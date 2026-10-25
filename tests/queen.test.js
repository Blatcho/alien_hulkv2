// The queen's own art (tools/blender/queen.py -> public/assets/models/queen.glb): what the engine
// expects of the file, and how the sim and the actors wire it in (core/config.js ALIEN_TYPES.queen).
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALIEN_TYPES } from '../src/core/config.js';
import { Rng } from '../src/core/rng.js';
import { generateLevel } from '../src/gen/level.js';
import { initPhysics } from '../src/physics/physics.js';
import { makeAlien } from '../src/sim/entities.js';
import { World } from '../src/sim/world.js';

beforeAll(async () => { await initPhysics(); });

const glbJson = (path) => { const b = readFileSync(path); return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()); };
const manifest = JSON.parse(readFileSync('public/assets/models/manifest.json', 'utf8'));

describe('the queen\'s art', () => {
  it('is in the manifest with her clips, sockets and bounds at her true size', () => {
    const m = manifest.models.queen;
    expect(m).toBeTruthy();
    expect(m.file).toBe('queen.glb');
    expect(m.clips.map((c) => c.name)).toEqual(['idle', 'lurk', 'skitter', 'attack', 'hit', 'die']);
    expect(m.clips.find((c) => c.name === 'skitter').speed).toBeGreaterThan(1);
    for (const c of m.clips) expect(c.loop).toBe(!['hit', 'die'].includes(c.name));
    expect(m.sockets).toEqual(['socket_head', 'socket_mouth']);
    const h = m.bounds.max[1] - m.bounds.min[1];
    const len = m.bounds.max[2] - m.bounds.min[2];
    expect(h).toBeGreaterThan(3.0);   // about 2.3 alien heights, as the sim's scale says
    expect(h).toBeLessThan(4.2);
    expect(len).toBeGreaterThan(4.0); // the egg sac drags well behind her
    expect(m.bounds.min[1]).toBeGreaterThan(-0.05); // feet on the deck
  });

  it('the file carries every clip and socket, vertex colours, one skin, and stays in budget', () => {
    const gltf = glbJson('public/assets/models/queen.glb');
    const anims = gltf.animations.map((a) => a.name);
    for (const c of manifest.models.queen.clips) expect(anims).toContain(c.name);
    const nodes = new Set(gltf.nodes.map((n) => n.name));
    for (const s of manifest.models.queen.sockets) expect(nodes.has(s)).toBe(true);
    for (const b of ['hips', 'chest', 'head', 'jaw', 'ab1', 'ab4', 'sting', 'thighF.L', 'thighH.R', 'blade.L', 'hand.R']) expect(nodes.has(b)).toBe(true);
    expect(gltf.skins.length).toBe(1);
    const prims = gltf.meshes.flatMap((m) => m.primitives);
    expect(prims.every((p) => p.attributes.COLOR_0 !== undefined)).toBe(true);
    const tris = prims.reduce((s, p) => s + gltf.accessors[p.indices].count / 3, 0);
    expect(tris).toBeLessThanOrEqual(12000);
    expect(gltf.materials.map((m) => m.name).sort()).toEqual(['M_Base', 'M_Glow', 'M_GlowPink']);
  });

  it('the sim keeps her size for the hitbox while the actors draw her file at scale 1', () => {
    const T = ALIEN_TYPES.queen;
    expect(T.model).toBe('queen');
    expect(T.modelScale).toBe(1);
    expect(T.scale).toBe(2.3);
    expect(T.tint).toBeNull(); // (her colours are her own, not a tint over the alien's)
    const q = makeAlien(new Rng('Q', 'x'), 0, 0, 0, 'dormant', { type: 'queen' });
    expect(q).toMatchObject({ type: 'queen', model: 'queen', modelScale: 1, scale: 2.3, royal: true });
    expect(q.height).toBeCloseTo(1.5 * 2.3);
    const d = makeAlien(new Rng('Q', 'x'), 0, 0, 0, 'dormant', { type: 'drone' });
    expect(d.model).toBeNull();
    expect(d.modelScale).toBeNull();
  });

  it('a boss hulk puts her in her nest, awake to the squad like any brood mother', () => {
    const L = generateLevel('QN1', { mods: { boss: true } });
    expect(L.contract.kind).toBe('queen');
    const spawn = L.spawns.aliens.find((a) => a.type === 'queen');
    expect(spawn).toBeTruthy();
    expect(spawn.surface).toBe('floor');
    const w = new World(L, { params: { god: true } });
    const q = w.aliens.find((a) => a.type === 'queen');
    expect(q.alive).toBe(true);
    expect(q.anim).toBe('idle');
    expect(L.boss.room).toBe(q.room);
  });
});
