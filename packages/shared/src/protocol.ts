/** Online multiplayer wire protocol (client <-> room server). Pure data + validation. */
import { CHARACTER_IDS, type CharacterId } from "./characters";
import { clampInput } from "./physics";
import type { PlayerSetup } from "./simulation";
import type { Snap } from "./snapshot";
import type { BotDifficulty, Phase } from "./types";

export const PROTOCOL_VERSION = 1;

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 4;

/** Uppercase, strip whitespace; null unless exactly 4 alphabet characters. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/\s+/g, "");
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const c of code) if (!ROOM_CODE_ALPHABET.includes(c)) return null;
  return code;
}

export function generateRoomCode(rand: () => number): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const idx = Math.min(ROOM_CODE_ALPHABET.length - 1, Math.floor(rand() * ROOM_CODE_ALPHABET.length));
    code += ROOM_CODE_ALPHABET[idx];
  }
  return code;
}

export type ClientMsg =
  | { t: "join"; token: string; nickname: string; character: CharacterId }
  | { t: "in"; seq: number; dirX: number; dirZ: number; skill: boolean }
  | { t: "pick"; character: CharacterId }
  | { t: "diff"; difficulty: BotDifficulty }
  | { t: "start" }
  | { t: "again" }
  | { t: "leave" };

export interface LobbyMember {
  id: string;
  nickname: string;
  character: CharacterId;
  connected: boolean;
}

export type ErrorCode =
  | "UPDATE_REQUIRED"
  | "FULL"
  | "IN_PROGRESS"
  | "NOT_FOUND"
  | "BAD_MESSAGE"
  | "REPLACED"
  | "KICKED";

export interface StartMsg {
  t: "start";
  seed: number;
  setups: PlayerSetup[];
  countdownMs: number;
}

export type ServerMsg =
  | { t: "welcome"; you: string; code: string }
  | { t: "lobby"; phase: Phase; hostId: string; difficulty: BotDifficulty; members: LobbyMember[] }
  | StartMsg
  | ({ t: "snap" } & Snap)
  | { t: "error"; code: ErrorCode };

const DIFFICULTIES: readonly BotDifficulty[] = ["easy", "medium", "hard"];

function isCharacter(v: unknown): v is CharacterId {
  return typeof v === "string" && (CHARACTER_IDS as readonly string[]).includes(v);
}

export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case "join":
      if (typeof m.token !== "string" || typeof m.nickname !== "string" || !isCharacter(m.character)) return null;
      return { t: "join", token: m.token, nickname: m.nickname, character: m.character };
    case "in": {
      if (typeof m.seq !== "number" || !Number.isFinite(m.seq) || typeof m.skill !== "boolean") return null;
      if (typeof m.dirX !== "number" || typeof m.dirZ !== "number") return null;
      const { dirX, dirZ } = clampInput(m.dirX, m.dirZ);
      return { t: "in", seq: m.seq, dirX, dirZ, skill: m.skill };
    }
    case "pick":
      return isCharacter(m.character) ? { t: "pick", character: m.character } : null;
    case "diff": {
      const d = DIFFICULTIES.find((x) => x === m.difficulty);
      return d ? { t: "diff", difficulty: d } : null;
    }
    case "start":
    case "again":
    case "leave":
      return { t: m.t };
    default:
      return null;
  }
}
