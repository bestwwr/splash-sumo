/** Snapshot codec: the dynamic part of MatchState, as sent over the wire. */
import type { LavaRock, Eruption, MatchResult, MatchState, Phase, Player, SimEvent, Tile } from "./types";

export interface SnapPlayer {
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  alive: boolean;
  fallingMs: number;
  hitStunMs: number;
  skillPhase: Player["skillPhase"];
  skillPhaseMs: number;
  skillCooldownMs: number;
  rockCooldownMs: number;
  spiritAngle: number;
  dashDirX: number;
  dashDirZ: number;
  eliminatedCause: Player["eliminatedCause"];
  eliminatedAtMs: number;
  lastProcessedSeq: number;
}

/** [index into MatchState.tiles, state, changedAtMs, warnAtMs] */
export type SnapTile = [number, Tile["state"], number, number];

export interface Snap {
  tick: number;
  timeMs: number;
  phase: Phase;
  suddenDeath: boolean;
  players: SnapPlayer[];
  tiles: SnapTile[];
  rocks: LavaRock[];
  eruption: Eruption;
  events: SimEvent[];
  result: MatchResult | null;
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

function snapPlayer(p: Player): SnapPlayer {
  return {
    x: r3(p.x),
    z: r3(p.z),
    vx: r3(p.vx),
    vz: r3(p.vz),
    facing: r3(p.facing),
    alive: p.alive,
    fallingMs: r3(p.fallingMs),
    hitStunMs: r3(p.hitStunMs),
    skillPhase: p.skillPhase,
    skillPhaseMs: r3(p.skillPhaseMs),
    skillCooldownMs: r3(p.skillCooldownMs),
    rockCooldownMs: r3(p.rockCooldownMs),
    spiritAngle: r3(p.spiritAngle),
    dashDirX: r3(p.dashDirX),
    dashDirZ: r3(p.dashDirZ),
    eliminatedCause: p.eliminatedCause,
    eliminatedAtMs: p.eliminatedAtMs,
    lastProcessedSeq: p.lastProcessedSeq,
  };
}

/** prevTiles === null sends every tile; otherwise only tiles that changed since prevTiles. */
export function encodeSnap(state: MatchState, prevTiles: Tile[] | null, events: SimEvent[]): Snap {
  const tiles: SnapTile[] = [];
  state.tiles.forEach((t, i) => {
    const p = prevTiles?.[i];
    if (!p || p.state !== t.state || p.changedAtMs !== t.changedAtMs || p.warnAtMs !== t.warnAtMs) {
      tiles.push([i, t.state, t.changedAtMs, t.warnAtMs]);
    }
  });
  return {
    tick: state.tick,
    timeMs: state.timeMs,
    phase: state.phase,
    suddenDeath: state.suddenDeath,
    players: state.players.map(snapPlayer),
    tiles,
    rocks: state.rocks.map((r) => ({ ...r })),
    eruption: { ...state.eruption, targets: state.eruption.targets.map((t) => ({ ...t })) },
    events,
    result: copyResult(state.result),
  };
}

function copyResult(r: MatchResult | null): MatchResult | null {
  return r ? { ...r, placements: r.placements.map((p) => ({ ...p })) } : null;
}

/** Returns a new state; base is not mutated. Static player fields come from base. */
export function applySnap(base: MatchState, snap: Snap): MatchState {
  const tiles = base.tiles.map((t) => ({ ...t }));
  for (const [i, state, changedAtMs, warnAtMs] of snap.tiles) {
    const t = tiles[i];
    if (t) {
      t.state = state;
      t.changedAtMs = changedAtMs;
      t.warnAtMs = warnAtMs;
    }
  }
  return {
    ...base,
    tick: snap.tick,
    timeMs: snap.timeMs,
    phase: snap.phase,
    suddenDeath: snap.suddenDeath,
    players: base.players.map((p, i) => ({ ...p, ...snap.players[i] })),
    tiles,
    rocks: snap.rocks.map((r) => ({ ...r })),
    eruption: { ...snap.eruption, targets: snap.eruption.targets.map((t) => ({ ...t })) },
    result: copyResult(snap.result),
  };
}
