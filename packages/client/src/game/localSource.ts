/** Solo match source: fixed 30 Hz shared `step` + 3 bots; countdown freezes the sim. */
import {
  BotController,
  CONFIG,
  Phase,
  createMatch,
  pickBotSetup,
  step,
  type MatchState,
  type PlayerInput,
  type SimEvent,
} from "@lava-sumo/shared";
import type { InputState } from "../input/input";
import type { Profile } from "../meta/profile";
import type { MatchSource } from "./matchSource";

/** Dev tool: `?fx` spawns one bot of each fighter so every skill can be seen. */
const FX_MODE = import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).has("fx");
const FX_CHARACTERS = ["elephant", "monkey", "turtle"] as const;

export const LOCAL_ID = "you";
const COUNTDOWN_MS = 3000; // pre-match 3-2-1 (A.1)
const GO_MS = 600;

export class LocalSource implements MatchSource {
  readonly localId = LOCAL_ID;
  private state: MatchState;
  private prev: MatchState;
  private readonly bots: BotController[];
  private countdownLeft = COUNTDOWN_MS;
  private sinceGo = 0;
  private acc = 0;
  private seq = 0;

  constructor(profile: Profile, seed: number) {
    const botSetups = pickBotSetup(seed, 3);
    const botIds = botSetups.map((_, i) => `bot${i + 1}`);
    this.state = createMatch(seed, [
      { id: LOCAL_ID, nickname: profile.nickname, character: profile.equippedFighter, isBot: false },
      ...botSetups.map((b, i) => ({
        id: botIds[i]!,
        nickname: b.nickname,
        character: FX_MODE ? FX_CHARACTERS[i]! : b.character,
        isBot: true,
      })),
    ]);
    this.prev = this.state;
    this.bots = botIds.map((id, i) => new BotController(id, profile.difficulty, (seed ^ (i + 1)) >>> 0));
  }

  advance(frameMs: number, local: InputState): SimEvent[] {
    const out: SimEvent[] = [];
    if (this.countdownLeft > 0) {
      this.countdownLeft -= frameMs;
      if (this.countdownLeft <= 0) this.sinceGo = 0;
      return out;
    }
    this.sinceGo += frameMs;
    if (this.state.phase !== Phase.PLAYING) return out;
    this.acc += frameMs;
    let steps = 0;
    while (this.acc >= CONFIG.TICK_MS && steps < CONFIG.MAX_CATCHUP_STEPS) {
      this.seq++;
      const inputs: Record<string, PlayerInput> = {
        [LOCAL_ID]: { seq: this.seq, dirX: local.dirX, dirZ: local.dirZ, skill: local.skill },
      };
      for (const b of this.bots) inputs[b.playerId] = b.input(this.state, this.seq);
      this.prev = this.state;
      const r = step(this.state, inputs);
      this.state = r.state;
      out.push(...r.events);
      this.acc -= CONFIG.TICK_MS;
      steps++;
    }
    if (steps === CONFIG.MAX_CATCHUP_STEPS) this.acc = 0; // avoid spiral of death (§3.7)
    return out;
  }

  frame() {
    const alpha =
      this.state.phase === Phase.PLAYING && this.countdownLeft <= 0 ? Math.min(1, this.acc / CONFIG.TICK_MS) : 1;
    const renderTimeMs = this.prev.timeMs + (this.state.timeMs - this.prev.timeMs) * alpha;
    return { prev: this.prev, cur: this.state, alpha, renderTimeMs };
  }

  countdown(): number | "GO!" | null {
    if (this.countdownLeft > 0) return Math.ceil(this.countdownLeft / 1000);
    return this.sinceGo < GO_MS ? "GO!" : null;
  }

  dispose(): void {}
}
