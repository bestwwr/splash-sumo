# Online multiplayer (Milestone 2) — design

Status: draft for PO approval · 2026-11-19 · Builds on SPEC §2–3 (architecture, netcode, error handling) and the live solo Quick Play.

## 1. Intent

Let up to 4 friends play the same Lava Sumo match from their own phones over the internet: one creates a room, shares a code/link, friends join, empty slots are bots. This is the core of the portfolio story ("shipped a real-time multiplayer game to real users"). The PO is in Pittsburgh, USA, and will test first with nearby friends.

**Success:** 4 phones on different networks (Wi-Fi + cellular) finish a match together, the floor never desyncs, shoves feel fair, and "Play again" keeps the group together.

## 2. Goals / non-goals / anti-goals

**Goals (this milestone)**
- Private rooms: create → 4-char code + share link → join → lobby → match → results → Play again.
- Server-authoritative match using the existing `packages/shared` simulation unchanged (same `step`, same bots).
- Bots fill empty slots; a disconnected player is driven by a bot for 15 s while they reconnect.
- Works first against a server on the PO's Mac (same Wi-Fi), then on Fly.io `iad`.
- Solo Quick Play stays fully client-side and keeps working when the server is down.

**Non-goals (later)**
- Client-side prediction of the local player (SPEC §3.3) — added only if testers far from `iad` report lag.
- Public matchmaking with strangers, accounts, friend lists, chat.
- PostHog analytics and Sentry error tracking.
- Singapore (`sin`) or other regions.

**Anti-goals** (would be a failure even if it "works")
- Solo mode breaks or needs the server.
- Desync: two phones show different floors or different winners.
- A player who drops for a moment loses their slot.
- Monthly cost above ~$5 at this scale.

## 3. Constraints

- Reuse the toolchain: pnpm workspace, TypeScript strict, Vitest, Node 26.
- `packages/shared` stays pure (no DOM / `Date.now` / `Math.random`); all tuning numbers in `config.ts`.
- The client is hosted on GitHub Pages (static, HTTPS) → the production server must speak `wss://`, and links can't use path routes like `/r/ABCD` (Pages would 404). Use `?room=ABCD`.
- Fly.io account + card are created by the PO; Claude does not sign up or enter payment details.

## 4. Approaches (decided)

**Hosting** — considered: (A) Fly.io `iad`, always-on, ~$2–5/mo; (B) Render free tier, sleeps after 15 min idle (~1 min wake); (C) PO's Mac, same Wi-Fi only. **Picked: C for development, then A for public play.** `iad` (Ashburn, VA) is ~15–25 ms from Pittsburgh. B's cold start kills a party game.

**Netcode** — considered: (1) server authoritative + snapshot interpolation for everyone; (2) SPEC §3.3 full version with local-player prediction + reconciliation. **Picked: 1.** At ~20 ms RTT the gain from prediction is small and it's the most bug-prone part; the design keeps `lastProcessedSeq` in state so prediction can be added later without protocol changes.

**Server framework** — Colyseus (SPEC D5): rooms, delta state sync, reconnection built in.

## 5. Design

### 5.1 Packages
- New `packages/server` (`@lava-sumo/server`): Node + Colyseus, depends on `@lava-sumo/shared`.
- `packages/client` gains a network client (`colyseus.js`) and online screens.
- Shared protocol types (message names, join options, error codes, `PROTOCOL_VERSION`) live in `packages/shared/src/protocol.ts` so client and server can't drift.

### 5.2 Server: `MatchRoom`
- Holds a plain `MatchState` from `createMatch` and steps it with `step()` every `TICK_MS` (30 Hz); catch-up capped at `MAX_CATCHUP_STEPS` (SPEC §3.7). Seed from `crypto.randomInt` at match start.
- Each tick: latest input per human, `BotController.input` for bots and for disconnected humans.
- Mirrors the plain state into a Colyseus schema (SPEC §3.2 shape, small numeric types) each tick; `patchRate = 50` ms (20 Hz). Tiles sync as an array; they change rarely.
- Broadcasts each `SimEvent` from `step` as a message (VFX/HUD only, not authority).
- Phases: LOBBY → COUNTDOWN (3 s, server-timed) → PLAYING → RESULTS. `playAgain` from any human returns the room to LOBBY with everyone still in it.
- Lobby: max 4 humans. Host = first joiner; if the host leaves, the oldest remaining human becomes host. Host sets bot difficulty and taps Start (≥ 1 human). Remaining slots filled with bots at Start (`pickBotSetup`).
- Joining while COUNTDOWN/PLAYING → rejected `IN_PROGRESS`; 5th human → `ROOM_FULL`.
- Room codes: 4 chars from a 32-char alphabet without ambiguous letters (SPEC §3.8), stored in a process-memory map code → roomId; freed on dispose. Empty room disposes after 30 s.
- HTTP: `GET /health` → `{ok, rooms, ccu}`; `GET /rooms/:code` → `{roomId}` / 404 / 409.
- Validation (SPEC §3.7): clamp input vectors, monotonic `seq`, drop > 40 msgs/s, nickname via the same rules as `sanitizeNickname`, character and skin checked against the known lists, `clientVersion` ≠ `PROTOCOL_VERSION` → `UPDATE_REQUIRED`.
- Reconnection: `allowReconnection(client, 15)`; bot drives the slot meanwhile; after expiry the slot stays a bot for the rest of the match.
- Graceful shutdown: on SIGTERM stop creating rooms, let matches finish (≤ 120 s), then exit.

### 5.3 Client
- **Refactor first:** split today's `quickPlay.ts` into a reusable *match view* (rendering, HUD, VFX, event handling, results) fed by a *match source*. Two sources:
  - `LocalSource` — today's local sim + bots (solo, unchanged behavior).
  - `NetSource` — Colyseus room: sends `input` every tick, buffers server snapshots, exposes `(prev, next, alpha)` at render time ~100 ms behind (`NET_INTERP_DELAY_MS` in config, tunable), forwards event messages.
  This keeps one rendering path, so online matches look exactly like solo.
- **Screens/flow:** Home gets **Play with friends** → *Friends* screen: **Create room** or **Join** (4-char code input) → *Lobby*: room code + Share button (Web Share API, fallback copy link `…/splash-sumo/?room=ABCD`), 4 slots (nickname, fighter, skin, host crown, empty = "Bot"), host-only difficulty picker + Start, everyone can **Leave**. Fighter/skin come from the player's profile; changing fighter in the lobby is allowed (`selectCharacter`).
- Opening `?room=ABCD` skips the splash tap target straight to the join flow for that code.
- Results (online): **Play again** (back to lobby for the whole room) and **Leave**; no "change fighter" (do it in the lobby).
- **Errors** shown as friendly messages: not found / full / in progress → "Create your own room"; connection lost → auto-retry with backoff (0.5, 1, 2, 4 s) up to 15 s, then home + toast; `UPDATE_REQUIRED` → reload; server unreachable → "Online play is down, try Quick Play".
- Server URL: `VITE_SERVER_URL` at build time; in dev it defaults to `ws://<page hostname>:2567`, so phones on the Wi-Fi reach the Mac's server.

### 5.4 Deployment
- Dev: `pnpm dev` runs client (5173) and server (2567) together.
- Prod: `packages/server/Dockerfile` + `fly.toml` (app in `iad`, 1 × shared-cpu-1x 256 MB, health check `/health`, always 1 machine running). Client built with `VITE_SERVER_URL=wss://<app>.fly.dev` in the Pages workflow.
- Server deploys are manual (`fly deploy`) after PO OK; the Pages workflow keeps deploying the client on merge to main.

## 6. Testing
- Server unit tests (Vitest + `@colyseus/testing`): create/join by code, full / in-progress rejections, host handoff, Start fills bots, match runs to RESULTS, Play again returns to LOBBY, disconnect → bot → reconnect restores control, input validation and rate limit, version mismatch.
- Determinism check: a server match and a local `step` replay of the same seed + recorded inputs produce the same result.
- Client tests: `NetSource` interpolation buffer (ordering, gaps, alpha), lobby screen rendering, `?room=` routing; existing solo tests still pass.
- Manual: 2–4 phones on the Mac server (Wi-Fi), then on Fly with at least one phone on cellular.

## 7. Left to the builder
Exact Colyseus/`colyseus.js` versions (pin current stable), schema class layout details, interpolation buffer internals, lobby styling (match existing screens and `--u` scale), Docker base image, how `pnpm dev` runs both processes.

## 8. Open (not blocking)
- Fly app name (default `lava-sumo`) — PO picks when creating the account.
- Whether a lobby needs a "kick player" button (default: no).
