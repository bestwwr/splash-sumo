// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRoom, connectRoom, createRoom, playerToken, serverUrl } from "../src/net/roomClient";

class FakeWS {
  static instances: FakeWS[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
  msg(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

const JOIN = { token: "tok", nickname: "Ann", character: "monkey" as const };

describe("serverUrl", () => {
  it("self on https origin", () => {
    expect(serverUrl("self", new URL("https://x.workers.dev/play"))).toEqual({ http: "https://x.workers.dev", ws: "wss://x.workers.dev" });
  });
  it("unset uses :8787 on the page host", () => {
    expect(serverUrl(undefined, new URL("http://localhost:5173/"))).toEqual({ http: "http://localhost:8787", ws: "ws://localhost:8787" });
  });
  it("explicit url", () => {
    expect(serverUrl("https://srv.example.com", new URL("http://localhost:5173/")).ws).toBe("wss://srv.example.com");
  });
});

describe("checkRoom / createRoom", () => {
  afterEach(() => vi.unstubAllGlobals());
  const fetchWith = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ status, ok: status < 300, json: async () => body })));

  it("maps 200/404/409 and network errors", async () => {
    fetchWith(200, { ok: true });
    expect(await checkRoom("ABCD")).toBe("ok");
    fetchWith(404, {});
    expect(await checkRoom("ABCD")).toBe("NOT_FOUND");
    fetchWith(409, { reason: "FULL" });
    expect(await checkRoom("ABCD")).toBe("FULL");
    fetchWith(409, { reason: "IN_PROGRESS" });
    expect(await checkRoom("ABCD")).toBe("IN_PROGRESS");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net"); }));
    expect(await checkRoom("ABCD")).toBe("DOWN");
  });

  it("createRoom returns the code", async () => {
    fetchWith(200, { code: "WXYZ" });
    expect(await createRoom()).toBe("WXYZ");
  });
});

describe("playerToken", () => {
  it("reuses anonId and persists", () => {
    localStorage.clear();
    localStorage.setItem("lavasumo.anonId", "anon-1");
    expect(playerToken()).toBe("anon-1");
    expect(localStorage.getItem("lavasumo.playerToken")).toBe("anon-1");
  });
});

describe("connectRoom", () => {
  beforeEach(() => {
    FakeWS.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWS);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends join on open, forwards messages", () => {
    const onMsg = vi.fn();
    const onState = vi.fn();
    connectRoom("ABCD", JOIN, { onMsg, onState });
    const ws = FakeWS.instances[0]!;
    expect(ws.url).toContain("/rooms/ABCD/ws?v=");
    ws.open();
    expect(JSON.parse(ws.sent[0]!)).toEqual({ t: "join", ...JOIN });
    ws.msg({ t: "welcome", you: "p1", code: "ABCD" });
    expect(onMsg).toHaveBeenCalledWith({ t: "welcome", you: "p1", code: "ABCD" });
    expect(onState).toHaveBeenLastCalledWith("open");
  });

  it("reconnects after 500 ms re-sending join with the same token", () => {
    const onState = vi.fn();
    connectRoom("ABCD", JOIN, { onMsg: vi.fn(), onState });
    FakeWS.instances[0]!.open();
    FakeWS.instances[0]!.drop();
    expect(onState).toHaveBeenLastCalledWith("reconnecting");
    vi.advanceTimersByTime(499);
    expect(FakeWS.instances.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(FakeWS.instances.length).toBe(2);
    FakeWS.instances[1]!.open();
    expect(JSON.parse(FakeWS.instances[1]!.sent[0]!)).toEqual({ t: "join", ...JOIN });
    expect(onState).toHaveBeenLastCalledWith("open");
  });

  it("gives up with 'lost' after 15 s of failed retries", () => {
    const onState = vi.fn();
    connectRoom("ABCD", JOIN, { onMsg: vi.fn(), onState });
    FakeWS.instances[0]!.open();
    FakeWS.instances[0]!.drop();
    for (let t = 0; t < 20000; t += 100) {
      vi.advanceTimersByTime(100);
      const last = FakeWS.instances[FakeWS.instances.length - 1]!;
      if (last.readyState === 0) last.drop();
    }
    expect(onState).toHaveBeenLastCalledWith("lost");
    const n = FakeWS.instances.length;
    vi.advanceTimersByTime(30000);
    expect(FakeWS.instances.length).toBe(n);
  });

  it("does not reconnect after a terminal error or close()", () => {
    const onState = vi.fn();
    const c = connectRoom("ABCD", JOIN, { onMsg: vi.fn(), onState });
    FakeWS.instances[0]!.open();
    FakeWS.instances[0]!.msg({ t: "error", code: "KICKED" });
    FakeWS.instances[0]!.drop();
    vi.advanceTimersByTime(20000);
    expect(FakeWS.instances.length).toBe(1);
    expect(onState).not.toHaveBeenCalledWith("reconnecting");
    c.close();
  });
});
