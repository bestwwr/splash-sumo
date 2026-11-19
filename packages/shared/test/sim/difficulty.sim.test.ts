/**
 * Difficulty balance: 200 seeded 4-player matches per pairing, 2 stronger bots vs 2 weaker bots
 * (random fighters). The stronger side must take ≥ 70% of the decided matches.
 */
import { describe, expect, it } from "vitest";
import { BotController } from "../../src/bots/bot";
import { pickBotSetup } from "../../src/bots/names";
import { createMatch, step } from "../../src/simulation";
import type { BotDifficulty, Inputs } from "../../src/types";

declare const console: { log(...args: unknown[]): void };

const MATCHES = 200;
const MAX_MS = 240_000;

type Outcome = "strong" | "weak" | "draw";

function playMatch(seed: number, strong: BotDifficulty, weak: BotDifficulty): Outcome {
  const setup = pickBotSetup(seed, 4);
  // Alternate sides by slot, and swap which side starts at slot 0 every other seed.
  const sideOf = (i: number): "strong" | "weak" => ((i + seed) % 2 === 0 ? "strong" : "weak");
  const diffOf = (i: number) => (sideOf(i) === "strong" ? strong : weak);
  let s = createMatch(
    seed,
    setup.map((b, i) => ({ id: `p${i}`, nickname: b.nickname, character: b.character, isBot: true })),
  );
  const bots = setup.map((_, i) => new BotController(`p${i}`, diffOf(i), seed * 1013 + i * 17 + 1));
  for (let seq = 1; !s.result && s.timeMs < MAX_MS; seq++) {
    const inputs: Inputs = {};
    for (const b of bots) inputs[b.playerId] = b.input(s, seq);
    s = step(s, inputs).state;
  }
  const winner = s.result?.winnerId;
  if (!winner) return "draw";
  return sideOf(Number(winner.slice(1)));
}

const PAIRINGS: [BotDifficulty, BotDifficulty][] = [
  ["hard", "easy"],
  ["hard", "medium"],
  ["medium", "easy"],
];

describe("bot difficulty balance", () => {
  const rows: string[] = [];
  for (const [strong, weak] of PAIRINGS) {
    it(`2 ${strong} vs 2 ${weak}: ${strong} side wins ≥ 70%`, () => {
      const tally = { strong: 0, weak: 0, draw: 0 };
      for (let seed = 1; seed <= MATCHES; seed++) tally[playMatch(seed, strong, weak)]++;
      const decided = tally.strong + tally.weak;
      const share = decided > 0 ? tally.strong / decided : 0;
      rows.push(
        `| 2 ${strong} vs 2 ${weak} | ${tally.strong} | ${tally.weak} | ${tally.draw} | ${(share * 100).toFixed(1)}% |`,
      );
      console.log(
        ["| Pairing | Strong wins | Weak wins | Draws | Strong share |", "|---|---|---|---|---|", ...rows].join("\n"),
      );
      expect(share).toBeGreaterThanOrEqual(0.7);
    });
  }
});
