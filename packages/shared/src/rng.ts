/**
 * Seeded RNG (mulberry32). The RNG state is a plain uint32 stored inside the
 * simulation state, so cloning the state clones the RNG too (determinism, §3.1).
 */
export interface RngState {
  rng: number;
}

/** Returns a float in [0, 1) and advances `s.rng`. */
export function nextFloat(s: RngState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function nextInt(s: RngState, n: number): number {
  return Math.floor(nextFloat(s) * n);
}

/** Float in [min, max). */
export function nextRange(s: RngState, min: number, max: number): number {
  return min + nextFloat(s) * (max - min);
}

/** Standalone generator, handy for client-side cosmetic randomness and dummy AI. */
export function createRng(seed: number): () => number {
  const s: RngState = { rng: seed >>> 0 };
  return () => nextFloat(s);
}
