import { describe, expect, it } from "vitest";
import { HEX_SIZE, hexCount, hexDistance, hexRingCells, hexToWorld, hexesInRadius, worldToHex, hexKey } from "../src/hex";
import { CONFIG } from "../src/config";

describe("hex math", () => {
  it("radius 5 arena has 91 unique tiles", () => {
    const cells = hexesInRadius(CONFIG.ARENA_RADIUS);
    expect(cells).toHaveLength(91);
    expect(hexCount(5)).toBe(91);
    expect(new Set(cells.map((c) => hexKey(c.q, c.r))).size).toBe(91);
  });

  it("each ring k has 6k cells at distance k", () => {
    for (let k = 1; k <= 5; k++) {
      const ring = hexRingCells(k);
      expect(ring).toHaveLength(6 * k);
      for (const c of ring) expect(hexDistance(c, { q: 0, r: 0 })).toBe(k);
    }
  });

  it("world ↔ hex round-trips at every tile center", () => {
    for (const h of hexesInRadius(5)) {
      const w = hexToWorld(h);
      expect(worldToHex(w.x, w.z)).toEqual(h);
    }
  });

  it("tile width across flats matches config", () => {
    const a = hexToWorld({ q: 0, r: 0 });
    const b = hexToWorld({ q: 1, r: 0 });
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(CONFIG.TILE_WIDTH, 6);
  });

  it("points just inside a tile edge map to that tile; just outside map to the neighbor", () => {
    const inner = (CONFIG.TILE_WIDTH / 2) * 0.98;
    const outer = (CONFIG.TILE_WIDTH / 2) * 1.02;
    expect(worldToHex(inner, 0)).toEqual({ q: 0, r: 0 });
    expect(worldToHex(outer, 0)).toEqual({ q: 1, r: 0 });
    // Corner distance is HEX_SIZE (pointy-top: corner straight "up" along z).
    expect(worldToHex(0, HEX_SIZE * 0.95)).toEqual({ q: 0, r: 0 });
  });
});
