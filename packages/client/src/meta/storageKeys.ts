/**
 * Browser storage keys were renamed with the game (Lava Sumo → Splash Sumo): "lavasumo.*" → "splashsumo.*".
 * Run once at startup, before anything reads storage, so returning players keep their nickname, fighter,
 * room token and anonymous ID. A key that already exists under the new name is never overwritten.
 */
export const OLD_PREFIX = "lavasumo.";
export const PREFIX = "splashsumo.";

export interface MigratableStorage {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function migrateStorageKeys(s: MigratableStorage | null): void {
  if (!s) return;
  try {
    const old: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(OLD_PREFIX)) old.push(k);
    }
    for (const k of old) {
      const v = s.getItem(k);
      const nk = PREFIX + k.slice(OLD_PREFIX.length);
      if (v !== null && s.getItem(nk) === null) s.setItem(nk, v);
      s.removeItem(k);
    }
  } catch {
    // Storage blocked or full: play on with whatever is there.
  }
}
