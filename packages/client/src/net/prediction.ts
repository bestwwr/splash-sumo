/**
 * Local-player prediction for online matches (D-NET-PREDICT).
 *
 * The server stays the authority. Each frame we take the local player from the newest snap and replay,
 * movement-only, the inputs this client sent since then, up to "the server tick an input sent now would hit":
 *   presentServerTime ≈ serverTimeEstimate(now) + RTT   (serverTimeEstimate lags the true server time by the
 *   downlink latency; RTT adds the downlink back and covers the uplink).
 * At server time τ the server applied the latest input that had arrived by τ, i.e. the one this client sent at
 * local time ≤ τ + minOffset − RTT, and never one older than the snap's lastProcessedSeq.
 * Collisions, skills starting, tiles and eliminations are not predicted: they arrive with the next snap and the
 * replay picks them up (knockback velocity, hit stun, dash and shell all come from the server's player state).
 * Any jump in the prediction between frames (a new snap, a new RTT or clock estimate) beyond what the fighter's
 * own velocity explains is spread over NET_PREDICT_SMOOTH_MS instead of snapping; jumps over NET_PREDICT_SNAP_M snap.
 */
import { CONFIG, applyMovement, type Player, type PlayerInput } from "@lava-sumo/shared";

export interface SentInput {
  at: number; // local ms when sent
  seq: number;
  dirX: number;
  dirZ: number;
}

export interface PredictClock {
  /** Server match time the newest-arriving snaps correspond to at local time `now`. */
  serverTime(nowMs: number): number;
  /** recvMs − timeMs of the least-delayed recent snap. */
  minOffsetMs(): number;
}

export interface Predicted {
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
}

const RTT_SAMPLES = 10;
const MAX_REPLAY_TICKS = 30;

export class LocalPredictor {
  private base: { p: Player; t: number } | null = null;
  private rtts: number[] = [];
  private lastAckSeq = 0;
  private offX = 0;
  private offZ = 0;
  private last: { at: number; p: Predicted } | null = null;

  constructor(
    private readonly history: () => readonly SentInput[],
    private readonly clock: PredictClock,
  ) {}

  /** Round trip: the smallest recent send→ack time (acks also wait for a tick and a snap, so min is closest). */
  rttMs(): number {
    return this.rtts.length > 0 ? Math.min(...this.rtts) : CONFIG.NET_RTT_INIT_MS;
  }

  /** Feed every snap's local player (null when the local player isn't predictable: dead, not PLAYING). */
  onSnap(p: Player | null, timeMs: number, recvMs: number): void {
    if (p && p.lastProcessedSeq > this.lastAckSeq) {
      const sent = this.history().find((h) => h.seq === p.lastProcessedSeq);
      if (sent) {
        this.rtts.push(recvMs - sent.at);
        if (this.rtts.length > RTT_SAMPLES) this.rtts.shift();
      }
    }
    if (p) this.lastAckSeq = Math.max(this.lastAckSeq, p.lastProcessedSeq);
    this.base = p ? { p: { ...p }, t: timeMs } : null;
  }

  /** Call on reconnect (input seqs restart). */
  reset(): void {
    this.lastAckSeq = 0;
    this.base = null;
    this.last = null;
    this.offX = this.offZ = 0;
  }

  /** Where to draw the local player this frame (prediction + decaying correction), or null to use the snap. */
  render(nowMs: number, frameMs: number): Predicted | null {
    const pr = this.predict(nowMs);
    if (!pr) {
      this.last = null;
      this.offX = this.offZ = 0;
      return null;
    }
    const prev = this.last;
    if (prev) {
      // Where the fighter's own motion would have taken last frame's prediction; anything else is a correction.
      const dt = Math.max(0, nowMs - prev.at) / 1000;
      const ex = prev.p.x + ((prev.p.vx + pr.vx) / 2) * dt;
      const ez = prev.p.z + ((prev.p.vz + pr.vz) / 2) * dt;
      this.offX += ex - pr.x;
      this.offZ += ez - pr.z;
      if (Math.hypot(this.offX, this.offZ) > CONFIG.NET_PREDICT_SNAP_M) this.offX = this.offZ = 0;
    }
    this.last = { at: nowMs, p: pr };
    const k = Math.exp(-frameMs / CONFIG.NET_PREDICT_SMOOTH_MS);
    this.offX *= k;
    this.offZ *= k;
    return { ...pr, x: pr.x + this.offX, z: pr.z + this.offZ };
  }

  /** Raw prediction at local time `nowMs` (no smoothing). */
  predict(nowMs: number): Predicted | null {
    const b = this.base;
    if (!b) return null;
    const p: Player = { ...b.p };
    const rtt = this.rttMs();
    const target = Math.min(this.clock.serverTime(nowMs) + rtt, b.t + MAX_REPLAY_TICKS * CONFIG.TICK_MS);
    const shift = this.clock.minOffsetMs() - rtt; // server time τ -> latest local send time that reached it
    let t = b.t;
    while (t + CONFIG.TICK_MS <= target) {
      t += CONFIG.TICK_MS;
      applyMovement(p, this.inputAt(t + shift, b.p.lastProcessedSeq), CONFIG.TICK_MS);
    }
    const rem = target - t;
    if (rem > 0) applyMovement(p, this.inputAt(t + CONFIG.TICK_MS + shift, b.p.lastProcessedSeq), rem);
    return { x: p.x, z: p.z, vx: p.vx, vz: p.vz, facing: p.facing };
  }

  private inputAt(sentBy: number, minSeq: number): PlayerInput {
    const h = this.history();
    let pick: SentInput | undefined;
    for (const e of h) {
      if (e.at <= sentBy || e.seq <= minSeq) pick = e;
      else break;
    }
    return pick ? { seq: pick.seq, dirX: pick.dirX, dirZ: pick.dirZ, skill: false } : { seq: 0, dirX: 0, dirZ: 0, skill: false };
  }
}
