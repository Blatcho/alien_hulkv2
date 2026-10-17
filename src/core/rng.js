// Deterministic random numbers. The simulation never calls Math.random: every system gets
// its own stream derived from the run seed, so a seed always reproduces the same ship,
// and adding randomness to one system never reshuffles another.

/** 32-bit FNV-1a hash of a string. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** sfc32 generator seeded from four 32-bit words. Returns floats in [0, 1). */
function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
}

export class Rng {
  /** @param {number|string} seed  @param {string} [stream] independent sub-stream name */
  constructor(seed, stream = '') {
    const s = `${seed}/${stream}`;
    this.next = sfc32(hashString(s), hashString(s + 'b'), hashString(s + 'c'), hashString(s + 'd'));
    for (let i = 0; i < 12; i++) this.next(); // warm up
  }

  float(min = 0, max = 1) { return min + (max - min) * this.next(); }
  int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); } // inclusive
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  /** Pick from [{weight, ...}] or [[item, weight]] entries. */
  weighted(entries) {
    const w = (e) => (Array.isArray(e) ? e[1] : e.weight);
    const total = entries.reduce((s, e) => s + w(e), 0);
    let r = this.next() * total;
    for (const e of entries) {
      r -= w(e);
      if (r < 0) return Array.isArray(e) ? e[0] : e;
    }
    const last = entries[entries.length - 1];
    return Array.isArray(last) ? last[0] : last;
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Child stream, e.g. rng.fork('room-12'). */
  fork(name) { return new Rng(this.next() * 4294967296 >>> 0, name); }
}

/** Short human-readable seed for the HUD / URL. */
export function randomSeed() {
  return Math.floor(Math.random() * 36 ** 6).toString(36).toUpperCase().padStart(6, '0');
}
