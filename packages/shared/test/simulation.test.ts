import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { cloneState, computeResult, createMatch, isSupported, spawnPoint, step } from "../src/simulation";
import { EliminationCause, Phase, TileState, type Inputs, type MatchState } from "../src/types";
import { hexKey } from "../src/hex";
import { createRng } from "../src/rng";

const setups = ["a", "b", "c", "d"].map((id) => ({ id, nickname: id, character: "elephant" as const, isBot: id !== "a" }));
const index = (s: MatchState) => new Map(s.tiles.map((t) => [hexKey(t.q, t.r), t]));

function runTicks(s: MatchState, n: number, inputs: Inputs = {}) {
  for (let i = 0; i < n; i++) s = step(s, inputs).state;
  return s;
}

describe("simulation", () => {
  it("all 4 spawns are on the arena and apart from each other", () => {
    const s = createMatch(1, setups);
    for (const p of s.players) expect(isSupported(index(s), p.x, p.z)).toBe(true);
    const a = spawnPoint(0, 4), b = spawnPoint(1, 4);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(4);
  });

  it("step is pure: the previous state is not mutated", () => {
    const s0 = createMatch(1, setups);
    const before = JSON.stringify(s0);
    step(s0, { a: { seq: 1, dirX: 1, dirZ: 0, skill: false } });
    expect(JSON.stringify(s0)).toBe(before);
  });

  it("tracks lastProcessedSeq", () => {
    const s = step(createMatch(1, setups), { a: { seq: 7, dirX: 0, dirZ: 0, skill: false } }).state;
    expect(s.players[0]!.lastProcessedSeq).toBe(7);
  });

  it("walking off the edge: falls, then eliminated after 0.5 s with cause FLOOR", () => {
    let s = createMatch(1, setups);
    const run: Inputs = { a: { seq: 1, dirX: 1, dirZ: 1, skill: false } };
    let fellAt = -1;
    for (let i = 0; i < 200 && s.players[0]!.alive; i++) {
      s = step(s, run).state;
      if (fellAt < 0 && s.players[0]!.fallingMs >= 0) fellAt = s.timeMs;
    }
    const p = s.players[0]!;
    expect(p.alive).toBe(false);
    expect(p.eliminatedCause).toBe(EliminationCause.FLOOR);
    expect(p.eliminatedAtMs - fellAt).toBeGreaterThanOrEqual(CONFIG.FALL_ELIMINATE_MS - CONFIG.TICK_MS);
    expect(p.eliminatedAtMs - fellAt).toBeLessThanOrEqual(CONFIG.FALL_ELIMINATE_MS + CONFIG.TICK_MS);
  });

  it("standing on a WARNING tile is safe; on a SINKING tile you fall", () => {
    let s = createMatch(1, setups);
    s.players[0]!.x = 0; s.players[0]!.z = 0;
    const center = s.tiles.find((t) => t.q === 0 && t.r === 0)!;
    center.state = TileState.WARNING; center.changedAtMs = 0;
    s = step(s, {}).state;
    expect(s.players[0]!.fallingMs).toBe(-1);
    s = runTicks(s, Math.ceil(CONFIG.WARNING_MS / CONFIG.TICK_MS) + 1);
    expect(s.players[0]!.fallingMs).toBeGreaterThanOrEqual(0);
  });

  it("a fall shortly after being shoved is credited to the shover", () => {
    let s = createMatch(1, setups);
    const [a, b] = s.players;
    // b stands near the east edge, a charges into it.
    b!.x = 5.2; b!.z = 0; a!.x = 4.2; a!.z = 0;
    s.players.slice(2).forEach((p, i) => { p.x = -2 - i; p.z = 0; });
    const inputs: Inputs = { a: { seq: 1, dirX: 1, dirZ: 0, skill: false } };
    for (let i = 0; i < 60; i++) {
      s = step(s, inputs).state;
      if (s.players[0]!.fallingMs >= 0) break; // don't let a follow b in
    }
    s = runTicks(s, 30);
    const victim = s.players[1]!;
    expect(victim.alive).toBe(false);
    expect(victim.eliminatedCause).toBe(EliminationCause.SHOVE);
    expect(victim.eliminatedById).toBe("a");
  });

  it("last one standing wins; results are ordered by elimination time", () => {
    let s = createMatch(1, setups);
    const t = (ms: number) => ms;
    s.players[1]!.alive = false; s.players[1]!.eliminatedAtMs = t(100);
    s.players[2]!.alive = false; s.players[2]!.eliminatedAtMs = t(200);
    s.players[3]!.x = 100; // off the arena → falls
    s.players[0]!.x = 0; s.players[0]!.z = 0;
    s = runTicks(s, 20);
    expect(s.phase).toBe(Phase.RESULTS);
    expect(s.result!.winnerId).toBe("a");
    expect(s.result!.placements.map((p) => [p.playerId, p.place])).toEqual([["a", 1], ["d", 2], ["c", 3], ["b", 4]]);
  });

  it("final players eliminated on the same tick → draw with tied places", () => {
    const s = createMatch(1, setups);
    s.players.forEach((p, i) => { p.alive = false; p.eliminatedAtMs = i < 2 ? 5000 : 1000 * i; });
    const r = computeResult(s);
    expect(r.draw).toBe(true);
    expect(r.winnerId).toBeNull();
    expect(r.placements.filter((p) => p.place === 1)).toHaveLength(2);
  });

  it("same seed + same inputs → identical match (replayable)", () => {
    const play = () => {
      const rng = createRng(99);
      let s = createMatch(1234, setups);
      const log: string[] = [];
      for (let i = 0; i < 30 * 120 && s.phase === Phase.PLAYING; i++) {
        const inputs: Inputs = {};
        for (const p of s.players) { const a = rng() * Math.PI * 2; inputs[p.id] = { seq: i, dirX: Math.cos(a), dirZ: Math.sin(a), skill: false }; }
        const r = step(s, inputs); s = r.state;
        for (const e of r.events) log.push(`${s.tick}:${e.type}`);
      }
      return { log, players: JSON.stringify(s.players), result: JSON.stringify(s.result) };
    };
    expect(play()).toEqual(play());
  });

  it("a full match with wandering players always ends (≤ sudden death + 20 s)", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rng = createRng(seed);
      let s = createMatch(seed, setups);
      let inputs: Inputs = {};
      while (s.phase === Phase.PLAYING && s.timeMs < CONFIG.SUDDEN_DEATH_AT_MS + 20_000) {
        if (s.tick % 15 === 0) {
          inputs = {};
          for (const p of s.players) { const a = rng() * Math.PI * 2; inputs[p.id] = { seq: s.tick, dirX: Math.cos(a) * 0.5 - p.x * 0.15, dirZ: Math.sin(a) * 0.5 - p.z * 0.15, skill: false }; }
        }
        s = step(s, inputs).state;
      }
      expect(s.phase).toBe(Phase.RESULTS);
    }
  });

  it("cloneState produces an independent deep copy", () => {
    const s = createMatch(1, setups);
    const c = cloneState(s);
    c.players[0]!.x = 99; c.tiles[0]!.state = TileState.GONE;
    expect(s.players[0]!.x).not.toBe(99);
    expect(s.tiles[0]!.state).toBe(TileState.SOLID);
  });
});
