# Splash Sumo — System Design Spec (MVP / Phase B)

> Paste into the repo root as `SPEC.md` and point Claude Code at it.
> Owner: Weerawish (Ben), Product Owner · Builder: Claude Code in Cursor · Status: decisions **locked** unless marked *Open*.

**Document map**
0. Instructions for Claude Code
1. Requirements (functional · non-functional · constraints)
2. High-level design (components · data flow · API contracts · storage)
3. Deep dive (simulation · data model · messages · caching · events · error handling)
4. Scale & reliability (load estimate · scaling · failover · monitoring)
5. Trade-off analysis (decision records)
6. What to revisit as the system grows
7. Delivery plan (8 weeks)
- Appendix A — Game rules & tuning reference
- Appendix B — Analytics event catalog

---

## 0. Instructions for Claude Code

1. Read the whole spec first. Sections 1 and Appendix A are **requirements**; Section 5 explains *why* — don't reverse a decision without writing the reason in `DECISIONS.md`.
2. Build **milestone by milestone** (Section 7). Don't start the next milestone until the current acceptance criteria pass.
3. `packages/shared` is **pure** simulation: no DOM, no network, no `Date.now()` (time is passed in), no `Math.random()` (use seeded RNG). Client and server both import it.
4. TypeScript everywhere, `strict: true`. All tuning numbers live in `packages/shared/src/config.ts`.
5. Write unit tests for shared logic (hex math, collisions, collapse schedule, skills) from Milestone 1.
6. After each milestone: run it, update tests, summarize what changed, list assumptions made.
7. If ambiguous: choose the simplest option that keeps the game fun on a phone; log it in `DECISIONS.md`.

---

## 1. Requirements

### 1.1 Product context
**Splash Sumo** is a mobile-first, browser-based, online **party battle royale**. Up to 4 players stand on basalt rock tiles inside a volcano crater; the floor cracks and melts into the lava tile by tile. Players **shove each other into the lava** by running into them. **Last one standing wins.**
Universal theme (no country-specific references) so international players get it instantly.

Pitch: *"Sumo in a volcano — 90-second matches, one thumb, send a link and play."*
Inspirations: King of Opera (shove off a stage), Fall Guys Hex-A-Gone (collapsing floor), sumo (push out of the ring).

**Phasing**: A (learning prototype) → **B (this spec: online portfolio MVP)** → C (commercial, only if the Phase-C gate in 1.3 passes).
**Portfolio story** (audience: PM recruiters in tech/AI): *a Product Owner used AI coding agents to ship a real-time multiplayer game to real users and made decisions from data.*

### 1.2 Functional requirements

| ID | Requirement |
|---|---|
| F1 | Player opens a link on a phone browser, enters a nickname (no sign-up), and reaches the home screen in ≤ 2 taps |
| F2 | **Play vs Bots**: solo player + 3 bots; choose Easy / Medium / Hard |
| F3 | **Private Room**: host creates a room → gets a shareable link `/r/ABCD` and a 4-char code; up to 4 humans join; host starts; empty slots filled by bots (host picks difficulty, default Medium) |
| F4 | Character select: **Elephant / Monkey / Turtle**, each with stats (Power / Agility / Endurance) and one skill |
| F5 | Match: 4 players on a hex arena; floor collapses (edge shrink + random tiles + one Eruption event + sudden death at 90 s); shove by collision; fall into lava = eliminated |
| F6 | Eliminated players become ember spirits that can **throw lava rocks** (small knockback, no direct kill) |
| F7 | Results screen with placement and cause of elimination; **Play again** keeps the same room |
| F8 | Controls: floating joystick (left) + one skill button (right); keyboard fallback on desktop (WASD/arrows + Space) |
| F9 | Reconnect to an in-progress match within 15 s; otherwise a bot takes over the slot |
| F10 | Analytics events (Appendix B) are captured for every session and match |

Full rules and tuning values: **Appendix A**.

### 1.3 Non-functional requirements

| Category | Target |
|---|---|
| Frame rate | **60 fps** on a mid-range phone (e.g. iPhone 12 / Pixel 6a); never below 30 fps |
| First load | Playable in **≤ 5 s on 4G**; initial JS + assets **≤ 5 MB** (compressed) |
| Network feel | Smooth at **≤ 120 ms RTT**; playable up to 200 ms |
| Bandwidth | ≤ **5 KB/s down per client**, ≤ 1.5 KB/s up |
| Server tick | Simulation **30 Hz**; tick compute p95 **< 5 ms** per room |
| Fairness | Server is the only authority on collisions, tiles, and eliminations |
| Availability | Best effort (~99% during launch weeks); a server restart may drop live matches but clients recover to the home screen gracefully |
| Privacy | No personal data beyond nickname + anonymous analytics ID; no accounts |
| Cost | **≤ $20/month** during Phase B |
| Accessibility | Danger cues use **shake + crack pattern + color** (not color alone); haptics where supported |

**Phase C gate** (within 4 weeks of public launch): ≥ 300 unique players · rematch rate ≥ 40% · ≥ 3 matches/session · D7 retention ≥ 10%.

### 1.4 Constraints
- **Team**: 1 Product Owner + AI coding agent (Claude Code in Cursor). No dedicated engineer or artist.
- **Time**: 8 weeks × 8–10 h/week, alongside a full-time MBA.
- **Budget**: free tiers + one small server.
- **Players**: soft launch spans the **US (Pittsburgh, international classmates) and Thailand** → latency matters.
- **Assets**: CC0 low-poly packs (Kenney, Quaternius), AI-assisted concept/UI, free SFX.

### 1.5 Explicit non-goals (MVP)
Accounts/login · friends list · progression · monetization/cosmetics · items/power-ups · public matchmaking (*Open*) · > 3 characters · > 1 arena · native app builds · ML bots.

---

## 2. High-level design

### 2.1 Component diagram

```
                    ┌──────────────────────────────────────────┐
                    │          Player's phone browser          │
                    │                                          │
                    │  ┌──────────┐  ┌──────────┐  ┌────────┐  │
                    │  │  Input   │→ │ Predict  │→ │Render  │  │
                    │  │joystick/ │  │(shared   │  │Three.js│  │
                    │  │keyboard  │  │ sim)     │  │ + HUD  │  │
                    │  └────┬─────┘  └────▲─────┘  └───▲────┘  │
                    │       │ inputs      │ reconcile  │interp. │
                    │  ┌────▼─────────────┴────────────┴─────┐  │
                    │  │     Net client (Colyseus JS)         │  │
                    │  └────┬──────────────────────────▲─────┘  │
                    │       │            ┌──────────┐  │        │
                    │       │            │Analytics │──┼──────┐ │
                    │       │            │(PostHog) │  │      │ │
                    └───────┼────────────┴──────────┴──┼──────┼─┘
             static assets  │ WebSocket (wss)          │      │ HTTPS
   ┌───────────────┐        │                          │      ▼
   │ CDN / static  │◄─ HTTPS (first load, cached)      │  ┌──────────┐
   │ host (Vercel /│                                   │  │ PostHog  │
   │ CF Pages)     │                                   │  │ (SaaS)   │
   └───────────────┘        │                          │  └──────────┘
                    ┌───────▼──────────────────────────┴───────────┐
                    │      Game server (Node + Colyseus) on Fly.io │
                    │                                              │
                    │  ┌────────────┐   ┌──────────────────────┐   │
                    │  │ HTTP API   │   │ MatchRoom (1 per     │   │
                    │  │ /health    │   │ match, in memory)    │   │
                    │  │ /rooms/:code│  │  ├ shared sim @30 Hz │   │
                    │  └────────────┘   │  ├ BotController ×N  │   │
                    │  ┌────────────┐   │  ├ state sync @20 Hz │   │
                    │  │ Matchmaker │──►│  └ event emitter     │   │
                    │  │ (Colyseus) │   └──────────────────────┘   │
                    │  └────────────┘   errors → Sentry            │
                    └──────────────────────────────────────────────┘
```

### 2.2 Components & responsibilities

| Component | Responsibility | Tech |
|---|---|---|
| `packages/shared` | Deterministic game simulation: hex grid, physics, collapse, characters, skills, config, seeded RNG | TypeScript (pure) |
| Client — Input | Floating joystick, skill button, keyboard; produces `{dirX, dirZ, skill}` | DOM pointer events |
| Client — Net | Join/create rooms, send inputs, receive state, reconnection | `colyseus.js` |
| Client — Prediction | Runs shared sim for the **local player's movement**; reconciles with server snapshots | shared |
| Client — Render | Scene, isometric camera, instanced hex tiles, lava shader, characters, VFX, HUD | Three.js, CSS overlay |
| Client — Analytics | Fire events from Appendix B | `posthog-js` |
| Server — Matchmaker | Create rooms, map 4-char codes → room IDs, enforce max 4 clients | Colyseus |
| Server — MatchRoom | Authoritative loop, phases (lobby → countdown → playing → results), bots, events | Colyseus Room |
| Server — Bots | Generate inputs per difficulty from game state | TypeScript (utility AI) |
| Static host | Serve hashed assets + PWA manifest/service worker | Vercel / Cloudflare Pages |
| Observability | Errors (Sentry), server metrics (Fly), product metrics (PostHog) | SaaS free tiers |

### 2.3 Data flow — one match

```
Host taps "Create Room"
  → client.create("match", {mode:"private", nickname, character})
  ← roomId + roomCode "ABCD"  → Web Share API sends /r/ABCD

Friend opens /r/ABCD
  → GET /rooms/ABCD → roomId   → client.joinById(roomId, {...})

Host taps Start → phase=countdown (3 s) → phase=playing, seed chosen

Every client frame (~60 Hz):  read input → predict local movement → render
Every 33 ms (client):          send "input" {seq, dirX, dirZ, skill}
Every 33 ms (server tick):     apply latest input per player (bots too)
                               → sim.step(dt) → collisions / tiles / eliminations
                               → emit events (hit, eliminated, eruption...)
Every 50 ms (server patch):    Colyseus delta-syncs state to all clients
Client:                         others = interpolate 100 ms behind
                               self   = reconcile to last acked input seq

Last survivor → phase=results → server sends matchEnd → clients fire analytics
"Play again" → back to lobby in same room
```

### 2.4 API contracts

**HTTP (game server)**

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `200 {"ok":true,"rooms":n,"ccu":n}` |
| GET | `/rooms/:code` | `200 {"roomId":"..."}` · `404` not found · `409` room full or match in progress |

**Colyseus room `match` — join/create options**
```ts
type CreateOptions = {
  mode: "bots" | "private";
  nickname: string;            // 1–12 chars, filtered
  character: "elephant" | "monkey" | "turtle";
  botDifficulty?: "easy" | "medium" | "hard"; // default "medium"
  clientVersion: string;       // reject if incompatible
};
type JoinOptions = Omit<CreateOptions, "mode" | "botDifficulty">;
```

**Client → server messages**

| Type | Payload | Rules |
|---|---|---|
| `input` | `{seq:number, dirX:number, dirZ:number, skill:boolean}` | Vector clamped to length ≤ 1; max 40 msgs/s; `seq` monotonic |
| `selectCharacter` | `{character}` | Lobby phase only |
| `setBotDifficulty` | `{difficulty}` | Host only, lobby phase |
| `start` | `{}` | Host only, ≥ 1 human |
| `playAgain` | `{}` | Results phase |

**Server → client**
- **State sync** (automatic, Colyseus schema — see 3.2).
- **Event messages** (for VFX/SFX/analytics, not authority):
  `hit {attackerId, victimId, strength}` · `eliminated {playerId, cause, byId?}` · `eruptionIncoming {targets:[{q,r}], impactAtMs}` · `skillUsed {playerId, skill}` · `lavaRockThrown {fromId, targetX, targetZ, landAtMs}` · `matchEnd {placements:[{playerId, place, cause}]}` · `error {code, message}`

### 2.5 Storage choices

| Data | Where | Why |
|---|---|---|
| Live match state | **Server memory** (Colyseus room) | Short-lived (≤ 2 min), latency-critical |
| Room code → roomId | **Server memory** map (single process) | Only valid while the room exists |
| Player identity | `localStorage`: nickname + anonymous UUID | No accounts needed in MVP |
| Analytics | **PostHog** | Funnels, retention, dashboards out of the box |
| Errors | **Sentry** | Stack traces from client + server |
| Static assets | CDN | Cached, hashed filenames |

**No database in Phase B.** (Revisit in Section 6.)

---

## 3. Deep dive

### 3.1 Simulation design (`packages/shared`)

- **Model**: gameplay physics on the **XZ plane as circles** (custom, deterministic). The 3D scene is visual only; vertical motion is just falling/sinking animation.
- **Fixed timestep**: `step(state, inputs, dtMs = 33.33)` → new state + list of events. Pure function.
- **Order per tick**: apply inputs → update skills/cooldowns → integrate velocity → resolve player-player collisions (shove) → apply event impulses (eruption, lava rocks) → update tile states → check support/eliminations → check win.
- **Determinism**: seeded RNG (e.g. mulberry32) for collapse and eruption; same seed + same inputs = same result (lets us replay bugs from logs).
- **Hex grid**: axial coordinates `(q, r)`, radius 5 (91 tiles); point-in-hex lookup for "is the player supported?".
- **Shove formula** (both directions per collision):
  `impulse = BASE_KNOCK × powerMult(A) × max(closingSpeed, MIN_SPEED) / enduranceMult(B)` + 0.15 s hit-stun on the receiver.

### 3.2 Data model (Colyseus schema)

```ts
class Tile extends Schema {
  @type("int8")   q; @type("int8") r;
  @type("uint8")  state;            // 0 SOLID,1 WARNING,2 SINKING,3 GONE
  @type("uint32") changedAtMs;
}
class Player extends Schema {
  @type("string")  id; @type("string") nickname;
  @type("uint8")   character;       // 0 elephant,1 monkey,2 turtle
  @type("uint8")   slot;            // 0–3 → color
  @type("boolean") isBot; @type("boolean") alive; @type("boolean") connected;
  @type("float32") x; @type("float32") z; @type("float32") vx; @type("float32") vz;
  @type("float32") facing;
  @type("uint16")  skillCooldownMs; @type("uint16") skillActiveMs; @type("uint16") hitStunMs;
  @type("uint16")  lavaRockCooldownMs;
  @type("uint32")  lastProcessedSeq; // for client reconciliation
  @type("uint8")   eliminatedCause;  // 0 none,1 shove,2 floor,3 eruption,4 lava_rock
  @type("uint32")  eliminatedAtMs;
}
class MatchState extends Schema {
  @type("uint8")  phase;            // 0 lobby,1 countdown,2 playing,3 results
  @type("string") roomCode; @type("string") hostId;
  @type("uint8")  botDifficulty; @type("uint32") seed; @type("uint32") timeMs;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type([ Tile ])        tiles   = new ArraySchema<Tile>();
}
```
Use small numeric types to keep patches small (tiles change rarely, so their delta cost is near zero).

### 3.3 Netcode strategy
- **Authority**: server for everything gameplay-relevant.
- **Remote players**: snapshot interpolation, 100 ms buffer.
- **Local player**: client-side prediction of movement only; on each snapshot, rewind to server position at `lastProcessedSeq`, replay unacked inputs; if error > 0.5 m, snap with a short blend.
- **Knockback/hits** always come from the server (no client prediction of collisions) → the "bonk" may feel ~1 RTT late; hide it with an instant local squash animation + sound on contact.
- **Tick vs patch**: simulate 30 Hz, send patches at 20 Hz (Colyseus `patchRate = 50`).

### 3.4 Bots
- Run **inside the MatchRoom**, produce the same `input` struct as humans → simulation treats them identically.
- Utility AI: score candidate move directions on (distance from edge, tiles about to sink, enemy near edge, threats like Elephant wind-up); pick the best with difficulty-based noise.

| Difficulty | Reaction delay | Behavior |
|---|---|---|
| Easy | 600 ms | Wanders, leaves warning tiles late, rarely uses skill |
| Medium | 300 ms | Avoids warning tiles, holds center, charges players near the edge, uses skill in range |
| Hard | 120 ms | Baits enemies onto warning tiles, times skills, dodges wind-ups |

- Budget: bot thinking ≤ 1 ms per bot per tick; think at 10 Hz, steer at 30 Hz.

### 3.5 Caching & asset strategy
- Vite build with **hashed filenames** → `Cache-Control: immutable, max-age=1y`; `index.html` no-cache.
- Models as **glTF + meshopt/Draco**, textures **KTX2** or small PNG atlases; total ≤ 5 MB.
- **Service worker** (PWA) pre-caches the game shell for instant reopen.
- Hex tiles via **InstancedMesh** (1 draw call); cap `devicePixelRatio` at 2; bloom only on high-end devices.

### 3.6 Event design
- **In-room events** are produced by the simulation each tick (`events[]`) and broadcast as messages — consumed by clients for VFX/SFX/haptics and analytics.
- **Analytics**: client sends events via `posthog-js` (batched, auto-retry). The **server also sends `match_end`** via `posthog-node` so results are recorded even when a client closes early.
- No message queue needed in Phase B (single process); see Section 6.

### 3.7 Error handling & retry

| Failure | Handling |
|---|---|
| Room code not found / full / in progress | `404/409` → friendly message + "Create your own room" |
| Client loses connection | Colyseus `allowReconnection(client, 15)`; slot keeps playing as a bot meanwhile; client auto-retries with backoff (0.5 s, 1 s, 2 s, 4 s…) |
| Reconnect window expires | Slot permanently becomes a bot; client returns home with "Connection lost" |
| Server restart / deploy | **Graceful shutdown**: stop accepting new rooms, let running matches finish (max 120 s), then exit; clients show "Server updating — rejoin" |
| Server crash | Fly restarts the machine; clients detect close → home screen + toast |
| Invalid / spammy input | Clamp vectors, drop > 40 msgs/s, kick after sustained abuse |
| Version mismatch | Reject join with `error {code:"UPDATE_REQUIRED"}` → client reloads |
| Bad nickname | Length limit + basic profanity filter; fallback to "Player123" |
| Tick overrun (> 33 ms) | Log + metric; clamp catch-up to 3 steps to avoid spiral of death |

### 3.8 Security & anti-cheat (MVP level)
Server-authoritative simulation removes speed/teleport cheats. Validate all messages, rate-limit, and never trust client positions. Rooms are unguessable enough for a portfolio (4 chars from a 32-char alphabet without ambiguous letters ≈ 1M codes); add expiry when empty.

---

## 4. Scale & reliability

### 4.1 Load estimation (Phase B)
- 300 unique players over 4 weeks; assume peak **≈ 40 concurrent users** (launch day / class demo) → **≤ 10–15 rooms** (bot rooms have 1 human).
- Per room CPU: 4 circles + 91 tiles + 3 bots → well under **1 ms/tick** → one small machine can host **100+ rooms**.
- Bandwidth: ~3 KB/s per client down × 40 CCU ≈ **120 KB/s** total. Trivial.
- Memory: ~1–2 MB per room → < 50 MB for all rooms.

**Conclusion:** a single Fly.io `shared-cpu-1x` (512 MB) machine per region is enough for Phase B with 10× headroom.

### 4.2 Scaling approach
- **Phase B**: vertical/single process per region. Simple, cheap, no shared state needed.
- **Phase C path**: horizontal — multiple Colyseus processes behind a load balancer with **Redis presence + Redis driver** so room codes resolve across processes.

### 4.3 Regions & latency (*Open*)
US ↔ Thailand RTT ≈ 220–260 ms → uncomfortable for one shared region.
- **Launch**: one region near the soft-launch group (`iad`, US-East).
- **Week 7–8 / after soft launch**: add **`sin` (Singapore)**. The room is created in the region with the lowest ping from the **host**; invitees join that region (cross-ocean rooms remain playable, not ideal).

### 4.4 Failover & redundancy
- Phase B accepts that a crashed machine loses its live matches (matches last ≤ 2 min). Fly auto-restarts; health check on `/health`.
- Zero-downtime-ish deploys via graceful shutdown (3.7). Deploy outside peak hours.
- Static client is on a CDN → stays up even if the game server is down (show "Servers are down, try again soon").

### 4.5 Monitoring & alerting

| Signal | Source | Alert when |
|---|---|---|
| Server up / health | Fly health checks | 2 consecutive failures |
| Crash / exception | Sentry (client + server) | New issue or spike |
| Tick duration p95 | Custom log metric | > 15 ms for 5 min |
| CCU, rooms, disconnect rate | `/health` + logs | Disconnect rate > 10% |
| Client RTT distribution | PostHog property on `match_end` | Median > 150 ms (consider region) |
| Client FPS (avg, p10) | PostHog property on `match_end` | p10 < 30 fps |
| Product metrics | PostHog dashboard | Weekly review vs Phase C gate |

---

## 5. Trade-off analysis (decision records)

| # | Decision | Chosen | Alternatives | Why | Cost of the choice |
|---|---|---|---|---|---|
| D1 | Platform | **Mobile-first web (PWA)** | Native iOS/Android, Steam | Share by link, instant playtests, no store review | Lower graphics ceiling; touch-control limits |
| D2 | Rendering | **Three.js** | Babylon.js, PlayCanvas, Godot/Unity web export | Lightweight, huge ecosystem, AI agents know it well | More DIY (no editor) |
| D3 | Gameplay physics | **Custom 2D circles on XZ** | Rapier / cannon-es 3D | Deterministic, tiny, easy to sync and predict | No realistic tumbling; falls are animated |
| D4 | Network model | **Server-authoritative + interpolation + local prediction** | P2P, deterministic lockstep, client-authoritative | Fair, cheat-resistant, tolerant of mobile jitter | Hits feel ~1 RTT late; needs a server |
| D5 | Server framework | **Colyseus** | Photon, Nakama, raw `ws`/Socket.io | Rooms, matchmaking, delta state sync, reconnection built in; TypeScript shared code | Self-hosting; scaling needs Redis later. *Superseded by DECISIONS.md D-MP-1 (Cloudflare Workers + Durable Objects).* |
| D6 | Shove input | **Collision-based** | Dedicated push button | One-thumb control; stats matter naturally | Less precise "intent" to shove |
| D7 | Bots | **Server-side utility AI** | Client-side bots, ML | Fills rooms; same code path as players | Hand-tuning needed |
| D8 | Identity | **Nickname + anonymous ID** | Accounts (OAuth) | Zero friction for portfolio launch | No cross-device stats/retention accuracy |
| D9 | Storage | **No DB** | Postgres/Supabase | Nothing persistent to store yet | Must add for accounts/leaderboards |
| D10 | Analytics | **PostHog** | GA4, Mixpanel, custom | Funnels + retention + free tier | Third-party dependency |
| D11 | Hosting | **Fly.io + CDN** | Render, Railway, AWS | WebSockets + multi-region on small budget | Vendor-specific config |
| D12 | Theme | **Volcano / lava** | Thai floating market, sky islands | Universal, instantly readable for international players | Less unique than a culturally specific theme |
| D13 | Scope | **No items, 3 characters, 1 arena** | More content | Prove the core loop first | Less variety at launch |

---

## 6. What to revisit as the system grows

| Trigger | Change |
|---|---|
| CCU > ~300 or > 1 process per region | Redis presence/driver; multiple Colyseus processes; load balancer with sticky WebSockets |
| Many players outside US/SEA | More regions; ping-based region select; cross-region matchmaking rules |
| Rooms are hard to fill | **Public quick-play matchmaking** service (skill/region buckets) |
| Phase C go | Accounts + Postgres (profiles, stats, cosmetics), leaderboards, purchase flow |
| "I didn't touch them" complaints | Lag compensation for collisions, tune interpolation buffer, input delay options |
| Content expansion | Items, more characters, more arenas (sky islands, Thai floating market, opera stage, ice floes), 6–8 player rooms |
| Native release | Wrap with Capacitor (mobile) / Tauri (Steam) or port `shared` logic to Godot/Unity |
| Cheating in public matchmaking | Server-side anomaly detection, stricter rate limits, reporting |

---

## 7. Delivery plan (8 weeks × 8–10 h)

| Weeks | Milestone | Scope | Acceptance criteria |
|---|---|---|---|
| **1–2** | Core loop (local) | Monorepo; shared sim; Three.js scene + camera; hex arena; collapse (edge + random + sudden death); 1 placeholder character; joystick + keyboard; shove; elimination; 3 random dummy players | Full 90 s match on a phone browser at 60 fps; unit tests for hex, collisions, collapse |
| **3–4** | Online | Colyseus MatchRoom @30 Hz; private rooms with link + code; lobby; interpolation + prediction; Play again; reconnection; staging deploy | 4 phones on different networks play together; no floor desync; shoves consistent at ~100 ms RTT |
| **5–6** | Characters, bots, spectators | Elephant/Monkey/Turtle + skills; character select; lava-rock ember spirits; Eruption event; bots ×3 difficulties; Play vs Bots | Hard bots usually beat casual players; Easy bots usually lose; every skill has a visible telegraph and counter-play |
| **7–8** | Polish & launch | Volcano art pass, animations, SFX/music; HUD/results; Web Share + PWA; PostHog + Sentry; optional `sin` region; 10+ person playtests; tune config | All Appendix B events firing; ≥ 95% crash-free sessions; itch.io page live; soft launch (Tepper + Thai friends) → itch.io + Reddit |

### Risks
| Risk | Mitigation |
|---|---|
| Online physics feels unfair | Server authority, simple physics, local contact feedback, hit-stun VFX |
| Touch controls feel imprecise | 1 joystick + 1 button; forgiving collision radius; test on real phones from week 1 |
| Empty rooms | Bots fill every slot; Play vs Bots always available |
| US ↔ Thailand latency | Second region (Singapore) |
| Low-end phone performance | Instancing, low-poly, DPR cap, bloom off on low-end |
| Scope creep | Non-goals list (1.5) |

---

## Appendix A — Game rules & tuning reference

### A.1 Core loop
1. Open link → nickname → mode (Bots / Private Room).
2. Pick character.
3. 3-2-1 countdown → match starts; floor begins collapsing; shove others into the lava.
4. Fall in → become an ember spirit throwing lava rocks.
5. Last one standing wins → results → **Play again**.

### A.2 Arena
- Hex grid, axial coords, **radius 5 (91 tiles)**, tile width ≈ 1.2 m.
- Visual: dark basalt rock columns with glowing cracks, inside a volcano crater with smoke; animated lava below.
- 4 spawn points at equal angles, ~3 rings from center.
- Not supported by a SOLID/WARNING tile → falls → eliminated after 0.5 s (cartoony smoke/ember poof, not graphic).

### A.3 Floor collapse (seeded)
Tile states: `SOLID → WARNING (1.0 s, cracks glow orange + shake, still walkable) → SINKING (0.4 s, no support) → GONE`.

| Rule | Start | Cadence |
|---|---|---|
| Edge shrink (outermost ring → WARNING, 0–0.3 s ripple stagger) | t = 10 s | every 10 s |
| Random tile → WARNING (not outermost ring; never isolate all players in first 30 s) | t = 15 s | every 1.5 s |
| **Eruption**: rumble + camera shake; 3–4 glowing target circles (r = 1.5 m) telegraphed 1.5 s; lava bombs → radial knockback ≈ 40% of a shove; hit tiles → WARNING | once, t ∈ [30, 50] s | — |
| **Sudden death**: random-tile rate ×3, edge shrink every 4 s | t = 90 s | until 1 remains |

Tie: if the final players are eliminated on the same tick → draw.

### A.4 Movement & shove
- Player circle radius 0.45 m; input = direction (0–1) + skill.
- Accelerate toward `input × maxSpeed`; slightly slippery friction.
- Stats 1–5 map to: `maxSpeed = 3.5 + 0.5·Agility` m/s · `powerMult = 0.6 + 0.2·Power` · `enduranceMult = 0.6 + 0.2·Endurance`.
- Shove formula in 3.1; hit-stun 0.15 s.

### A.5 Characters (stat totals = 10)

| Character | P / A / E | Skill | Cooldown | Counter-play |
|---|---|---|---|---|
| 🐘 Elephant (Tank) | 5 / 2 / 3 | **Ground Slam**: 0.4 s visible wind-up → radial knockback within 2.0 m | 8 s | Dodge the wind-up |
| 🐒 Monkey (Speedster) | 2 / 5 / 3 | **Dash**: 4 m in 0.25 s, crosses 1-tile gaps; dash hit = ×1.5 knockback | 6 s | Mis-aimed dash = self-elimination |
| 🐢 Turtle (Anchor) | 3 / 2 / 5 | **Shell**: 1.5 s immobile, knockback-immune, reflects colliders at full force | 10 s | Floor can melt under it |

Triangle: Elephant > Turtle > Monkey > Elephant. **Balance target**: each character's 4-player win rate 30–36%.
Look: chubby low-poly animals wearing sumo belts; player-slot color on belt/outline.

### A.6 Ember spirits (eliminated players)
- Float above the lava at the arena edge (keep slot color).
- Skill button → **Throw lava rock**: aim with joystick, soft auto-aim cone; flight 0.6 s with arc + landing shadow.
- Impact: 30% of a base shove + 0.2 s stagger; can't directly eliminate unless the target is already at the edge. Cooldown 4 s.

### A.7 UI (landscape)
- Left: floating joystick · Right: large skill button with cooldown ring · Top: 4 portraits (X when out) + timer.
- Screens: Home (nickname, Play vs Bots, Create Room, Join with code) → Character select → Lobby (code, Share, players, Start) → Match → Results (placement, cause, **Play again**, change character, leave).
- Portrait → "rotate your phone" prompt. Haptics on hit/elimination.

### A.8 Art & audio
- CC0 low-poly assets (Kenney, Quaternius); AI-assisted concept/UI icons.
- Cartoony bright palette; scrolling emissive lava with subtle bubbling; bloom on high-end only; blob shadows.
- SFX: bonk, lava sizzle/poof, rock crack, volcano rumble, lava bomb impact, rock thunk, win jingle. Upbeat tribal-drum music loop.

### A.9 Repo layout
```
splash-sumo/
├─ packages/
│  ├─ shared/src/   config.ts hex.ts physics.ts collapse.ts characters.ts skills.ts simulation.ts rng.ts
│  ├─ server/src/   index.ts rooms/MatchRoom.ts bots/ http/
│  └─ client/src/   render/ input/ net/ ui/ analytics.ts
├─ SPEC.md · DECISIONS.md · package.json (pnpm workspaces)
```

---

## Appendix B — Analytics event catalog (PostHog)

| Event | Sent by | Key properties |
|---|---|---|
| `session_start` | client | device_type, referrer, is_invite_link |
| `room_created` | client | mode, bot_difficulty |
| `room_joined_via_link` | client | room_code |
| `match_start` | client | humans_count, bots_count, characters[] |
| `match_end` | **server** + client | placement, character, eliminated_by (shove/floor/eruption/lava_rock), duration_ms, winner_is_bot, rtt_ms, fps_avg, fps_p10 |
| `rematch_clicked` | client | — |
| `skill_used` | client | character, hit_count |
| `lava_rock_thrown` | client | hit |
| `session_end` | client | matches_played, session_duration |

**Dashboards**: rematch rate · matches/session · D1/D7 retention · character pick & win rate · cause-of-elimination mix · invite funnel (link opened → joined → played) · RTT & FPS distribution.
