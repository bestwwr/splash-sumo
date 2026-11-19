import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { cloneState, createMatch, step } from "../src/simulation";
import { hexToWorld } from "../src/hex";
import { EliminationCause, TileState, type MatchState, type SimEvent } from "../src/types";
import { makePlayer } from "./helpers";

const setups = [
  { id: "a", nickname: "a", character: "elephant" as const, isBot: false },
  { id: "b", nickname: "b", character: "elephant" as const, isBot: false },
];

function runUntil(s: MatchState, ms: number): { s: MatchState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  for (let i = 0; i < 5000 && s.timeMs < ms; i++) {
    const r = step(s, {});
    s = r.state;
    events.push(...r.events);
  }
  return { s, events };
}

/** Eruption scheduled at 100 ms, no floor collapse interference. */
function arena(): MatchState {
  const s = createMatch(7, setups);
  s.eruption.atMs = 100;
  s.nextEdgeShrinkAtMs = 1e9;
  s.nextRandomTileAtMs = 1e9;
  return s;
}

describe("eruption", () => {
  it("happens once, between 30 and 50 s, for 20 seeds", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createMatch(seed, setups);
      expect(s.eruption.atMs).toBeGreaterThanOrEqual(CONFIG.ERUPTION_MIN_MS);
      expect(s.eruption.atMs).toBeLessThan(CONFIG.ERUPTION_MAX_MS);
      s.nextEdgeShrinkAtMs = 1e9;
      s.nextRandomTileAtMs = 1e9;
      const { events } = runUntil(s, CONFIG.ERUPTION_MAX_MS + CONFIG.ERUPTION_TELEGRAPH_MS + 500);
      expect(events.filter((e) => e.type === "eruptionIncoming")).toHaveLength(1);
      expect(events.filter((e) => e.type === "eruptionImpact")).toHaveLength(1);
    }
  });

  it("telegraph: 3-4 targets announced 1.5 s before impact", () => {
    const { events } = runUntil(arena(), 3000);
    const inc = events.find((e) => e.type === "eruptionIncoming");
    expect(inc?.type).toBe("eruptionIncoming");
    if (inc?.type !== "eruptionIncoming") return;
    expect(inc.targets.length).toBeGreaterThanOrEqual(3);
    expect(inc.targets.length).toBeLessThanOrEqual(4);
    expect(new Set(inc.targets.map((t) => `${t.x},${t.z}`)).size).toBe(inc.targets.length);
    expect(inc.impactAtMs - 100).toBeGreaterThanOrEqual(CONFIG.ERUPTION_TELEGRAPH_MS - 1);
    expect(inc.impactAtMs - 100).toBeLessThan(CONFIG.ERUPTION_TELEGRAPH_MS + CONFIG.TICK_MS);
  });

  it("impact: pushes players inside the circle with 40% of a reference shove; outside untouched", () => {
    const s = arena();
    s.eruption.phase = 1;
    s.eruption.targets = [{ x: 0, z: 0 }];
    s.eruption.impactAtMs = 100;
    s.players = [makePlayer("in", 1, 0), makePlayer("out", 3, 0, { slot: 1 })];
    const { s: out, events } = runUntil(s, 150);
    const inP = out.players[0]!;
    const outP = out.players[1]!;
    expect(inP.vx).toBeGreaterThan(0);
    expect(inP.vx).toBeLessThanOrEqual(CONFIG.ERUPTION_KNOCK_SPEED + 1e-9);
    expect(inP.vx).toBeGreaterThan(CONFIG.ERUPTION_KNOCK_SPEED * 0.5);
    expect(outP.vx).toBe(0);
    expect(outP.lastHitById).toBeNull();
    const ev = events.find((e) => e.type === "eruptionImpact");
    expect(ev?.type === "eruptionImpact" && ev.hitIds).toEqual(["in"]);
    expect(CONFIG.ERUPTION_KNOCK_SPEED).toBeCloseTo(0.4 * CONFIG.REFERENCE_SHOVE_SPEED, 9);
  });

  it("impact: SOLID tiles under a target turn WARNING", () => {
    const s = arena();
    s.eruption.phase = 1;
    s.eruption.targets = [{ x: 0, z: 0 }];
    s.eruption.impactAtMs = 100;
    s.players = [makePlayer("p", 4, 0)];
    const { s: out } = runUntil(s, 150);
    for (const t of out.tiles) {
      const c = hexToWorld(t);
      const inside = Math.hypot(c.x, c.z) <= CONFIG.ERUPTION_RADIUS;
      if (inside) expect(t.state).toBe(TileState.WARNING);
      else expect(t.state).toBe(TileState.SOLID);
    }
    expect(out.eruption.phase).toBe(2);
  });

  it("a fall right after an eruption hit is credited ERUPTION", () => {
    const s = arena();
    s.eruption.phase = 1;
    s.eruption.targets = [{ x: 0, z: 0 }];
    s.eruption.impactAtMs = 100;
    s.players = [makePlayer("v", 0.5, 0), makePlayer("w", 4, 0, { slot: 1 })];
    const { s: hit } = runUntil(s, 100 + CONFIG.TICK_MS);
    expect(hit.players[0]!.lastHitCause).toBe(EliminationCause.ERUPTION);
    // Remove the floor under the victim: the fall is credited to the eruption.
    for (const t of hit.tiles) t.state = TileState.GONE;
    const { s: out } = runUntil(hit, hit.timeMs + 1500);
    const v = out.players[0]!;
    expect(v.alive).toBe(false);
    expect(v.eliminatedCause).toBe(EliminationCause.ERUPTION);
  });

  it("eruption pending when the match ends never fires", () => {
    const s = createMatch(3, setups);
    expect(s.eruption.phase).toBe(0);
    const { s: out, events } = runUntil(s, 5000);
    expect(out.eruption.phase).toBe(0);
    expect(events.some((e) => e.type === "eruptionIncoming")).toBe(false);
  });

  it("cloneState deep-copies the eruption and step never mutates prev", () => {
    const s = arena();
    s.eruption.targets = [{ x: 1, z: 1 }];
    const c = cloneState(s);
    c.eruption.targets[0]!.x = 9;
    expect(s.eruption.targets[0]!.x).toBe(1);
    const snap = JSON.stringify(s);
    step(s, {});
    expect(JSON.stringify(s)).toBe(snap);
  });
});
