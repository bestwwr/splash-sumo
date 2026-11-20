# Solo Quick Play, Home & Inventory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Milestone-1 prototype into a complete solo game: home showcase, inventory, Quick Play vs Easy/Medium/Hard bots, three fighter skills, ember spirits, eruption, and a GitHub Pages deploy gated on a human playtest.

**Architecture:** All gameplay (skills, spirits, rocks, eruption, bots) is added to the pure, seeded `packages/shared` simulation and its `step()` tick, so the Milestone-2 server can reuse it unchanged. The client keeps plain HTML/CSS screens over the Three.js canvas (approach A) and gains a small `meta/` layer (catalog + persisted profile) that the Home and Inventory screens read.

**Tech Stack:** TypeScript 7 (strict), pnpm workspaces, Vite 8, Vitest 5, three r187, GitHub Actions + GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-11-18-solo-quick-play-design.md` (builds on `SPEC.md` Appendix A and §3.4, and `DECISIONS.md`).

## Global Constraints

- `packages/shared` is pure: no DOM, no network, no `Date.now()`, no `Math.random()`; randomness only via the state's seeded `rng` (`nextFloat/nextInt/nextRange` in `rng.ts`).
- `step(prev, inputs)` stays pure: never mutates `prev`. `cloneState` must deep-copy every new array/object you add to `MatchState`/`Player`.
- **All tuning numbers in `packages/shared/src/config.ts`.** Every retune is logged in `DECISIONS.md` with the measured result.
- TypeScript `strict` + `noUncheckedIndexedAccess`; `pnpm typecheck` clean after every task.
- Tick order (SPEC §3.1): apply inputs → **update skills/cooldowns** → integrate velocity → player-player collisions → **event impulses (eruption, lava rocks)** → tile states → support/eliminations → win.
- Fighter values (SPEC A.5): Elephant 5/2/3 Ground Slam (0.4 s wind-up, 2.0 m radius, 8 s cd); Monkey 2/5/3 Dash (4 m in 0.25 s, crosses 1-tile gaps, ×1.5 knockback on a dash hit, 6 s cd); Turtle 3/2/5 Shell (1.5 s immobile, knockback-immune, reflects colliders at full force, 10 s cd).
- Ember spirit (SPEC A.6): soft auto-aim cone, 0.6 s flight, 30% of a base shove + 0.2 s stagger, 4 s cooldown.
- Eruption (SPEC A.3): once, t ∈ [30, 50] s; 3–4 circles r = 1.5 m telegraphed 1.5 s; ≈ 40% of a shove; hit tiles → WARNING.
- Bots (SPEC §3.4): reaction delay Easy 600 / Medium 300 / Hard 120 ms; think 10 Hz, steer 30 Hz; ≤ 1 ms per bot per tick; same `PlayerInput` as humans.
- Two taps from Home to a match (Quick Play → Fight!, with last picks pre-selected); one tap for Play again. *(Amended 2026-11-19: PO asked for a map/fighter select screen.)*
- Mobile landscape, 60 fps target; bundle stays far under 5 MB.
- Persistence is device-only `localStorage`, every access wrapped in try/catch.

## Review Focus

1. **Broken or missing storage** (private mode throws, garbage JSON, M1's old `lavasumo.nickname` key, an unknown fighter ID saved): the game loads with defaults/migrated values and never crashes → tests in Task 8.
2. **Skill pressed in the wrong moment** (held down continuously, pressed during cooldown, pressed while falling, pressed during hit-stun): exactly one activation per press when ready, none otherwise → tests in Task 1.
3. **Monkey dash at the edge or over a 2-tile gap**: crossing one GONE tile is safe, ending the dash over lava falls (self-elimination) → tests in Task 2.
4. **Turtle shell edge cases** (shell vs shell, slam/rock/eruption on a shell, shell on a sinking tile): immune to knockback but still falls when the floor goes → tests in Task 3.
5. **Match ends with things in flight** (rock mid-air, eruption telegraphed, slam winding up when the last opponent falls): no events or impulses after `Phase.RESULTS`, result unchanged → tests in Tasks 4 and 5.

---

## File map

**Shared (`packages/shared/src/`)**
- `config.ts` — add skill, spirit, rock, eruption, bot numbers.
- `types.ts` — extend `Player`, `MatchState`, `SimEvent`; add `SkillId`, `BotDifficulty`, `LavaRock`, `EruptionState`.
- `skills.ts` *(new)* — skill activation + per-tick skill update for all three skills.
- `physics.ts` — dash/shell rules inside `resolveCollision`; `applyRadialImpulse` helper.
- `spirits.ts` *(new)* — spirit placement, rock aim/throw/land.
- `eruption.ts` *(new)* — seeded schedule, telegraph, impact.
- `simulation.ts` — wire the new stages into `step()`; init new fields in `createMatch`; extend `cloneState`.
- `bots/` *(new)* — `bot.ts` (controller), `scoring.ts` (utility scoring), `names.ts`.
- `index.ts` — export the new modules.

**Shared tests (`packages/shared/test/`)**: `skills.test.ts`, `spirits.test.ts`, `eruption.test.ts`, `bots.test.ts`; slow sims in `test/sim/*.sim.test.ts` (excluded from `pnpm test`, run with `pnpm sim`).

**Client (`packages/client/src/`)**
- `meta/catalog.ts`, `meta/profile.ts` *(new)* — inventory data + persisted profile.
- `render/fighters.ts` *(new)* — per-fighter placeholder models; `render/players.ts` uses it.
- `render/skillFx.ts` *(new)* — slam ring, dash trail, shell, rocks + landing shadows, eruption circles, spirit look.
- `input/input.ts` — skill button cooldown ring + label.
- `ui/screens/splash.ts`, `ui/screens/home.ts`, `ui/screens/inventory.ts`, `ui/screens/setup.ts` *(new)*; `ui/hud.ts` — results actions; `style.css`.
- `game/quickPlay.ts` *(renamed from `localGame.ts`)*; `game/dummyAI.ts` **deleted**.
- `main.ts` — screen routing.

**Repo**: `.github/workflows/pages.yml` *(new)*, `packages/client/vite.config.ts`, `README.md`, `DECISIONS.md`.

---

### Task 0: Branch and baseline

**Files:** none changed.

- [ ] **Step 1:** Confirm with the PO that Milestone 1 may be committed (it is currently uncommitted). Then commit the M1 work to `main`: `git add -A && git commit -m "feat: milestone 1 core loop (local)"`.
- [ ] **Step 2:** `git checkout -b feat/solo-quick-play`. All later commits go on this branch; **nothing is merged to `main` until Task 15**, because pushes to `main` deploy publicly.
- [ ] **Step 3:** Run `pnpm test && pnpm typecheck`. Expected: 40 tests pass, no type errors.

---

### Task 1: Skill framework + Elephant Ground Slam

**Files:**
- Modify: `packages/shared/src/types.ts`, `config.ts`, `simulation.ts`, `physics.ts`, `index.ts`
- Create: `packages/shared/src/skills.ts`
- Test: `packages/shared/test/skills.test.ts`

**Interfaces:**
- Produces:
  - `type SkillId = "slam" | "dash" | "shell"`; `SKILL_OF: Record<CharacterId, SkillId>` in `characters.ts`.
  - New `Player` fields: `skillCooldownMs: number`, `skillPhase: SkillPhase` (`enum SkillPhase { NONE=0, WINDUP=1, ACTIVE=2 }`), `skillPhaseMs: number` (time left in the current phase), `skillHeld: boolean` (last tick's input, for press detection), `dashDirX: number`, `dashDirZ: number`.
  - `SimEvent` additions: `{ type: "skillUsed"; playerId; skill: SkillId }` (at activation), `{ type: "slamImpact"; playerId; x; z; hitIds: string[] }`.
  - `updateSkills(state: MatchState, inputs: Inputs, events: SimEvent[]): void` in `skills.ts`; called in `step()` right after inputs are read, before `applyMovement`.
  - `applyRadialImpulse(p: Player, fromX: number, fromZ: number, speed: number, stunMs: number, byId: string | null, nowMs: number): void` in `physics.ts` (pushes `p` directly away from the point; sets `hitStunMs`, `lastHitById`, `lastHitAtMs`). Reused by rocks and eruption.
  - Config: `SLAM_WINDUP_MS: 400`, `SLAM_RADIUS: 2.0`, `SLAM_COOLDOWN_MS: 8000`, `SLAM_KNOCK_SPEED` (builder tunes; start at `4.5`), `DASH_*`, `SHELL_*` cooldowns too (`6000`, `10000`).
- Rules: activation needs a **press** (`input.skill && !p.skillHeld`), `skillCooldownMs === 0`, `alive`, `fallingMs < 0`, `hitStunMs === 0`, `skillPhase === NONE`. Cooldown starts at activation. During WINDUP the slammer cannot steer (treat like stun for movement). Slam knockback speed on each victim = `SLAM_KNOCK_SPEED × powerMult(elephant) / enduranceMult(victim)`, outward; the slammer is not affected; credit `lastHitById = slammer`.

- [ ] **Step 1: Write failing tests** in `test/skills.test.ts` (reuse `makePlayer` from `test/helpers.ts`; extend it with the new fields' defaults):
  - `slam: winds up for 400 ms, then knocks back everyone within 2.0 m outward` — elephant at (0,0), victims at (1.5,0) and (3,0); press skill; after ⌈400/33.3⌉ ticks expect a `slamImpact` with `hitIds` = only the near victim, near victim `vx > 2`, far victim `vx === 0`.
  - `slam: slammer cannot move during wind-up` — hold input `dirX:1`; position unchanged (±0.01) until impact.
  - `slam: knockback credits the elephant` — near victim `lastHitById === elephantId`.
  - `skill: one activation per press` — hold `skill:true` for 9 s of ticks: exactly 1 `skillUsed` before cooldown ends, a 2nd only after releasing and pressing again post-cooldown.
  - `skill: ignored during cooldown, while falling, while hit-stunned` — three cases, each yields 0 `skillUsed`.
  - `step stays pure with skills` — the existing purity test, but with a slam in progress.
- [ ] **Step 2:** Run `cd packages/shared && npx vitest run test/skills.test.ts`. Expected: FAIL (no `updateSkills`).
- [ ] **Step 3:** Implement the types, config, `SKILL_OF`, `applyRadialImpulse`, `updateSkills` (slam branch only; dash/shell branches arrive in Tasks 2–3 as `// next task` no-ops returning early), init new fields in `createMatch`, call `updateSkills` in `step()`.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: all pass (old 40 + new).
- [ ] **Step 5:** Commit: `feat(shared): skill framework and elephant ground slam`.

---

### Task 2: Monkey Dash

**Files:** Modify `skills.ts`, `physics.ts`, `simulation.ts`, `config.ts`; Test `test/skills.test.ts`.

**Interfaces:**
- Consumes: Task 1 skill fields and `updateSkills`.
- Config: `DASH_DISTANCE: 4`, `DASH_DURATION_MS: 250`, `DASH_COOLDOWN_MS: 6000`, `DASH_KNOCK_MULT: 1.5`.
- Rules: direction = normalized input if non-zero, else `facing`. Phase ACTIVE for 250 ms at constant speed `DASH_DISTANCE / 0.25 s = 16 m/s`; input ignored. **While dashing, the support check is skipped** (so 1-tile gaps are crossed); the check resumes on the first tick after the dash. In `resolveCollision`, if the attacker is dashing, its `powerMult` is multiplied by `DASH_KNOCK_MULT`, and the dash ends on contact. At the end of a dash, velocity drops to `maxSpeed` in the dash direction.

- [ ] **Step 1: Write failing tests:**
  - `dash: travels 4 m in 250 ms` — from (0,0) dirX 1: after ⌈250/33.3⌉ ticks, `x` ∈ [3.8, 4.2].
  - `dash: crosses a single GONE tile` — set tile (1,0) GONE, dash from center along +x: never falling, lands supported.
  - `dash: ending over lava falls` (Review Focus 3) — tiles (1,0)…(4,0) GONE: after the dash `fallingMs >= 0`, then eliminated with cause `FLOOR`.
  - `dash: hit during dash knocks back ×1.5` — compare victim `vx` from a dash hit vs a normal hit at the same closing speed: ratio ∈ [1.45, 1.55].
  - `dash: uses facing when no input`.
- [ ] **Step 2:** Run the file. Expected: the new dash tests FAIL.
- [ ] **Step 3:** Implement the dash branch in `updateSkills`, the support-skip in `step()` stage 5, and the dash multiplier in `resolveCollision`.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`: all pass.
- [ ] **Step 5:** Commit: `feat(shared): monkey dash`.

---

### Task 3: Turtle Shell

**Files:** Modify `skills.ts`, `physics.ts`, `config.ts`; Test `test/skills.test.ts`.

**Interfaces:**
- Config: `SHELL_DURATION_MS: 1500`, `SHELL_COOLDOWN_MS: 10000`, `SHELL_REFLECT_MULT: 1.0`.
- Produces: `isShelled(p: Player): boolean` (exported from `skills.ts`; used by physics, spirits, eruption, bots).
- Rules: while ACTIVE, velocity is zero and input is ignored. `applyRadialImpulse` is a no-op on a shelled player. In `resolveCollision` with exactly one shelled player: the shell doesn't move (all separation goes to the other), and the other gets **reflected at full force**: speed `BASE_KNOCK × powerMult(other) × max(closing, MIN_SHOVE_SPEED) / enduranceMult(other) × SHELL_REFLECT_MULT` away from the shell. **Shell vs shell:** both stay put; separation is split; no impulse. The support check still runs: a shelled turtle on a SINKING tile falls.

- [ ] **Step 1: Write failing tests** (Review Focus 4):
  - `shell: immobile and knockback-immune for 1.5 s` — an elephant charges at 4.5 m/s: the turtle's position is unchanged, and the elephant's `vx < -3`.
  - `shell: immune to slam` — a slam next to a shelled turtle: turtle `vx === 0`.
  - `shell vs shell: no impulse, just separation`.
  - `shell: still falls when its tile sinks`.
  - `shell: ends after 1.5 s and the turtle can move again`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`: pass.
- [ ] **Step 5:** Commit: `feat(shared): turtle shell`.

---

### Task 4: Ember spirits and lava rocks

**Files:** Create `packages/shared/src/spirits.ts`; modify `types.ts`, `config.ts`, `simulation.ts`, `index.ts`; Test `test/spirits.test.ts`.

**Interfaces:**
- Produces:
  - `Player` fields: `spiritAngle: number` (position on the spirit ring), `rockCooldownMs: number`.
  - `MatchState.rocks: LavaRock[]`, with `interface LavaRock { id: number; fromId: string; fromX; fromZ; targetX; targetZ; thrownAtMs; landAtMs }` and `MatchState.nextRockId: number`.
  - `spiritPosition(p: Player): { x: number; z: number }`: on a circle of radius `SPIRIT_RING_RADIUS` at `spiritAngle`.
  - `updateSpirits(state, inputs, events)`: throws on press. `updateRocks(state, events)`: lands rocks and applies impulses, run at the "event impulses" stage.
  - Events: `{ type: "lavaRockThrown"; fromId; targetX; targetZ; landAtMs }` (SPEC §2.4), `{ type: "rockImpact"; fromId; x; z; hitIds: string[] }`.
  - `EliminationCause.LAVA_ROCK` credit: rock hits set `lastHitById = spirit`, plus a new `lastHitCause: EliminationCause` field on `Player` so `eliminate()` picks `LAVA_ROCK` vs `SHOVE` (slam/dash/shell hits count as `SHOVE`).
- Config: `SPIRIT_RING_RADIUS: 7.2`, `SPIRIT_DRIFT_SPEED: 1.2` (rad/s; the joystick's sideways part drifts the spirit around the ring), `ROCK_FLIGHT_MS: 600`, `ROCK_RANGE: 9`, `ROCK_AIM_CONE_DEG: 30`, `ROCK_COOLDOWN_MS: 4000`, `ROCK_HIT_RADIUS: 0.9`, `ROCK_STAGGER_MS: 200`, `REFERENCE_SHOVE_SPEED` (= the impulse of a full-speed Elephant charge on an Elephant under current config; compute it once as a derived constant), `ROCK_KNOCK_SPEED = 0.30 × REFERENCE_SHOVE_SPEED`.
- Rules: on elimination, `spiritAngle = atan2(z, x)` of the fall position. Aim = joystick direction from the spirit position; the target is the nearest living, standing player inside the ±30° cone within `ROCK_RANGE`, landing at their **position at throw time**. With no player in the cone, the rock lands `ROCK_RANGE × |input|` along the aim (or at the nearest living player when input is zero). Rocks don't change tiles. Bots and humans are spirits alike.

- [ ] **Step 1: Write failing tests:**
  - `eliminated player becomes a spirit at the ring angle where they fell`.
  - `rock: soft auto-aim picks a player inside the 30° cone, not one outside it`.
  - `rock: lands after 600 ms and pushes with 30% of a reference shove` — victim speed ∈ [0.27, 0.33] × `REFERENCE_SHOVE_SPEED` (a stationary Elephant victim; account for endurance by using the formula's victim term = Elephant).
  - `rock: 4 s cooldown, one throw per press`.
  - `rock: a fall right after a rock hit is credited LAVA_ROCK to the spirit`.
  - `rock: a rock still in flight when the match ends does nothing` (Review Focus 5) — after `Phase.RESULTS`, `step` emits no `rockImpact` and leaves positions unchanged.
  - `cloneState deep-copies rocks`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. `step()`: dead players skip movement and instead run `updateSpirits`; `updateRocks` runs at stage "event impulses".
- [ ] **Step 4:** `pnpm test && pnpm typecheck`: pass.
- [ ] **Step 5:** Commit: `feat(shared): ember spirits and lava rocks`.

---

### Task 5: Eruption

**Files:** Create `packages/shared/src/eruption.ts`; modify `types.ts`, `config.ts`, `simulation.ts`, `index.ts`; Test `test/eruption.test.ts`.

**Interfaces:**
- Produces: `MatchState.eruption: { atMs: number; impactAtMs: number; targets: { x: number; z: number }[]; phase: 0 | 1 | 2 }` (0 pending, 1 telegraphed, 2 done). `updateEruption(state, events)` runs at the "event impulses" stage. Events: `{ type: "eruptionIncoming"; targets: {x, z}[]; impactAtMs }` (SPEC §2.4), `{ type: "eruptionImpact"; targets; hitIds }`.
- Config: `ERUPTION_MIN_MS: 30000`, `ERUPTION_MAX_MS: 50000`, `ERUPTION_TELEGRAPH_MS: 1500`, `ERUPTION_TARGETS_MIN: 3`, `ERUPTION_TARGETS_MAX: 4`, `ERUPTION_RADIUS: 1.5`, `ERUPTION_KNOCK_SPEED = 0.40 × REFERENCE_SHOVE_SPEED`, `ERUPTION_STUN_MS: 200`.
- Rules: `atMs` drawn from the seeded RNG **in `createMatch`** (this changes downstream RNG draws, so re-run the M1 determinism tests; they compare runs against themselves, so they stay valid). At `atMs`: pick 3–4 distinct supportive tile centers (seeded) → phase 1 → emit `eruptionIncoming`. At `impactAtMs`: every standing, alive, non-shelled player within 1.5 m gets `applyRadialImpulse` away from the circle center (cause `ERUPTION`), and every SOLID tile whose center is within 1.5 m goes to WARNING → phase 2.

- [ ] **Step 1: Write failing tests:**
  - `eruption happens once, between 30 and 50 s, for 20 seeds`.
  - `telegraph: 3–4 targets announced 1.5 s before impact`.
  - `impact: pushes players inside the circle with 40% of a reference shove; outside untouched`.
  - `impact: SOLID tiles under a target turn WARNING`.
  - `a fall right after an eruption hit is credited ERUPTION`.
  - `eruption pending when the match ends never fires` (Review Focus 5).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`: pass.
- [ ] **Step 5:** Commit: `feat(shared): eruption event`.

---

### Task 6: Bots (Easy / Medium / Hard)

**Files:** Create `packages/shared/src/bots/bot.ts`, `bots/scoring.ts`, `bots/names.ts`; modify `config.ts`, `index.ts`; Test `test/bots.test.ts`, `test/sim/difficulty.sim.test.ts`; modify `packages/shared/package.json` (add `"sim": "vitest run test/sim"`), and add `packages/shared/vitest.config.ts` excluding `test/sim/**` from the default run.

**Interfaces:**
- Produces:
  - `type BotDifficulty = "easy" | "medium" | "hard"` (in `types.ts`).
  - `class BotController { constructor(playerId: string, difficulty: BotDifficulty, seed: number); input(state: MatchState, seq: number): PlayerInput }`. Holds its own `RngState` (seeded; no `Math.random`). Thinks every `BOT_THINK_MS` (100); a decision made at time t takes effect at `t + reactionDelay`; steers every tick toward the active decision. Handles spirits (aims rocks at players near the edge) when its player is dead.
  - `scoreDirection(state, p, dirX, dirZ, weights): number` in `scoring.ts`: higher is better. Inputs: floor safety along the path (SOLID > WARNING > SINKING/GONE), distance from the current edge, pressure on opponents near the edge, threats (an Elephant in WINDUP within `SLAM_RADIUS + 0.5`, a dashing Monkey's line, eruption circles in phase 1).
  - `BOT_NAMES: readonly string[]` (≥ 12 entries) and `pickBotSetup(seed: number, count: number): { nickname: string; character: CharacterId }[]`: random fighters (repeats allowed), distinct names.
  - Config: `BOT_THINK_MS: 100`, `BOT_REACTION_MS: { easy: 600, medium: 300, hard: 120 }`, plus per-difficulty `BOT_NOISE`, `BOT_SKILL_USE` and scoring weights (builder tunes).
- Behavior per SPEC §3.4 table (Easy wanders, leaves warning tiles late, rarely skills; Medium avoids warnings, holds center, charges edge players, skills in range; Hard baits onto warning tiles, times skills, dodges wind-ups and eruption circles).

- [ ] **Step 1: Write failing fast tests** (`test/bots.test.ts`):
  - `bot input is deterministic for the same seed and state`.
  - `bot input magnitude ≤ 1 and never NaN` over a 120 s bot match.
  - `medium/hard bots step off a WARNING tile before it sinks` — bot alone on a warning tile next to solid tiles: standing on solid after 1.0 s.
  - `hard bot steps out of an elephant wind-up ring` — dummy elephant in WINDUP 1.0 m away: hard bot ends outside 2.0 m before impact; easy bot is not required to.
  - `reaction delay: a hard bot reacts to a new threat ≥ 120 ms and < 300 ms after it appears`.
  - `bot think time: average BotController.input() < 1 ms` over a 90 s match (use `performance.now()` in the test only; it is not called from `src/`).
- [ ] **Step 2: Write the difficulty sim** (`test/sim/difficulty.sim.test.ts`): 200 seeded matches each of 2 Hard vs 2 Easy, 2 Hard vs 2 Medium, 2 Medium vs 2 Easy (random fighters). Assert the stronger side's win share is ≥ 70% in each pairing. Print the table.
- [ ] **Step 3:** Run `pnpm --filter @splash-sumo/shared test`. Expected: bot tests FAIL.
- [ ] **Step 4:** Implement the controller, scoring, names.
- [ ] **Step 5:** Run `pnpm test`, then `pnpm --filter @splash-sumo/shared sim`. Expected: fast tests pass and the difficulty sim passes. Tune weights/noise until it does.
- [ ] **Step 6:** Log the difficulty table and the chosen weights in `DECISIONS.md` (new section "Solo Quick Play").
- [ ] **Step 7:** Commit: `feat(shared): utility-AI bots with three difficulties`.

---

### Task 7: Fighter balance pass

**Files:** Create `packages/shared/test/sim/balance.sim.test.ts`; modify `config.ts`, `DECISIONS.md`.

**Interfaces:** Consumes `BotController`, `pickBotSetup`, all skills.

- [ ] **Step 1: Write the balance sim:** 600 seeded matches, 4 **Hard** bots with random fighters (repeats allowed). Win share per fighter = that fighter's wins ÷ all non-draw wins (a win counts once, for the winner's fighter). Assert every share ∈ [0.30, 0.36]. Also print Medium shares (not asserted) and a 1-v-1 triangle table (200 matches per pair, Hard) for Elephant>Turtle, Turtle>Monkey, Monkey>Elephant (not asserted; design intent).
- [ ] **Step 2:** Run `pnpm --filter @splash-sumo/shared sim`. Expected: probably FAIL at first. Record the numbers.
- [ ] **Step 3:** Tune only skill numbers and `SLAM_KNOCK_SPEED`/`SHELL_REFLECT_MULT`/`DASH_KNOCK_MULT` in `config.ts` (not the A.5 stats, cooldowns, durations or radii, which the spec fixes) until the shares pass. Keep `pnpm test` green (the shove-feel guard tests must still pass).
- [ ] **Step 4:** Log the before/after shares, the triangle table and every changed number in `DECISIONS.md`.
- [ ] **Step 5:** Commit: `tune(shared): fighter balance to 30–36% win share`.

---

### Task 8: Profile and inventory catalog (client meta layer)

**Files:** Create `packages/client/src/meta/catalog.ts`, `meta/profile.ts`, `packages/client/test/profile.test.ts`, `packages/client/test/catalog.test.ts`; modify `packages/client/package.json` (add `"test": "vitest run"`), root `package.json` (`"test"` runs both packages: `pnpm -r test`).

**Interfaces:**
- Produces:
  - `interface CatalogItem { id: string; kind: "fighter" | "skin"; name: string; role?: string; fighterId?: CharacterId; order: number; defaultOwned: boolean }`, plus `CATALOG: readonly CatalogItem[]` (3 fighters: ids `fighter.elephant|monkey|turtle`, roles Tank/Speedster/Anchor, all `defaultOwned: true`; no skins yet). Also `SKILL_INFO: Record<SkillId, { name: string; blurb: string }>` with copy: Ground Slam "Wind up, then blast everyone within 2 m.", Dash "Burst 4 m forward and hop small gaps. Mis-aim and you splash.", Shell "Hide for 1.5 s. Nothing moves you, and whoever hits you bounces off."
  - Arenas: `interface ArenaInfo { id: string; name: string; emoji: string; blurb: string; available: boolean; order: number }`, plus `ARENAS: readonly ArenaInfo[]` with exactly one entry: `{ id: "arena.volcano", name: "Volcano", emoji: "🌋", blurb: "The floor crumbles into lava. Don't be the one who splashes.", available: true, order: 0 }`. And `arenasForPicker(minCells = 3): Array<ArenaInfo | null>`: available arenas by `order`, padded with `null` ("coming soon") to ≥ `minCells`.
  - `interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }`.
  - `interface Profile { version: 1; nickname: string; equippedFighter: CharacterId; difficulty: BotDifficulty; arena: string; owned: string[]; equippedSkins: Partial<Record<CharacterId, string>> }`.
  - `loadProfile(storage: KeyValueStorage | null, randomNick: () => string): Profile` and `saveProfile(storage: KeyValueStorage | null, p: Profile): void`, in one JSON key `lavasumo.profile.v1`. Load migrates M1's `lavasumo.nickname`; owned = saved ∪ all `defaultOwned` items, minus unknown IDs; an equipped fighter that isn't owned resets to `elephant`; an unknown difficulty resets to `medium`; an unknown or unavailable arena resets to `arena.volcano`. Every storage call is wrapped in try/catch.
  - `fightersForGrid(profile, minCells = 6): Array<CatalogItem | null>`: owned fighters by `order`, padded with `null` ("?" slots) to a multiple of 3 that is ≥ `minCells`.

- [ ] **Step 1: Write failing tests** (Review Focus 1):
  - `defaults: elephant, medium, all 3 fighters owned, random nickname` — with `null` storage, and with an empty fake storage.
  - `storage that throws on every call → defaults, no throw`.
  - `garbage JSON → defaults`.
  - `migrates the M1 nickname key`.
  - `unknown fighter / unknown difficulty / unknown arena / unknown owned IDs are repaired`.
  - `arenasForPicker pads the single volcano arena with 2 nulls`.
  - `save → load round-trips`.
  - `fightersForGrid pads to 6 with nulls; 7 owned would pad to 9`.
- [ ] **Step 2:** Run `pnpm --filter @splash-sumo/client test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`: pass.
- [ ] **Step 5:** Commit: `feat(client): profile persistence, inventory and arena catalog`.

---

### Task 9: Fighter models and skill visuals

**Files:** Create `packages/client/src/render/fighters.ts`, `render/skillFx.ts`; modify `render/players.ts`, `render/scene.ts`, `input/input.ts`, `style.css`.

**Interfaces:**
- Consumes: shared `SkillPhase`, `isShelled`, `spiritPosition`, `LavaRock`, `MatchState.eruption`, and the events from Tasks 1–5.
- Produces:
  - `buildFighter(character: CharacterId, slot: number, opts: { isLocal: boolean; showcase?: boolean }): FighterModel`, where `FighterModel { root: THREE.Group; body: THREE.Group; setPose(pose: "idle" | "walk" | "windup" | "dash" | "shell" | "fall", t: number): void }`. Shapes (must be tellable apart without color): **Elephant** big ears + trunk, **Monkey** round ears + long curled tail, **Turtle** domed shell on its back. All wear the slot-colored belt.
  - `createSkillFx(scene): { onEvent(e: SimEvent, state: MatchState): void; update(state: MatchState, renderTimeMs: number, dt: number): void }`. Draws: the slam wind-up ring growing to 2.0 m during WINDUP, then a shockwave; a dash streak; a shell glow; rocks arcing over 600 ms with a landing shadow; eruption circles glowing for 1.5 s, then a bomb burst; spirits as translucent glowing orbs in slot color at `spiritPosition`.
  - `Controls.setSkillState(s: { label: string; cooldownFrac: number; ready: boolean }): void` draws a cooldown ring on the skill button (CSS conic-gradient); the label is the skill name, or "THROW" for a spirit. The button reaches full opacity when ready.
- [ ] **Step 1:** Implement `fighters.ts` and switch `players.ts` to it. Delete `buildSumo`.
- [ ] **Step 2:** Implement `skillFx.ts` and the skill button ring.
- [ ] **Step 3: Visual check** in Chrome with `pnpm dev`, through a temporary dev-only URL flag `?fx` that spawns one bot of each fighter. Verify every telegraph is visible: the slam ring before impact, eruption circles 1.5 s before impact, rock landing shadows. Remove nothing; `?fx` stays as a dev tool, ignored in production builds (`import.meta.env.DEV`).
- [ ] **Step 4:** `pnpm typecheck && pnpm --filter @splash-sumo/client build`. Expected: clean; gzip JS < 300 KB.
- [ ] **Step 5:** Commit: `feat(client): fighter models and skill/spirit/eruption visuals`.

---

### Task 10: Splash and Home screens (showcase, layout B)

**Files:** Create `packages/client/src/ui/screens/splash.ts`, `packages/client/src/ui/screens/home.ts`; modify `main.ts`, `style.css`, `render/scene.ts` (adds a showcase mount).

**Interfaces:**
- Consumes: `loadProfile/saveProfile`, `CATALOG`, `buildFighter(…, { showcase: true })`.
- Produces: `createSplashScreen(root: HTMLElement, deps: { onContinue(): void }): { show(): void; hide(): void }`: full-screen over the live scene, title **SPLASH SUMO**, a pulsing **"Tap to play"**, footer "A Best & Ben game"; the first pointerdown or keydown anywhere calls `onContinue` once. `main.ts` shows it once per page load, then Home.
- Produces: `createHomeScreen(root: HTMLElement, deps: { gs: GameScene; getProfile(): Profile; setProfile(p: Profile): void; onQuickPlay(): void; onInventory(): void }): { show(): void; hide(): void }`. Plus `GameScene.setShowcase(model: FighterModel | null)`, which places the model at the arena center, idle-animating, with the camera framed slightly left so the fighter sits at ~35% of the width (as in the mockup).
- Layout (approved mockup `home-layout.html` option B): top-left title; the fighter center-left with a "Nickname · Fighter" chip and a "Tap to change ▸" chip (tap → `onInventory`); right column: **⚡ Quick Play** (primary, largest; calls `onQuickPlay`, which opens the Setup screen from Task 12), **🎒 Inventory**, and a disabled **👥 Play with friends · coming soon**. Nickname is editable inline (tap the chip → input; sanitize with the existing `sanitizeNickname`; save on blur/Enter).
- [ ] **Step 1:** Implement the screen and `setShowcase`; replace the M1 home card in `main.ts`.
- [ ] **Step 2: Check in Chrome** at desktop size and at 844×390 (DevTools device mode): the fighter and the right column don't overlap; every control is ≥ 44 px tall; a reload keeps the nickname; the splash shows on load and one tap reaches Home.
- [ ] **Step 3:** `pnpm typecheck`. Commit: `feat(client): splash and home screens`.

---

### Task 11: Inventory screen (collection grid, layout A)

**Files:** Create `packages/client/src/ui/screens/inventory.ts`; modify `main.ts`, `style.css`.

**Interfaces:**
- Consumes: `fightersForGrid`, `CATALOG`, `SKILL_INFO`, `CHARACTERS` (stats), `SKILL_OF`, profile load/save.
- Produces: `createInventoryScreen(root, deps: { getProfile(): Profile; setProfile(p: Profile): void; onBack(): void }): { show(): void; hide(): void }`. The top-left button is **◂ Home** (`onBack`). *(Results' Change fighter goes to the Setup screen, Task 12, instead.)*
- Layout (approved mockup `inventory-layout.html` option A): tabs **Fighters (n)** and **Skins · soon**. Left: a 3-column grid from `fightersForGrid` (empty cells render "?" and aren't selectable; the equipped cell shows an "EQUIPPED" tag). Right panel for the selected cell: emoji/mini render, name + role, Power/Agility/Endurance bars (value / 5), skill name + blurb, and an **Equip** button ("✓ Equipped" when it already is). Selecting a cell doesn't equip; Equip does, and saves immediately. The Skins tab shows the empty state "Skins are coming soon. Your fighters will be able to wear them here."
- [ ] **Step 1:** Implement.
- [ ] **Step 2: Check in Chrome** at 844×390: the grid and panel fit without scrolling; equip → back → Home shows the new fighter; reload keeps it.
- [ ] **Step 3:** `pnpm typecheck`. Commit: `feat(client): inventory screen`.

---

### Task 12: Quick Play setup screen (map · fighter · difficulty)

**Files:** Create `packages/client/src/ui/screens/setup.ts`; modify `main.ts`, `style.css`.

**Interfaces:**
- Consumes: `arenasForPicker`, `fightersForGrid`, `CATALOG`, `SKILL_INFO`, `SKILL_OF`, profile load/save.
- Produces: `createSetupScreen(root: HTMLElement, deps: { getProfile(): Profile; setProfile(p: Profile): void; onBack(): void; onFight(): void }): { show(): void; hide(): void }`.
- Layout (design §7.1 sketch), over the live scene, fits 844×390 without scrolling:
  - top bar: **◂ Back** (`onBack`) and the title **QUICK PLAY**;
  - **MAP** row: one card per `arenasForPicker()` cell. Available: emoji + name, selected one outlined with ✓, tap saves `profile.arena`. `null` cells: 🔒 + "Coming soon", dimmed, not selectable (`aria-disabled="true"`);
  - **FIGHTER** row: one card per owned fighter (`fightersForGrid` without the null padding): emoji, name, role, skill name. Tap equips (`equippedFighter`) and saves; the equipped one shows ✓;
  - **BOTS** row: an **Easy | Medium | Hard** segmented toggle, saves `profile.difficulty`;
  - a primary **FIGHT!** button (bottom-right, the largest control) → `onFight`.
  - Every card/button ≥ 44 px tall; selection is visible without color alone (✓ + outline).
- Routing in `main.ts`: Home's Quick Play → Setup; Setup's Fight! → start the match (wired to the Quick Play loop in Task 13; until then it may start the existing local game).
- [ ] **Step 1: Write failing tests** in `packages/client/test/setup.test.ts` using happy-dom (add `happy-dom` as a client devDependency and set `environment: "happy-dom"` for this file only via `// @vitest-environment happy-dom`):
  - `renders 1 volcano card + 2 coming-soon cards; coming-soon cards ignore taps`.
  - `picking a fighter equips and saves it`.
  - `picking a difficulty saves it`.
  - `opens with the saved picks pre-selected`.
  - `Fight! calls onFight; Back calls onBack`.
- [ ] **Step 2:** Run `pnpm --filter @splash-sumo/client test`. Expected: FAIL.
- [ ] **Step 3:** Implement and wire the routing.
- [ ] **Step 4: Check in Chrome** at 844×390: everything fits, picks survive a reload, Home → Quick Play → Fight! is two taps.
- [ ] **Step 5:** `pnpm test && pnpm typecheck`. Commit: `feat(client): quick play setup screen with map and fighter select`.

---

### Task 13: Quick Play loop, bots in the match, results actions

**Files:** Rename `packages/client/src/game/localGame.ts` → `game/quickPlay.ts`; delete `game/dummyAI.ts`; modify `ui/hud.ts`, `main.ts`.

**Interfaces:**
- Consumes: `BotController`, `pickBotSetup`, `createSkillFx`, `Controls.setSkillState`, the profile, and the screens from Tasks 10–12.
- Produces: `startQuickPlay(gs, controls, hud, opts: { profile: Profile; onHome(): void; onChangeFighter(): void }): { stop(): void }`.
  - Players: you (`profile.equippedFighter`, `profile.nickname`) + 3 bots from `pickBotSetup(seed, 3)`, each with a `BotController(id, profile.difficulty, seed ^ slot)`.
  - Each tick: bot inputs come from their controllers, and yours from the controls. Feed every `SimEvent` to `skillFx.onEvent`, and keep the existing hit/elimination feedback (shake, haptics, banners). Add banners for `eruptionIncoming` ("ERUPTION! 🌋 Get out of the circles!") and `suddenDeath`.
  - Skill button state comes from your player each frame (alive → your skill; dead → THROW with `rockCooldownMs`).
  - `hud.showResults(result, players, localId, actions: { onAgain; onChangeFighter; onHome }, subtitle: string)`, where the subtitle reads e.g. `"vs Medium bots · 47.3 s"`. Causes show `Eruption` and `Lava rock by <name>`.
  - Results **Change fighter** → `onChangeFighter` → the Setup screen (picks kept), where **Fight!** starts a new Quick Play with the newly equipped fighter, arena and difficulty.
  - The match uses `profile.arena`; only `arena.volcano` exists, which is the simulation's current arena.
- [ ] **Step 1:** Implement, then delete `dummyAI.ts`.
- [ ] **Step 2: Play-check in Chrome:** a full match on each difficulty; get knocked out and throw rocks as a spirit; see the eruption; check Play again, Change fighter → pick Monkey on Setup → Fight! (you are now the Monkey), and Home. No console errors (`read_console_messages` with `onlyErrors`).
- [ ] **Step 3:** `pnpm test && pnpm typecheck && pnpm build`. All clean.
- [ ] **Step 4:** Commit: `feat(client): quick play vs bots with results actions`.

---

### Task 14: GitHub Pages deploy pipeline (not yet live)

**Files:** Create `.github/workflows/pages.yml`; modify `packages/client/vite.config.ts`, `README.md`.

**Interfaces:**
- `vite.config.ts`: `base: "./"` (relative; works under any repo name).
- `pages.yml`: on `push` to `main` + `workflow_dispatch`. Jobs: checkout → `pnpm/action-setup` → `actions/setup-node` (Node 22 LTS, pnpm cache) → `pnpm install --frozen-lockfile` → `pnpm test` → `pnpm --filter @splash-sumo/client build` → `actions/upload-pages-artifact` (path `packages/client/dist`) → `actions/deploy-pages`. Permissions: `pages: write`, `id-token: write`, `contents: read`. Pin each action to its current major version.
- [ ] **Step 1:** Write the workflow and the base change. Build locally, then serve `dist` from a sub-path to prove relative paths work: `cd packages/client && pnpm build && npx vite preview --base /splash-sumo/` and load `http://localhost:4173/splash-sumo/`. Expected: the game loads, no 404s.
- [ ] **Step 2:** README: replace the Milestone table's row status and add a "▶ Play it" link placeholder `https://bestwwr.github.io/splash-sumo/` marked "(goes live after the playtest)".
- [ ] **Step 3:** Commit on the branch: `ci: github pages deploy workflow`. **Do not merge yet.**

---

### Task 15: Playtest gate, then go live (PO)

**Files:** `DECISIONS.md`.

- [ ] **Step 1:** Push the branch and open a PR to `main` (do not merge). Share the Wi-Fi dev URL (`pnpm dev`, the Network address) with the PO.
- [ ] **Step 2: Playtest (PO + 2 friends, casual players):** each plays **5 matches vs Easy and 5 vs Hard**, noting their placement each time. **Pass:** vs Easy, each tester finishes top 2 in ≥ 3 of 5; vs Hard, each finishes top 2 in ≤ 2 of 5.
- [ ] **Step 3:** If it fails: retune the bot difficulty in `config.ts` (Task 6 knobs only), re-run `pnpm sim` (the difficulty and balance sims must still pass), log it in `DECISIONS.md`, and repeat Step 2.
- [ ] **Step 4:** On a pass, log the playtest results in `DECISIONS.md`. With the PO's OK, enable Pages for the repo (`gh api -X POST repos/bestwwr/splash-sumo/pages -f build_type=workflow`), merge the PR, and confirm the Actions run deploys. Open the live URL on a phone and play one match.
- [ ] **Step 5:** Update the README link (remove "goes live after the playtest").
