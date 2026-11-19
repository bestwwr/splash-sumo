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

## Toolchain
- Node 26, pnpm 12 workspaces, TypeScript 7 (`strict`, `noUncheckedIndexedAccess`), Vite 8, Vitest 5, three r187.
