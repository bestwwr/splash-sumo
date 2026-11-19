import { describe, expect, it } from "vitest";
import {
  Phase, createMatch, encodeSnap,
  type ClientMsg, type MatchState, type PlayerSetup, type SimEvent, type Snap, type StartMsg,
} from "@lava-sumo/shared";
import { NetSource } from "../src/net/netSource";

const setups: PlayerSetup[] = [
  { id: "a", nickname: "A", character: "elephant", isBot: false },
  { id: "b", nickname: "B", character: "monkey", isBot: false },
];
const start: StartMsg = { t: "start", seed: 5, setups, countdownMs: 3000 };
const ZERO = { dirX: 0, dirZ: 0, skill: false };

/** Build a snap at an arbitrary time by tweaking a stepped state. */
function snapAt(n: number, opts: { x?: number; events?: SimEvent[]; phase?: Phase } = {}): Snap {
  let st: MatchState = createMatch(5, setups);
  st = { ...st, phase: opts.phase ?? Phase.PLAYING, tick: n, timeMs: n * 50 };
  st = { ...st, players: st.players.map((p, i) => (i === 0 ? { ...p, x: opts.x ?? n } : p)) };
  return encodeSnap(st, n === 0 ? null : st.tiles, opts.events ?? []);
}

function make() {
  let now = 0;
  const sent: ClientMsg[] = [];
  const src = new NetSource(start, "a", (m) => sent.push(m), () => now);
  return { src, sent, at: (t: number) => (now = t) };
}

describe("NetSource", () => {
  it("interpolates between the snaps straddling render time", () => {
    const { src, at } = make();
    for (let i = 0; i <= 6; i++) {
      at(i * 50);
      src.onSnap(snapAt(i), i * 50);
    }
    // newest 300 -> render 200 after first advance of 0 ms; advance 25 ms keeps it in sync
    src.advance(0, ZERO);
    let f = src.frame();
    expect(f.renderTimeMs).toBeCloseTo(200, 0);
    expect(f.cur.players[0]!.x).toBeGreaterThanOrEqual(f.prev.players[0]!.x);
    src.advance(25, ZERO);
    f = src.frame();
    const x = f.prev.players[0]!.x + (f.cur.players[0]!.x - f.prev.players[0]!.x) * f.alpha;
    // x == tick number == time/50, so render time 225ish gives x ~ 4.5
    expect(x).toBeCloseTo(f.renderTimeMs / 50, 1);
    expect(f.alpha).toBeGreaterThan(0);
    expect(f.alpha).toBeLessThan(1);
  });

  it("alpha is correct inside a snap interval", () => {
    const { src } = make();
    for (let i = 0; i <= 6; i++) src.onSnap(snapAt(i), i * 50);
    src.advance(0, ZERO);
    // render at 200 exactly = snap 4 -> next 25 ms
    src.advance(12.5, ZERO);
    const f = src.frame();
    expect(f.alpha).toBeCloseTo(((f.renderTimeMs - 200) % 50) / 50, 1);
  });

  it("ignores an out-of-order snap", () => {
    const { src } = make();
    for (let i = 0; i <= 6; i++) src.onSnap(snapAt(i), i * 50);
    src.onSnap(snapAt(2, { x: 999 }), 400);
    src.advance(0, ZERO);
    const f = src.frame();
    expect(f.cur.players[0]!.x).toBeLessThan(100);
    expect(f.prev.players[0]!.x).toBeLessThan(100);
  });

  it("holds the last snap through a 500 ms gap, then resumes", () => {
    const { src } = make();
    for (let i = 0; i <= 6; i++) src.onSnap(snapAt(i), i * 50);
    src.advance(0, ZERO);
    for (let k = 0; k < 40; k++) expect(() => src.advance(16, ZERO)).not.toThrow();
    let f = src.frame();
    expect(f.alpha).toBe(1);
    expect(f.cur.tick).toBe(6);
    for (let i = 17; i <= 26; i++) src.onSnap(snapAt(i), i * 50);
    for (let k = 0; k < 20; k++) src.advance(16, ZERO);
    f = src.frame();
    expect(f.cur.tick).toBeGreaterThan(6);
  });

  it("releases each snap's events exactly once, after render time passes it", () => {
    const { src } = make();
    const ev: SimEvent = { type: "edgeShrink", ring: 3 } as unknown as SimEvent;
    for (let i = 0; i <= 3; i++) src.onSnap(snapAt(i, { events: i === 3 ? [ev] : [] }), i * 50);
    const got: Array<{ events: SimEvent[]; state: MatchState }> = [];
    got.push(...src.advance(0, ZERO)); // render = 150-100 = 50
    expect(got).toHaveLength(0);
    got.push(...src.advance(50, ZERO)); // render 100
    expect(got).toHaveLength(0);
    for (let k = 0; k < 20; k++) got.push(...src.advance(16, ZERO));
    expect(got).toHaveLength(1);
    expect(got[0]!.events).toEqual([ev]);
    expect(got[0]!.state.tick).toBe(3); // paired with the snap that carried it
    for (let k = 0; k < 20; k++) got.push(...src.advance(16, ZERO));
    expect(got).toHaveLength(1);
  });

  it("applies tile deltas cumulatively", () => {
    const { src } = make();
    const s0 = snapAt(0);
    const s1: Snap = { ...snapAt(1), tiles: [[3, "warning" as never, 50, 0]] };
    const s2: Snap = { ...snapAt(2), tiles: [] };
    src.onSnap(s0, 0);
    src.onSnap(s1, 50);
    src.onSnap(s2, 100);
    for (let k = 0; k < 30; k++) src.advance(16, ZERO);
    expect(src.frame().cur.tiles[3]!.state).toBe("warning");
  });

  it("countdown follows start.countdownMs, then GO! once PLAYING renders, then null", () => {
    const { src, at } = make();
    expect(src.countdown()).toBe(3);
    at(1100);
    expect(src.countdown()).toBe(2);
    at(2500);
    expect(src.countdown()).toBe(1);
    for (let i = 0; i <= 3; i++) src.onSnap(snapAt(i, { phase: Phase.COUNTDOWN }), 0);
    at(3000);
    for (let i = 4; i <= 8; i++) src.onSnap(snapAt(i, { phase: Phase.PLAYING }), 3000);
    for (let k = 0; k < 30; k++) src.advance(16, ZERO);
    expect(src.countdown()).toBe("GO!");
    at(3700);
    expect(src.countdown()).toBeNull();
  });

  it("sends inputs through its InputSender", () => {
    const { src, sent, at } = make();
    at(100);
    src.advance(16, { dirX: 1, dirZ: 0, skill: false });
    expect(sent[0]).toMatchObject({ t: "in", seq: 1, dirX: 1 });
  });

  it("M5: the snapshot buffer stays ~1 s deep while no frames run (hidden tab)", () => {
    const { src } = make();
    for (let i = 0; i <= 200; i++) src.onSnap(snapAt(i), i * 50);
    const buf = (src as unknown as { buf: unknown[] }).buf;
    expect(buf.length).toBeLessThanOrEqual(23);
    expect(buf.length).toBeGreaterThan(15);
  });

  it("M5: a hard resync forward drops stale events but still releases matchEnd", () => {
    const { src } = make();
    const shrink = { type: "edgeShrink", ring: 1 } as unknown as SimEvent;
    const end = { type: "matchEnd", result: { winnerId: "a", placements: [] } } as unknown as SimEvent;
    for (let i = 0; i <= 4; i++) src.onSnap(snapAt(i), i * 50);
    src.advance(0, ZERO);
    for (let i = 5; i <= 100; i++) src.onSnap(snapAt(i, { events: i === 10 ? [shrink, end] : [shrink] }), i * 50);
    const got = src.advance(16, ZERO); // renderT jumps to ~4900
    // only matchEnd (snap 10) plus whatever is at/after the new render time (snap ~98); not 90 stale batches
    expect(got.length).toBeLessThanOrEqual(2);
    expect(got[0]!.events.map((e) => e.type)).toEqual(["matchEnd"]);
    expect(got[0]!.state.tick).toBe(10);
    for (const g of got.slice(1)) expect(g.state.tick).toBeGreaterThanOrEqual(98);
    // events newer than the new render time still arrive normally
    const later: string[] = [];
    for (let k = 0; k < 20; k++) later.push(...src.advance(16, ZERO).flatMap((g) => g.events.map((e) => e.type)));
    expect(later.every((t) => t === "edgeShrink")).toBe(true);
  });

  it("I5: no keep-alive while the latest snap is RESULTS; keep-alive while PLAYING", () => {
    const { src, sent, at } = make();
    src.onSnap(snapAt(1, { phase: Phase.PLAYING }), 0);
    at(1500);
    src.advance(16, ZERO);
    expect(sent).toHaveLength(1);
    src.onSnap(snapAt(2, { phase: Phase.RESULTS }), 1500);
    for (let t = 2000; t <= 9000; t += 500) {
      at(t);
      src.advance(16, ZERO);
    }
    expect(sent).toHaveLength(1);
  });
});
