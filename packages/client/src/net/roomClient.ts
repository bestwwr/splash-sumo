/** Online room client: REST helpers + a WebSocket that auto-reconnects and re-sends `join`. */
import { CONFIG, PROTOCOL_VERSION, type CharacterId, type ClientMsg, type ServerMsg } from "@lava-sumo/shared";

export function serverUrl(
  env: string | undefined = import.meta.env.VITE_SERVER_URL,
  loc: { origin: string; protocol: string; hostname: string } = location,
): { http: string; ws: string } {
  let http: string;
  if (env === "self") http = loc.origin;
  else if (env) http = env.replace(/\/+$/, "");
  else http = `${loc.protocol}//${loc.hostname}:8787`;
  return { http, ws: http.replace(/^http/, "ws") };
}

const TOKEN_KEY = "lavasumo.playerToken";
const ANON_KEY = "lavasumo.anonId";

/** Stable per-browser identity for rejoining; reuses the analytics anon id when present. */
export function playerToken(): string {
  try {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
      t = localStorage.getItem(ANON_KEY) ?? crypto.randomUUID?.() ?? String(Math.random()).slice(2);
      t = t.slice(0, 64);
      localStorage.setItem(TOKEN_KEY, t);
    }
    return t;
  } catch {
    return (crypto.randomUUID?.() ?? String(Math.random()).slice(2)).slice(0, 64);
  }
}

/** fetch with a timeout that also works under fake timers (AbortSignal.timeout does not). */
async function fetchTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CONFIG.NET_HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function createRoom(): Promise<string> {
  const res = await fetchTimeout(`${serverUrl().http}/rooms`, { method: "POST" });
  if (!res.ok) throw new Error(`createRoom ${res.status}`);
  const body = (await res.json()) as { code?: unknown };
  if (typeof body.code !== "string") throw new Error("createRoom: bad body");
  return body.code;
}

export type RoomCheck = "ok" | "NOT_FOUND" | "FULL" | "IN_PROGRESS" | "DOWN";

export async function checkRoom(code: string): Promise<RoomCheck> {
  try {
    const res = await fetchTimeout(`${serverUrl().http}/rooms/${encodeURIComponent(code)}`);
    if (res.status === 200) return "ok";
    if (res.status === 404) return "NOT_FOUND";
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { reason?: string };
      return body.reason === "FULL" ? "FULL" : "IN_PROGRESS";
    }
    return "DOWN";
  } catch {
    return "DOWN";
  }
}

export interface JoinInfo {
  token: string;
  nickname: string;
  character: CharacterId;
}
export type ConnState = "open" | "reconnecting" | "lost";
export interface RoomHandlers {
  onMsg(m: ServerMsg): void;
  onState(s: ConnState): void;
}
export interface RoomConnection {
  send(m: ClientMsg): void;
  close(): void;
}

const BACKOFF_MS = [500, 1000, 2000, 4000];
const GIVE_UP_MS = 15_000;
/** Server errors after which retrying cannot help. */
const TERMINAL = new Set(["REPLACED", "KICKED", "FULL", "IN_PROGRESS", "NOT_FOUND", "UPDATE_REQUIRED"]);

export function connectRoom(code: string, join: JoinInfo, handlers: RoomHandlers): RoomConnection {
  const url = `${serverUrl().ws}/rooms/${encodeURIComponent(code)}/ws?v=${PROTOCOL_VERSION}`;
  let ws: WebSocket | null = null;
  let closed = false;
  let terminal = false;
  let attempt = 0;
  let deadline = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function open() {
    const sock = new WebSocket(url);
    ws = sock;
    let done = false;
    // A socket that never opens would otherwise hang the UI: treat it like any other drop.
    const connectTimer = setTimeout(() => {
      if (ws !== sock || sock.readyState === 1) return;
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      onDown();
    }, CONFIG.NET_CONNECT_TIMEOUT_MS);
    sock.onopen = () => {
      if (ws !== sock) return;
      clearTimeout(connectTimer);
      attempt = 0;
      deadline = 0;
      sock.send(JSON.stringify({ t: "join", ...join }));
      handlers.onState("open");
    };
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      let m: ServerMsg;
      try {
        m = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      if (m.t === "error" && TERMINAL.has(m.code)) terminal = true;
      handlers.onMsg(m);
    };
    sock.onclose = () => onDown();
    function onDown() {
      clearTimeout(connectTimer);
      if (done) return;
      done = true;
      if (ws !== sock || closed || terminal) return;
      if (deadline === 0) deadline = Date.now() + GIVE_UP_MS;
      const left = deadline - Date.now();
      if (left <= 0) {
        handlers.onState("lost");
        return;
      }
      handlers.onState("reconnecting");
      const delay = Math.min(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!, left);
      attempt++;
      timer = setTimeout(open, delay);
    }
  }
  open();

  return {
    send(m) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* already closed */
      }
    },
  };
}
