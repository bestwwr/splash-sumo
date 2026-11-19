/**
 * Online match source: buffers server snaps and renders ~NET_INTERP_DELAY_MS behind the newest,
 * interpolating between the two snaps that straddle render time. Owns countdown timing and input sending.
 */
import {
  CONFIG,
  Phase,
  applySnap,
  createMatch,
  type ClientMsg,
  type MatchState,
  type SimEvent,
  type Snap,
  type StartMsg,
} from "@lava-sumo/shared";
import type { InputState } from "../input/input";
import type { MatchSource, SourceEvents } from "../game/matchSource";
import { InputSender } from "./inputSender";

const BUF_KEEP_MS = 1000;

interface Entry {
  t: number; // server match time
  tick: number;
  state: MatchState;
}

export class NetSource implements MatchSource {
  private readonly buf: Entry[] = [];
  private pending: Array<{ t: number; events: SimEvent[]; state: MatchState }> = [];
  private readonly sender: InputSender;
  private readonly startRecvMs: number;
  private renderT = 0;
  private goAt: number | null = null;
  private latest: MatchState;

  constructor(
    private readonly start: StartMsg,
    readonly localId: string,
    send: (m: ClientMsg) => void,
    private readonly nowMs: () => number,
  ) {
    this.latest = createMatch(start.seed, start.setups);
    this.sender = new InputSender(send, nowMs);
    this.startRecvMs = nowMs();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibility);
  }

  private activePhase(): boolean {
    const p = this.latest.phase;
    return p === Phase.COUNTDOWN || p === Phase.PLAYING;
  }

  /** Hidden tabs stop rendering (and so sending): tell the server to stop steering right away. */
  private readonly onVisibility = (): void => {
    if (document.visibilityState === "hidden" && this.activePhase()) this.sender.sendNeutral();
  };

  /** Call after a reconnect (server resets its processed input seq). */
  resetInput(): void {
    this.sender.reset();
  }

  onSnap(s: Snap, _recvMs: number): void {
    const newest = this.buf[this.buf.length - 1];
    if (newest && s.tick < newest.tick) return; // out of order
    const state = applySnap(this.latest, s);
    this.latest = state;
    const t = newest ? Math.max(s.timeMs, newest.t) : s.timeMs;
    const first = this.buf.length === 0;
    this.buf.push({ t, tick: s.tick, state });
    if (s.events.length > 0) this.pending.push({ t, events: s.events, state });
    if (first) this.renderT = t - CONFIG.NET_INTERP_DELAY_MS;
    // While the tab is hidden advance() stops running: keep only ~1 s of history behind the newest snap.
    while (this.buf.length > 2 && this.buf[1]!.t < t - BUF_KEEP_MS) this.buf.shift();
    this.dropStaleEvents(t - BUF_KEEP_MS);
  }

  advance(frameMs: number, input: InputState): SourceEvents[] {
    this.sender.update(input, this.activePhase());
    const newest = this.buf[this.buf.length - 1];
    if (!newest) return [];
    const target = newest.t - CONFIG.NET_INTERP_DELAY_MS;
    this.renderT += frameMs;
    const drift = target - this.renderT;
    if (Math.abs(drift) > CONFIG.NET_HARD_RESYNC_MS) {
      this.renderT = target;
      // Jumped forward (e.g. back from a hidden tab): don't replay a burst of old banners/shakes.
      if (drift > 0) this.dropStaleEvents(Math.min(target, newest.t));
    } else {
      const lim = frameMs * CONFIG.NET_RESYNC_FRAC;
      this.renderT += Math.max(-lim, Math.min(lim, drift));
    }
    this.renderT = Math.min(this.renderT, newest.t); // never extrapolate

    const out: SourceEvents[] = [];
    while (this.pending.length > 0 && this.pending[0]!.t <= this.renderT) {
      const p = this.pending.shift()!;
      out.push({ events: p.events, state: p.state });
    }

    const f = this.frame();
    if (this.goAt === null && this.start.countdownMs > 0 && f.cur.phase === Phase.PLAYING) this.goAt = this.nowMs();
    // Drop entries that can no longer be straddled (keep one at or before render time).
    while (this.buf.length > 2 && this.buf[1]!.t <= this.renderT) this.buf.shift();
    return out;
  }

  /** Drop pending event batches older than `t`, except matchEnd (results must still show). */
  private dropStaleEvents(t: number): void {
    this.pending = this.pending.flatMap((p) => {
      if (p.t >= t) return [p];
      const keep = p.events.filter((e) => e.type === "matchEnd");
      return keep.length > 0 ? [{ ...p, events: keep }] : [];
    });
  }

  frame(): { prev: MatchState; cur: MatchState; alpha: number; renderTimeMs: number } {
    const b = this.buf;
    if (b.length === 0) return { prev: this.latest, cur: this.latest, alpha: 1, renderTimeMs: 0 };
    const r = this.renderT;
    const oldest = b[0]!;
    const newest = b[b.length - 1]!;
    if (r >= newest.t) return { prev: newest.state, cur: newest.state, alpha: 1, renderTimeMs: r };
    if (r <= oldest.t) return { prev: oldest.state, cur: oldest.state, alpha: 1, renderTimeMs: r };
    for (let i = b.length - 1; i > 0; i--) {
      const lo = b[i - 1]!;
      const hi = b[i]!;
      if (lo.t <= r && r <= hi.t) {
        const span = hi.t - lo.t;
        return { prev: lo.state, cur: hi.state, alpha: span > 0 ? (r - lo.t) / span : 1, renderTimeMs: r };
      }
    }
    return { prev: newest.state, cur: newest.state, alpha: 1, renderTimeMs: r };
  }

  countdown(): number | "GO!" | null {
    if (this.goAt !== null) return this.nowMs() - this.goAt < CONFIG.GO_DISPLAY_MS ? "GO!" : null;
    const left = this.start.countdownMs - (this.nowMs() - this.startRecvMs);
    return left > 0 ? Math.ceil(left / 1000) : null;
  }

  dispose(): void {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
  }
}
