import { describe, expect, it } from "vitest";
import { EliminationCause } from "@splash-sumo/shared";
import { causeText, resultsSubtitle } from "./resultsText";

describe("resultsText", () => {
  it("formats causes", () => {
    expect(causeText(EliminationCause.ERUPTION, null)).toBe("Eruption");
    expect(causeText(EliminationCause.LAVA_ROCK, "Ash")).toBe("Lava rock by Ash");
    expect(causeText(EliminationCause.SHOVE, "you")).toBe("Shoved by you");
    expect(causeText(EliminationCause.SHOVE, null)).toBe("Shoved");
    expect(causeText(EliminationCause.FLOOR, null)).toBe("Floor melted");
  });
  it("formats the subtitle", () => {
    expect(resultsSubtitle("medium", 47300)).toBe("vs Medium bots · 47.3 s");
  });
});
