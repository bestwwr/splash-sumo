/**
 * Plain-data simulation state. Mirrors the Colyseus schema in SPEC §3.2 so the
 * server can copy fields across 1:1 in Milestone 2.
 */
import type { CharacterId, SkillId } from "./characters";

export enum TileState {
  SOLID = 0,
  WARNING = 1,
  SINKING = 2,
  GONE = 3,
}

export enum Phase {
  LOBBY = 0,
  COUNTDOWN = 1,
  PLAYING = 2,
  RESULTS = 3,
}

export enum EliminationCause {
  NONE = 0,
  SHOVE = 1,
  FLOOR = 2,
  ERUPTION = 3,
  LAVA_ROCK = 4,
}

export enum SkillPhase {
  NONE = 0,
  WINDUP = 1,
  ACTIVE = 2,
}

export interface Tile {
  q: number;
  r: number;
  ring: number;
  state: TileState;
  changedAtMs: number;
  /** Scheduled time to enter WARNING (edge ripple stagger), or -1. */
  warnAtMs: number;
}

export interface Player {
  id: string;
  nickname: string;
  character: CharacterId;
  slot: number;
  isBot: boolean;
  alive: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  hitStunMs: number;
  /** ms spent unsupported; -1 while standing on a tile. */
  fallingMs: number;
  lastHitById: string | null;
  lastHitAtMs: number;
  /** Cause to credit if the player falls soon after lastHitById's hit. */
  lastHitCause: EliminationCause;
  lastProcessedSeq: number;
  /** ms until the skill can be used again; 0 = ready. */
  skillCooldownMs: number;
  skillPhase: SkillPhase;
  /** Time left in the current skill phase (ms). */
  skillPhaseMs: number;
  /** Last tick's skill input, for press (rising-edge) detection. */
  skillHeld: boolean;
  dashDirX: number;
  dashDirZ: number;
  /** Position on the spirit ring (radians) once eliminated. */
  spiritAngle: number;
  /** Spirit's rock cooldown (ms); 0 = ready. */
  rockCooldownMs: number;
  eliminatedCause: EliminationCause;
  eliminatedAtMs: number;
  eliminatedById: string | null;
}

export interface LavaRock {
  id: number;
  fromId: string;
  fromX: number;
  fromZ: number;
  targetX: number;
  targetZ: number;
  thrownAtMs: number;
  landAtMs: number;
}

/** Eruption event: phase 0 pending, 1 telegraphed, 2 done. */
export interface Eruption {
  atMs: number;
  impactAtMs: number;
  targets: { x: number; z: number }[];
  phase: 0 | 1 | 2;
}

export interface MatchState {
  phase: Phase;
  seed: number;
  /** Seeded RNG state (uint32). */
  rng: number;
  tick: number;
  timeMs: number;
  players: Player[];
  tiles: Tile[];
  /** Ring that the next edge-shrink will take. */
  edgeRing: number;
  nextEdgeShrinkAtMs: number;
  nextRandomTileAtMs: number;
  suddenDeath: boolean;
  rocks: LavaRock[];
  nextRockId: number;
  eruption: Eruption;
  /** Set when the match ends. */
  result: MatchResult | null;
}

export interface PlayerInput {
  seq: number;
  dirX: number;
  dirZ: number;
  skill: boolean;
}

export type Inputs = Record<string, PlayerInput | undefined>;

export interface Placement {
  playerId: string;
  place: number;
  cause: EliminationCause;
  byId: string | null;
}

export interface MatchResult {
  draw: boolean;
  winnerId: string | null;
  placements: Placement[];
  durationMs: number;
}

export type SimEvent =
  | { type: "hit"; attackerId: string; victimId: string; strength: number }
  | { type: "fall"; playerId: string }
  | { type: "eliminated"; playerId: string; cause: EliminationCause; byId: string | null }
  | { type: "skillUsed"; playerId: string; skill: SkillId }
  | { type: "slamImpact"; playerId: string; x: number; z: number; hitIds: string[] }
  | { type: "lavaRockThrown"; fromId: string; targetX: number; targetZ: number; landAtMs: number }
  | { type: "rockImpact"; fromId: string; x: number; z: number; hitIds: string[] }
  | { type: "eruptionIncoming"; targets: { x: number; z: number }[]; impactAtMs: number }
  | { type: "eruptionImpact"; targets: { x: number; z: number }[]; hitIds: string[] }
  | { type: "suddenDeath" }
  | { type: "edgeShrink"; ring: number }
  | { type: "matchEnd"; result: MatchResult };

export type BotDifficulty = "easy" | "medium" | "hard";
