import { describe, expect, it } from "vitest";
import { generateRoomCode, normalizeRoomCode, parseClientMsg, ROOM_CODE_ALPHABET } from "../src/protocol";
import { createRng } from "../src/rng";
import { sanitizeNickname } from "../src/nickname";

describe("room codes", () => {
  it("normalizes", () => {
    expect(normalizeRoomCode(" ab cd ")).toBe("ABCD");
    expect(normalizeRoomCode("AB1D")).toBeNull();
    expect(normalizeRoomCode("ABCDE")).toBeNull();
  });
  it("generates 4 alphabet chars from a fixed sequence", () => {
    const seq = [0, 0.5, 0.999999, 0.25];
    let i = 0;
    const code = generateRoomCode(() => seq[i++ % seq.length]!);
    expect(code).toHaveLength(4);
    for (const c of code) expect(ROOM_CODE_ALPHABET).toContain(c);
  });
  it("1000 seeded codes all normalize to themselves", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const c = generateRoomCode(rng);
      expect(normalizeRoomCode(c)).toBe(c);
    }
  });
});

describe("parseClientMsg", () => {
  it("accepts a valid input", () => {
    expect(parseClientMsg({ t: "in", seq: 3, dirX: 0.5, dirZ: -0.5, skill: true })).toEqual({
      t: "in", seq: 3, dirX: 0.5, dirZ: -0.5, skill: true,
    });
  });
  it("clamps direction and sanitizes NaN", () => {
    const m = parseClientMsg({ t: "in", seq: 1, dirX: 5, dirZ: 0, skill: false });
    expect(m).toMatchObject({ t: "in", dirX: 1, dirZ: 0 });
    const n = parseClientMsg({ t: "in", seq: 1, dirX: NaN, dirZ: 0, skill: false });
    expect(n).toMatchObject({ dirX: 0 });
  });
  it("rejects bad shapes", () => {
    expect(parseClientMsg({ t: "pick", character: "dragon" })).toBeNull();
    expect(parseClientMsg({ t: "diff", difficulty: "insane" })).toBeNull();
    expect(parseClientMsg({ seq: 1 })).toBeNull();
    expect(parseClientMsg("hi")).toBeNull();
    expect(parseClientMsg(null)).toBeNull();
    expect(parseClientMsg({ t: "in", seq: "1", dirX: 0, dirZ: 0, skill: false })).toBeNull();
    expect(parseClientMsg({ t: "nope" })).toBeNull();
  });
  it("accepts the other message kinds", () => {
    expect(parseClientMsg({ t: "pick", character: "monkey" })).toEqual({ t: "pick", character: "monkey" });
    expect(parseClientMsg({ t: "diff", difficulty: "hard" })).toEqual({ t: "diff", difficulty: "hard" });
    expect(parseClientMsg({ t: "start" })).toEqual({ t: "start" });
    expect(parseClientMsg({ t: "again" })).toEqual({ t: "again" });
    expect(parseClientMsg({ t: "leave" })).toEqual({ t: "leave" });
    expect(parseClientMsg({ t: "join", token: "abc", nickname: "Bo", character: "turtle" })).toEqual({
      t: "join", token: "abc", nickname: "Bo", character: "turtle",
    });
    expect(parseClientMsg({ t: "join", token: "abc", nickname: "Bo", character: "x" })).toBeNull();
  });
});

describe("sanitizeNickname (shared)", () => {
  it("strips, trims, truncates, falls back", () => {
    expect(sanitizeNickname("  Bob<script>  ", () => "R")).toBe("Bobscript");
    expect(sanitizeNickname("abcdefghijklmnop", () => "R")).toBe("abcdefghijkl");
    expect(sanitizeNickname("!!!", () => "R")).toBe("R");
  });
});
