# Online multiplayer (Milestone 2) — design

Status: draft for PO approval · 2026-11-19 · Builds on SPEC §2–3 (architecture, netcode, error handling) and the live solo Quick Play. Replaces SPEC D5 (Colyseus on Fly.io) with Cloudflare Workers + Durable Objects — see §4.

## 1. Intent

Let up to 4 friends play the same Lava Sumo match from their own phones over the internet: one creates a room, shares a code/link, friends join, empty slots are bots. This is the core of the portfolio story ("shipped a real-time multiplayer game to real users"). The PO is in Pittsburgh, USA, tests first with nearby friends, and has friends in Thailand. Hosting must be free.

**Success:** 4 phones on different networks (Wi-Fi + cellular) finish a match together, the floor never desyncs, shoves feel fair, and "Play again" keeps the group together.

## 2. Goals / non-goals / anti-goals

**Goals (this milestone)**
- Private rooms: create → 4-char code + share link → join → lobby → match → results → Play again.
- Server-authoritative match using the existing `packages/shared` simulation unchanged (same `step`, same bots).
- Bots fill empty slots; a disconnected player is driven by a bot for 15 s while they reconnect.
- Runs on Cloudflare's free plan, no card, no machine of the PO's acting as a server.
- Solo Quick Play stays fully client-side and keeps working when the server is down.

**Non-goals (later)**
- Client-side prediction of the local player (SPEC §3.3) — only if testers report lag.
- Public matchmaking with strangers, accounts, friend lists, chat.
- PostHog analytics and Sentry error tracking.
- Automatic server deploys from CI.

**Anti-goals** (would be a failure even if it "works")
- Solo mode breaks or needs the server.
- Desync: two phones show different floors or different winners.
- A player who drops for a moment loses their slot.
- Any hosting bill.

## 3. Constraints

- Reuse the toolchain: pnpm workspace, TypeScript strict, Vitest, Node 26 for tooling.
- `packages/shared` stays pure (no DOM / `Date.now` / `Math.random`); all tuning numbers in `config.ts`. It must also run inside the Workers runtime (it already uses no Node APIs).
- Cloudflare Workers Free plan: Durable Objects must be SQLite-backed; 100,000 requests/day (incoming WebSocket messages count 20:1); exceeding a limit makes further operations fail until 00:00 UTC. Outgoing messages are free.
- The client stays on GitHub Pages (static, HTTPS) → the server must speak `wss://`, and links can't use path routes like `/r/ABCD`. Use `?room=ABCD`.
- The PO creates the Cloudflare account and runs `wrangler login`; Claude does not sign up.

## 4. Approaches (decided)

**Hosting** — considered: (A) Fly.io `iad`, always-on Colyseus, ~$2–5/mo, card required; (B) Render free tier, Colyseus, sleeps after 15 min idle (~1 min wake) and may restart at any time; (C) Cloudflare Workers + Durable Objects, free, no card, one Durable Object per room starting in milliseconds near the players. **Picked: C** — PO wants free hosting and not their own computer; C has no cold-start problem and is close to both Pittsburgh and Thailand. Cost: no Colyseus, so rooms, state sync and reconnection are our own small code (§5.2).

**Netcode** — considered: (1) server authoritative + snapshot interpolation; (2) SPEC §3.3 with local-player prediction; (3) lockstep (server relays inputs, every phone runs `step`). **Picked: 1.** (3) would be tiny on bandwidth but `Math.exp`/`atan2`/`hypot` aren't guaranteed bit-identical across browsers → desync risk (an anti-goal). (2) can be added later: snapshots carry `lastProcessedSeq`.

## 5. Design

### 5.1 Packages
- New `packages/server` (`@lava-sumo/server`): a Cloudflare Worker with one Durable Object class `MatchRoom`; depends on `@lava-sumo/shared`. Config in `wrangler.toml` (SQLite-backed DO migration).
- Room logic is a plain TypeScript class (`room.ts`: lobby, phases, tick, input handling, snapshot building) with no Cloudflare APIs. `MatchRoom` is a thin adapter that wires WebSockets, timers and storage to it. This keeps the logic testable with ordinary Vitest.
- Shared protocol types (message shapes, error codes, `PROTOCOL_VERSION`) in `packages/shared/src/protocol.ts`.

### 5.2 Server
**Worker routes**
- `POST /rooms` → picks a 4-char code (32-char alphabet without ambiguous letters, SPEC §3.8), addresses the DO by `idFromName(code)`, retries if that room is already in use, returns `{code}`.
- `GET /rooms/:code` → `200` joinable · `404` not found · `409 {reason: "full" | "in_progress"}`.
- `GET /rooms/:code/ws?v=<PROTOCOL_VERSION>` → WebSocket upgrade forwarded to the room's DO.
- `GET /health` → `{ok:true}`.
- CORS allows the GitHub Pages origin and localhost.

**`MatchRoom` Durable Object**
- Holds a plain `MatchState`; during COUNTDOWN/PLAYING steps it with `step()` every `TICK_MS` (30 Hz) via a timer, catch-up capped at `MAX_CATCHUP_STEPS`. Seed from `crypto.getRandomValues` at match start. No timer runs in LOBBY/RESULTS, so idle rooms cost nothing (use the WebSocket Hibernation API).
- Each tick: latest input per human, `BotController.input` for bots and for disconnected humans.
- Every 50 ms (20 Hz) sends a `snap` to all sockets: time, phase, players (fields the client renders, numbers rounded), rocks, eruption, sudden death, `lastProcessedSeq` per player, **tile changes since the last snap** (full tile list once at match start), and **the SimEvents produced since the last snap** (so VFX arrive in order with state).
- Phases: LOBBY → COUNTDOWN (3 s, server-timed) → PLAYING → RESULTS. `playAgain` from any human returns the room to LOBBY with everyone still in it.
- Lobby: max 4 humans. Host = first joiner; if the host leaves, the oldest remaining human becomes host. Host sets bot difficulty and taps Start (≥ 1 human). Remaining slots filled with bots at Start (`pickBotSetup`). Lobby changes broadcast as a `lobby` message.
- Joining while COUNTDOWN/PLAYING → `in_progress`; 5th human → `full`.
- Identity: each phone keeps an anonymous player token (random UUID in `localStorage`) sent on join; it's how a reconnecting phone reclaims its slot.
- Reconnection: socket close mid-match → bot drives the slot; same token rejoins within 15 s → control restored; after that the slot stays a bot for the rest of the match. In LOBBY a close removes the player.
- Empty room (no humans) for 30 s → DO clears its state, freeing the code.
- Validation (SPEC §3.7): clamp input vectors, monotonic `seq`, drop messages above 15/s, kick after sustained abuse; nickname via the same rules as `sanitizeNickname`; character and skin checked against known lists; `v` ≠ `PROTOCOL_VERSION` → `UPDATE_REQUIRED`.

**Staying inside the free plan**
- Phones send an input message only when it changes (direction quantized to 2 decimals, skill press/release) and at most 15/s, plus a 1 s keep-alive. A 2-minute, 4-human match then costs a few hundred billed requests → hundreds of matches/day free.
- If Cloudflare rejects requests because the daily limit is hit, the client shows "Online play is busy today — try Quick Play".

### 5.3 Client
- **Refactor first:** split today's `quickPlay.ts` into a reusable *match view* (rendering, HUD, VFX, event handling, results) fed by a *match source*:
  - `LocalSource` — today's local sim + bots (solo, unchanged behavior).
  - `NetSource` — WebSocket: sends inputs (rules above), buffers `snap`s, rebuilds a `MatchState` from them, and exposes `(prev, next, alpha)` at render time ~100 ms behind (`NET_INTERP_DELAY_MS` in config, tunable); forwards events.
  One rendering path, so online matches look exactly like solo.
- **Screens/flow:** Home gets **Play with friends** → *Friends* screen: **Create room** or **Join** (4-char code input) → *Lobby*: room code + Share button (Web Share API, fallback copy link `…/splash-sumo/?room=ABCD`), 4 slots (nickname, fighter, skin, host crown, empty = "Bot"), host-only difficulty picker + Start, everyone can **Leave**. Fighter/skin come from the profile; changing fighter in the lobby is allowed.
- Opening `?room=ABCD` goes straight from the splash to joining that room.
- Results (online): **Play again** (whole room back to lobby) and **Leave**.
- **Errors** shown as friendly messages: not found / full / in progress → "Create your own room"; connection lost → auto-retry with backoff (0.5, 1, 2, 4 s) up to 15 s, then home + toast; `UPDATE_REQUIRED` → reload; server unreachable or over limit → "Online play is down/busy, try Quick Play".
- Server URL from `VITE_SERVER_URL` at build time; in dev it defaults to the local `wrangler dev` address.

### 5.4 Development & deployment
- Dev: `pnpm dev` runs the client (5173) and `wrangler dev` (local emulator, 8787) together; several desktop browser tabs act as players. Phone tests use the deployed Worker.
- Prod: `wrangler deploy` → `https://lava-sumo.<account>.workers.dev`. Server deploys are manual, after PO OK. The Pages workflow builds the client with `VITE_SERVER_URL=wss://lava-sumo.<account>.workers.dev` and keeps deploying on merge to main.

## 6. Testing
- Room-logic unit tests (plain Vitest on `room.ts`): create/join, full / in-progress rejections, host handoff, Start fills bots, match runs to RESULTS, Play again returns to LOBBY, disconnect → bot → reconnect with token restores control, 15 s expiry, input validation and rate limit, version mismatch, snapshot tile deltas rebuild the same tiles.
- Worker/DO integration tests with `@cloudflare/vitest-pool-workers`: `POST /rooms` → WebSocket join → snapshots arrive; 404/409 routes.
- Client tests: `NetSource` interpolation buffer (ordering, gaps, alpha) and state rebuild from snaps, lobby screen rendering, `?room=` routing; existing solo tests still pass.
- Manual: several desktop tabs on `wrangler dev`, then 2–4 phones on the deployed Worker, at least one on cellular.

## 7. Left to the builder
Exact versions of `wrangler` and `@cloudflare/vitest-pool-workers` (pin current stable), snapshot field encoding details, interpolation buffer internals, lobby styling (match existing screens and the `--u` scale), how `pnpm dev` runs both processes.

## 8. Open (not blocking)
- Worker name (default `lava-sumo`).
- Whether a lobby needs a "kick player" button (default: no).
- DECISIONS.md gets a new entry superseding SPEC D5 once this doc is approved.
