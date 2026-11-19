import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ServerMsg } from "@lava-sumo/shared";

// `exports.default` is the Worker's default export (typed loosely by the plugin).
const worker = (exports as unknown as { default: { fetch(r: Request): Promise<Response> } }).default;
const fetchW = (path: string, init?: RequestInit) => worker.fetch(new Request(`http://example.com${path}`, init));

async function createRoom(): Promise<string> {
  const res = await fetchW("/rooms", { method: "POST" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { code: string };
  expect(body.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
  return body.code;
}

async function openWs(code: string, v: number) {
  const res = await fetchW(`/rooms/${code}/ws?v=${v}`, { headers: { Upgrade: "websocket" } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const msgs: ServerMsg[] = [];
  const waiters: Array<() => void> = [];
  ws.addEventListener("message", (e: MessageEvent) => {
    msgs.push(JSON.parse(e.data as string) as ServerMsg);
    waiters.splice(0).forEach((w) => w());
  });
  const waitFor = async (pred: (m: ServerMsg) => boolean, ms = 4000): Promise<ServerMsg> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = msgs.find(pred);
      if (hit) return hit;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timeout; got ${msgs.map((m) => m.t).join(",")}`);
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, left);
      });
    }
  };
  return { ws, msgs, waitFor };
}

const join = { t: "join", token: "tok-1", nickname: "Host", character: "elephant" };

describe("worker", () => {
  it("GET /health", async () => {
    const res = await fetchW("/health");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("creates a room and finds it; unknown room is 404", async () => {
    const code = await createRoom();
    const res = await fetchW(`/rooms/${code}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await fetchW("/rooms/ZZZZ")).status).toBe(404);
  });

  it("CORS: reflects allowed origins, handles preflight, omits others", async () => {
    const ok = await fetchW("/health", { headers: { Origin: "https://bestwwr.github.io" } });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("https://bestwwr.github.io");
    const lan = await fetchW("/health", { headers: { Origin: "http://192.168.1.5:5173" } });
    expect(lan.headers.get("Access-Control-Allow-Origin")).toBe("http://192.168.1.5:5173");
    const pre = await fetchW("/rooms", { method: "OPTIONS", headers: { Origin: "http://localhost:5173" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    const bad = await fetchW("/health", { headers: { Origin: "https://evil.example" } });
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("websocket join -> welcome then lobby", async () => {
    const code = await createRoom();
    const { ws, msgs, waitFor } = await openWs(code, 1);
    ws.send(JSON.stringify(join));
    await waitFor((m) => m.t === "lobby");
    expect(msgs.map((m) => m.t).slice(0, 2)).toEqual(["welcome", "lobby"]);
    ws.close();
  });

  it("wrong protocol version -> error UPDATE_REQUIRED", async () => {
    const code = await createRoom();
    const { waitFor } = await openWs(code, 999);
    expect(await waitFor((m) => m.t === "error")).toEqual({ t: "error", code: "UPDATE_REQUIRED" });
  });

  it("host start -> start then snaps", async () => {
    const code = await createRoom();
    const { ws, msgs, waitFor } = await openWs(code, 1);
    ws.send(JSON.stringify(join));
    await waitFor((m) => m.t === "lobby");
    ws.send(JSON.stringify({ t: "start" }));
    await waitFor((m) => m.t === "snap");
    const kinds = msgs.map((m) => m.t);
    expect(kinds.indexOf("start")).toBeGreaterThan(-1);
    expect(kinds.indexOf("start")).toBeLessThan(kinds.indexOf("snap"));
    ws.close();
  });

  it("idle lobby keeps state across messages >= 1 s apart", async () => {
    const code = await createRoom();
    const { ws, msgs, waitFor } = await openWs(code, 1);
    ws.send(JSON.stringify(join));
    await waitFor((m) => m.t === "lobby");
    await new Promise((r) => setTimeout(r, 1200));
    ws.send(JSON.stringify({ t: "diff", difficulty: "hard" }));
    await waitFor((m) => m.t === "lobby" && m.difficulty === "hard");
    expect(msgs.some((m) => m.t === "error")).toBe(false);
    ws.close();
  });
});
