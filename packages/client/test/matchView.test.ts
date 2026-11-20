// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG, Phase, createMatch, type MatchResult, type MatchState, type PlayerSetup } from "@lava-sumo/shared";
import type { MatchSource } from "../src/game/matchSource";

vi.mock("../src/render/players", () => ({
  createPlayers: () => ({ group: {}, update: vi.fn(), squash: vi.fn(), dispose: vi.fn() }),
}));

const { runMatchView } = await import("../src/game/matchView");

const setups: PlayerSetup[] = [
  { id: "p1", nickname: "A", character: "elephant", isBot: false },
  { id: "p2", nickname: "B", character: "monkey", isBot: false },
];
const RESULT = { winnerId: "p1", placements: [] } as unknown as MatchResult;

function harness(localId: string, state: MatchState, events: Array<{ events: unknown[]; state: MatchState }> = []) {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (frames.push(cb), frames.length));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const gs = {
    scene: { add: vi.fn(), remove: vi.fn() },
    skillFx: { reset: vi.fn(), onEvent: vi.fn(), update: vi.fn() },
    arena: { surfaceHeight: () => 0, update: vi.fn() },
    fx: { bonk: vi.fn(), poof: vi.fn() },
    shake: vi.fn(),
    updateLava: vi.fn(),
    render: vi.fn(),
  };
  const controls = { setEnabled: vi.fn(), read: () => ({ dirX: 0, dirZ: 0, skill: false }), setSkillState: vi.fn() };
  const hud = {
    setPlayers: vi.fn(), setVisible: vi.fn(), hideResults: vi.fn(), showResults: vi.fn(), countdown: vi.fn(),
    update: vi.fn(), banner: vi.fn(), setFps: vi.fn(),
  };
  const queue = [...events];
  const source: MatchSource = {
    localId,
    advance: () => queue.splice(0) as never,
    frame: () => ({ prev: state, cur: state, alpha: 1, renderTimeMs: 0 }),
    countdown: () => null,
    dispose: vi.fn(),
  };
  const view = runMatchView(gs as never, controls as never, hud as never, source, { subtitle: () => "sub", actions: [] });
  let t = 0;
  const frame = () => frames.shift()!((t += 16));
  return { frame, hud, controls, view, gs };
}

describe("matchView", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("I1: shows results from a RESULTS-phase state with a result even without a matchEnd event", () => {
    const st: MatchState = { ...createMatch(1, setups), phase: Phase.RESULTS, result: RESULT };
    const h = harness("p1", st);
    h.frame();
    h.frame();
    // Same pause as after matchEnd, so an online frame that reaches RESULTS early doesn't cut the last fall short.
    vi.advanceTimersByTime(CONFIG.RESULTS_DELAY_MS - 1);
    expect(h.hud.showResults).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.hud.showResults).toHaveBeenCalledTimes(1);
    h.view.stop();
  });

  it("I1: a matchEnd event plus a RESULTS state shows results exactly once", () => {
    const st: MatchState = { ...createMatch(1, setups), phase: Phase.RESULTS, result: RESULT };
    const h = harness("p1", st, [{ events: [{ type: "matchEnd", result: RESULT }], state: st }]);
    h.frame();
    h.frame();
    vi.advanceTimersByTime(2000);
    expect(h.hud.showResults).toHaveBeenCalledTimes(1);
    h.view.stop();
  });

  it("I2: a local id missing from the match renders without throwing and without a skill button", () => {
    const st = createMatch(1, setups);
    const h = harness("ghost", st);
    expect(() => {
      h.frame();
      h.frame();
    }).not.toThrow();
    expect(h.controls.setSkillState).not.toHaveBeenCalled();
    h.view.stop();
  });
});
