import { describe, expect, it } from "vitest";
import { applyMovement, applyRadialImpulse, clampInput, resolveCollision } from "../src/physics";
import { CONFIG } from "../src/config";
import { enduranceMult, maxSpeed, powerMult } from "../src/characters";
import { makePlayer } from "./helpers";

const R2 = CONFIG.PLAYER_RADIUS * 2;

describe("input clamping", () => {
  it("clamps to length 1 and sanitizes NaN/Infinity", () => {
    const c = clampInput(3, 4);
    expect(Math.hypot(c.dirX, c.dirZ)).toBeCloseTo(1);
    expect(clampInput(NaN, Infinity)).toEqual({ dirX: 0, dirZ: 0 });
    expect(clampInput(0.3, 0)).toEqual({ dirX: 0.3, dirZ: 0 });
  });
});

describe("movement", () => {
  it("accelerates toward input × maxSpeed and never exceeds it from input alone", () => {
    const p = makePlayer("a", 0, 0, { character: "monkey" });
    for (let i = 0; i < 90; i++) applyMovement(p, { seq: i, dirX: 1, dirZ: 0, skill: false }, CONFIG.TICK_MS);
    expect(p.vx).toBeGreaterThan(maxSpeed("monkey") * 0.95);
    expect(p.vx).toBeLessThanOrEqual(maxSpeed("monkey") + 1e-9);
  });
  it("is slightly slippery: velocity persists briefly after releasing input", () => {
    const p = makePlayer("a", 0, 0, { vx: 4 });
    applyMovement(p, { seq: 1, dirX: 0, dirZ: 0, skill: false }, CONFIG.TICK_MS);
    expect(p.vx).toBeGreaterThan(0.5);
  });
  it("ignores input while hit-stunned", () => {
    const p = makePlayer("a", 0, 0, { hitStunMs: 150 });
    applyMovement(p, { seq: 1, dirX: 1, dirZ: 0, skill: false }, CONFIG.TICK_MS);
    expect(p.vx).toBe(0);
    expect(p.hitStunMs).toBeCloseTo(150 - CONFIG.TICK_MS);
  });
});

describe("collisions & shove", () => {
  it("no collision when not overlapping", () => {
    const a = makePlayer("a", 0, 0), b = makePlayer("b", R2 + 0.01, 0);
    expect(resolveCollision(a, b, 0)).toEqual([]);
  });

  it("separates overlapping players and pushes the victim away from the attacker", () => {
    const a = makePlayer("a", 0, 0, { vx: 4 }), b = makePlayer("b", R2 - 0.1, 0);
    const ev = resolveCollision(a, b, 1000);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(R2);
    expect(b.vx).toBeGreaterThan(0);
    expect(a.vx).toBeLessThan(b.vx);
    expect(ev).toEqual([expect.objectContaining({ type: "hit", attackerId: "a", victimId: "b" })]);
    expect(a.hitStunMs).toBe(CONFIG.HIT_STUN_MS);
    expect(b.hitStunMs).toBe(CONFIG.HIT_STUN_MS);
    expect(b.lastHitById).toBe("a");
  });

  it("players separate after a shove (no repeated hit next tick)", () => {
    const a = makePlayer("a", 0, 0, { vx: 5 }), b = makePlayer("b", R2 - 0.05, 0);
    resolveCollision(a, b, 0);
    expect(b.vx - a.vx).toBeGreaterThan(0); // moving apart
  });

  it("faster closing speed = bigger shove", () => {
    const slow = makePlayer("b", R2 - 0.05, 0), fast = makePlayer("b", R2 - 0.05, 0);
    resolveCollision(makePlayer("a", 0, 0, { vx: 2 }), slow, 0);
    resolveCollision(makePlayer("a", 0, 0, { vx: 6 }), fast, 0);
    expect(fast.vx).toBeGreaterThan(slow.vx);
  });

  it("MIN_SHOVE_SPEED gives a pop even from standing contact", () => {
    const a = makePlayer("a", 0, 0), b = makePlayer("b", R2 - 0.05, 0);
    resolveCollision(a, b, 0);
    expect(b.vx).toBeGreaterThan(1);
  });

  it("power and endurance scale knockback per the spec formula", () => {
    // Elephant (P5) hitting Monkey (E3) vs Monkey (P2) hitting Turtle (E5).
    const v1 = makePlayer("v", R2 - 0.05, 0, { character: "monkey" });
    resolveCollision(makePlayer("a", 0, 0, { vx: 4, character: "elephant" }), v1, 0);
    const v2 = makePlayer("v", R2 - 0.05, 0, { character: "turtle" });
    resolveCollision(makePlayer("a", 0, 0, { vx: 4, character: "monkey" }), v2, 0);
    expect(v1.vx).toBeGreaterThan(v2.vx);
    // Exact impulse check: mean (2) + BASE × 1.6 × 4 / 1.2
    expect(v1.vx).toBeCloseTo(2 + (CONFIG.BASE_KNOCK * 1.6 * 4) / 1.2, 6);
  });
});

describe("shove feel (tuning guard)", () => {
  /** How far a victim travels after one hit, optionally pushing back against it. */
  function pushDistance(attackerSpeed: number, resist: number): number {
    const a = makePlayer("a", 0, 0, { vx: attackerSpeed });
    const b = makePlayer("b", R2 - 0.05, 0);
    resolveCollision(a, b, 0);
    const x0 = b.x;
    let maxX = b.x;
    for (let i = 0; i < 90; i++) {
      applyMovement(b, { seq: i, dirX: -resist, dirZ: 0, skill: false }, CONFIG.TICK_MS);
      maxX = Math.max(maxX, b.x);
    }
    return maxX - x0;
  }

  it("a full-speed Elephant charge pushes a passive Elephant ~1.5 tiles", () => {
    const d = pushDistance(maxSpeed("elephant"), 0);
    expect(d).toBeGreaterThan(CONFIG.TILE_WIDTH * 1.2);
    expect(d).toBeLessThan(CONFIG.TILE_WIDTH * 2);
  });

  it("bracing against a shove reduces the push", () => {
    expect(pushDistance(maxSpeed("elephant"), 1)).toBeLessThan(pushDistance(maxSpeed("elephant"), 0) * 0.8);
  });

  it("a standing bump is a nudge, not a launch", () => {
    expect(pushDistance(0, 0)).toBeLessThan(CONFIG.TILE_WIDTH * 0.4);
  });
});

describe("REFERENCE_SHOVE_SPEED", () => {
  it("equals a full-speed Elephant shove on a stationary Elephant", () => {
    const expected = (CONFIG.BASE_KNOCK * powerMult("elephant") * maxSpeed("elephant")) / enduranceMult("elephant");
    expect(CONFIG.REFERENCE_SHOVE_SPEED).toBeCloseTo(expected, 9);
    expect(CONFIG.ROCK_KNOCK_SPEED).toBeCloseTo(0.3 * expected, 9);
  });
});

describe("applyRadialImpulse stun", () => {
  it("never shortens an existing longer stun", () => {
    const p = makePlayer("p", 1, 0, { hitStunMs: 500 });
    applyRadialImpulse(p, 0, 0, 1, 200, "x", 0);
    expect(p.hitStunMs).toBe(500);
  });
});
