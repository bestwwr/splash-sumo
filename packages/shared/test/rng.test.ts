import { describe, expect, it } from "vitest";
import { createRng, nextFloat, nextInt } from "../src/rng";

describe("seeded rng", () => {
  it("same seed → same sequence", () => {
    const a = createRng(42), b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
  it("different seeds diverge", () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });
  it("stays in range and state is a uint32", () => {
    const s = { rng: 7 };
    for (let i = 0; i < 1000; i++) {
      const f = nextFloat(s);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      expect(Number.isInteger(s.rng) && s.rng >= 0 && s.rng <= 0xffffffff).toBe(true);
      const n = nextInt(s, 6);
      expect(n >= 0 && n < 6).toBe(true);
    }
  });
});
