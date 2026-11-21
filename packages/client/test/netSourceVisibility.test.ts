// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { Phase, createMatch, encodeSnap, type ClientMsg, type PlayerSetup, type StartMsg } from "@splash-sumo/shared";
import { NetSource } from "../src/net/netSource";

const setups: PlayerSetup[] = [{ id: "a", nickname: "A", character: "elephant", isBot: false }];
const start: StartMsg = { t: "start", seed: 5, setups, countdownMs: 0 };

function setVisibility(v: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("NetSource visibility (I3)", () => {
  afterEach(() => setVisibility("visible"));

  it("sends a neutral input immediately when the tab is hidden, and stops after dispose", () => {
    const sent: ClientMsg[] = [];
    const src = new NetSource(start, "a", (m) => sent.push(m), () => 0);
    const st = { ...createMatch(5, setups), phase: Phase.PLAYING, tick: 1, timeMs: 50 };
    src.onSnap(encodeSnap(st, null, []), 0);
    src.advance(16, { dirX: 1, dirZ: 0, skill: false });
    expect(sent).toHaveLength(1);
    setVisibility("hidden");
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ t: "in", seq: 2, dirX: 0, dirZ: 0, skill: false });
    setVisibility("visible");
    expect(sent).toHaveLength(2);
    src.dispose();
    setVisibility("hidden");
    expect(sent).toHaveLength(2);
  });

  it("does nothing in RESULTS", () => {
    const sent: ClientMsg[] = [];
    const src = new NetSource(start, "a", (m) => sent.push(m), () => 0);
    const st = { ...createMatch(5, setups), phase: Phase.RESULTS, tick: 1, timeMs: 50 };
    src.onSnap(encodeSnap(st, null, []), 0);
    setVisibility("hidden");
    expect(sent).toHaveLength(0);
    src.dispose();
  });
});
