import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { resolveCollision } from "../src/physics";
import { createMatch, step } from "../src/simulation";
import { EliminationCause, SkillPhase, TileState, type Inputs, type MatchState, type PlayerInput, type SimEvent } from "../src/types";
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

describe("monkey dash", () => {
  const DASH_TICKS = Math.ceil(CONFIG.DASH_DURATION_MS / CONFIG.TICK_MS);
  const dashScene = (opts: Partial<ReturnType<typeof makePlayer>> = {}) =>
    arena(makePlayer("m", 0, 0, { character: "monkey", ...opts }), makePlayer("far", -3, 0, { slot: 1 }));
  const goneTiles = (s: MatchState, qs: number[]) => {
    for (const t of s.tiles) if (t.r === 0 && qs.includes(t.q)) t.state = TileState.GONE;
  };

  it("travels 4 m in 250 ms", () => {
    const { s } = run(dashScene(), DASH_TICKS, { m: press({ dirX: 1 }) });
    expect(s.players[0]!.x).toBeGreaterThanOrEqual(3.8);
    expect(s.players[0]!.x).toBeLessThanOrEqual(4.2);
    expect(Math.abs(s.players[0]!.z)).toBeLessThan(0.01);
  });

  it("crosses a single GONE tile", () => {
    const s0 = dashScene();
    goneTiles(s0, [1]);
    let s = s0;
    for (let i = 0; i < DASH_TICKS + 4; i++) {
      s = step(s, { m: press({ dirX: 1 }) }).state;
      expect(s.players[0]!.fallingMs).toBe(-1);
    }
    expect(s.players[0]!.alive).toBe(true);
  });

  it("ending over lava falls, then is eliminated by FLOOR", () => {
    const s0 = dashScene();
    goneTiles(s0, [1, 2, 3, 4]);
    const mid = run(s0, DASH_TICKS + 1, { m: press({ dirX: 1 }) });
    expect(mid.s.players[0]!.fallingMs).toBeGreaterThanOrEqual(0);
    const { s } = run(mid.s, 20, { m: press({ dirX: 1 }) });
    expect(s.players[0]!.alive).toBe(false);
    expect(s.players[0]!.eliminatedCause).toBe(EliminationCause.FLOOR);
  });

  it("hit during dash knocks back x1.5 and ends the dash", () => {
    const mk = (dashing: boolean) => {
      const a = makePlayer("a", 0, 0, { character: "monkey", vx: 16, dashDirX: 1 });
      if (dashing) { a.skillPhase = SkillPhase.ACTIVE; a.skillPhaseMs = 100; }
      const b = makePlayer("b", 0.8, 0, { slot: 1 });
      resolveCollision(a, b, 0);
      return { a, b };
    };
    // Both share the same momentum-averaged component (16/2); compare the shove impulses.
    const mean = 8;
    const ratio = (mk(true).b.vx - mean) / (mk(false).b.vx - mean);
    expect(ratio).toBeGreaterThanOrEqual(1.45);
    expect(ratio).toBeLessThanOrEqual(1.55);
    expect(mk(true).a.skillPhase).toBe(SkillPhase.NONE);
    expect(mk(true).a.hitStunMs).toBe(CONFIG.HIT_STUN_MS);
  });

  it("uses facing when no input", () => {
    const s0 = dashScene({ facing: Math.PI / 2 }); // facing +x
    const { s } = run(s0, DASH_TICKS, { m: press() });
    expect(s.players[0]!.x).toBeGreaterThan(3.8);
    expect(Math.abs(s.players[0]!.z)).toBeLessThan(0.01);
  });

  it("ignores steering input while dashing", () => {
    const { s } = run(dashScene(), 4, (i) => ({ m: press({ dirX: 1, dirZ: i > 0 ? -1 : 0 }) }));
    expect(Math.abs(s.players[0]!.z)).toBeLessThan(0.01);
  });

  it("drops to max speed when the dash ends", () => {
    const { s } = run(dashScene(), DASH_TICKS + 1, { m: press({ dirX: 1 }) });
    expect(Math.hypot(s.players[0]!.vx, s.players[0]!.vz)).toBeLessThan(7);
    expect(s.players[0]!.skillPhase).toBe(SkillPhase.NONE);
  });
});

describe("turtle shell", () => {
  const SHELL_TICKS = Math.ceil(CONFIG.SHELL_DURATION_MS / CONFIG.TICK_MS);
  const shelled = (id: string, x: number, z: number, slot = 0) => {
    const p = makePlayer(id, x, z, { character: "turtle", slot });
    p.skillPhase = SkillPhase.ACTIVE;
    p.skillPhaseMs = CONFIG.SHELL_DURATION_MS;
    p.skillCooldownMs = CONFIG.SHELL_COOLDOWN_MS;
    return p;
  };

  it("shell: immobile and knockback-immune for 1.5 s", () => {
    const s0 = arena(shelled("t", 0, 0), makePlayer("e", -0.9, 0, { slot: 1, vx: 4.5 }));
    const { s } = run(s0, 4, { t: press({ dirX: 1 }) });
    expect(s.players[0]!.x).toBe(0);
    expect(s.players[0]!.z).toBe(0);
    expect(s.players[0]!.vx).toBe(0);
    expect(s.players[1]!.vx).toBeLessThan(-3);
  });

  it("shell: immune to slam", () => {
    const s0 = arena(makePlayer("e", 0, 0), shelled("t", 1.2, 0, 1));
    const { s, events } = run(s0, WINDUP_TICKS + 1, { e: press() });
    expect(count(events, "slamImpact")).toBe(1);
    expect(s.players[1]!.vx).toBe(0);
  });

  it("shell vs shell: no impulse, just separation", () => {
    const s0 = arena(shelled("a", 0, 0), shelled("b", 0.8, 0, 1));
    const { s } = run(s0, 1, {});
    expect(s.players[0]!.vx).toBe(0);
    expect(s.players[1]!.vx).toBe(0);
    const d = s.players[1]!.x - s.players[0]!.x;
    expect(d).toBeGreaterThanOrEqual(CONFIG.PLAYER_RADIUS * 2 - 1e-6);
  });

  it("shell: still falls when its tile sinks", () => {
    const s0 = arena(shelled("t", 0, 0), makePlayer("far", -3, 0, { slot: 1 }));
    for (const t of s0.tiles) if (t.q === 0 && t.r === 0) t.state = TileState.GONE;
    const { s } = run(s0, 2, {});
    expect(s.players[0]!.fallingMs).toBeGreaterThanOrEqual(0);
    expect(s.players[0]!.skillPhase).toBe(SkillPhase.NONE);
  });

  it("shell: activates, ends after 1.5 s and the turtle can move again", () => {
    const s0 = arena(makePlayer("t", 0, 0, { character: "turtle" }), makePlayer("far", -3, 0, { slot: 1 }));
    const a = run(s0, 3, { t: press({ dirX: 1 }) });
    expect(a.s.players[0]!.x).toBe(0);
    expect(a.s.players[0]!.skillPhase).toBe(SkillPhase.ACTIVE);
    expect(a.events.some((e) => e.type === "skillUsed")).toBe(true);
    const b = run(a.s, SHELL_TICKS + 1, { t: { seq: 1, dirX: 1, dirZ: 0, skill: false } });
    expect(b.s.players[0]!.skillPhase).toBe(SkillPhase.NONE);
    const c = run(b.s, 5, { t: { seq: 1, dirX: 1, dirZ: 0, skill: false } });
    expect(c.s.players[0]!.x).toBeGreaterThan(0.05);
  });
});
