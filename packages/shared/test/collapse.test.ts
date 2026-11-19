import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { advanceTiles, createTiles, solidIsConnected, warnTile } from "../src/collapse";
import { createMatch, step } from "../src/simulation";
import { TileState, type MatchState, type SimEvent } from "../src/types";
import { hexKey } from "../src/hex";

const setups = ["a", "b", "c", "d"].map((id) => ({ id, nickname: id, character: "elephant" as const, isBot: true }));

/** Run the floor only: pin players at the center so the match never ends. */
function runFloor(seed: number, untilMs: number, onTick?: (s: MatchState, prev: MatchState, events: SimEvent[]) => void): MatchState {
  let s = createMatch(seed, setups);
  while (s.timeMs < untilMs) {
    for (const p of s.players) { p.x = 0; p.z = 0; p.vx = 0; p.vz = 0; p.fallingMs = -1; p.alive = true; }
    const prev = s;
    const r = step(s, {});
    s = r.state;
    onTick?.(s, prev, r.events);
  }
  return s;
}

describe("tile lifecycle", () => {
  it("SOLID → WARNING (1.0 s) → SINKING (0.4 s) → GONE", () => {
    const [t] = createTiles(0);
    warnTile(t!, 1000);
    expect(t!.state).toBe(TileState.WARNING);
    advanceTiles([t!], 1999); expect(t!.state).toBe(TileState.WARNING);
    advanceTiles([t!], 2000); expect(t!.state).toBe(TileState.SINKING);
    advanceTiles([t!], 2399); expect(t!.state).toBe(TileState.SINKING);
    advanceTiles([t!], 2400); expect(t!.state).toBe(TileState.GONE);
  });
});

describe("collapse schedule", () => {
  it("nothing collapses before the edge shrink starts", () => {
    const s = runFloor(1, CONFIG.EDGE_SHRINK_START_MS - 50);
    expect(s.tiles.every((t) => t.state === TileState.SOLID && t.warnAtMs < 0)).toBe(true);
  });

  it("edge shrink takes the whole outermost ring within the ripple stagger", () => {
    const s = runFloor(1, CONFIG.EDGE_SHRINK_START_MS + CONFIG.EDGE_RIPPLE_STAGGER_MS + 40);
    const outer = s.tiles.filter((t) => t.ring === CONFIG.ARENA_RADIUS);
    expect(outer.every((t) => t.state === TileState.WARNING)).toBe(true);
    const inner = s.tiles.filter((t) => t.ring < CONFIG.ARENA_RADIUS);
    expect(inner.every((t) => t.state === TileState.SOLID)).toBe(true);
  });

  it("random tiles start at 15 s, every 3 s, never from the outermost remaining ring", () => {
    const randomAt: number[] = [];
    runFloor(3, 60_000, (s, prev) => {
      s.tiles.forEach((t, i) => {
        const before = prev.tiles[i]!;
        // Random picks go SOLID → WARNING directly (edge ripples are pre-scheduled via warnAtMs).
        if (before.state === TileState.SOLID && before.warnAtMs < 0 && t.state === TileState.WARNING) {
          randomAt.push(t.changedAtMs);
          expect(t.ring).toBeLessThan(prev.edgeRing); // edgeRing = outermost remaining ring
        }
      });
    });
    expect(randomAt[0]).toBe(CONFIG.RANDOM_TILE_START_MS);
    expect(randomAt[1]! - randomAt[0]!).toBe(CONFIG.RANDOM_TILE_INTERVAL_MS);
  });

  it("the remaining floor stays one connected island for the first 30 s", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      runFloor(seed, CONFIG.NO_ISOLATION_UNTIL_MS, (s) => expect(solidIsConnected(s.tiles)).toBe(true));
    }
  });

  it("the final 7-tile ring survives until sudden death, then sudden death clears the arena", () => {
    const before = runFloor(5, CONFIG.SUDDEN_DEATH_AT_MS - 100);
    const core = before.tiles.filter((t) => t.ring < CONFIG.MIN_EDGE_RING_BEFORE_SUDDEN_DEATH);
    expect(core).toHaveLength(7);
    expect(core.every((t) => t.state === TileState.SOLID)).toBe(true);
    const after = runFloor(5, CONFIG.SUDDEN_DEATH_AT_MS + 15_000);
    expect(after.suddenDeath).toBe(true);
    expect(after.tiles.every((t) => t.state === TileState.GONE)).toBe(true);
  });

  it("sudden death fires at 90 s and switches to the faster cadence", () => {
    let sdAt = -1;
    runFloor(9, CONFIG.SUDDEN_DEATH_AT_MS + 200, (s, _prev, events) => {
      if (events.some((e) => e.type === "suddenDeath")) {
        sdAt = s.timeMs;
        expect(s.nextEdgeShrinkAtMs - s.timeMs).toBeLessThanOrEqual(CONFIG.SUDDEN_DEATH_EDGE_INTERVAL_MS);
        expect(s.nextRandomTileAtMs - s.timeMs).toBeLessThanOrEqual(
          CONFIG.RANDOM_TILE_INTERVAL_MS / CONFIG.SUDDEN_DEATH_RANDOM_RATE_MULT,
        );
      }
    });
    expect(sdAt).toBe(CONFIG.SUDDEN_DEATH_AT_MS);
  });

  it("is deterministic for a seed and varies across seeds", () => {
    const snap = (s: MatchState) => s.tiles.map((t) => `${hexKey(t.q, t.r)}:${t.state}:${t.changedAtMs}`).join("|");
    expect(snap(runFloor(11, 45_000))).toBe(snap(runFloor(11, 45_000)));
    expect(snap(runFloor(11, 45_000))).not.toBe(snap(runFloor(12, 45_000)));
  });
});
