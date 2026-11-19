// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Phase, type ClientMsg, type ServerMsg, type StartMsg } from "@lava-sumo/shared";
import { createOnlineFlow } from "../src/game/onlinePlay";
import { loadProfile } from "../src/meta/profile";
import type { RoomHandlers } from "../src/net/roomClient";

const START = { t: "start", seed: 1, setups: [], countdownMs: 3000 } as unknown as StartMsg;
const lobbyMsg = (phase: Phase): ServerMsg => ({
  t: "lobby",
  phase,
  hostId: "me",
  difficulty: "easy",
  members: [{ id: "me", nickname: "Ann", character: "monkey", connected: true }],
});

function setup(over: { check?: string } = {}) {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  document.body.appendChild(root);
  let profile = loadProfile(null, () => "Rando");
  const sent: ClientMsg[] = [];
  const conns: Array<{ handlers: RoomHandlers; close: ReturnType<typeof vi.fn>; code: string }> = [];
  const sources: Array<{ resetInput: ReturnType<typeof vi.fn>; onSnap: ReturnType<typeof vi.fn>; send: (m: ClientMsg) => void }> = [];
  const views: Array<{ stop: ReturnType<typeof vi.fn>; actions: Array<{ id: string; onClick(): void }> }> = [];
  const onHome = vi.fn();
  let resolveCreate: (c: string) => void = () => {};
  const api = {
    connectRoom: vi.fn((code: string, _j: unknown, handlers: RoomHandlers) => {
      const close = vi.fn();
      conns.push({ handlers, close, code });
      return { send: (m: ClientMsg) => void sent.push(m), close };
    }),
    createRoom: vi.fn(() => new Promise<string>((r) => (resolveCreate = r))),
    checkRoom: vi.fn(async () => (over.check ?? "ok") as never),
    runMatchView: vi.fn((_g: unknown, _c: unknown, _h: unknown, _s: unknown, o: { actions: Array<{ id: string; onClick(): void }> }) => {
      const v = { stop: vi.fn(), actions: o.actions };
      views.push(v);
      return v;
    }),
    makeSource: vi.fn((_s: StartMsg, _id: string, send: (m: ClientMsg) => void) => {
      const src = { resetInput: vi.fn(), onSnap: vi.fn(), send };
      sources.push(src);
      return src as never;
    }),
  };
  const flow = createOnlineFlow({
    root,
    gs: {} as never,
    controls: {} as never,
    hud: {} as never,
    getProfile: () => profile,
    setProfile: (p) => (profile = p),
    setIdle: vi.fn(),
    onHome,
    api: api as never,
  });
  const el = (s: string) => root.querySelector<HTMLElement>(s)!;
  const hidden = (s: string) => el(s).classList.contains("hidden");
  const typeJoin = (c: string) => {
    const i = el(".friends-code") as HTMLInputElement;
    i.value = c;
    i.dispatchEvent(new Event("input", { bubbles: true }));
    el(".friends-join").click();
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { root, flow, api, conns, sources, views, sent, onHome, el, hidden, typeJoin, tick, resolveCreate: (c: string) => resolveCreate(c) };
}

async function toLobby(t: ReturnType<typeof setup>) {
  t.flow.openFriends();
  t.typeJoin("ABCD");
  await t.tick();
  const h = t.conns[0]!.handlers;
  h.onMsg({ t: "welcome", you: "me", code: "ABCD" });
  h.onMsg(lobbyMsg(Phase.LOBBY));
  return h;
}

describe("online flow", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lobby -> start -> results -> lobby -> second start uses exactly one new source", async () => {
    const t = setup();
    const h = await toLobby(t);
    expect(t.hidden(".lobby-screen")).toBe(false);
    h.onMsg(START);
    expect(t.sources.length).toBe(1);
    expect(t.hidden(".lobby-screen")).toBe(true);
    t.views[0]!.actions.find((a) => a.id === "again")!.onClick();
    expect(t.sent).toContainEqual({ t: "again" });
    h.onMsg(lobbyMsg(Phase.LOBBY));
    expect(t.views[0]!.stop).toHaveBeenCalledTimes(1);
    expect(t.hidden(".lobby-screen")).toBe(false);
    h.onMsg(START);
    expect(t.sources.length).toBe(2);
    expect(t.views.length).toBe(2);
    // old source is no longer fed
    h.onMsg({ t: "snap" } as never);
    expect(t.sources[0]!.onSnap).not.toHaveBeenCalled();
    expect(t.sources[1]!.onSnap).toHaveBeenCalledTimes(1);
  });

  it("rejoin start mid-match rebuilds the source; reconnect calls resetInput", async () => {
    const t = setup();
    const h = await toLobby(t);
    h.onMsg(START);
    h.onState("reconnecting");
    h.onState("open");
    expect(t.sources[0]!.resetInput).toHaveBeenCalledTimes(1);
    h.onMsg(START);
    expect(t.views[0]!.stop).toHaveBeenCalledTimes(1);
    expect(t.sources.length).toBe(2);
  });

  it("leave from results sends leave once, stops the view once, goes home", async () => {
    const t = setup();
    const h = await toLobby(t);
    h.onMsg(START);
    t.views[0]!.actions.find((a) => a.id === "leave")!.onClick();
    expect(t.sent.filter((m) => m.t === "leave").length).toBe(1);
    expect(t.views[0]!.stop).toHaveBeenCalledTimes(1);
    expect(t.conns[0]!.close).toHaveBeenCalled();
    expect(t.onHome).toHaveBeenCalledTimes(1);
  });

  it("terminal error mid-match tears down and goes home", async () => {
    const t = setup();
    const h = await toLobby(t);
    h.onMsg(START);
    h.onMsg({ t: "error", code: "KICKED" });
    expect(t.views[0]!.stop).toHaveBeenCalled();
    expect(t.onHome).toHaveBeenCalledTimes(1);
    expect(t.conns[0]!.close).toHaveBeenCalled();
  });

  it("IN_PROGRESS check still connects; server IN_PROGRESS error shows unavailable", async () => {
    const t = setup({ check: "IN_PROGRESS" });
    t.flow.openFriends();
    t.typeJoin("ABCD");
    await t.tick();
    expect(t.conns.length).toBe(1);
    t.conns[0]!.handlers.onMsg({ t: "error", code: "IN_PROGRESS" });
    expect(t.el(".friends-msg").textContent).toContain("Room not available");
    expect(t.hidden(".friends-screen")).toBe(false);
  });

  it("Back during an in-flight create does not connect or show lobby", async () => {
    const t = setup();
    t.flow.openFriends();
    t.el(".friends-create").click();
    t.el(".friends-back").click();
    t.resolveCreate("WXYZ");
    await t.tick();
    expect(t.conns.length).toBe(0);
    expect(t.hidden(".lobby-screen")).toBe(true);
    expect(t.onHome).toHaveBeenCalledTimes(1);
  });

  it("Back during an in-flight join does not connect", async () => {
    const t = setup();
    t.flow.openFriends();
    t.typeJoin("ABCD");
    t.el(".friends-back").click();
    await t.tick();
    expect(t.conns.length).toBe(0);
  });
});
