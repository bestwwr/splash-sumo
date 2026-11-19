import { describe, expect, it } from "vitest";
import { ARENAS, CATALOG, SKILL_INFO, arenasForPicker } from "../src/meta/catalog";

describe("catalog", () => {
  it("has the three default-owned fighters", () => {
    expect(CATALOG.map((c) => c.id)).toEqual(["fighter.elephant", "fighter.monkey", "fighter.turtle"]);
    expect(CATALOG.map((c) => c.role)).toEqual(["Tank", "Speedster", "Anchor"]);
    expect(CATALOG.every((c) => c.defaultOwned && c.kind === "fighter")).toBe(true);
  });

  it("describes every skill", () => {
    expect(Object.keys(SKILL_INFO).sort()).toEqual(["dash", "shell", "slam"]);
  });

  it("arenasForPicker pads the single volcano arena with 2 nulls", () => {
    expect(ARENAS).toHaveLength(1);
    const cells = arenasForPicker();
    expect(cells).toHaveLength(3);
    expect(cells[0]?.id).toBe("arena.volcano");
    expect(cells.slice(1)).toEqual([null, null]);
  });
});
