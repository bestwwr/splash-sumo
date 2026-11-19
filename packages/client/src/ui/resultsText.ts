import { EliminationCause, type BotDifficulty } from "@lava-sumo/shared";

const CAUSE_LABEL: Record<EliminationCause, string> = {
  [EliminationCause.NONE]: "Survived",
  [EliminationCause.SHOVE]: "Shoved",
  [EliminationCause.FLOOR]: "Floor melted",
  [EliminationCause.ERUPTION]: "Eruption",
  [EliminationCause.LAVA_ROCK]: "Lava rock",
};

const DIFFICULTY_LABEL: Record<BotDifficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

/** Plain-text cause line (callers escape it). `byName` is "you" or a nickname. */
export function causeText(cause: EliminationCause, byName: string | null): string {
  if (byName) {
    if (cause === EliminationCause.SHOVE) return `Shoved by ${byName}`;
    if (cause === EliminationCause.LAVA_ROCK) return `Lava rock by ${byName}`;
  }
  return CAUSE_LABEL[cause];
}

export function resultsSubtitle(difficulty: BotDifficulty, durationMs: number): string {
  return `vs ${DIFFICULTY_LABEL[difficulty]} bots · ${(durationMs / 1000).toFixed(1)} s`;
}
