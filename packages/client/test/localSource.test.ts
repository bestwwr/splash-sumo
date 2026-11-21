import { describe, expect, it } from "vitest";
import { BotController, CONFIG, createMatch, pickBotSetup, step, type MatchState, type PlayerInput } from "@splash-sumo/shared";
import { LocalSource } from "../src/game/localSource";
import type { Profile } from "../src/meta/profile";

const profile = { nickname: "Tester", equippedFighter: "elephant", difficulty: "medium" } as unknown as Profile;
const ZERO = { dirX: 0, dirZ: 0, skill: false };

function reference(seed: number) {
  const botSetups = pickBotSetup(seed, 3);
  let state: MatchState = createMatch(seed, [
    { id: "you", nickname: profile.nickname, character: profile.equippedFighter, isBot: false },
    ...botSetups.map((b, i) => ({ id: `bot${i + 1}`, nickname: b.nickname, character: b.character, isBot: true })),
  ]);
  const bots = botSetups.map((_, i) => new BotController(`bot${i + 1}`, profile.difficulty, (seed ^ (i + 1)) >>> 0));
  return {
    get state() { return state; },
    tick() {
      const seq = state.tick + 1;
      const inputs: Record<string, PlayerInput> = { you: { seq, dirX: 0, dirZ: 0, skill: false } };
      for (const b of bots) inputs[b.playerId] = b.input(state, seq);
      const r = step(state, inputs);
      state = r.state;
      return r;
    },
  };
}

describe("LocalSource", () => {
  it("uneven frames: tick count follows accumulator + catch-up cap, and equals a direct step replay", () => {
    const seed = 7;
    const src = new LocalSource(profile, seed);
    src.advance(CONFIG.SOLO_COUNTDOWN_MS + 1, ZERO); // finish the countdown (sim frozen during it)
    expect(src.frame().cur.tick).toBe(0);

    let acc = 0;
    let expected = 0;
    for (let f = 0; f < 200; f++) {
      const dt = f % 10 === 9 ? 120 : 16.7;
      src.advance(dt, ZERO);
      acc += dt;
      let steps = 0;
      while (acc >= CONFIG.TICK_MS && steps < CONFIG.MAX_CATCHUP_STEPS) {
        acc -= CONFIG.TICK_MS;
        steps++;
        expected++;
      }
      if (steps === CONFIG.MAX_CATCHUP_STEPS) acc = 0;
      expect(src.frame().cur.tick).toBe(expected);
    }
    // 120 ms frames hit the cap (3 < 3.6 ticks), so some time was dropped
    expect(expected).toBeGreaterThan(100);

    const ref = reference(seed);
    for (let k = 0; k < expected; k++) ref.tick();
    const cur = src.frame().cur;
    cur.players.forEach((p, i) => {
      expect(p.x).toBe(ref.state.players[i]!.x);
      expect(p.z).toBe(ref.state.players[i]!.z);
    });
  });

  it("pairs each event with the post-tick state it occurred in", () => {
    const seed = 7;
    const src = new LocalSource(profile, seed);
    src.advance(CONFIG.SOLO_COUNTDOWN_MS + 1, ZERO);
    const ref = reference(seed);
    let checked = 0;
    for (let f = 0; f < 3000 && checked < 3; f++) {
      const batches = src.advance(CONFIG.TICK_MS * 3 + 0.01, ZERO); // 3 ticks per frame
      const before = ref.state.tick;
      const refTicks: Array<{ tick: number; n: number }> = [];
      for (let k = 0; k < 3; k++) {
        const r = ref.tick();
        if (r.events.length > 0) refTicks.push({ tick: ref.state.tick, n: r.events.length });
      }
      expect(ref.state.tick).toBe(before + 3);
      expect(batches.map((b) => ({ tick: b.state.tick, n: b.events.length }))).toEqual(refTicks);
      if (batches.length > 0 && batches.some((b) => b.state.tick !== src.frame().cur.tick)) checked++;
    }
    expect(checked).toBeGreaterThan(0); // saw at least one event batch from a non-final tick
  });

  it("counts down 3-2-1-GO then clears", () => {
    const src = new LocalSource(profile, 1);
    src.advance(16, ZERO);
    expect(src.countdown()).toBe(3);
    src.advance(1000, ZERO);
    expect(src.countdown()).toBe(2);
    src.advance(2000, ZERO);
    expect(src.countdown()).toBe("GO!");
    src.advance(700, ZERO);
    expect(src.countdown()).toBeNull();
  });
});
