import type { MatchState, SimEvent } from "@lava-sumo/shared";
import type { InputState } from "../input/input";

/** Feeds runMatchView: a local sim or a network-interpolated one. Sources own all timing. */
export interface MatchSource {
  readonly localId: string;
  /** Advance by real frame time; returns events that became visible this frame. */
  advance(frameMs: number, input: InputState): SimEvent[];
  /** States to render between; alpha in [0,1]. */
  frame(): { prev: MatchState; cur: MatchState; alpha: number; renderTimeMs: number };
  /** What the HUD should show. */
  countdown(): number | "GO!" | null;
  dispose(): void;
}
