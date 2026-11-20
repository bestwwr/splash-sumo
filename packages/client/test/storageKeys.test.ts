import { describe, expect, it } from "vitest";
import { migrateStorageKeys } from "../src/meta/storageKeys";

function mem(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  return {
    m,
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("storage key migration (Lava Sumo → Splash Sumo)", () => {
  it("moves every lavasumo.* key to splashsumo.* and removes the old ones", () => {
    const s = mem({ "lavasumo.profile.v1": '{"nickname":"Ben"}', "lavasumo.playerToken": "tok", "other.key": "x" });
    migrateStorageKeys(s);
    expect(Object.fromEntries(s.m)).toEqual({
      "other.key": "x",
      "splashsumo.profile.v1": '{"nickname":"Ben"}',
      "splashsumo.playerToken": "tok",
    });
  });

  it("never overwrites a value already saved under the new name", () => {
    const s = mem({ "lavasumo.anonId": "old", "splashsumo.anonId": "new" });
    migrateStorageKeys(s);
    expect(Object.fromEntries(s.m)).toEqual({ "splashsumo.anonId": "new" });
  });

  it("does nothing harmful without storage or when storage throws", () => {
    expect(() => migrateStorageKeys(null)).not.toThrow();
    const broken = { ...mem({ "lavasumo.x": "1" }), setItem: () => { throw new Error("quota"); } };
    expect(() => migrateStorageKeys(broken)).not.toThrow();
  });
});
