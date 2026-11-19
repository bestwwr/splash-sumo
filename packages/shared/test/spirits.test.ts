import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { worldToHex } from "../src/hex";
import { cloneState, createMatch, step } from "../src/simulation";
import { EliminationCause, Phase, TileState, type Inputs, type MatchState, type PlayerInput, type SimEvent } from "../src/types";
import { makePlayer } from "./helpers";

const press = (over: Partial<PlayerInput> = {}): PlayerInput => ({ seq: 1, dirX: 0, dirZ: 0, skill: true, ...over });

function arena(...players: ReturnType<typeof makePlayer>[]): MatchState {
  const s = createMatch(1, [
    { id: "x", nickname: "x", character: "elephant", isBot: false },
    { id: "y", nickname: "y", character: "elephant", isBot: false },
  ]);
  s.players = players;
  return s;
}

function run(s: MatchState, ticks: number, inputs: Inputs | ((i: number) => Inputs)) {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = step(s, typeof inputs === "function" ? inputs(i) : inputs);
    s = r.state;
    events.push(...r.events);
  }
  return { s, events };
}

const spirit = (angle = 0) => makePlayer("s", Math.cos(angle) * CONFIG.SPIRIT_RING_RADIUS, Math.sin(angle) * CONFIG.SPIRIT_RING_RADIUS, { alive: false, spiritAngle: angle, slot: 3 });
const thrown = (ev: SimEvent[]) => ev.filter((e) => e.type === "lavaRockThrown");

describe("ember spirits", () => {
  it("eliminated player becomes a spirit at the ring angle where they fell", () => {
    const s = arena(makePlayer("a", 3, 3), makePlayer("b", -3, 0, { slot: 1 }), makePlayer("c", 0, -3, { slot: 2 }));
    const h = worldToHex(3, 3);
    s.tiles.find((t) => t.q === h.q && t.r === h.r)!.state = TileState.GONE;
    const { s: out, events } = run(s, 40, {});
    const a = out.players[0]!;
    expect(events.some((e) => e.type === "eliminated" && e.playerId === "a")).toBe(true);
    expect(a.alive).toBe(false);
    expect(a.spiritAngle).toBeCloseTo(Math.atan2(a.z, a.x), 9);
  });

  it("rock: soft auto-aim picks a player inside the 30 degree cone, not one outside it", () => {
    // Spirit at (7.2, 0) aims -x. "near" is closer but ~51 degrees off; "far" is in the cone.
    const s = arena(spirit(), makePlayer("near", 6, 1.5, { slot: 1 }), makePlayer("far", 4, 0.3, { slot: 2 }));
    const { events } = run(s, 1, { s: press({ dirX: -1 }) });
    const t = thrown(events)[0];
    expect(t?.type).toBe("lavaRockThrown");
    if (t?.type === "lavaRockThrown") {
      expect(t.fromId).toBe("s");
      expect(t.targetX).toBeCloseTo(4, 1);
      expect(t.targetZ).toBeCloseTo(0.3, 1);
    }
  });

  it("rock with nobody in the cone lands ROCK_RANGE x |input| along the aim", () => {
    const s = arena(spirit(), makePlayer("a", 0, 6, { slot: 1 }), makePlayer("b", 0, -6, { slot: 2 }));
    const { events } = run(s, 1, { s: press({ dirX: -0.5 }) });
    const t = thrown(events)[0];
    if (t?.type !== "lavaRockThrown") throw new Error("no throw");
    expect(t.targetX).toBeCloseTo(CONFIG.SPIRIT_RING_RADIUS - CONFIG.ROCK_RANGE * 0.5, 6);
    expect(t.targetZ).toBeCloseTo(0, 6);
  });

  it("rock: lands after 600 ms and pushes with 30% of a reference shove", () => {
    const s = arena(spirit(), makePlayer("v", 4, 0, { slot: 1 }), makePlayer("o", -3, 3, { slot: 2 }));
    let cur = s;
    let impactTick = -1;
    for (let i = 0; i < 40; i++) {
      const r = step(cur, i === 0 ? { s: press({ dirX: -1 }) } : {});
      cur = r.state;
      const hit = r.events.find((e) => e.type === "rockImpact");
      if (hit) {
        impactTick = i;
        if (hit.type === "rockImpact") expect(hit.hitIds).toEqual(["v"]);
        break;
      }
      expect(cur.players[1]!.vx).toBe(0);
    }
    expect(impactTick).toBeGreaterThanOrEqual(Math.floor(CONFIG.ROCK_FLIGHT_MS / CONFIG.TICK_MS) - 1);
    expect(impactTick).toBeLessThanOrEqual(Math.ceil(CONFIG.ROCK_FLIGHT_MS / CONFIG.TICK_MS) + 1);
    const v = cur.players[1]!;
    const speed = Math.hypot(v.vx, v.vz);
    expect(speed).toBeGreaterThanOrEqual(0.27 * CONFIG.REFERENCE_SHOVE_SPEED);
    expect(speed).toBeLessThanOrEqual(0.33 * CONFIG.REFERENCE_SHOVE_SPEED);
    expect(v.hitStunMs).toBeGreaterThan(0);
    expect(cur.rocks).toHaveLength(0);
  });

  it("rock: 4 s cooldown, one throw per press", () => {
    const mk = () => arena(spirit(), makePlayer("a", 3, 3, { slot: 1 }), makePlayer("b", -3, 3, { slot: 2 }));
    const held = run(mk(), 60, { s: press({ dirX: -1 }) });
    expect(thrown(held.events)).toHaveLength(1);
    const mashed = run(mk(), 140, (i) => ({ s: press({ dirX: -1, skill: i % 2 === 0 }) }));
    const ticks = thrown(mashed.events).length;
    expect(ticks).toBe(2);
    const early = run(mk(), 118, (i) => ({ s: press({ dirX: -1, skill: i % 2 === 0 }) }));
    expect(thrown(early.events)).toHaveLength(1);
  });

  it("living players never throw rocks", () => {
    const s = arena(makePlayer("a", 0, 0, { slot: 0 }), makePlayer("b", 3, 0, { slot: 1 }));
    const { events } = run(s, 5, { a: press({ dirX: 1 }) });
    expect(thrown(events)).toHaveLength(0);
  });

  it("rock: a fall right after a rock hit is credited LAVA_ROCK to the spirit", () => {
    const s = arena(spirit(), makePlayer("v", 4, 0, { slot: 1 }), makePlayer("o", -3, 3, { slot: 2 }));
    const hit = run(s, 25, (i) => (i === 0 ? { s: press({ dirX: -1 }) } : {}));
    const v = hit.s.players[1]!;
    expect(v.lastHitById).toBe("s");
    expect(v.lastHitCause).toBe(EliminationCause.LAVA_ROCK);
    const h = worldToHex(v.x, v.z);
    hit.s.tiles.find((t) => t.q === h.q && t.r === h.r)!.state = TileState.GONE;
    const { events } = run(hit.s, 30, {});
    const e = events.find((x) => x.type === "eliminated" && x.playerId === "v");
    expect(e).toMatchObject({ cause: EliminationCause.LAVA_ROCK, byId: "s" });
  });

  it("collisions credit SHOVE, not a stale rock cause", () => {
    const s = arena(makePlayer("a", 0, 0, { vx: 4, lastHitCause: EliminationCause.LAVA_ROCK }), makePlayer("b", 0.8, 0, { slot: 1 }));
    const { s: out } = run(s, 1, { a: { seq: 1, dirX: 1, dirZ: 0, skill: false } });
    expect(out.players[0]!.lastHitCause).toBe(EliminationCause.SHOVE);
  });

  it("rock: a rock still in flight when the match ends does nothing", () => {
    const s = arena(spirit(), makePlayer("v", 4, 0, { slot: 1 }), makePlayer("o", -3, 3, { slot: 2 }));
    const thrownState = run(s, 3, (i) => (i === 0 ? { s: press({ dirX: -1 }) } : {})).s;
    expect(thrownState.rocks).toHaveLength(1);
    thrownState.phase = Phase.RESULTS;
    const before = thrownState.players.map((p) => [p.x, p.z, p.vx]);
    const { s: out, events } = run(thrownState, 40, {});
    expect(events.filter((e) => e.type === "rockImpact")).toHaveLength(0);
    expect(out.players.map((p) => [p.x, p.z, p.vx])).toEqual(before);
  });

  it("cloneState deep-copies rocks", () => {
    const s = arena(spirit(), makePlayer("v", 4, 0, { slot: 1 }), makePlayer("o", -3, 3, { slot: 2 }));
    const withRock = run(s, 2, (i) => (i === 0 ? { s: press({ dirX: -1 }) } : {})).s;
    const c = cloneState(withRock);
    expect(c.rocks).toHaveLength(1);
    c.rocks[0]!.targetX = 99;
    expect(withRock.rocks[0]!.targetX).not.toBe(99);
  });
});
