/**
 * Plain-data simulation state. Mirrors the Colyseus schema in SPEC §3.2 so the
 * server can copy fields across 1:1 in Milestone 2.
 */
import type { CharacterId } from "./characters";

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
  lastProcessedSeq: number;
  eliminatedCause: EliminationCause;
  eliminatedAtMs: number;
  eliminatedById: string | null;
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
  | { type: "suddenDeath" }
  | { type: "edgeShrink"; ring: number }
  | { type: "matchEnd"; result: MatchResult };
