/**
 * Seeded randomness and noise fields for the thumbnail generator.
 *
 * Everything here is deterministic for a given seed, so a song always gets the
 * same artwork until the user asks for another variation.
 */

/** FNV-1a over a string — stable across sessions and browsers. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mixes two 32-bit values into a new well-scattered seed. */
export function mixSeed(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Small, fast PRNG (mulberry32). Returns floats in [0, 1). */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: <T,>(items: readonly T[]) => items[Math.floor(next() * items.length) % items.length],
    chance: (probability) => next() < probability,
    sign: () => (next() < 0.5 ? -1 : 1),
  };
}

export interface Random {
  next: () => number;
  range: (min: number, max: number) => number;
  int: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
  chance: (probability: number) => boolean;
  sign: () => number;
}

/**
 * 2D value noise on a hashed lattice, plus fractal sums and a cellular field.
 *
 * Smooth octaves give the large soft clouds; the high octaves are linearly
 * interpolated on purpose — the lattice facets that leaves behind are what give
 * a posterised edge its crystalline, cut-paper look instead of a blurry one.
 */
export class NoiseField {
  private readonly values = new Float32Array(512);
  private readonly perm = new Uint16Array(512);
  private readonly jitterX = new Float32Array(512);
  private readonly jitterY = new Float32Array(512);

  constructor(seed: number) {
    const random = createRandom(seed);
    const order = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(random.next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = order[i & 255];
      this.values[i] = random.next();
      this.jitterX[i] = random.next();
      this.jitterY[i] = random.next();
    }
  }

  private lattice(ix: number, iy: number): number {
    return this.perm[(this.perm[ix & 255] + iy) & 511];
  }

  /** Value noise in [0, 1]. `linear` keeps the lattice facets. */
  value(x: number, y: number, linear = false): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let u = x - xi;
    let v = y - yi;
    if (!linear) {
      u = u * u * (3 - 2 * u);
      v = v * v * (3 - 2 * v);
    }
    const a = this.values[this.lattice(xi, yi)];
    const b = this.values[this.lattice(xi + 1, yi)];
    const c = this.values[this.lattice(xi, yi + 1)];
    const d = this.values[this.lattice(xi + 1, yi + 1)];
    const top = a + (b - a) * u;
    const bottom = c + (d - c) * u;
    return top + (bottom - top) * v;
  }

  /**
   * Fractal sum in roughly [0, 1]. Octaves from `facetFrom` upward are linear,
   * which sharpens the fine edge detail without making the big shapes blocky.
   */
  fbm(x: number, y: number, octaves = 5, gain = 0.5, facetFrom = 3): number {
    let sum = 0;
    let amplitude = 0.5;
    let norm = 0;
    let frequency = 1;
    for (let o = 0; o < octaves; o++) {
      // Offset each octave so their lattices never line up.
      sum += amplitude * this.value(x * frequency + o * 17.13, y * frequency - o * 9.71, o >= facetFrom);
      norm += amplitude;
      amplitude *= gain;
      frequency *= 2.03;
    }
    return sum / norm;
  }

  /**
   * Distances to the nearest and second-nearest feature points (Worley).
   * F2 − F1 is near zero along cell borders, which draws a crack network.
   */
  cellular(x: number, y: number, out: CellSample): CellSample {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let f1 = Infinity;
    let f2 = Infinity;
    let id = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = xi + ox;
        const cy = yi + oy;
        const cell = this.lattice(cx, cy);
        const px = cx + 0.1 + this.jitterX[cell] * 0.8;
        const py = cy + 0.1 + this.jitterY[cell] * 0.8;
        const dx = px - x;
        const dy = py - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = cell;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    out.f1 = f1;
    out.f2 = f2;
    out.id = this.values[id];
    return out;
  }
}

export interface CellSample {
  f1: number;
  f2: number;
  /** Stable per-cell random value in [0, 1). */
  id: number;
}
