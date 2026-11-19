/**
 * Seeded floor collapse (A.3):
 *   SOLID → WARNING (1.0 s, walkable) → SINKING (0.4 s, no support) → GONE
 * Sources: edge shrink, random tiles, sudden death. (Eruption: Milestone 3.)
 */
import { CONFIG } from "./config";
import { HEX_DIRECTIONS, hexKey, hexesInRadius, hexRing } from "./hex";
import { nextInt, nextRange } from "./rng";
import { TileState, type MatchState, type SimEvent, type Tile } from "./types";

export function createTiles(radius: number = CONFIG.ARENA_RADIUS): Tile[] {
  return hexesInRadius(radius).map((h) => ({
    q: h.q,
    r: h.r,
    ring: hexRing(h),
    state: TileState.SOLID,
    changedAtMs: 0,
    warnAtMs: -1,
  }));
}

export function isSupportive(state: TileState): boolean {
  return state === TileState.SOLID || state === TileState.WARNING;
}

function setState(t: Tile, state: TileState, atMs: number): void {
  t.state = state;
  t.changedAtMs = atMs;
}

/** Mark a SOLID tile as WARNING now (no-op otherwise). */
export function warnTile(t: Tile, nowMs: number): boolean {
  if (t.state !== TileState.SOLID) return false;
  setState(t, TileState.WARNING, nowMs);
  t.warnAtMs = -1;
  return true;
}

/** Advance WARNING → SINKING → GONE and fire scheduled ripple warnings. */
export function advanceTiles(tiles: Tile[], nowMs: number): void {
  for (const t of tiles) {
    if (t.state === TileState.SOLID && t.warnAtMs >= 0 && nowMs >= t.warnAtMs) {
      setState(t, TileState.WARNING, t.warnAtMs);
      t.warnAtMs = -1;
    }
    if (t.state === TileState.WARNING && nowMs >= t.changedAtMs + CONFIG.WARNING_MS) {
      setState(t, TileState.SINKING, t.changedAtMs + CONFIG.WARNING_MS);
    }
    if (t.state === TileState.SINKING && nowMs >= t.changedAtMs + CONFIG.SINKING_MS) {
      setState(t, TileState.GONE, t.changedAtMs + CONFIG.SINKING_MS);
    }
  }
}

/**
 * Are all SOLID tiles (optionally excluding one, optionally only rings ≤ maxRing)
 * a single connected island?
 */
export function solidIsConnected(tiles: Tile[], excludeKey?: string, maxRing = Infinity): boolean {
  const solid = new Map<string, Tile>();
  for (const t of tiles) {
    const k = hexKey(t.q, t.r);
    if (t.state === TileState.SOLID && t.warnAtMs < 0 && t.ring <= maxRing && k !== excludeKey) solid.set(k, t);
  }
  const first = solid.values().next();
  if (first.done) return true;
  const seen = new Set<string>();
  const stack: Tile[] = [first.value];
  seen.add(hexKey(first.value.q, first.value.r));
  while (stack.length) {
    const t = stack.pop()!;
    for (const d of HEX_DIRECTIONS) {
      const k = hexKey(t.q + d.q, t.r + d.r);
      const n = solid.get(k);
      if (n && !seen.has(k)) {
        seen.add(k);
        stack.push(n);
      }
    }
  }
  return seen.size === solid.size;
}

/** Edge shrink: schedule the outermost remaining ring with a 0–300 ms ripple. */
function edgeShrink(state: MatchState, nowMs: number, events: SimEvent[]): void {
  const minRing = state.suddenDeath ? 0 : CONFIG.MIN_EDGE_RING_BEFORE_SUDDEN_DEATH;
  // Skip rings that are already fully gone/claimed.
  while (state.edgeRing >= minRing) {
    const ringTiles = state.tiles.filter((t) => t.ring === state.edgeRing && t.state === TileState.SOLID && t.warnAtMs < 0);
    if (ringTiles.length > 0) {
      for (const t of ringTiles) {
        t.warnAtMs = nowMs + Math.round(nextRange(state, 0, CONFIG.EDGE_RIPPLE_STAGGER_MS));
      }
      events.push({ type: "edgeShrink", ring: state.edgeRing });
      state.edgeRing--;
      return;
    }
    state.edgeRing--;
  }
}

/** Random tile → WARNING, never from the current outermost ring. */
export function pickRandomTile(state: MatchState, nowMs: number): Tile | null {
  // Before sudden death, the final ring (rings < MIN_EDGE_RING) is protected too.
  const minRing = state.suddenDeath ? 0 : CONFIG.MIN_EDGE_RING_BEFORE_SUDDEN_DEATH;
  const candidates = state.tiles.filter(
    (t) => t.state === TileState.SOLID && t.warnAtMs < 0 && t.ring < state.edgeRing && t.ring >= minRing,
  );
  const guardIsolation = nowMs < CONFIG.NO_ISOLATION_UNTIL_MS;
  // Seeded shuffle-pick: try candidates in random order until one is acceptable.
  while (candidates.length > 0) {
    const i = nextInt(state, candidates.length);
    const t = candidates[i]!;
    candidates.splice(i, 1);
    // Check the region that survives the NEXT edge shrink too, so a later ring
    // removal can't strand tiles that were only connected through the edge.
    if (!guardIsolation || solidIsConnected(state.tiles, hexKey(t.q, t.r), state.edgeRing - 1)) return t;
  }
  return null;
}

/** Run collapse timers for this tick. */
export function updateCollapse(state: MatchState, events: SimEvent[]): void {
  const now = state.timeMs;

  if (!state.suddenDeath && now >= CONFIG.SUDDEN_DEATH_AT_MS) {
    state.suddenDeath = true;
    events.push({ type: "suddenDeath" });
    state.nextEdgeShrinkAtMs = Math.min(state.nextEdgeShrinkAtMs, now + CONFIG.SUDDEN_DEATH_EDGE_INTERVAL_MS);
    state.nextRandomTileAtMs = Math.min(
      state.nextRandomTileAtMs,
      now + CONFIG.RANDOM_TILE_INTERVAL_MS / CONFIG.SUDDEN_DEATH_RANDOM_RATE_MULT,
    );
  }

  if (now >= state.nextEdgeShrinkAtMs) {
    edgeShrink(state, state.nextEdgeShrinkAtMs, events);
    state.nextEdgeShrinkAtMs += state.suddenDeath
      ? CONFIG.SUDDEN_DEATH_EDGE_INTERVAL_MS
      : CONFIG.EDGE_SHRINK_INTERVAL_MS;
  }

  while (now >= state.nextRandomTileAtMs) {
    const t = pickRandomTile(state, state.nextRandomTileAtMs);
    if (t) warnTile(t, state.nextRandomTileAtMs);
    state.nextRandomTileAtMs += state.suddenDeath
      ? CONFIG.RANDOM_TILE_INTERVAL_MS / CONFIG.SUDDEN_DEATH_RANDOM_RATE_MULT
      : CONFIG.RANDOM_TILE_INTERVAL_MS;
  }

  advanceTiles(state.tiles, now);
}
