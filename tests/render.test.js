import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Actors } from '../src/render/actors.js';

describe('procedural gait layer', () => {
  it('does not accumulate on held poses (the mixer skips unchanged bones)', () => {
    const actors = new Actors(new THREE.Scene(), null);
    const bones = { hips: new THREE.Bone(), spine: new THREE.Bone(), chest: new THREE.Bone(), head: new THREE.Bone() };
    const v = { bones, root: new THREE.Object3D(), action: null, baseName: 'interact' };
    const e = { gait: { cadence: 1, lean: 9, sway: 4, bounce: 0.02, swagger: 5 } };
    // Simulate 600 frames where the mixer never rewrites the bones (a frozen pose).
    for (let i = 0; i < 600; i++) actors.applyGait(v, e);
    const lean = 9 * 0.35 * Math.PI / 180;
    expect(bones.spine.rotation.x).toBeCloseTo(lean, 5);
    expect(bones.head.rotation.x).toBeCloseTo(-lean * 0.6, 5);
  });

  it('re-applies on top of fresh mixer output each frame', () => {
    const actors = new Actors(new THREE.Scene(), null);
    const bones = { spine: new THREE.Bone() };
    const v = { bones, root: new THREE.Object3D(), action: null, baseName: 'aim' };
    const e = { gait: { cadence: 1, lean: 10, sway: 0, bounce: 0, swagger: 0 } };
    for (let i = 0; i < 50; i++) {
      bones.spine.rotation.set(0.2 + i * 0.001, 0, 0); // the mixer wrote a new value
      actors.applyGait(v, e);
      expect(bones.spine.rotation.x).toBeCloseTo(0.2 + i * 0.001 + 10 * 0.35 * Math.PI / 180, 5);
    }
  });
});
