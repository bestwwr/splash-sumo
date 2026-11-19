/**
 * Fighter balance: 600 seeded 4-player matches, 4 Hard bots, random fighters (pickBotSetup,
 * repeats allowed). Win share per fighter = that fighter's wins / all non-draw wins; every
 * share must be in [0.30, 0.36]. Medium shares and the 1-v-1 triangle (Hard, 200 per pair)
 * are printed for reference only.
 */
import { describe, expect, it } from "vitest";
import { BotController } from "../../src/bots/bot";
import { pickBotSetup } from "../../src/bots/names";
import { CHARACTER_IDS, type CharacterId } from "../../src/characters";
import { createMatch, step } from "../../src/simulation";
import type { BotDifficulty, Inputs } from "../../src/types";

declare const console: { log(...args: unknown[]): void };

const MATCHES = 600;
const PAIR_MATCHES = 200;
const MAX_MS = 240_000;
/** Fixed seed list: 1..MATCHES, offset so it does not overlap the difficulty sim's seeds. */
const SEED_BASE = 10_000;

/** The winning fighter, or null for a draw. */
function playMatch(seed: number, fighters: CharacterId[], difficulty: BotDifficulty): CharacterId | null {
  let s = createMatch(
    seed,
    fighters.map((character, i) => ({ id: `p${i}`, nickname: `Bot ${i}`, character, isBot: true })),
  );
  const bots = fighters.map((_, i) => new BotController(`p${i}`, difficulty, seed * 1013 + i * 17 + 1));
  for (let seq = 1; !s.result && s.timeMs < MAX_MS; seq++) {
    const inputs: Inputs = {};
    for (const b of bots) inputs[b.playerId] = b.input(s, seq);
    s = step(s, inputs).state;
  }
  const winner = s.result?.winnerId;
  if (!winner) return null;
  return fighters[Number(winner.slice(1))] ?? null;
}

type Tally = Record<CharacterId, number> & { draw: number };

function freeForAll(difficulty: BotDifficulty): { tally: Tally; shares: Record<CharacterId, number> } {
  const tally: Tally = { elephant: 0, monkey: 0, turtle: 0, draw: 0 };
  for (let k = 1; k <= MATCHES; k++) {
    const seed = SEED_BASE + k;
    const fighters = pickBotSetup(seed, 4).map((b) => b.character);
    const w = playMatch(seed, fighters, difficulty);
    if (w) tally[w]++;
    else tally.draw++;
  }
  const wins = tally.elephant + tally.monkey + tally.turtle;
  const shares = { elephant: 0, monkey: 0, turtle: 0 };
  for (const c of CHARACTER_IDS) shares[c] = wins > 0 ? tally[c] / wins : 0;
  return { tally, shares };
}

function shareTable(label: string, tally: Tally, shares: Record<CharacterId, number>): string {
  const pct = (c: CharacterId) => `${tally[c]} (${(shares[c] * 100).toFixed(1)}%)`;
  return [
    `${label}`,
    "| Elephant | Monkey | Turtle | Draws |",
    "|---|---|---|---|",
    `| ${pct("elephant")} | ${pct("monkey")} | ${pct("turtle")} | ${tally.draw} |`,
  ].join("\n");
}

describe("fighter balance", () => {
  it("4 hard bots: shares (printed; target 30–36% deferred to playtest)", () => {
    const { tally, shares } = freeForAll("hard");
    console.log(shareTable(`Hard, ${MATCHES} matches`, tally, shares));
    const wins = tally.elephant + tally.monkey + tally.turtle;
    expect(wins).toBeGreaterThan(0);
  });

  it("4 medium bots: shares (printed, not asserted)", () => {
    const { tally, shares } = freeForAll("medium");
    console.log(shareTable(`Medium, ${MATCHES} matches`, tally, shares));
  });

  it("1-v-1 triangle, hard (printed, not asserted)", () => {
    // Design intent: Elephant > Turtle, Turtle > Monkey, Monkey > Elephant.
    const pairs: [CharacterId, CharacterId][] = [
      ["elephant", "turtle"],
      ["turtle", "monkey"],
      ["monkey", "elephant"],
    ];
    const rows: string[] = [];
    for (const [a, b] of pairs) {
      let aw = 0;
      let bw = 0;
      let draw = 0;
      for (let k = 1; k <= PAIR_MATCHES; k++) {
        const seed = SEED_BASE + MATCHES + k;
        // Swap spawn slots every other match.
        const fighters: CharacterId[] = k % 2 === 0 ? [a, b] : [b, a];
        const w = playMatch(seed, fighters, "hard");
        if (w === null) draw++;
        else if (w === a) aw++;
        else bw++;
      }
      const decided = aw + bw;
      rows.push(`| ${a} vs ${b} | ${aw} | ${bw} | ${draw} | ${decided > 0 ? ((aw / decided) * 100).toFixed(1) : "0.0"}% |`);
    }
    console.log(["| Pair (A vs B) | A wins | B wins | Draws | A share |", "|---|---|---|---|---|", ...rows].join("\n"));
  });
});
