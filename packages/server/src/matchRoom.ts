/** Durable Object adapter: sockets, storage flag and timers around the pure RoomLogic. No game rules here. */
import { DurableObject } from "cloudflare:workers";
import { CONFIG, PROTOCOL_VERSION, type ErrorCode, type ServerMsg } from "@lava-sumo/shared";
import { RoomLogic, type Outgoing } from "./room";

const FLAG_KEY = "room";
const CLOSE_CODE = 4000;

interface Attachment {
  conn: string;
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

export class MatchRoom extends DurableObject {
  private logic: RoomLogic | null = null;
  private exists = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.blockConcurrencyWhile(async () => {
      this.exists = (await ctx.storage.get<boolean>(FLAG_KEY)) === true;
      // Woke from hibernation: in-memory room state is gone, so any surviving sockets are orphans.
      const orphans = ctx.getWebSockets();
      if (orphans.length > 0) {
        for (const ws of orphans) this.closeWith(ws, "NOT_FOUND");
        await this.destroy();
      }
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/claim" && request.method === "POST") {
      if (this.exists) return Response.json({ error: "TAKEN" }, { status: 409 });
      this.exists = true;
      await this.ctx.storage.put(FLAG_KEY, true);
      this.logic = this.newLogic();
      this.sync();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/status") {
      if (!this.exists) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
      const j = this.room().joinable();
      return j.ok ? Response.json({ ok: true }) : Response.json({ reason: j.code }, { status: 409 });
    }
    if (url.pathname === "/ws") return this.upgrade(url);
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  private upgrade(url: URL): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    if (url.searchParams.get("v") !== String(PROTOCOL_VERSION)) {
      this.closeWith(server, "UPDATE_REQUIRED");
    } else if (!this.exists) {
      this.closeWith(server, "NOT_FOUND");
    } else {
      const conn = crypto.randomUUID();
      server.serializeAttachment({ conn } satisfies Attachment);
      this.deliver(this.room().connect(conn, Date.now()));
      this.sync();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const conn = this.connOf(ws);
    if (conn === null) return;
    if (!this.exists) return this.closeWith(ws, "NOT_FOUND");
    let raw: unknown;
    try {
      raw = typeof message === "string" ? JSON.parse(message) : undefined;
    } catch {
      raw = undefined;
    }
    this.deliver(this.room().message(conn, raw, Date.now()));
    this.sync();
  }

  override webSocketClose(ws: WebSocket): void {
    this.dropSocket(ws);
  }

  override webSocketError(ws: WebSocket): void {
    this.dropSocket(ws);
  }

  // ---- internals ----

  private dropSocket(ws: WebSocket): void {
    const conn = this.connOf(ws);
    try {
      ws.close(1000);
    } catch {
      /* already closed */
    }
    if (conn === null || !this.logic) return;
    this.deliver(this.logic.disconnect(conn, Date.now()));
    this.sync();
  }

  private newLogic(): RoomLogic {
    return new RoomLogic(this.ctx.id.name ?? "????", { random: Math.random, randomSeed }, Date.now());
  }

  /** The in-memory room, recreated empty if the flag survived an eviction. */
  private room(): RoomLogic {
    return (this.logic ??= this.newLogic());
  }

  private connOf(ws: WebSocket): string | null {
    return (ws.deserializeAttachment() as Attachment | null)?.conn ?? null;
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
    if (out.length === 0) return;
    const sockets = this.ctx.getWebSockets();
    const byConn = new Map<string, WebSocket>();
    for (const ws of sockets) {
      const c = this.connOf(ws);
      if (c !== null) byConn.set(c, ws);
    }
    const encoded = new Map<ServerMsg, string>();
    for (const o of out) {
      if ("close" in o) {
        const ws = byConn.get(o.close);
        if (ws) this.closeWith(ws, o.code);
        continue;
      }
      const text = encoded.get(o.msg) ?? JSON.stringify(o.msg);
      encoded.set(o.msg, text);
      const targets = o.to === "all" ? byConn.values() : [byConn.get(o.to)];
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
    this.deliver(logic.tick(Date.now()));
    this.sync();
  }

  private async destroy(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.logic = null;
    this.exists = false;
    await this.ctx.storage.delete(FLAG_KEY);
  }
}
