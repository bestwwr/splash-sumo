# Decisions log

Decisions made while building, per SPEC §0. Spec-level decision records (D1–D13) live in `SPEC.md` §5.

## Milestone 1 — Core loop (local)

### D-M1-1 · Floor collapse cadence slowed to fit a 90 s match
- **Spec (A.3):** edge shrink every 10 s from t = 10 s; random tile every 1.5 s from t = 15 s; sudden death at 90 s.
- **Problem:** measured headlessly, those rates empty a radius-5 arena (91 tiles) by **~45 s**, so sudden death never happens and matches can't be "90 seconds".
- **Chosen:** edge shrink every **20 s**, random tile every **3 s**, and before sudden death the inner 7 tiles (rings 0–1) are protected: the edge stops at ring 2 and random tiles skip rings < 2. Sudden death (×3 random rate, edge every 4 s) then clears the last ring.
- **Resulting floor arc:** 91 → 61 (15 s) → ~28 (40 s) → ~10 (55 s) → 7-tile final ring (70–90 s) → gone ≈ 100 s.
- **Revisit:** week 7–8 playtests. All numbers are in `packages/shared/src/config.ts`.

### D-M1-2 · Shove tuning
- **Spec:** formula from §3.1 kept exactly; constants were not specified.
- **Chosen:** `BASE_KNOCK = 0.78`, `MIN_SHOVE_SPEED = 1.2 m/s`, `KNOCKBACK_DECAY_RATE = 3.3/s`. A full-speed Elephant charge pushes a passive Elephant **≈ 1.85 m (~1.5 tiles)**; bracing cuts that to ~1.3 m; a standing bump is ~0.3 m. Locked in by regression tests in `physics.test.ts`.
- **Why:** first-pass constants pushed ~2.8 m, so nearly every hit killed (median dummy match 14 s). With these, edge position matters: sumo, not pinball.

### D-M1-3 · Collision resolution details
- On contact the closing velocity along the normal is cancelled (inelastic) **before** both shove impulses are applied, so the pair always separates and can't re-hit every tick.
- Both players get the 0.15 s hit-stun (the spec says "receiver", and with both-direction impulses both are receivers).
- The "attacker" in `hit` events is whoever was moving harder into the contact (for VFX/analytics only).

### D-M1-4 · Elimination & win rules
- Once a player is unsupported they are committed to the fall (no grabbing back on); eliminated after 0.5 s.
- A fall within **2.5 s** of being shoved is credited as `SHOVE` by that player; otherwise `FLOOR`.
- The match ends when nobody is alive, or exactly one player is alive **and standing**. Placement is by elimination time; same tick = tied place; a tie for 1st = draw.

### D-M1-5 · "Never isolate all players in the first 30 s"
- Implemented as: a random tile is rejected if removing it would split the floor that survives the *next* edge shrink into more than one island. This also stops a later ring removal from stranding tiles that were only connected through the edge.

### D-M1-6 · Placeholder character
- Everyone uses Elephant stats (5/2/3) and a placeholder sumo model in M1. All three characters' stats already live in `characters.ts`; skills and models are Milestone 3.

### D-M1-7 · Dummy players
- "3 random dummy players" = wander + edge avoidance + occasional short charges + bracing against knockback. Median 4-dummy match ≈ 31 s. These are throwaway: real utility-AI bots with difficulties are Milestone 3.

### D-M1-8 · Camera & controls mapping
- Camera sits on +z, pitched 58°, auto-fit to the arena for any aspect ratio. Screen-right = +x, screen-up = −z, so the joystick maps directly without rotation.
- Floating joystick on the left 55 % of the screen; its base follows the thumb if dragged past the rim.

### D-M1-9 · Name
- The spec says **Lava Sumo**; the repo/folder is **Splash Sumo**. The in-game title uses the spec name for now. *Open:* confirm with the PO.

## Solo Quick Play

### D-SQP-1 · Utility-AI bots (Easy / Medium / Hard)
- Code: `packages/shared/src/bots/` (`bot.ts` controller, `scoring.ts` direction scoring, `names.ts`). Pure and deterministic: each `BotController` has its own seeded `RngState`.
- Every `BOT_THINK_MS` (100 ms) a bot scores 16 directions + "stand still" and picks the best after adding uniform noise `[0, BOT_NOISE)`. The decision is queued and takes effect `BOT_REACTION_MS` later (600 / 300 / 120 ms); each tick the bot outputs the active decision. Skill presses (and spirit rock throws) are one-tick rising edges.
- Score = floor safety on the predicted path (7 samples over 0.8 s using the real steering model incl. current knockback; once a sample loses support the rest of the path counts as fallen) + distance from the edge (capped) − distance from the safe-floor centroid + pressure (aim for the spot behind an opponent who is near an edge, so the shove pushes them into it) + chase − threats (slam wind-up ring — a path through the rooted elephant counts as blocked — dash line, eruption circles in phase 1, incoming rocks).
- "Edge" is derived from the tiles, not the arena radius: distance to the nearest missing neighbor cell, SINKING/GONE tile, or warned tile that sinks within the bot's `warnSenseMs`. A larger `warnSenseMs` makes a bot both avoid warnings earlier and treat opponents near warning tiles as "near the edge" (Hard's baiting onto warning tiles).
- Skills: Easy uses sloppy triggers at 8% per think; Medium uses "opponent in range" (current positions) at 50%; Hard times them and leads targets (slam only when a target is near an edge or two are in range and its own tile stays solid through the wind-up; dash only to push a near-edge target toward its hole, or to jump a sinking tile; shell against chargers, wind-ups, dashes, eruption circles and rocks, and only on floor that lasts the shell).
- Dead bots play their ember spirit: aim at the living player in range who is nearest the edge, throw when the rock is ready.
- **Dodge range (real 400 ms slam wind-up):** a settled Hard bot (own skill on cooldown) escapes on every seed (60/60) from **≥ 1.7 m** for Elephant and Turtle and **≥ 1.8 m** for all three fighters (Monkey: 60/60 at 1.6 m, 58/60 at 1.7 m). Below that it is physics: after the 120 ms reaction plus up to 67 ms of think wait, a 4.5 m/s fighter covers only ≈ 0.42 m before impact. Escape rates by start distance (60 seeds): Elephant/Turtle 1.4 m 0, 1.5 m 16, 1.6 m 45, 1.7 m 60; Monkey 1.4 m 45, 1.5 m 45, 1.6 m 60. `test/bots.test.ts` checks 1.8 m for all fighters with the real wind-up; a second test holds a dummy wind-up at 1 s from 1 m to check the dodge logic itself. Turtles normally shell instead.
- Hard judges threat timings net of its own reaction delay (`threatLead` 1: it has `impact − reaction` to get clear). Easy and Medium don't (0).

Chosen tuning (`config.ts`; shared bot constants such as threat multipliers and zone margins, the pressure offset, the wander interval and skill-trigger distances/thresholds live in `BOT_THREAT`, `BOT_SKILL` and the other `BOT_*` keys):

| | Easy | Medium | Hard |
|---|---|---|---|
| Reaction | 600 ms | 300 ms | 120 ms |
| Noise | 1.0 | 0.8 | 0.15 |
| Skill use | 0.08 | 0.5 | 1 |
| floor / warnSenseMs | 2 / 500 | 4 / 1000 | 5 / 1800 |
| edge / edgeCap | 1 / 1.5 m | 1.4 / 2.5 m | 1.8 / 3 m |
| center | 0.05 | 0.25 | 0.2 |
| pressure / chase | 0.3 / 0.25 | 1.2 / 0.35 | 3 / 0.4 |
| threat / threatLead | 0 / 0 | 1.5 / 0 | 4 / 1 |
| wander / inertia | 0.6 / 0.2 | 0 / 0.25 | 0 / 0.25 |
| skill timing / stick speed | sloppy / 0.7 | in range / 1 | timed + lead / 1 |

Difficulty sim (`pnpm --filter @lava-sumo/shared sim`, ~40 s): 200 seeded 4-bot matches per pairing, random fighters, sides alternate by slot. Share = strong wins / decided matches (draws excluded; counting draws as losses lowers each by ≤ 1 point).

| Pairing | Strong wins | Weak wins | Draws | Strong share |
|---|---|---|---|---|
| 2 hard vs 2 easy | 187 | 8 | 5 | 95.9% |
| 2 hard vs 2 medium | 152 | 46 | 2 | 76.8% |
| 2 medium vs 2 easy | 154 | 41 | 5 | 79.0% |

(Before Hard's `threatLead` was added: 97.5 / 79.3 / 79.0%. Moving the inline bot constants into `CONFIG.BOT_*` alone left the table identical.)

- Tuning history: first pass gave 95.9 / 75.0 / 80.1%, but Easy bots walked off the rim on their own (half of Easy deaths were FLOOR, ~14 s matches); Easy now moves at 0.7 stick with less wander and more edge weight. Tried and dropped: an "exposure" term (don't stand near an edge with an opponent behind you) and a "stay out of a ready elephant's range" term both made Hard more passive and *lowered* Hard vs Medium (69.9% / ~77%). Higher Hard pressure, Medium seeing warnings later (1000 ms) and Hard-only target leading widened the gap. Run-to-run sensitivity to small weight changes is about ±3 points.
- Bot `input()` averages ≈ 15–20 µs per call (budget 1 ms).

### D-SQP-2 · Fighter balance deferred to the playtest
- **Measured (600 matches, 4 Hard bots):** Elephant 13.7%, Monkey 68.0%, Turtle 18.4% of wins. Design target is 30–36% each.
- **Why not tuned now:** every config that hits the target either changes spec-fixed values (dash ×1.5, shell reflects at full force) or makes slam/shell very swingy.
- **Decision (PO, 2026-11-19):** keep the current spec values for the first playtest. `test/sim/balance.sim.test.ts` prints shares instead of asserting the target. Revisit with playtest feedback; the leading candidate is a Monkey nerf (dash cooldown 6→8 s or distance 4→3.5 m).
- **Update (PO playtest, 2026-11-19):** PO found Monkey too strong and asked for a longer cooldown. Dash cooldown 6 → **10 s**. Sim, 4 Hard bots (600 matches): Monkey 68.0% → 57.6% (8 s gave 64.1%; 8 s + 3.5 m dash gave 63.0%). The 1-v-1 Hard triangle is unchanged (Monkey still beats Elephant and Turtle ~98%), so the next lever, if needed, is the dash knockback (`DASH_KNOCK_MULT`) or the Hard bot's dash aim.

### D-SQP-3 · Arenas: volcano first, data-driven
- **Decision (PO, 2026-11-19):** ship only the volcano (lava) arena now. The map picker shows other arenas as "coming soon" slots. Arenas are defined as data so new ones can be added later without touching the screens.

## Online multiplayer

### D-MP-1 · Cloudflare Workers + Durable Objects (supersedes SPEC D5)
- **Decision:** the game server runs on Cloudflare Workers with Durable Objects (free plan, SQLite-backed, one DO per room code), replacing Colyseus on Fly.io (SPEC D5).
- **Why:** free hosting, no card, no cold starts, close to both the US and Thailand.
- **Standard WebSockets (not hibernating):** lobbies stay in memory. Cost: DO duration is billed while sockets are open.

### D-MP-2 · Server-authoritative snapshots, no prediction
- **Decision:** server sends snapshots at 20 Hz; clients interpolate with ~100 ms delay. No client-side prediction this milestone.
- **Rejected:** lockstep, because of cross-browser float determinism risk.

### D-MP-3 · No skin field in the protocol yet
- Skins are "soon"; the protocol carries no skin field until they exist.

### D-MP-4 · Two environments
- **Staging:** Worker `lava-sumo-staging` serves the staging client and server same-origin, with a TEST badge. Deploy freely via `pnpm deploy:staging`.
- **Prod:** Worker `lava-sumo` plus the GitHub Pages client. Deploy only with PO OK.

## Toolchain
- Node 26, pnpm 12 workspaces, TypeScript 7 (`strict`, `noUncheckedIndexedAccess`), Vite 8, Vitest 5, three r187.
