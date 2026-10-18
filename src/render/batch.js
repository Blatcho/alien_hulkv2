// Static geometry batching: collect (geometry, world matrix, material) triples and merge them
// into one mesh per material. A whole room of kit pieces becomes a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const cache = new WeakMap();

/** Non-indexed geometry with exactly position/normal/color(float3) - a mergeable common format. */
export function normalizeGeometry(src) {
  if (cache.has(src)) return cache.get(src);
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = g.attributes.color;
  for (let i = 0; i < n; i++) {
    col[i * 3] = c ? c.getX(i) : 1;
    col[i * 3 + 1] = c ? c.getY(i) : 1;
    col[i * 3 + 2] = c ? c.getZ(i) : 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.morphAttributes = {};
  cache.set(src, g);
  return g;
}

export class Batch {
  constructor() { this.byMat = new Map(); }

  /**
   * Add every mesh under `obj` (a kit/prop node) transformed by `matrix`. `tint` ([r, g, b])
   * multiplies the vertex colours of its lit parts (not its glow strips): the hull class's palette.
   */
  addObject(obj, matrix, tint = null) {
    obj.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const local = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
      const lit = !/^M_(Glow|Rarity)/.test(o.material.name ?? '');
      this.add(o.geometry, new THREE.Matrix4().multiplyMatrices(matrix, local), o.material, lit ? tint : null);
    });
  }

  add(geometry, matrix, material, tint = null) {
    const g = normalizeGeometry(geometry).clone().applyMatrix4(matrix);
    if (matrix.determinant() < 0) flipWinding(g);
    if (tint) {
      const c = g.attributes.color.array;
      for (let i = 0; i < c.length; i += 3) { c[i] *= tint[0]; c[i + 1] *= tint[1]; c[i + 2] *= tint[2]; }
    }
    if (!this.byMat.has(material)) this.byMat.set(material, []);
    this.byMat.get(material).push(g);
  }

  /** Merge into a Group of meshes (one per material). */
  build(name = 'batch') {
    const group = new THREE.Group();
    group.name = name;
    for (const [mat, list] of this.byMat) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.byMat.clear();
    return group;
  }
}

function flipWinding(g) {
  const p = g.attributes.position.array;
  const n = g.attributes.normal.array;
  const c = g.attributes.color.array;
  for (let i = 0; i < p.length; i += 9) {
    for (const arr of [p, n, c]) {
      for (let k = 0; k < 3; k++) {
        const t = arr[i + 3 + k]; arr[i + 3 + k] = arr[i + 6 + k]; arr[i + 6 + k] = t;
      }
    }
  }
}

/** Vertex-coloured box geometry (placeholder pieces, slabs, hull). */
export function boxGeo(w, h, d, color, { shadeTop = 1.15, shadeBottom = 0.6 } = {}) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const c = new THREE.Color(color);
  const n = g.attributes.normal;
  const col = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const k = n.getY(i) > 0.5 ? shadeTop : n.getY(i) < -0.5 ? shadeBottom : n.getZ(i) > 0.5 ? 1 : 0.8;
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}
