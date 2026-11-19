import { describe, expect, it } from "vitest";
import { BotController } from "../src/bots/bot";
import { BOT_NAMES, pickBotSetup } from "../src/bots/names";
import { scoreDirection } from "../src/bots/scoring";
import { CHARACTER_IDS } from "../src/characters";
import { CONFIG } from "../src/config";
import { hexToWorld, worldToHex } from "../src/hex";
import { createMatch, step, type PlayerSetup } from "../src/simulation";
import { isSupportive } from "../src/collapse";
import { SkillPhase, TileState, type BotDifficulty, type Inputs, type MatchState, type PlayerInput, type SimEvent } from "../src/types";

declare const performance: { now(): number };
declare const console: { log(...args: unknown[]): void };

const DIFFS: BotDifficulty[] = ["easy", "medium", "hard"];

function botMatch(seed: number, diffs: BotDifficulty[]): { state: MatchState; bots: BotController[] } {
  const setups: PlayerSetup[] = pickBotSetup(seed, diffs.length).map((b, i) => ({ id: `b${i}`, nickname: b.nickname, character: b.character, isBot: true }));
  const state = createMatch(seed, setups);
  const bots = diffs.map((d, i) => new BotController(`b${i}`, d, seed * 7919 + i));
  return { state, bots };
}

function botInputs(state: MatchState, bots: BotController[], seq: number): Inputs {
  const inputs: Inputs = {};
  for (const b of bots) inputs[b.playerId] = b.input(state, seq);
  return inputs;
}

/** One bot ("me") plus one far-away idle elephant, on a fresh arena. */
function duel(meCharacter: PlayerSetup["character"] = "elephant"): MatchState {
  return createMatch(5, [
    { id: "me", nickname: "me", character: meCharacter, isBot: true },
    { id: "el", nickname: "el", character: "elephant", isBot: false },
  ]);
}

function place(state: MatchState, id: string, x: number, z: number): void {
  const p = state.players.find((q) => q.id === id)!;
  p.x = x;
  p.z = z;
  p.vx = 0;
  p.vz = 0;
}

const tileAt = (state: MatchState, x: number, z: number) => {
  const h = worldToHex(x, z);
  return state.tiles.find((t) => t.q === h.q && t.r === h.r);
};

describe("bot setup", () => {
  it("has at least 12 distinct names", () => {
    expect(BOT_NAMES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(BOT_NAMES).size).toBe(BOT_NAMES.length);
  });

  it("pickBotSetup gives distinct names, valid fighters, and is seeded", () => {
    const a = pickBotSetup(42, 3);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((b) => b.nickname)).size).toBe(3);
    for (const b of a) {
      expect(BOT_NAMES).toContain(b.nickname);
      expect(CHARACTER_IDS).toContain(b.character);
    }
    expect(pickBotSetup(42, 3)).toEqual(a);
    const many = Array.from({ length: 20 }, (_, i) => pickBotSetup(i, 3).map((b) => b.nickname).join());
    expect(new Set(many).size).toBeGreaterThan(1);
  });
});

describe("scoreDirection", () => {
  it("prefers solid floor over a warning tile over a gone tile", () => {
    const s = duel();
    place(s, "el", -4, 0);
    const me = s.players[0]!;
    place(s, "me", 0, 0);
    // Tile one step +x warns, one step -x is gone; +z stays solid.
    const right = tileAt(s, 1.2, 0)!;
    right.state = TileState.WARNING;
    right.changedAtMs = 0;
    const left = tileAt(s, -1.2, 0)!;
    left.state = TileState.GONE;
    const w = CONFIG.BOT_WEIGHTS.hard;
    const up = scoreDirection(s, me, 0.5, Math.sqrt(3) / 2, w);
    const toWarn = scoreDirection(s, me, 1, 0, w);
    const toGone = scoreDirection(s, me, -1, 0, w);
    expect(up).toBeGreaterThan(toWarn);
    expect(toWarn).toBeGreaterThan(toGone);
  });

  it("prefers moving away from the edge", () => {
    const s = duel();
    place(s, "el", -4, 3);
    const me = s.players[0]!;
    place(s, "me", 4.6, 0); // ring 4, near the +x edge
    const w = CONFIG.BOT_WEIGHTS.medium;
    expect(scoreDirection(s, me, -1, 0, w)).toBeGreaterThan(scoreDirection(s, me, 1, 0, w));
  });
});

describe("BotController", () => {
  it("bot input is deterministic for the same seed and state", () => {
    for (const d of DIFFS) {
      const { state: s0, bots } = botMatch(11, [d, "medium", "easy", "hard"]);
      const twin = new BotController("b0", d, 11 * 7919);
      let s = s0;
      for (let i = 1; i <= 600; i++) {
        const inputs = botInputs(s, bots, i);
        const mine = twin.input(s, i);
        expect(mine).toEqual(inputs.b0);
        s = step(s, inputs).state;
      }
    }
  });

  it("bot input magnitude ≤ 1 and never NaN over a 120 s bot match", () => {
    for (const seed of [1, 2, 3]) {
      let { state: s, bots } = botMatch(seed, ["easy", "medium", "hard", "hard"]);
      const ticks = 120 * CONFIG.TICK_HZ;
      for (let i = 1; i <= ticks; i++) {
        const inputs = botInputs(s, bots, i);
        for (const inp of Object.values(inputs)) {
          expect(inp).toBeDefined();
          const { dirX, dirZ } = inp!;
          expect(Number.isFinite(dirX) && Number.isFinite(dirZ)).toBe(true);
          expect(Math.hypot(dirX, dirZ)).toBeLessThanOrEqual(1 + 1e-9);
          expect(inp!.seq).toBe(i);
        }
        s = step(s, inputs).state;
        if (s.result) break;
      }
    }
  });

  it("skill presses are rising edges (never held two ticks in a row)", () => {
    let { state: s, bots } = botMatch(9, ["hard", "hard", "medium", "medium"]);
    const prev: Record<string, boolean> = {};
    let presses = 0;
    for (let i = 1; i <= 90 * CONFIG.TICK_HZ && !s.result; i++) {
      const inputs = botInputs(s, bots, i);
      for (const [id, inp] of Object.entries(inputs)) {
        if (inp!.skill) {
          presses++;
          expect(prev[id]).not.toBe(true);
        }
        prev[id] = inp!.skill;
      }
      s = step(s, inputs).state;
    }
    expect(presses).toBeGreaterThan(0);
  });

  it("medium/hard bots step off a WARNING tile before it sinks", () => {
    for (const d of ["medium", "hard"] as const) {
      for (const seed of [1, 2, 3, 4, 5]) {
        let s = createMatch(seed, [{ id: "me", nickname: "me", character: "turtle", isBot: true }]);
        const c = hexToWorld({ q: 1, r: 0 });
        place(s, "me", c.x, c.z);
        const t = tileAt(s, c.x, c.z)!;
        t.state = TileState.WARNING;
        t.changedAtMs = 0;
        const bot = new BotController("me", d, seed);
        for (let i = 1; i <= CONFIG.TICK_HZ; i++) s = step(s, { me: bot.input(s, i) }).state;
        const me = s.players[0]!;
        const under = tileAt(s, me.x, me.z);
        expect(me.fallingMs, `${d} seed ${seed}`).toBe(-1);
        expect(under && under.state === TileState.SOLID, `${d} seed ${seed}`).toBe(true);
      }
    }
  });

  it("hard bot steps out of an elephant wind-up ring", () => {
    // The dummy elephant's wind-up is held long (1 s) so the test measures the bot's dodge, not the
    // physics limit: with a 120 ms reaction no fighter can cover 1 m in a 400 ms wind-up.
    const windupMs = 1000;
    const run = (d: BotDifficulty, seed: number) => {
      let s = duel("monkey");
      place(s, "me", 0, 0);
      place(s, "el", 1.0, 0);
      const el = s.players[1]!;
      el.skillPhase = SkillPhase.WINDUP;
      el.skillPhaseMs = windupMs;
      el.skillCooldownMs = CONFIG.SLAM_COOLDOWN_MS;
      const bot = new BotController("me", d, seed);
      const events: SimEvent[] = [];
      let distBeforeImpact = 0;
      for (let i = 1; i <= 60; i++) {
        const elNow = s.players[1]!;
        if (elNow.skillPhase === SkillPhase.WINDUP) {
          const me = s.players[0]!;
          distBeforeImpact = Math.hypot(me.x - elNow.x, me.z - elNow.z);
        }
        const r = step(s, { me: bot.input(s, i) });
        s = r.state;
        events.push(...r.events);
      }
      const slam = events.find((e) => e.type === "slamImpact");
      return { distBeforeImpact, hit: slam?.type === "slamImpact" && slam.hitIds.includes("me") };
    };
    for (const seed of [1, 2, 3, 4, 5]) {
      const hard = run("hard", seed);
      expect(hard.distBeforeImpact, `seed ${seed}`).toBeGreaterThan(CONFIG.SLAM_RADIUS);
      expect(hard.hit, `seed ${seed}`).toBe(false);
    }
    // Easy is not required to dodge; it only must not crash.
    expect(() => run("easy", 1)).not.toThrow();
  });

  it("hard bot dodges a real 400 ms wind-up from 1.8 m (its reliable dodge range)", () => {
    // Real CONFIG.SLAM_WINDUP_MS. The bot has been running (settled), so the wind-up starts at a
    // random point in its think cycle. Its own skill is on cooldown so it must dodge on foot.
    // 1.8 m is where Hard escapes on every seed for all fighters; see DECISIONS.md D-SQP-1.
    const DIST = 1.8;
    for (const character of CHARACTER_IDS) {
      for (let seed = 1; seed <= 10; seed++) {
        let s = duel(character);
        const reset = (st: MatchState) => {
          place(st, "me", 0, 0);
          place(st, "el", DIST, 0);
          st.players[0]!.skillCooldownMs = 60_000;
          st.players[1]!.skillCooldownMs = CONFIG.SLAM_COOLDOWN_MS;
        };
        const bot = new BotController("me", "hard", seed);
        let seq = 0;
        for (let i = 0; i < CONFIG.TICK_HZ + (seed % 3); i++) {
          reset(s);
          s = step(s, { me: bot.input(s, ++seq) }).state;
        }
        reset(s);
        s.players[1]!.skillPhase = SkillPhase.WINDUP;
        s.players[1]!.skillPhaseMs = CONFIG.SLAM_WINDUP_MS;
        let slam: SimEvent | undefined;
        let distAtImpact = 0;
        for (let i = 0; i < 20 && !slam; i++) {
          const before = s.players[0]!;
          distAtImpact = Math.hypot(before.x - s.players[1]!.x, before.z - s.players[1]!.z);
          const r = step(s, { me: bot.input(s, ++seq) });
          s = r.state;
          slam = r.events.find((e) => e.type === "slamImpact");
        }
        expect(slam, `${character} seed ${seed}`).toBeDefined();
        expect(slam?.type === "slamImpact" && slam.hitIds.includes("me"), `${character} seed ${seed}`).toBe(false);
        expect(distAtImpact, `${character} seed ${seed}`).toBeGreaterThan(CONFIG.SLAM_RADIUS);
      }
    }
  });

  it("reaction delay: a hard bot reacts to a new threat ≥ 120 ms and < 300 ms after it appears", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      let s = duel("monkey");
      place(s, "me", 0, 0);
      place(s, "el", 0, -3.5);
      const bot = new BotController("me", "hard", seed);
      // Settle for 1 s with no threat.
      let seq = 0;
      let last: PlayerInput = { seq: 0, dirX: 0, dirZ: 0, skill: false };
      for (let i = 0; i < CONFIG.TICK_HZ; i++) {
        last = bot.input(s, ++seq);
        s = step(s, { me: last }).state;
        place(s, "me", 0, 0);
        place(s, "el", 0, -3.5);
      }
      // The threat appears: an elephant winding up 1 m away, on the side the bot is heading to.
      const len = Math.hypot(last.dirX, last.dirZ);
      const hx = len > 0.3 ? last.dirX / len : 1;
      const hz = len > 0.3 ? last.dirZ / len : 0;
      const appearMs = s.timeMs;
      place(s, "el", hx, hz);
      const el = s.players[1]!;
      el.skillPhase = SkillPhase.WINDUP;
      el.skillPhaseMs = 1000;
      let reactedMs = -1;
      for (let i = 0; i < 20 && reactedMs < 0; i++) {
        const inp: PlayerInput = bot.input(s, ++seq);
        // Reacting = the steering changes from what it was doing before the threat.
        if (Math.hypot(inp.dirX - last.dirX, inp.dirZ - last.dirZ) > 0.5) reactedMs = s.timeMs - appearMs;
        s = step(s, { me: inp }).state;
        place(s, "me", 0, 0);
        place(s, "el", hx, hz);
      }
      expect(reactedMs, `seed ${seed}`).toBeGreaterThanOrEqual(CONFIG.BOT_REACTION_MS.hard);
      expect(reactedMs, `seed ${seed}`).toBeLessThan(300);
    }
  });

  it("dead bot (spirit) throws rocks with press then release", () => {
    let { state: s, bots } = botMatch(3, ["hard", "easy", "easy", "easy"]);
    const me = s.players[0]!;
    me.alive = false;
    me.spiritAngle = 0;
    me.eliminatedAtMs = 0;
    let thrown = 0;
    for (let i = 1; i <= 10 * CONFIG.TICK_HZ && !s.result; i++) {
      const inputs = botInputs(s, bots, i);
      const r = step(s, inputs);
      thrown += r.events.filter((e) => e.type === "lavaRockThrown" && e.fromId === "b0").length;
      s = r.state;
    }
    expect(thrown).toBeGreaterThanOrEqual(1);
  });

  it("bot inputs stay finite on a nearly empty arena", () => {
    let { state: s, bots } = botMatch(4, ["hard", "medium"]);
    for (const t of s.tiles) if (t.ring >= 2) t.state = TileState.GONE;
    for (let i = 1; i <= 60; i++) {
      const inputs = botInputs(s, bots, i);
      for (const inp of Object.values(inputs)) expect(Number.isFinite(inp!.dirX + inp!.dirZ)).toBe(true);
      s = step(s, inputs).state;
    }
    expect(s.tiles.some((t) => isSupportive(t.state))).toBe(true);
  });

  it("bot think time: average BotController.input() < 1 ms over 90 s of match time", () => {
    // Matches between bots can end early; chain seeded matches until 90 s of play is covered.
    let calls = 0;
    let total = 0;
    let simMs = 0;
    for (let seed = 21; simMs < 90_000; seed++) {
      let { state: s, bots } = botMatch(seed, ["hard", "medium", "easy", "hard"]);
      for (let i = 1; !s.result && simMs < 90_000; i++) {
        const inputs: Inputs = {};
        for (const b of bots) {
          const t0 = performance.now();
          inputs[b.playerId] = b.input(s, i);
          total += performance.now() - t0;
          calls++;
        }
        s = step(s, inputs).state;
        simMs += CONFIG.TICK_MS;
      }
    }
    expect(calls).toBeGreaterThan(0);
    expect(total / calls).toBeLessThan(1);
    console.log(`bot input avg ${(total / calls * 1000).toFixed(1)} us over ${calls} calls`);
  });
});
