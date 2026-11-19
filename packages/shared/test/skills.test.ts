import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { createMatch, step } from "../src/simulation";
import { SkillPhase, type Inputs, type MatchState, type PlayerInput, type SimEvent } from "../src/types";
import { makePlayer } from "./helpers";

const WINDUP_TICKS = Math.ceil(CONFIG.SLAM_WINDUP_MS / CONFIG.TICK_MS);
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

const slamScene = () =>
  arena(makePlayer("e", 0, 0), makePlayer("near", 1.5, 0, { slot: 1 }), makePlayer("far", 3, 0, { slot: 2 }));
const count = (ev: SimEvent[], t: string) => ev.filter((e) => e.type === t).length;

describe("elephant slam", () => {
  it("winds up for 400 ms, then knocks back everyone within 2.0 m outward", () => {
    const early = run(slamScene(), WINDUP_TICKS - 2, { e: press() });
    expect(count(early.events, "slamImpact")).toBe(0);
    const { s, events } = run(slamScene(), WINDUP_TICKS + 1, { e: press() });
    const impact = events.find((e) => e.type === "slamImpact");
    expect(impact).toBeDefined();
    if (impact?.type === "slamImpact") expect(impact.hitIds).toEqual(["near"]);
    expect(s.players[1]!.vx).toBeGreaterThan(2);
    expect(s.players[2]!.vx).toBe(0);
    expect(s.players[0]!.skillPhase).toBe(SkillPhase.NONE);
  });

  it("slammer cannot move during wind-up", () => {
    let s = slamScene();
    for (let i = 0; i < WINDUP_TICKS - 2; i++) {
      s = step(s, { e: press({ dirX: 1 }) }).state;
      expect(Math.abs(s.players[0]!.x)).toBeLessThan(0.01);
    }
  });

  it("knockback credits the elephant", () => {
    const { s } = run(slamScene(), WINDUP_TICKS + 1, { e: press() });
    expect(s.players[1]!.lastHitById).toBe("e");
    expect(s.players[0]!.lastHitById).toBeNull();
  });
});

describe("skill activation rules", () => {
  it("one activation per press", () => {
    const ticks = Math.ceil(9000 / CONFIG.TICK_MS);
    const held = run(slamScene(), ticks, { e: press() });
    expect(count(held.events, "skillUsed")).toBe(1);
    // Release, then press again after the cooldown has elapsed.
    const again = run(held.s, 2, (i) => ({ e: press({ skill: i === 1 }) }));
    expect(count(again.events, "skillUsed")).toBe(1);
  });

  it("is ignored during cooldown", () => {
    const s = slamScene();
    s.players[0]!.skillCooldownMs = 5000;
    expect(count(run(s, 3, { e: press() }).events, "skillUsed")).toBe(0);
  });
  it("is ignored while falling", () => {
    const s = slamScene();
    s.players[0]!.fallingMs = 0;
    expect(count(run(s, 3, { e: press() }).events, "skillUsed")).toBe(0);
  });
  it("is ignored while hit-stunned", () => {
    const s = slamScene();
    s.players[0]!.hitStunMs = 150;
    expect(count(run(s, 1, { e: press() }).events, "skillUsed")).toBe(0);
  });

  it("step stays pure with a slam in progress", () => {
    const s = run(slamScene(), 5, { e: press() }).s;
    const before = JSON.stringify(s);
    step(s, { e: press() });
    expect(JSON.stringify(s)).toBe(before);
  });
});
