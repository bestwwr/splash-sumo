/**
 * Deterministic match simulation (SPEC §3.1).
 *
 *   step(state, inputs) → { state, events }     (pure: input state is not mutated)
 *
 * Tick order: apply inputs → (skills: M3) → integrate velocity → player-player
 * collisions → (event impulses: M3) → tile states → support/eliminations → win.
 */
import { CONFIG } from "./config";
import type { CharacterId } from "./characters";
import { createTiles, isSupportive, updateCollapse } from "./collapse";
import { hexKey, worldToHex } from "./hex";
import { applyMovement, resolveCollisions } from "./physics";
import {
  EliminationCause,
  Phase,
  type Inputs,
  type MatchResult,
  type MatchState,
  type Placement,
  type Player,
  type SimEvent,
  type Tile,
} from "./types";

export interface PlayerSetup {
  id: string;
  nickname: string;
  character: CharacterId;
  isBot: boolean;
}

/** Spawn points: equal angles on a circle ~3 rings from the center (A.2). */
export function spawnPoint(slot: number, count: number): { x: number; z: number } {
  const angle = CONFIG.SPAWN_ANGLE_OFFSET + (slot / count) * Math.PI * 2;
  return { x: Math.cos(angle) * CONFIG.SPAWN_RADIUS, z: Math.sin(angle) * CONFIG.SPAWN_RADIUS };
}

export function createMatch(seed: number, setups: PlayerSetup[]): MatchState {
  const players: Player[] = setups.map((s, slot) => {
    const sp = spawnPoint(slot, Math.max(4, setups.length));
    return {
      id: s.id,
      nickname: s.nickname,
      character: s.character,
      slot,
      isBot: s.isBot,
      alive: true,
      x: sp.x,
      z: sp.z,
      vx: 0,
      vz: 0,
      facing: Math.atan2(-sp.x, -sp.z), // face the center
      hitStunMs: 0,
      fallingMs: -1,
      lastHitById: null,
      lastHitAtMs: -Infinity,
      lastProcessedSeq: 0,
      eliminatedCause: EliminationCause.NONE,
      eliminatedAtMs: -1,
      eliminatedById: null,
    };
  });
  return {
    phase: Phase.PLAYING,
    seed: seed >>> 0,
    rng: seed >>> 0,
    tick: 0,
    timeMs: 0,
    players,
    tiles: createTiles(),
    edgeRing: CONFIG.ARENA_RADIUS,
    nextEdgeShrinkAtMs: CONFIG.EDGE_SHRINK_START_MS,
    nextRandomTileAtMs: CONFIG.RANDOM_TILE_START_MS,
    suddenDeath: false,
    result: null,
  };
}

export function cloneState(s: MatchState): MatchState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p })),
    tiles: s.tiles.map((t) => ({ ...t })),
    result: s.result
      ? { ...s.result, placements: s.result.placements.map((p) => ({ ...p })) }
      : null,
  };
}

/** Build a q,r → tile lookup. 91 tiles; cheap to rebuild per tick. */
function tileIndex(tiles: Tile[]): Map<string, Tile> {
  const m = new Map<string, Tile>();
  for (const t of tiles) m.set(hexKey(t.q, t.r), t);
  return m;
}

export function isSupported(index: Map<string, Tile>, x: number, z: number): boolean {
  const h = worldToHex(x, z);
  const t = index.get(hexKey(h.q, h.r));
  return t !== undefined && isSupportive(t.state);
}

function eliminate(p: Player, nowMs: number, events: SimEvent[]): void {
  p.alive = false;
  p.eliminatedAtMs = nowMs;
  const credited = p.lastHitById !== null && nowMs - p.lastHitAtMs <= CONFIG.SHOVE_CREDIT_MS;
  p.eliminatedCause = credited ? EliminationCause.SHOVE : EliminationCause.FLOOR;
  p.eliminatedById = credited ? p.lastHitById : null;
  events.push({ type: "eliminated", playerId: p.id, cause: p.eliminatedCause, byId: p.eliminatedById });
}

/** Placements: survivors first, then by elimination time (later = better). Same tick = tied place. */
export function computeResult(state: MatchState): MatchResult {
  const sorted = [...state.players].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return b.eliminatedAtMs - a.eliminatedAtMs;
  });
  const placements: Placement[] = [];
  let place = 1;
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    const tied = prev !== undefined && prev.alive === p.alive && (p.alive || prev.eliminatedAtMs === p.eliminatedAtMs);
    if (!tied) place = i + 1;
    placements.push({ playerId: p.id, place, cause: p.eliminatedCause, byId: p.eliminatedById });
  });
  // Winner = sole holder of 1st place. If the last players went down on the same tick → draw (A.3).
  const firsts = placements.filter((p) => p.place === 1);
  const winnerId = firsts.length === 1 ? firsts[0]!.playerId : null;
  return { draw: winnerId === null, winnerId, placements, durationMs: state.timeMs };
}

/** Advance one fixed tick. Does not mutate `prev`. */
export function step(prev: MatchState, inputs: Inputs): { state: MatchState; events: SimEvent[] } {
  const state = cloneState(prev);
  const events: SimEvent[] = [];
  if (state.phase !== Phase.PLAYING) return { state, events };

  const dtMs = CONFIG.TICK_MS;
  state.tick += 1;
  state.timeMs = (state.tick * 1000) / CONFIG.TICK_HZ; // exact at whole seconds
  const now = state.timeMs;

  // 1) Inputs + 2) integrate velocity
  for (const p of state.players) {
    if (!p.alive) continue;
    const input = inputs[p.id];
    if (input && input.seq > p.lastProcessedSeq) p.lastProcessedSeq = input.seq;
    applyMovement(p, input, dtMs);
  }

  // 3) Player-player collisions (shove)
  events.push(...resolveCollisions(state.players, now));

  // 4) Tile states
  updateCollapse(state, events);

  // 5) Support & eliminations
  const index = tileIndex(state.tiles);
  for (const p of state.players) {
    if (!p.alive) continue;
    if (p.fallingMs < 0) {
      if (!isSupported(index, p.x, p.z)) {
        p.fallingMs = 0;
        events.push({ type: "fall", playerId: p.id });
      }
    } else {
      p.fallingMs += dtMs;
      if (p.fallingMs >= CONFIG.FALL_ELIMINATE_MS) eliminate(p, now, events);
    }
  }

  // 6) Win check: ≤ 1 alive (and nobody mid-fall who could still change the outcome).
  const alive = state.players.filter((p) => p.alive);
  const standing = alive.filter((p) => p.fallingMs < 0);
  const decided = alive.length === 0 || (alive.length === 1 && standing.length === 1);
  if (decided && state.players.length > 1) {
    state.phase = Phase.RESULTS;
    state.result = computeResult(state);
    events.push({ type: "matchEnd", result: state.result });
  }

  return { state, events };
}
