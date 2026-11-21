/** Sends player input to the server: change-only, 2dp quantized, rate-limited, with keep-alive. */
import { CONFIG, type ClientMsg } from "@splash-sumo/shared";
import type { InputState } from "../input/input";
import type { SentInput } from "./prediction";

const MIN_INTERVAL_MS = 1000 / CONFIG.NET_INPUT_MAX_PER_SEC;
const q2 = (n: number) => Math.round(n * 100) / 100;
const HISTORY_MS = 3000;

export class InputSender {
  private seq = 0;
  private observed: InputState | null = { dirX: 0, dirZ: 0, skill: false };
  private queue: InputState[] = [];
  private lastSendAt = -Infinity;
  private lastKeepAliveAt: number;
  /** Inputs sent in the last few seconds, oldest first (for local prediction). */
  readonly history: SentInput[] = [];

  constructor(
    private readonly send: (m: ClientMsg) => void,
    private readonly nowMs: () => number,
  ) {
    this.lastKeepAliveAt = nowMs();
  }

  /** Call every frame with the current input. `keepAlive` is false outside COUNTDOWN/PLAYING. */
  update(input: InputState, keepAlive = true): void {
    const now = this.nowMs();
    const cur: InputState = { dirX: q2(input.dirX), dirZ: q2(input.dirZ), skill: input.skill };
    const o = this.observed;
    if (!o || o.dirX !== cur.dirX || o.dirZ !== cur.dirZ || o.skill !== cur.skill) {
      // Coalesce moves with the same skill state; skill edges are never dropped.
      const last = this.queue[this.queue.length - 1];
      const skillOfLast = last ? last.skill : o?.skill;
      if (last && skillOfLast === cur.skill) this.queue[this.queue.length - 1] = cur;
      else if (this.queue.length >= CONFIG.NET_INPUT_MAX_QUEUE) this.queue[this.queue.length - 1] = cur;
      else this.queue.push(cur);
      this.observed = cur;
    }
    if (this.queue.length > 0) {
      if (now - this.lastSendAt >= MIN_INTERVAL_MS) this.emit(this.queue.shift()!, now);
    } else if (keepAlive && this.observed && now - this.lastKeepAliveAt >= CONFIG.NET_INPUT_KEEPALIVE_MS) {
      this.emit(this.observed, now);
    }
  }

  /** Send a neutral (zero) input right now (e.g. tab hidden), keeping seq monotonic and dropping queued moves. */
  sendNeutral(): void {
    const zero: InputState = { dirX: 0, dirZ: 0, skill: false };
    this.queue = [];
    this.observed = zero;
    this.emit(zero, this.nowMs());
  }

  /** Call on reconnect: the server resets its processed seq to 0. */
  reset(): void {
    this.seq = 0;
    this.observed = null;
    this.queue = [];
    this.history.length = 0;
  }

  private emit(i: InputState, now: number): void {
    this.seq++;
    this.lastSendAt = now;
    this.lastKeepAliveAt = now;
    this.history.push({ at: now, seq: this.seq, dirX: i.dirX, dirZ: i.dirZ });
    // Keep at least one entry: it is the input the server is still holding.
    while (this.history.length > 1 && this.history[1]!.at < now - HISTORY_MS) this.history.shift();
    this.send({ t: "in", seq: this.seq, dirX: i.dirX, dirZ: i.dirZ, skill: i.skill });
  }
}
