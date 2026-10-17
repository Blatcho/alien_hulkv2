// 2D visibility polygon (classic angular sweep). Given an eye point and wall segments,
// returns the polygon of everything visible, as points sorted by angle. Rooms here are
// axis-aligned boxes, so segments come straight from the level's solid boxes.

/** Four edges of each box that lies within `range` of (x, y). */
export function segmentsNear(boxes, x, y, range) {
  const segs = [];
  for (const b of boxes) {
    if (b.x1 < x - range || b.x0 > x + range || b.y1 < y - range || b.y0 > y + range) continue;
    segs.push(
      [b.x0, b.y0, b.x1, b.y0], [b.x1, b.y0, b.x1, b.y1],
      [b.x1, b.y1, b.x0, b.y1], [b.x0, b.y1, b.x0, b.y0],
    );
  }
  // Range box so every ray terminates.
  const r = range;
  segs.push([x - r, y - r, x + r, y - r], [x + r, y - r, x + r, y + r], [x + r, y + r, x - r, y + r], [x - r, y + r, x - r, y - r]);
  return segs;
}

/** Distance along ray (ox,oy)+t*(dx,dy) to segment, or Infinity. */
function raySeg(ox, oy, dx, dy, s) {
  const [x1, y1, x2, y2] = s;
  const ex = x2 - x1;
  const ey = y2 - y1;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const t = ((x1 - ox) * ey - (y1 - oy) * ex) / den;
  const u = ((x1 - ox) * dy - (y1 - oy) * dx) / den;
  if (t < 0 || u < -1e-9 || u > 1 + 1e-9) return Infinity;
  return t;
}

/**
 * @param {number} x @param {number} y  eye position
 * @param {Array<[number,number,number,number]>} segs
 * @returns {Float32Array} flat [x0,y0,x1,y1,...] polygon, angle-sorted
 */
export function visibilityPolygon(x, y, segs) {
  const angles = [];
  const EPS = 1e-4;
  for (const s of segs) {
    for (const [px, py] of [[s[0], s[1]], [s[2], s[3]]]) {
      const a = Math.atan2(py - y, px - x);
      angles.push(a - EPS, a, a + EPS);
    }
  }
  angles.sort((a, b) => a - b);
  const out = [];
  let lastA = -Infinity;
  for (const a of angles) {
    if (a - lastA < 1e-7) continue;
    lastA = a;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = Infinity;
    for (const s of segs) {
      const t = raySeg(x, y, dx, dy, s);
      if (t < best) best = t;
    }
    if (best < Infinity) out.push(x + dx * best, y + dy * best);
  }
  return new Float32Array(out);
}

/** Point-in-polygon (even-odd), for tests. */
export function inside(poly, px, py) {
  let c = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i]; const yi = poly[i + 1]; const xj = poly[j]; const yj = poly[j + 1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
