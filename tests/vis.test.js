import { describe, expect, it } from 'vitest';
import { inside, segmentsNear, visibilityPolygon } from '../src/vis/polygon.js';

// Two rooms side by side separated by a wall with a doorway gap at the bottom (y 0..3),
// floor slab below and ceiling slab above.
const floor = { x0: -1, x1: 25, y0: -0.5, y1: 0 };
const ceiling = { x0: -1, x1: 25, y0: 4.5, y1: 5 };
const lintel = { x0: 11.7, x1: 12.3, y0: 3, y1: 4.5 };
const door = { x0: 11.75, x1: 12.25, y0: 0, y1: 3 };
const leftHull = { x0: -1, x1: 0, y0: 0, y1: 4.5 };

describe('visibility polygon', () => {
  it('sees its own room and nothing through a closed door', () => {
    const segs = segmentsNear([floor, ceiling, lintel, door, leftHull], 4, 1.6, 30);
    const poly = visibilityPolygon(4, 1.6, segs);
    expect(inside(poly, 8, 2)).toBe(true);
    expect(inside(poly, 1, 4)).toBe(true);
    expect(inside(poly, 16, 1.5)).toBe(false); // other room
    expect(inside(poly, 8, 5.5)).toBe(false);  // deck above
  });

  it('sees through an open doorway but not the region shadowed by the lintel', () => {
    const segs = segmentsNear([floor, ceiling, lintel, leftHull], 4, 1.6, 30);
    const poly = visibilityPolygon(4, 1.6, segs);
    expect(inside(poly, 16, 1.0)).toBe(true);
    expect(inside(poly, 20, 4.3)).toBe(false);
  });
});
