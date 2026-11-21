# Online Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Up to 4 friends play one server-authoritative Splash Sumo match from their own phones via a room code, hosted free on Cloudflare Workers + Durable Objects.

**Architecture:** A Worker routes `/rooms` and forwards WebSockets to one `MatchRoom` Durable Object per room code. The DO is a thin adapter around a pure `RoomLogic` class that runs the existing shared `step()` at 30 Hz and emits compact snapshots at 20 Hz. The client's match loop is split into a match *view* fed by a `LocalSource` (solo, unchanged) or a `NetSource` (snapshot interpolation ~100 ms behind).

**Tech Stack:** pnpm workspace, TypeScript strict, Vitest 5, Vite 8, three r187, Cloudflare `wrangler` + `@cloudflare/vitest-pool-workers` (pin current stable).

**Spec:** `docs/superpowers/specs/2026-11-19-online-multiplayer-design.md` (builds on `SPEC.md` §2–3).

## Global Constraints

- `packages/shared` stays pure: no DOM, `Date.now`, `Math.random`, Node or Cloudflare APIs. All tuning numbers in `packages/shared/src/config.ts`.
- Server authoritative; clients never send positions. No client-side prediction this milestone.
- Max 4 humans per room; empty slots become bots at Start via `pickBotSetup`.
- Room code: 4 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 chars, no I/O/0/1).
- Tick 30 Hz (`CONFIG.TICK_MS`), catch-up ≤ `CONFIG.MAX_CATCHUP_STEPS`; snapshots every 50 ms.
- Countdown 3000 ms, server-timed. Reconnect window 15 000 ms. Empty room cleared after 30 000 ms.
- Client inputs: sent only on change (direction quantized to 2 decimals, skill press/release), ≤ 15 msgs/s, plus a keep-alive every 1000 ms. Server drops messages above 15/s per connection and closes a connection that exceeds that for 5 s straight.
- Nickname sanitized with the same rules as client `sanitizeNickname` (move the function to shared).
- Protocol mismatch (`?v=` ≠ `PROTOCOL_VERSION`) → error `UPDATE_REQUIRED`.
- Links: `?room=ABCD` (no path routes; GitHub Pages).
- Solo Quick Play keeps working with no server, and its existing tests stay green.
- **Ruling:** skins are still "soon" in the client (no skin data exists), so the protocol carries no skin field; the spec's skin validation is deferred until skins exist.
- Two environments (spec §5.4): **staging** = Worker `splash-sumo-staging` serving the staging client build (static assets) + game server, same origin, **TEST** badge; **prod** = Worker `splash-sumo` + GitHub Pages client. Build env vars: `VITE_APP_ENV` (`dev`|`staging`|`prod`), `VITE_SERVER_URL` (`self` → `location.origin`; a URL; unset in dev → `http(s)://<hostname>:8787`).
- Staging deploys (`pnpm deploy:staging`) are allowed without asking once the PO has logged in to Cloudflare; **prod** deploys, push, and merge need the PO's explicit OK.
- No push, merge, or prod `wrangler deploy` without the PO's explicit OK. The PO creates the Cloudflare account.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Snapshot gaps / reordering** (dropped or late `snap` on cellular): the client must not jump backwards, freeze, or crash; it holds the last state and resumes. → Task 4 tests.
2. **Phone backgrounded mid-match** (socket closes, phone returns after 5 s): same slot, controlled again, bot moved it meanwhile. → Task 1 + Task 4 tests.
3. **Host leaves the lobby or during a match**: someone else becomes host; Play again still works. → Task 1 tests.
4. **Two tabs on one browser** (same token): the second connection takes over the slot, the first gets `REPLACED` and is closed — no duplicate player. → Task 1 test.
5. **Room code typed lowercase or with spaces** (`ab cd`): normalized to `ABCD`; invalid characters rejected client-side. → Task 5 test.

---

### Task 1: Shared protocol, net config, snapshot codec

**Files:**
- Create: `packages/shared/src/protocol.ts`, `packages/shared/src/snapshot.ts`, `packages/shared/src/nickname.ts`
- Modify: `packages/shared/src/config.ts`, `packages/shared/src/index.ts`, `packages/client/src/meta/profile.ts` (re-export `sanitizeNickname` from shared)
- Test: `packages/shared/test/protocol.test.ts`, `packages/shared/test/snapshot.test.ts`

**Interfaces — Produces:**
- `CONFIG` additions: `NET_SNAP_MS: 50`, `NET_INTERP_DELAY_MS: 100`, `NET_COUNTDOWN_MS: 3000`, `NET_RECONNECT_MS: 15_000`, `NET_EMPTY_ROOM_MS: 30_000`, `NET_MAX_HUMANS: 4`, `NET_INPUT_MAX_PER_SEC: 15`, `NET_INPUT_KEEPALIVE_MS: 1000`, `NET_ABUSE_KICK_MS: 5000`.
- `protocol.ts`: `PROTOCOL_VERSION = 1`; `ROOM_CODE_ALPHABET`; `normalizeRoomCode(raw: string): string | null` (uppercases, strips whitespace, null unless exactly 4 alphabet chars); `generateRoomCode(rand: () => number): string`.
  - `ClientMsg` = `{t:"join", token, nickname, character}` | `{t:"in", seq, dirX, dirZ, skill}` | `{t:"pick", character}` | `{t:"diff", difficulty}` | `{t:"start"}` | `{t:"again"}` | `{t:"leave"}`.
  - `LobbyMember = {id, nickname, character, connected}`.
  - `ServerMsg` = `{t:"welcome", you, code}` | `{t:"lobby", phase, hostId, difficulty, members: LobbyMember[]}` | `StartMsg = {t:"start", seed, setups: PlayerSetup[], countdownMs}` | `{t:"snap", ...Snap}` | `{t:"error", code: ErrorCode}`.
  - `ErrorCode = "UPDATE_REQUIRED" | "FULL" | "IN_PROGRESS" | "NOT_FOUND" | "BAD_MESSAGE" | "REPLACED" | "KICKED"`.
  - `parseClientMsg(raw: unknown): ClientMsg | null` — validates shape and types; clamps `dirX/dirZ` with `clampInput`; rejects unknown characters/difficulties.
- `snapshot.ts`: `Snap = {tick, timeMs, phase, suddenDeath, players: SnapPlayer[], tiles: [index, state, changedAtMs, warnAtMs][], rocks, eruption, events: SimEvent[], result: MatchResult | null}`; `SnapPlayer` holds only dynamic fields (`x z vx vz facing alive fallingMs hitStunMs skillPhase skillPhaseMs skillCooldownMs rockCooldownMs spiritAngle dashDirX dashDirZ eliminatedCause eliminatedAtMs lastProcessedSeq`), numbers rounded to 3 decimals.
  - `encodeSnap(state: MatchState, prevTiles: Tile[] | null, events: SimEvent[]): Snap` — `prevTiles === null` → all tiles; otherwise only tiles whose state/changedAtMs/warnAtMs differ.
  - `applySnap(base: MatchState, snap: Snap): MatchState` — returns a new state (base not mutated) with players' static fields kept from `base`.
- `sanitizeNickname(raw, randomNick)` moves to `nickname.ts` (same behavior); client re-exports it.

- [ ] **Step 1: Write failing tests**
  - `normalizeRoomCode(" ab cd ") === "ABCD"`, `normalizeRoomCode("AB1D") === null`, `normalizeRoomCode("ABCDE") === null`.
  - `generateRoomCode` with a fixed sequence returns 4 alphabet chars; 1000 codes from a seeded RNG all pass `normalizeRoomCode`.
  - `parseClientMsg`: valid `in` passes; `{t:"in", seq:1, dirX:5, dirZ:0, skill:false}` → dirX 1; `dirX: NaN` → 0; `{t:"pick", character:"dragon"}` → null; missing `t` → null; non-object → null.
  - Snapshot round trip: run `createMatch(42, 4 setups)` + 300 `step`s with a scripted input pattern; at every 2nd tick `encodeSnap` (tiles delta vs previous encoded tiles) and `applySnap` onto the client copy; final client players match server players within 0.001 on every `SnapPlayer` field, and tiles match exactly.
  - First snap with `prevTiles === null` has 91 tiles; a snap with no tile changes has `tiles.length === 0`.
  - `JSON.stringify(encodeSnap(...))` for a 4-player mid-match state is < 2500 bytes.
- [ ] **Step 2: Run** `pnpm --filter @splash-sumo/shared test` — expect the new tests to FAIL.
- [ ] **Step 3: Implement** the files above; move `sanitizeNickname`/`defaultRandomNick`-free part to shared (shared takes `randomNick` as a parameter, no `Math.random`).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` — all green (client profile tests still pass).
- [ ] **Step 5: Commit** `feat(shared): net protocol, room codes, snapshot codec`.

---

### Task 2: Pure room logic (`packages/server/src/room.ts`)

**Files:**
- Create: `packages/server/package.json` (`@splash-sumo/server`, scripts `test`, `typecheck`, `dev`, `deploy`), `packages/server/tsconfig.json`, `packages/server/src/room.ts`
- Test: `packages/server/test/room.test.ts`

**Interfaces — Consumes:** Task 1 protocol, snapshot codec, config; shared `createMatch`, `step`, `BotController`, `pickBotSetup`, `sanitizeNickname`.
**Produces:**
```ts
type ConnId = string;
type Outgoing = { to: ConnId | "all"; msg: ServerMsg } | { close: ConnId; code: ErrorCode };
class RoomLogic {
  constructor(code: string, deps: { random: () => number; randomSeed: () => number });
  connect(conn: ConnId, nowMs: number): Outgoing[];          // socket opened (before join)
  message(conn: ConnId, raw: unknown, nowMs: number): Outgoing[];
  disconnect(conn: ConnId, nowMs: number): Outgoing[];
  tick(nowMs: number): Outgoing[];                           // call every ~TICK_MS while needsTicking()
  needsTicking(): boolean;                                   // COUNTDOWN/PLAYING, or a pending reconnect/empty timer
  joinable(): { ok: true } | { ok: false; code: "FULL" | "IN_PROGRESS" };
  isDead(nowMs: number): boolean;                            // no humans for NET_EMPTY_ROOM_MS
}
```
Player id = `p` + slot order of joining (`p1`…`p4`), bots `bot1`…; `token` → player id map for reconnects. Host = earliest joined human still present. Simulation clock advances by fixed `TICK_MS` steps from `nowMs` (accumulator), so tests drive time explicitly.

- [ ] **Step 1: Write failing tests** (drive with a fake clock; assert on `Outgoing[]`):
  - join → `welcome` to that conn + `lobby` to all; nickname sanitized; host = first joiner.
  - 5th distinct token → `{close, code:"FULL"}`; join during COUNTDOWN/PLAYING → `IN_PROGRESS`.
  - same token on a second conn → first conn gets `close REPLACED`, member count unchanged.
  - `diff`/`start` from non-host ignored; `start` from host → `start` msg with 4 setups (humans + bots), phase COUNTDOWN; after 3000 ms of ticks → PLAYING; snaps arrive every 50 ms (±1 tick) and the first has 91 tiles.
  - `in` updates the player's input; stale `seq` (≤ last) ignored; `lastProcessedSeq` in snaps reflects it.
  - host disconnects in lobby → removed, next oldest becomes host; host disconnects mid-match → slot bot-driven, host passes to another connected human.
  - mid-match disconnect → slot driven by a `BotController` (position changes with no input); same token rejoins within 15 000 ms → `welcome` with same `you`, input controls it again; after 15 000 ms → rejoin with that token while PLAYING gets `IN_PROGRESS`.
  - full match with 1 human idle + 3 bots runs to RESULTS; final snap carries `result`; `again` → phase LOBBY, `lobby` broadcast, same members.
  - rate limit: 30 `in` msgs in 1 s → only 15 applied; 5 s of over-limit traffic → `close KICKED`.
  - invalid message → ignored (no throw); `pick` only in LOBBY.
  - all humans gone → `isDead` false at +29 999 ms, true at +30 000 ms.
- [ ] **Step 2: Run** `pnpm --filter @splash-sumo/server test` — FAIL.
- [ ] **Step 3: Implement `RoomLogic`.**
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` — green.
- [ ] **Step 5: Commit** `feat(server): pure room logic (lobby, match loop, reconnect)`.

---

### Task 3: Worker + `MatchRoom` Durable Object

**Files:**
- Create: `packages/server/wrangler.toml` (top level = prod, name `splash-sumo`, no assets; `[env.staging]` name `splash-sumo-staging` with its own DO binding/migration and `assets = { directory = "../client/dist-staging" }` so the Worker serves the staging client and falls through to the API for `/rooms*` and `/health`;  `main = "src/worker.ts"`, DO binding `ROOMS` → class `MatchRoom`, `[[migrations]] new_sqlite_classes = ["MatchRoom"]`, `compatibility_date` = today), `packages/server/src/worker.ts`, `packages/server/src/matchRoom.ts`, `packages/server/vitest.config.ts` (workers pool)
- Modify: root `package.json` (`dev` runs client + `wrangler dev` together via a tiny dependency-free runner or `pnpm -r --parallel dev`; `build:staging` builds the client with `VITE_APP_ENV=staging VITE_SERVER_URL=self` into `packages/client/dist-staging`; `deploy:staging` = `build:staging` + `wrangler deploy --env staging`; `deploy:prod` = `wrangler deploy`)
- Test: `packages/server/test/worker.test.ts`

**Interfaces — Consumes:** `RoomLogic` (Task 2), `generateRoomCode`, `normalizeRoomCode`, `PROTOCOL_VERSION`.
**Produces (HTTP):**
- `POST /rooms` → `200 {code}`; picks a code, asks that DO `/claim` (DO returns 409 if it already holds a live room), retries up to 5 codes.
- `GET /rooms/:code` → `200 {ok:true}` · `404` · `409 {reason:"FULL"|"IN_PROGRESS"}`.
- `GET /rooms/:code/ws?v=N` → 101 upgrade forwarded to the DO; wrong `v` → the socket gets `error UPDATE_REQUIRED` then close.
- `GET /health` → `{ok:true}`. CORS: `https://bestwwr.github.io`, `http://localhost:*`, `http://127.0.0.1:*`, and private LAN `http://192.168.*`/`172.*`/`10.*` origins for dev.
- DO: Hibernation API (`ctx.acceptWebSocket`, `webSocketMessage`, `webSocketClose`); while `logic.needsTicking()` a `setInterval(TICK_MS)` calls `tick(Date.now())` and delivers `Outgoing` (JSON); interval cleared when not needed. Room existence flag kept in DO storage (SQLite KV) so `/claim` and `GET` survive hibernation; cleared when `isDead`. If the DO wakes from hibernation with sockets but no in-memory room, it closes them with `NOT_FOUND`.

- [ ] **Step 1: Write failing tests** with `@cloudflare/vitest-pool-workers` (`SELF.fetch`): `POST /rooms` returns a valid code; `GET` that code → 200; `GET /rooms/ZZZZ` → 404; WebSocket to `/rooms/<code>/ws?v=1`, send `join` → receive `welcome` then `lobby`; `v=999` → `error UPDATE_REQUIRED`; host `start` → `start` then ≥ 1 `snap` within 4 s; `/health` → `{ok:true}`.
- [ ] **Step 2: Run** `pnpm --filter @splash-sumo/server test` — FAIL.
- [ ] **Step 3: Implement** worker, DO, wrangler config, dev script.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`; then `pnpm dev` and `curl -X POST localhost:8787/rooms` → `{code}`.
- [ ] **Step 5: Commit** `feat(server): Cloudflare worker + MatchRoom durable object`.

---

### Task 4: Client match view + sources (refactor, then NetSource)

**Files:**
- Create: `packages/client/src/game/matchView.ts`, `packages/client/src/game/localSource.ts`, `packages/client/src/net/netSource.ts`, `packages/client/src/net/inputSender.ts`
- Modify: `packages/client/src/game/quickPlay.ts` (becomes a thin wrapper: `startQuickPlay` = view + `LocalSource`; same exported signature), `packages/client/src/ui/hud.ts` (results actions become a list so online can show only Play again + Leave)
- Test: `packages/client/test/netSource.test.ts`, `packages/client/test/inputSender.test.ts`, `packages/client/test/localSource.test.ts`

**Interfaces — Produces:**
```ts
interface MatchSource {
  readonly localId: string;
  /** Advance by real frame time; returns events that became visible this frame. */
  advance(frameMs: number, input: InputState): SimEvent[];
  /** States to render between; alpha in [0,1]. */
  frame(): { prev: MatchState; cur: MatchState; alpha: number; renderTimeMs: number };
  countdown(): number | "GO!" | null;     // what the HUD should show
  dispose(): void;
}
function runMatchView(gs, controls, hud, source: MatchSource, opts: {
  subtitle: (r: MatchResult) => string;
  actions: Array<{ id: string; label: string; onClick: () => void }>;
}): { stop(): void };
class LocalSource implements MatchSource { constructor(profile: Profile, seed: number) }
class NetSource implements MatchSource {
  constructor(start: StartMsg, localId: string, send: (m: ClientMsg) => void, nowMs: () => number);
  onSnap(s: Snap, recvMs: number): void;
}
class InputSender { constructor(send, nowMs); update(input: InputState): void } // change-only, quantize 2dp, ≤15/s, keep-alive 1000 ms
```
`NetSource` keeps a buffer of `(serverTimeMs, MatchState)`; render time = newest server time − `NET_INTERP_DELAY_MS`, advanced by real frame time and gently re-synced (±10 %/frame) to the buffer; events are released when render time passes the snap that carried them; countdown derived from `start.countdownMs` and the first snaps.

- [ ] **Step 1: Write failing tests**
  - `LocalSource`: with seed 7 and zero input, 200 frames of 33.3 ms produce the same `MatchState.tick` and player positions as calling `step` directly (proves the refactor kept behavior).
  - `NetSource`: feed snaps at 50 ms spacing; `frame()` interpolates between the two snaps straddling render time (alpha correct to 0.05); out-of-order snap (older tick) ignored; a 500 ms gap holds `cur` at the last snap (alpha 1) with no throw, then resumes; events from a snap are returned exactly once, after render time passes it; tile deltas applied.
  - `InputSender`: identical inputs send nothing until 1000 ms keep-alive; 60 changing inputs in 1 s send ≤ 15; skill press then release both sent even inside the rate window (queued to the next slot); `seq` strictly increases.
  - Existing `setup`, `splash`, `profile`, `catalog` tests still pass.
- [ ] **Step 2: Run** `pnpm --filter @splash-sumo/client test` — FAIL.
- [ ] **Step 3: Implement**: extract rendering/HUD/event code from `quickPlay.ts` into `runMatchView` unchanged; wrap the local loop in `LocalSource`; then `NetSource` and `InputSender`.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm build`; then `pnpm dev`, play one solo match in the browser — identical to before (countdown, eruption, results buttons Play again / Change fighter / Home).
- [ ] **Step 5: Commit** `refactor(client): match view + sources; add NetSource and InputSender`.

---

### Task 5: Online client flow (net client, Friends + Lobby screens, routing)

**Files:**
- Create: `packages/client/src/net/roomClient.ts`, `packages/client/src/ui/screens/friends.ts`, `packages/client/src/ui/screens/lobby.ts`, `packages/client/src/game/onlinePlay.ts`
- Modify: `packages/client/src/ui/screens/home.ts` (add **Play with friends** button), `packages/client/src/main.ts` (routes; `?room=` handling), `packages/client/src/style.css`, `packages/client/src/vite-env.d.ts` (`VITE_SERVER_URL`)
- Test: `packages/client/test/roomClient.test.ts`, `packages/client/test/friends.test.ts`, `packages/client/test/lobby.test.ts`

**Interfaces — Produces:**
- `serverUrl(): {http: string; ws: string}` — `VITE_SERVER_URL === "self"` → `location.origin`; another value → that URL; unset → `http(s)://<location.hostname>:8787`; `ws` swaps the scheme to `ws`/`wss`.
- `VITE_APP_ENV === "staging"` → a small fixed **TEST** badge in a corner on every screen.
- `createRoom(): Promise<string>`; `checkRoom(code): Promise<"ok"|"NOT_FOUND"|"FULL"|"IN_PROGRESS"|"DOWN">`.
- `connectRoom(code, join: {token, nickname, character}, handlers: {onMsg(m: ServerMsg), onState(s: "open"|"reconnecting"|"lost")}): RoomConnection` with `send(m)`, `close()`; auto-reconnect with backoff 500, 1000, 2000, 4000 ms, … until 15 000 ms total, re-sending `join` with the same token.
- Player token: `lavasumo.playerToken` in localStorage (reuse existing `lavasumo.anonId` value if present).
- Friends screen: Create room · Join (4-char input, `normalizeRoomCode`, Join disabled until valid) · Back. Lobby screen: big code, Share (Web Share API, else copy link `<origin><path>?room=CODE` and show "Link copied"), 4 slots (nickname, fighter emoji, 👑 for host, "Bot" for empty, dimmed if disconnected), host-only Easy/Medium/Hard + Start, fighter picker (sends `pick`), Leave.
- `onlinePlay.ts`: on `start` → `runMatchView` with `NetSource`; results actions **Play again** (sends `again`) and **Leave**; on `lobby` with phase LOBBY after results → back to Lobby screen.
- Error copy: NOT_FOUND/FULL/IN_PROGRESS → "Room not available — create your own room"; lost → home + toast "Connection lost"; UPDATE_REQUIRED → `location.reload()`; DOWN → "Online play is down or busy — try Quick Play".
- `?room=ABCD` on load: splash continue → straight to joining that code (then the param is removed with `history.replaceState`).

- [ ] **Step 1: Write failing tests** (happy-dom, fake `fetch`/`WebSocket`):
  - `checkRoom` maps 200/404/409 bodies and network errors to the right result.
  - `serverUrl` for `self` on `https://x.workers.dev` → `{http:"https://x.workers.dev", ws:"wss://x.workers.dev"}`; unset on `http://localhost:5173` → `ws://localhost:8787`.
  - `connectRoom`: socket close → `onState("reconnecting")`, new socket after 500 ms re-sends `join` with same token; no reconnect after 15 s total → `onState("lost")`.
  - Friends: typing `ab cd` enables Join with code `ABCD`; `AB1` keeps it disabled.
  - Lobby: renders 4 slots from a `lobby` msg (2 members + 2 "Bot"), Start and difficulty visible only when `you === hostId`; tapping Medium sends `{t:"diff", difficulty:"medium"}`.
- [ ] **Step 2: Run** client tests — FAIL.
- [ ] **Step 3: Implement**, matching existing screen structure (`create…Screen(root, deps) → {show, hide}`, delegated listeners, `--u` scale).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm build`; then `pnpm dev`, open 3 browser tabs (one per profile via different nicknames / a private window): create, join by code and by `?room=` link, Start, finish a match, Play again, close a tab mid-match and reopen within 15 s.
- [ ] **Step 5: Commit** `feat(client): online rooms — friends, lobby, online match`.

---

### Task 6: Production wiring + docs (deploy only with PO OK)

**Files:**
- Modify: `.github/workflows/pages.yml` (build step env `VITE_APP_ENV: prod`, `VITE_SERVER_URL: ${{ vars.SERVER_URL }}`), `README.md` (how to play with friends, dev commands), `DECISIONS.md` (D-MP-1: Cloudflare Workers + DOs supersede SPEC D5; D-MP-2: interpolation only, no prediction; D-MP-3: no skins in protocol yet), `SPEC.md` (one-line pointer at D5 to D-MP-1)

- [ ] **Step 1:** Make the edits; `pnpm test && pnpm typecheck && pnpm build` green.
- [ ] **Step 2: Commit** `chore: deploy wiring and docs for online play`.
- [ ] **Step 3 (PO):** PO creates the free Cloudflare account and runs `! npx wrangler login`.
- [ ] **Step 4 (staging):** `pnpm deploy:staging` → open `https://splash-sumo-staging.<account>.workers.dev` (TEST badge visible), `curl <url>/health` → `{"ok":true}`; PO + friends test on phones (one on cellular): create, join by link, finish a match, Play again, background a phone for 5 s.
- [ ] **Step 5 (prod, after PO OK):** `pnpm deploy:prod` → `curl https://splash-sumo.<account>.workers.dev/health`; `gh variable set SERVER_URL --body "https://splash-sumo.<account>.workers.dev"`; push branch, open PR (CI green), merge → Pages redeploys; create + join a room on the live site from two phones.
