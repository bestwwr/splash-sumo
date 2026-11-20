/** Edge entry: HTTP room API + CORS, forwarding WebSocket upgrades to the per-room MatchRoom DO. */
import { PROTOCOL_VERSION, generateRoomCode, normalizeRoomCode } from "@lava-sumo/shared";
import type { MatchRoom } from "./matchRoom";

export { MatchRoom } from "./matchRoom";

export interface Env {
  ROOMS: DurableObjectNamespace<MatchRoom>;
}

const MAX_CLAIM_ATTEMPTS = 5;

const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/bestwwr\.github\.io$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
];

function allowedOrigin(origin: string | null): string | null {
  return origin !== null && ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin)) ? origin : null;
}

function withCors(res: Response, origin: string | null): Response {
  const allowed = allowedOrigin(origin);
  if (allowed === null || res.status === 101) return res;
  const out = new Response(res.body, res);
  out.headers.set("Access-Control-Allow-Origin", allowed);
  out.headers.append("Vary", "Origin");
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function randomCode(): string {
  const buf = new Uint32Array(1);
  return generateRoomCode(() => {
    crypto.getRandomValues(buf);
    return buf[0]! / 0x1_0000_0000;
  });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/health" && request.method === "GET") return json({ ok: true });

  if (path === "/rooms" && request.method === "POST") {
    for (let i = 0; i < MAX_CLAIM_ATTEMPTS; i++) {
      const code = randomCode();
      const res = await env.ROOMS.getByName(code).fetch("http://room/claim", { method: "POST" });
      if (res.status === 200) return json({ code });
    }
    return json({ error: "NO_CODE_AVAILABLE" }, 503);
  }

  const m = /^\/rooms\/([^/]+)(\/ws)?$/.exec(path);
  if (m) {
    const code = normalizeRoomCode(decodeURIComponent(m[1]!));
    if (code === null) return json({ error: "NOT_FOUND" }, 404);
    const stub = env.ROOMS.getByName(code);
    if (m[2]) {
      if (request.method !== "GET" || request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      const v = url.searchParams.get("v") ?? "";
      return stub.fetch(`http://room/ws?v=${encodeURIComponent(v)}&expected=${PROTOCOL_VERSION}`, request);
    }
    if (request.method === "GET") return stub.fetch("http://room/status");
  }

  return json({ error: "NOT_FOUND" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      const allowed = allowedOrigin(origin);
      if (allowed === null) return new Response(null, { status: 204 });
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowed,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") ?? "Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        },
      });
    }
    return withCors(await route(request, env), origin);
  },
} satisfies ExportedHandler<Env>;
