import { describe, expect, it } from "vitest";
import {
  CONFIG, Phase, createMatch, encodeSnap, maxSpeed,
  type ClientMsg, type MatchState, type Player, type PlayerSetup, type StartMsg,
} from "@splash-sumo/shared";
import { LocalPredictor, type SentInput } from "../src/net/prediction";
import { NetSource } from "../src/net/netSource";

const setups: PlayerSetup[] = [
  { id: "a", nickname: "A", character: "elephant", isBot: false },
  { id: "b", nickname: "B", character: "monkey", isBot: false },
];

function player(over: Partial<Player> = {}): Player {
  return { ...createMatch(5, setups).players[1]!, x: 0, z: 0, vx: 0, vz: 0, ...over };
}

/** Clock where snaps arrive `down` ms after the server made them (min offset = down). */
const clock = (down: number) => ({ serverTime: (now: number) => now - down, minOffsetMs: () => down });

describe("LocalPredictor", () => {
  it("P1: a key press moves your fighter right away, before the server has seen it", () => {
    const hist: SentInput[] = [];
    const lp = new LocalPredictor(() => hist, clock(60));
    lp.onSnap(player({ lastProcessedSeq: 0 }), 1000, 1060); // snap made at server 1000, received at local 1060
    expect(lp.predict(1060)!.x).toBeCloseTo(0, 5);
    hist.push({ at: 1060, seq: 1, dirX: 1, dirZ: 0 });
    const x100 = lp.predict(1160)!.x;
    expect(x100).toBeGreaterThan(0.1); // ~100 ms of acceleration toward +x
    expect(lp.predict(1260)!.x).toBeGreaterThan(x100);
  });

  it("P2: with no input a standing fighter stays put; a moving one keeps its server velocity decaying", () => {
    const lp = new LocalPredictor(() => [], clock(60));
    lp.onSnap(player(), 1000, 1060);
    expect(lp.predict(1500)!.x).toBeCloseTo(0, 6);
    const lp2 = new LocalPredictor(() => [], clock(60));
    lp2.onSnap(player({ vx: 8, hitStunMs: 200 }), 1000, 1060); // shoved: knockback carries on
    const p = lp2.predict(1100)!;
    expect(p.x).toBeGreaterThan(0.5);
    expect(p.vx).toBeLessThan(8);
  });

  it("P3: inputs the server already acked are never replaced by older ones", () => {
    // Clock says cut-off is before seq 2 was sent, but the snap acks seq 2: the replay must use seq 2 (moving right).
    const hist: SentInput[] = [
      { at: 0, seq: 1, dirX: -1, dirZ: 0 },
      { at: 900, seq: 2, dirX: 1, dirZ: 0 },
    ];
    const lp = new LocalPredictor(() => hist, { serverTime: (n) => n, minOffsetMs: () => -500 });
    lp.onSnap(player({ lastProcessedSeq: 2 }), 1000, 1000);
    expect(lp.predict(1100)!.x).toBeGreaterThan(0);
  });

  it("P4: RTT is measured from send to ack, keeping the smallest recent sample", () => {
    const hist: SentInput[] = [
      { at: 1000, seq: 1, dirX: 1, dirZ: 0 },
      { at: 2000, seq: 2, dirX: 0, dirZ: 0 },
    ];
    const lp = new LocalPredictor(() => hist, clock(60));
    expect(lp.rttMs()).toBe(CONFIG.NET_RTT_INIT_MS);
    lp.onSnap(player({ lastProcessedSeq: 1 }), 1100, 1180);
    expect(lp.rttMs()).toBe(180);
    lp.onSnap(player({ lastProcessedSeq: 2 }), 2100, 2240);
    expect(lp.rttMs()).toBe(180);
  });

  it("P5: a small server correction is eased out over time; a big one jumps", () => {
    const lp = new LocalPredictor(() => [], clock(60));
    lp.onSnap(player({ x: 0 }), 1000, 1060);
    lp.render(1077, 16);
    lp.onSnap(player({ x: 0.5 }), 1033, 1093); // server disagrees by 0.5 m
    const first = lp.render(1093, 16)!.x;
    expect(first).toBeLessThan(0.2); // still drawn near where it was
    let x = first;
    for (let i = 1; i <= 60; i++) x = lp.render(1093 + i * 16, 16)!.x;
    expect(x).toBeCloseTo(0.5, 2); // and settles on the server's answer
    lp.onSnap(player({ x: 5 }), 2000, 2060); // 4.5 m away: jump
    expect(lp.render(2069, 16)!.x).toBeCloseTo(5, 3);
  });

  it("P5b: a change in the RTT estimate doesn't make the fighter jump", () => {
    const hist: SentInput[] = [{ at: 910, seq: 1, dirX: 1, dirZ: 0 }];
    const lp = new LocalPredictor(() => hist, clock(60));
    lp.onSnap(player({ lastProcessedSeq: 1, vx: 4 }), 1000, 1060); // RTT sample 150
    const a = lp.render(1060, 16)!.x;
    hist.push({ at: 1000, seq: 2, dirX: 1, dirZ: 0 });
    lp.onSnap(player({ lastProcessedSeq: 2, vx: 4, x: 0.13 }), 1033, 1076); // ack: RTT 76 instead of 150
    expect(lp.rttMs()).toBe(76);
    const b = lp.render(1076, 16)!.x;
    expect(Math.abs(b - a)).toBeLessThan(4.5 * 0.016 * 1.6); // no more than one frame of running
  });

  it("P6: nothing to predict when the local player isn't predictable (dead / not playing)", () => {
    const lp = new LocalPredictor(() => [], clock(60));
    lp.onSnap(null, 1000, 1060);
    expect(lp.render(1100, 16)).toBeNull();
  });

  it("P7: the predicted speed never exceeds the fighter's max speed from inputs alone", () => {
    const hist: SentInput[] = [{ at: 0, seq: 1, dirX: 1, dirZ: 0 }];
    const lp = new LocalPredictor(() => hist, clock(60));
    lp.onSnap(player({ lastProcessedSeq: 1 }), 1000, 1060);
    const p = lp.predict(3000)!; // replay is capped at 30 ticks
    expect(Math.hypot(p.vx, p.vz)).toBeLessThanOrEqual(maxSpeed("monkey") + 1e-9);
  });
});

describe("NetSource with prediction", () => {
  const start: StartMsg = { t: "start", seed: 5, setups, countdownMs: 0 };
  function snapAt(n: number, st0: MatchState, over: (s: MatchState) => MatchState = (s) => s) {
    const st = over({ ...st0, phase: Phase.PLAYING, tick: n, timeMs: n * 50 });
    return encodeSnap(st, n === 0 ? null : st.tiles, []);
  }

  it("P8: your fighter is drawn from your inputs; other fighters stay interpolated", () => {
    let now = 0;
    const sent: ClientMsg[] = [];
    const src = new NetSource(start, "b", (m) => sent.push(m), () => now);
    const base = createMatch(5, setups);
    for (let i = 0; i <= 6; i++) {
      now = i * 50;
      src.onSnap(snapAt(i, base), now);
    }
    const bx0 = base.players[1]!.x;
    for (let k = 0; k < 10; k++) {
      now += 16;
      src.advance(16, { dirX: 1, dirZ: 0, skill: false });
    }
    const f = src.frame();
    const me = f.cur.players.find((p) => p.id === "b")!;
    const other = f.cur.players.find((p) => p.id === "a")!;
    expect(me.x).toBeGreaterThan(bx0 + 0.2); // moved without any server ack
    expect(me).toEqual(f.prev.players.find((p) => p.id === "b")); // same spot in both, so alpha can't pull it back
    expect(other.x).toBeCloseTo(base.players[0]!.x, 2);
  });

  it("P9: once you're eliminated the server's state is drawn as-is", () => {
    let now = 0;
    const src = new NetSource(start, "b", () => {}, () => now);
    const base = createMatch(5, setups);
    const dead = (s: MatchState) => ({ ...s, players: s.players.map((p) => (p.id === "b" ? { ...p, alive: false } : p)) });
    for (let i = 0; i <= 6; i++) {
      now = i * 50;
      src.onSnap(snapAt(i, base, dead), now);
    }
    src.advance(16, { dirX: 1, dirZ: 0, skill: false });
    const me = src.frame().cur.players.find((p) => p.id === "b")!;
    expect(me.x).toBeCloseTo(base.players[1]!.x, 2);
  });
});
