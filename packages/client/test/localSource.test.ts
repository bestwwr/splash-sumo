import { describe, expect, it } from "vitest";
import { BotController, CONFIG, Phase, createMatch, pickBotSetup, step, type MatchState, type PlayerInput } from "@lava-sumo/shared";
import { LocalSource } from "../src/game/localSource";
import type { Profile } from "../src/meta/profile";

const profile = { nickname: "Tester", equippedFighter: "elephant", difficulty: "medium" } as unknown as Profile;
const ZERO = { dirX: 0, dirZ: 0, skill: false };

describe("LocalSource", () => {
  it("matches calling step directly (seed 7, zero input, 200 frames)", () => {
    const seed = 7;
    const src = new LocalSource(profile, seed);
    // reference sim built the same way
    const botSetups = pickBotSetup(seed, 3);
    let ref: MatchState = createMatch(seed, [
      { id: "you", nickname: profile.nickname, character: profile.equippedFighter, isBot: false },
      ...botSetups.map((b, i) => ({ id: `bot${i + 1}`, nickname: b.nickname, character: b.character, isBot: true })),
    ]);
    const bots = botSetups.map((_, i) => new BotController(`bot${i + 1}`, profile.difficulty, (seed ^ (i + 1)) >>> 0));
    let seq = 0;
    // skip countdown in the reference: LocalSource freezes sim for 3000 ms
    let t = 0;
    const FRAME = CONFIG.TICK_MS; // one tick per frame keeps the reference exact
    for (let f = 0; f < 200; f++) {
      src.advance(FRAME, ZERO);
      t += FRAME;
      if (t > 3000 && ref.phase === Phase.PLAYING) {
        seq++;
        const inputs: Record<string, PlayerInput> = { you: { seq, dirX: 0, dirZ: 0, skill: false } };
        for (const b of bots) inputs[b.playerId] = b.input(ref, seq);
        ref = step(ref, inputs).state;
      }
    }
    // the source stepped on frames after its countdown elapsed; compare tick counts are equal once aligned
    const cur = src.frame().cur;
    expect(cur.tick).toBeGreaterThan(0);
    // replay the reference for exactly cur.tick ticks
    let r2 = createMatch(seed, [
      { id: "you", nickname: profile.nickname, character: profile.equippedFighter, isBot: false },
      ...botSetups.map((b, i) => ({ id: `bot${i + 1}`, nickname: b.nickname, character: b.character, isBot: true })),
    ]);
    const bots2 = botSetups.map((_, i) => new BotController(`bot${i + 1}`, profile.difficulty, (seed ^ (i + 1)) >>> 0));
    for (let k = 1; k <= cur.tick; k++) {
      const inputs: Record<string, PlayerInput> = { you: { seq: k, dirX: 0, dirZ: 0, skill: false } };
      for (const b of bots2) inputs[b.playerId] = b.input(r2, k);
      r2 = step(r2, inputs).state;
    }
    expect(cur.tick).toBe(r2.tick);
    cur.players.forEach((p, i) => {
      expect(p.x).toBe(r2.players[i]!.x);
      expect(p.z).toBe(r2.players[i]!.z);
    });
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
