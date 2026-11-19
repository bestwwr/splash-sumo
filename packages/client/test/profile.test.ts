import { describe, expect, it } from "vitest";
import { fightersForGrid, loadProfile, saveProfile, sanitizeNickname, type KeyValueStorage } from "../src/meta/profile";
import { CATALOG, type CatalogItem } from "../src/meta/catalog";

const KEY = "lavasumo.profile.v1";
const nick = () => "Rando42";

function fakeStorage(init: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const throwing: KeyValueStorage = {
  getItem() {
    throw new Error("denied");
  },
  setItem() {
    throw new Error("denied");
  },
};

const allOwned = ["fighter.elephant", "fighter.monkey", "fighter.turtle"];

describe("loadProfile", () => {
  it("defaults with null storage", () => {
    const p = loadProfile(null, nick);
    expect(p).toMatchObject({ version: 1, nickname: "Rando42", equippedFighter: "elephant", difficulty: "medium", arena: "arena.volcano" });
    expect([...p.owned].sort()).toEqual(allOwned);
  });

  it("defaults with an empty fake storage", () => {
    const p = loadProfile(fakeStorage(), nick);
    expect(p.nickname).toBe("Rando42");
    expect(p.equippedFighter).toBe("elephant");
    expect(p.difficulty).toBe("medium");
    expect([...p.owned].sort()).toEqual(allOwned);
  });

  it("storage that throws on every call gives defaults, no throw", () => {
    const p = loadProfile(throwing, nick);
    expect(p.equippedFighter).toBe("elephant");
    expect(() => saveProfile(throwing, p)).not.toThrow();
  });

  it("garbage JSON gives defaults", () => {
    expect(loadProfile(fakeStorage({ [KEY]: "{not json" }), nick).difficulty).toBe("medium");
    expect(loadProfile(fakeStorage({ [KEY]: "42" }), nick).nickname).toBe("Rando42");
  });

  it("migrates the M1 nickname key", () => {
    const p = loadProfile(fakeStorage({ "lavasumo.nickname": "Old Timer" }), nick);
    expect(p.nickname).toBe("Old Timer");
  });

  it("repairs unknown fighter / difficulty / arena / owned IDs", () => {
    const s = fakeStorage({
      [KEY]: JSON.stringify({
        version: 1,
        nickname: "Zed",
        equippedFighter: "dragon",
        difficulty: "nightmare",
        arena: "arena.nowhere",
        owned: ["fighter.ghost", "fighter.monkey"],
      }),
    });
    const p = loadProfile(s, nick);
    expect(p.nickname).toBe("Zed");
    expect(p.equippedFighter).toBe("elephant");
    expect(p.difficulty).toBe("medium");
    expect(p.arena).toBe("arena.volcano");
    expect([...p.owned].sort()).toEqual(allOwned);
  });
});

describe("saveProfile", () => {
  it("round-trips", () => {
    const s = fakeStorage();
    const p = loadProfile(s, nick);
    p.nickname = "Saved";
    p.equippedFighter = "monkey";
    p.difficulty = "hard";
    saveProfile(s, p);
    expect(s.data[KEY]).toBeDefined();
    expect(loadProfile(s, () => "Other")).toEqual(p);
  });
});

describe("sanitizeNickname", () => {
  it("strips junk, trims, caps at 12, falls back to random", () => {
    expect(sanitizeNickname("  a<b>c  ", () => "X")).toBe("abc");
    expect(sanitizeNickname("abcdefghijklmnop", () => "X")).toBe("abcdefghijkl");
    expect(sanitizeNickname("<>", () => "Fallback")).toBe("Fallback");
  });
});

describe("fightersForGrid", () => {
  const profile = (owned: string[]) => ({ ...loadProfile(null, nick), owned });
  it("pads to 6 with nulls", () => {
    const cells = fightersForGrid(profile(allOwned));
    expect(cells).toHaveLength(6);
    expect(cells.slice(0, 3).map((c) => c?.id)).toEqual(allOwned);
    expect(cells.slice(3)).toEqual([null, null, null]);
  });

  it("7 owned would pad to 9", () => {
    const extra: CatalogItem[] = [1, 2, 3, 4].map((i) => ({
      id: `fighter.x${i}`, kind: "fighter", name: `X${i}`, order: 10 + i, defaultOwned: false,
    }));
    const catalog = [...CATALOG, ...extra];
    const cells = fightersForGrid(profile([...allOwned, ...extra.map((e) => e.id)]), 6, catalog);
    expect(cells).toHaveLength(9);
    expect(cells.filter((c) => c === null)).toHaveLength(2);
  });
});
