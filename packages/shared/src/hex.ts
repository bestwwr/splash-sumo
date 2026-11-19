/**
 * Hex grid math — pointy-top hexes, axial coordinates (q, r). World plane is XZ.
 * Reference: redblobgames.com/grids/hexagons
 */
import { CONFIG } from "./config";

export interface Axial {
  q: number;
  r: number;
}

const SQRT3 = Math.sqrt(3);

/** Center-to-corner distance for the configured tile width (across flats). */
export const HEX_SIZE = CONFIG.TILE_WIDTH / SQRT3;

export const HEX_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Ring index = distance from the center tile. */
export function hexRing(h: Axial): number {
  return hexDistance(h, { q: 0, r: 0 });
}

export function hexToWorld(h: Axial, size = HEX_SIZE): { x: number; z: number } {
  return {
    x: size * (SQRT3 * h.q + (SQRT3 / 2) * h.r),
    z: size * (1.5 * h.r),
  };
}

/** Rounds fractional axial coords to the nearest hex (via cube rounding). */
export function hexRound(q: number, r: number): Axial {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  // Normalize -0 to 0 so keys/equality are stable.
  return { q: rq + 0, r: rr + 0 };
}

/** Which hex contains world point (x, z). */
export function worldToHex(x: number, z: number, size = HEX_SIZE): Axial {
  const q = ((SQRT3 / 3) * x - (1 / 3) * z) / size;
  const r = ((2 / 3) * z) / size;
  return hexRound(q, r);
}

/** All hexes within `radius` of the center, ordered by ring then angle. */
export function hexesInRadius(radius: number): Axial[] {
  const out: Axial[] = [{ q: 0, r: 0 }];
  for (let ring = 1; ring <= radius; ring++) out.push(...hexRingCells(ring));
  return out;
}

export function hexRingCells(ring: number): Axial[] {
  if (ring === 0) return [{ q: 0, r: 0 }];
  const out: Axial[] = [];
  // Start at direction 4 scaled by ring, walk each of the 6 sides.
  const start = HEX_DIRECTIONS[4]!;
  let cur: Axial = { q: start.q * ring, r: start.r * ring };
  for (let side = 0; side < 6; side++) {
    const d = HEX_DIRECTIONS[side]!;
    for (let step = 0; step < ring; step++) {
      out.push(cur);
      cur = { q: cur.q + d.q, r: cur.r + d.r };
    }
  }
  return out;
}

export function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

/** Number of tiles in a hex of the given radius: 3r(r+1)+1. */
export function hexCount(radius: number): number {
  return 3 * radius * (radius + 1) + 1;
}
