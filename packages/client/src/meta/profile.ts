import { CHARACTER_IDS, sanitizeNickname as sanitizeNicknameShared, type BotDifficulty, type CharacterId } from "@splash-sumo/shared";
import { ARENAS, CATALOG, DEFAULT_ARENA, type CatalogItem } from "./catalog";

export interface KeyValueStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export interface Profile {
  version: 1;
  nickname: string;
  equippedFighter: CharacterId;
  difficulty: BotDifficulty;
  arena: string;
  owned: string[];
  equippedSkins: Partial<Record<CharacterId, string>>;
}

const PROFILE_KEY = "splashsumo.profile.v1";
const LEGACY_NICK_KEY = "splashsumo.nickname";
const DIFFICULTIES: readonly BotDifficulty[] = ["easy", "medium", "hard"];

export function sanitizeNickname(raw: string, randomNick: () => string = defaultRandomNick): string {
  return sanitizeNicknameShared(raw, randomNick);
}

export function defaultRandomNick(): string {
  return `Player${Math.floor(100 + Math.random() * 900)}`;
}

function read(storage: KeyValueStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function loadProfile(storage: KeyValueStorage | null, randomNick: () => string): Profile {
  let saved: Record<string, unknown> = {};
  const raw = read(storage, PROFILE_KEY);
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) saved = parsed;
    } catch {
      /* garbage: fall back to defaults */
    }
  }

  const nickSource = typeof saved.nickname === "string" ? saved.nickname : read(storage, LEGACY_NICK_KEY) ?? "";
  const nickname = sanitizeNickname(nickSource, randomNick);

  const known = new Set(CATALOG.map((c) => c.id));
  const savedOwned = Array.isArray(saved.owned) ? saved.owned.filter((x): x is string => typeof x === "string") : [];
  const owned = [...new Set([...savedOwned, ...CATALOG.filter((c) => c.defaultOwned).map((c) => c.id)])].filter((id) =>
    known.has(id),
  );

  let equippedFighter: CharacterId = "elephant";
  if (typeof saved.equippedFighter === "string") {
    const id = saved.equippedFighter;
    if ((CHARACTER_IDS as readonly string[]).includes(id) && owned.includes(`fighter.${id}`)) {
      equippedFighter = id as CharacterId;
    }
  }

  const difficulty = DIFFICULTIES.find((d) => d === saved.difficulty) ?? "medium";

  const arena = ARENAS.some((a) => a.id === saved.arena && a.available) ? (saved.arena as string) : DEFAULT_ARENA;

  const equippedSkins: Partial<Record<CharacterId, string>> = {};
  if (isRecord(saved.equippedSkins)) {
    for (const c of CHARACTER_IDS) {
      const skin = saved.equippedSkins[c];
      if (typeof skin === "string" && owned.includes(skin)) equippedSkins[c] = skin;
    }
  }

  return { version: 1, nickname, equippedFighter, difficulty, arena, owned, equippedSkins };
}

export function saveProfile(storage: KeyValueStorage | null, p: Profile): void {
  try {
    storage?.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* device-only persistence is best effort */
  }
}

/** Owned fighters by order, padded with null ("?" slots) to a multiple of 3 that is >= minCells. */
export function fightersForGrid(
  profile: Profile,
  minCells = 6,
  catalog: readonly CatalogItem[] = CATALOG,
): Array<CatalogItem | null> {
  const cells: Array<CatalogItem | null> = catalog
    .filter((c) => c.kind === "fighter" && profile.owned.includes(c.id))
    .sort((a, b) => a.order - b.order);
  const target = Math.max(minCells, Math.ceil(cells.length / 3) * 3);
  while (cells.length < target) cells.push(null);
  return cells;
}
