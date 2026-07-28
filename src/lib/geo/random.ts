/** Deterministic 32-bit hash (FNV-1a variant) used for stable seeding. */
export function hashString(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function hashNumbers(...values: number[]): number {
  return hashString(values.map((v) => v.toFixed(6)).join(':'));
}

export type Rng = () => number;

/** mulberry32 — small, fast, deterministic PRNG. */
export function createRng(seed: number | string): Rng {
  let a = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic float in [0,1) derived from a set of integers. */
export function unitHash(...values: number[]): number {
  return hashNumbers(...values) / 4294967296;
}

export function pickWeighted<T>(items: ReadonlyArray<readonly [T, number]>, unit: number): T {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let threshold = unit * total;
  for (const [item, weight] of items) {
    threshold -= weight;
    if (threshold <= 0) return item;
  }
  return items[items.length - 1]![0];
}
