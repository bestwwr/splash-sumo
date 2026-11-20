/** Durable Object adapter: sockets, storage flag and timers around the pure RoomLogic. No game rules here. */
import { DurableObject } from "cloudflare:workers";
import { CONFIG, PROTOCOL_VERSION, type ErrorCode, type ServerMsg } from "@lava-sumo/shared";
import { RoomLogic, type Outgoing } from "./room";

const FLAG_KEY = "room";
const CLOSE_CODE = 4000;
const MAX_MSG_CHARS = 1024;
const IDLE_CHECK_MS = 10_000;

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/**
 * Standard (non-hibernating) WebSockets: the DO stays in memory while any socket is open, so the
 * in-memory RoomLogic is never lost mid-lobby. The storage flag only records that a code is taken.
 */
export class MatchRoom extends DurableObject {
  private logic: RoomLogic | null = null;
  private readonly sockets = new Map<string, WebSocket>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Slow poll so an idle LOBBY/RESULTS room (no tick timer running) still notices it is dead. */
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    // A surviving flag at construction means the DO was evicted and its room is gone: free the code.
    ctx.blockConcurrencyWhile(() => ctx.storage.delete(FLAG_KEY).then(() => undefined));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/claim" && request.method === "POST") {
      if (this.logic) return Response.json({ error: "TAKEN" }, { status: 409 });
      await this.ctx.storage.put(FLAG_KEY, true);
      this.logic = this.newLogic();
      this.sync();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/status") {
      if (!this.logic) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
      const j = this.logic.joinable();
      return j.ok ? Response.json({ ok: true }) : Response.json({ reason: j.code }, { status: 409 });
    }
    if (url.pathname === "/ws") return this.upgrade(url);
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  private upgrade(url: URL): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    if (url.searchParams.get("v") !== String(PROTOCOL_VERSION)) {
      this.closeWith(server, "UPDATE_REQUIRED");
    } else if (!this.logic) {
      this.closeWith(server, "NOT_FOUND"); // safety net: code unknown or room lost after eviction
    } else {
      const conn = crypto.randomUUID();
      this.sockets.set(conn, server);
      server.addEventListener("message", (e: MessageEvent) => this.onMessage(conn, e.data));
      server.addEventListener("close", () => this.onGone(conn));
      server.addEventListener("error", () => this.onGone(conn));
      this.deliver(this.logic.connect(conn, Date.now()));
      this.sync();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(conn: string, data: unknown): void {
    if (!this.logic) return;
    let raw: unknown;
    if (typeof data === "string" && data.length > MAX_MSG_CHARS) {
      const ws = this.sockets.get(conn);
      if (ws) this.dropConn(conn, ws, "BAD_MESSAGE");
      return;
    }
    try {
      raw = typeof data === "string" ? JSON.parse(data) : undefined;
    } catch {
      raw = undefined;
    }
    try {
      this.deliver(this.logic.message(conn, raw, Date.now()));
    } catch {
      this.failConn(conn);
      return;
    }
    this.sync();
  }

  /** Close one conn with BAD_MESSAGE after an unexpected exception, keeping the logic consistent. */
  private failConn(conn: string): void {
    const ws = this.sockets.get(conn);
    if (ws) this.dropConn(conn, ws, "BAD_MESSAGE");
  }

  private dropConn(conn: string, ws: WebSocket, code: ErrorCode): void {
    this.sockets.delete(conn);
    this.closeWith(ws, code);
    try {
      if (this.logic) this.deliver(this.logic.disconnect(conn, Date.now()));
    } catch {
      /* logic is already inconsistent; the timer/destroy path will clean up */
    }
    this.sync();
  }

  private onGone(conn: string): void {
    const ws = this.sockets.get(conn);
    if (!ws) return;
    this.sockets.delete(conn);
    try {
      ws.close(1000);
    } catch {
      /* already closed */
    }
    if (!this.logic) return;
    try {
      this.deliver(this.logic.disconnect(conn, Date.now()));
    } catch {
      this.failAll();
      return;
    }
    this.sync();
  }

  private newLogic(): RoomLogic {
    return new RoomLogic(this.ctx.id.name ?? "????", { random: Math.random, randomSeed }, Date.now());
  }

  private closeWith(ws: WebSocket, code: ErrorCode): void {
    try {
      ws.send(JSON.stringify({ t: "error", code } satisfies ServerMsg));
      ws.close(CLOSE_CODE, code);
    } catch {
      /* already closed */
    }
  }

  private deliver(out: Outgoing[]): void {
    const encoded = new Map<ServerMsg, string>();
    for (const o of out) {
      if ("close" in o) {
        const ws = this.sockets.get(o.close);
        if (ws) {
          this.closeWith(ws, o.code);
          // logic already forgot this conn (kick/replace); drop our handle so the close event is a no-op
          this.sockets.delete(o.close);
        }
        continue;
      }
      const text = encoded.get(o.msg) ?? JSON.stringify(o.msg);
      encoded.set(o.msg, text);
      const targets = o.to === "all" ? [...this.sockets.values()] : [this.sockets.get(o.to)];
      for (const ws of targets) {
        try {
          ws?.send(text);
        } catch {
          /* socket closing */
        }
      }
    }
  }

  /** Start/stop the tick timer and retire the room once logic reports it dead. */
  private sync(): void {
    const logic = this.logic;
    if (logic?.isDead(Date.now())) {
      void this.destroy();
      return;
    }
    if (logic && this.idleTimer === null) this.idleTimer = setInterval(() => this.sync(), IDLE_CHECK_MS);
    const need = logic?.needsTicking() === true;
    if (need && this.timer === null) {
      this.timer = setInterval(() => this.onTick(), CONFIG.TICK_MS);
    } else if (!need && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private onTick(): void {
    const logic = this.logic;
    if (!logic) return this.sync();
    try {
      this.deliver(logic.tick(Date.now()));
      this.sync();
    } catch {
      // Don't loop the same exception at 30 Hz: end the room.
      this.failAll();
    }
  }

  private failAll(): void {
    void this.destroy().catch(() => undefined);
  }

  /** Close every socket (joined or not) and free the room code. */
  async destroy(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    if (this.idleTimer !== null) clearInterval(this.idleTimer);
    this.timer = null;
    this.idleTimer = null;
    this.logic = null;
    const all = [...this.sockets.values()];
    this.sockets.clear();
    for (const ws of all) {
      try {
        ws.close(CLOSE_CODE, "NOT_FOUND");
      } catch {
        /* already closed */
      }
    }
    await this.ctx.storage.delete(FLAG_KEY);
  }
}
