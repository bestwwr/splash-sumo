import { describe, expect, it } from "vitest";
import { applySnap, encodeSnap, type SnapPlayer } from "../src/snapshot";
import { cloneState, createMatch, step } from "../src/simulation";
import type { Inputs, MatchState, SimEvent, Tile } from "../src/types";

const setups = ["a", "b", "c", "d"].map((id, i) => ({
  id, nickname: id, character: (["elephant", "monkey", "turtle", "elephant"] as const)[i]!, isBot: false,
}));

function scripted(tick: number): Inputs {
  const o: Inputs = {};
  setups.forEach((s, i) => {
    const a = tick * 0.05 + i * 1.7;
    o[s.id] = { seq: tick, dirX: Math.cos(a), dirZ: Math.sin(a), skill: tick % 40 === i * 7 };
  });
  return o;
}

const FIELDS: (keyof SnapPlayer)[] = [
  "x","z","vx","vz","facing","alive","fallingMs","hitStunMs","skillPhase","skillPhaseMs","skillCooldownMs",
  "rockCooldownMs","spiritAngle","dashDirX","dashDirZ","eliminatedCause","eliminatedAtMs","lastProcessedSeq",
];

describe("snapshot codec", () => {
  it("round trips over 300 ticks", () => {
    let server = createMatch(42, setups);
    let client = cloneState(server);
    let prevTiles: Tile[] | null = null;
    let events: SimEvent[] = [];
    for (let t = 1; t <= 300; t++) {
      const r = step(server, scripted(t));
      server = r.state;
      events = events.concat(r.events);
      if (t % 2 === 0) {
        const snap = encodeSnap(server, prevTiles, events);
        events = [];
        prevTiles = server.tiles.map((x) => ({ ...x }));
        client = applySnap(client, JSON.parse(JSON.stringify(snap)));
      }
    }
    expect(client.tick).toBe(server.tick);
    server.players.forEach((sp, i) => {
      const cp = client.players[i]!;
      expect(cp.id).toBe(sp.id);
      expect(cp.nickname).toBe(sp.nickname);
      for (const f of FIELDS) {
        const a = cp[f], b = sp[f];
        if (typeof a === "number" && typeof b === "number") expect(Math.abs(a - b)).toBeLessThanOrEqual(0.001);
        else expect(a).toBe(b);
      }
    });
    expect(client.tiles).toEqual(server.tiles);
  });

  it("first snap has all 91 tiles; unchanged has none", () => {
    const s = createMatch(42, setups);
    const first = encodeSnap(s, null, []);
    expect(first.tiles).toHaveLength(91);
    expect(encodeSnap(s, s.tiles, []).tiles).toHaveLength(0);
  });

  it("does not mutate base", () => {
    const s = createMatch(42, setups);
    const before = JSON.stringify(s);
    const moved = step(s, scripted(1)).state;
    applySnap(s, encodeSnap(moved, null, []));
    expect(JSON.stringify(s)).toBe(before);
  });

  it("4-player mid-match snap is under 2500 bytes", () => {
    let s: MatchState = createMatch(42, setups);
    for (let t = 1; t <= 150; t++) s = step(s, scripted(t)).state;
    const prev = step(s, scripted(151)).state;
    const snap = encodeSnap(s, prev.tiles, []);
    expect(JSON.stringify(snap).length).toBeLessThan(2500);
  });
});
