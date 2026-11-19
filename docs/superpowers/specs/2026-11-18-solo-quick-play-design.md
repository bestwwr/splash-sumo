# Solo Quick Play, Home & Inventory — Design

**Date:** 2026-11-18 · **Status:** Ready for PO approval · **Builds on:** `SPEC.md`, `DECISIONS.md` (Milestone 1)

## 1. Intent

Make Lava Sumo a **complete solo game that strangers can enjoy at a public link before online play exists**. A new player opens the link, sees their fighter on a volcano arena, taps Quick Play, and fights three bots at a difficulty they chose. The three fighters feel different because each has its own skill. Getting knocked out early doesn't mean dead time, because you come back as an ember spirit and keep influencing the fight.

This pulls most of the spec's Milestone 3 (characters, skills, bots, ember spirits, eruption) ahead of Milestone 2 (online), and adds a home page, an inventory and a public deploy.

## 2. Goals

1. **Home page (layout "B", character showcase):** the equipped fighter stands center-stage on the live 3D arena. On the right: a big **Quick Play** button, an **Easy / Medium / Hard** toggle directly under it, **🎒 Inventory**, and a greyed-out **👥 Play with friends · coming soon**. Nickname is editable on the home page.
2. **Quick Play:** one tap from home → 3-2-1 → match vs **3 bots** at the selected difficulty.
3. **Inventory (layout "A", collection grid):** tabs **Fighters** and **Skins · coming soon**. Left: a grid of fighter slots (Elephant, Monkey, Turtle, then empty "?" slots that hint more are coming). Right: the selected fighter's name, role, Power/Agility/Endurance bars, skill name + one-line description, and an **Equip** button (shows "✓ Equipped" for the current one).
4. **All 3 fighters are owned from the first visit.** No unlocking, no currency.
5. **Skills** for all three fighters, per SPEC A.5, each with a visible telegraph and counter-play.
6. **Bots** with three difficulties, per SPEC §3.4, meeting the SPEC acceptance bar: *Hard bots usually beat casual players; Easy bots usually lose.*
7. **Ember spirits** (SPEC A.6): eliminated players float at the arena edge and throw lava rocks.
8. **Eruption** (SPEC A.3): once per match.
9. **Results screen** gets **Play again** (same fighter + difficulty), **Change fighter** (→ Inventory → back into a match) and **Home**.
10. **Public deploy to GitHub Pages**, updated automatically on push to `main`.

## 3. Non-goals

- Online play, rooms, invite links (Milestone 2). The Friends button exists only as a disabled teaser.
- Unlocking, currency, progression, accounts, cloud save.
- Actual skins (only the empty **Skins** tab and a data model that can hold them).
- Final art and audio, analytics (PostHog), Sentry, PWA, itch.io page (Milestone 4).
- More than 3 fighters or 1 arena.

## 4. Anti-goals (would be a failure even if it "works")

- **Fighters that feel the same.** If picking a different fighter doesn't change how you play, the inventory is pointless.
- **Unfair-feeling bots:** bots that read your input, are pixel-perfect, or win by cheating physics. Bots use exactly the same input struct and simulation as the player.
- **Dead time:** a solo player knocked out at 15 s staring at nothing for a minute.
- **More taps:** a returning player must be **one tap** from a match (Quick Play), and Play again must be one tap.
- **An inventory that has to be redesigned** to add the 4th fighter or the first skin.
- **Breaking Milestone 2:** anything gameplay-relevant living outside `packages/shared`, or anything non-deterministic inside it.

## 5. Constraints

- SPEC §0 rules still hold: `packages/shared` is pure (no DOM, no network, no `Date.now()`, no `Math.random()`); TypeScript `strict`; **all tuning numbers in `packages/shared/src/config.ts`**; unit tests for shared logic.
- Mobile-first: 60 fps target on a mid-range phone; landscape; touch + keyboard (WASD/arrows + Space).
- Static hosting only: no server in this phase.
- Bundle stays far under the 5 MB budget (currently ~150 KB gzip).

## 6. Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| **A** | Plain HTML/CSS screens over the canvas (like today); gameplay + bots in `packages/shared`; data-driven inventory catalog | Fits the existing code; no new library; screen code is a bit more manual | **Chosen** |
| B | Same, plus Preact for menu screens | Tidier as screens multiply; adds a second UI style and rewrite churn | Not now, revisit in M2 if menus get unwieldy |
| C | Menus rendered inside Three.js | Most "game-like"; several times the work for text, layout, touch; harder to read on small phones | Rejected |

Chosen by the PO: **A**.

## 7. Decided design

### 7.1 Screens & flow

*(Amended 2026-11-19 at the PO's request: a splash page, and a Quick Play setup screen to pick the map and fighter.)*

```
SPLASH ─tap─▶ HOME ──Quick Play──▶ SETUP (map · fighter · difficulty) ──Fight!──▶ MATCH (you + 3 bots) ──▶ RESULTS
                │  ▲                     ▲                                                               │ Play again ─▶ MATCH (same picks)
                │  │                     └──────────────────── Change fighter ───────────────────────────┤
                ▼  │◀──────────────────────────────────── Home ─────────────────────────────────────────┘
              INVENTORY (also opened by tapping the fighter on Home)
```

- **Splash:** shown once per page load over the live arena + lava scene: the game title, a pulsing **"Tap to play"**, and a small credit line. Any tap or key goes to Home. (The tap is also the user gesture later used to unlock audio and fullscreen.)
- **Home** (mockup B): the equipped fighter showcased at the centre, **⚡ Quick Play**, **🎒 Inventory**, disabled **👥 Play with friends · coming soon**. *Builder's call:* the Easy/Medium/Hard toggle moves from Home to the Setup screen, so all match choices live in one place.
- **Quick Play Setup:** three rows, all **pre-selected with your last picks**, so Home → Quick Play → **Fight!** is two taps.
  - **Map:** the Volcano card (selected) plus "coming soon" locked cards (padded to 3 cards). Locked cards can't be picked.
  - **Fighter:** your owned fighters as cards with name, role and skill name; picking one equips it (saved immediately, same as Inventory's Equip).
  - **Difficulty:** Easy | Medium | Hard.
  - **◂ Back** returns to Home; **Fight!** starts the match.

  ```
  ◂ Back                QUICK PLAY
  MAP       [🌋 Volcano ✓] [🔒 Soon] [🔒 Soon]
  FIGHTER   [🐘 Elephant ✓] [🐒 Monkey] [🐢 Turtle]
  BOTS      ( Easy | Medium✓ | Hard )          [ FIGHT! ]
  ```
- **Results → Change fighter** opens Setup (with your picks kept); Fight! from there starts a new match.
- Tapping the showcased fighter on Home opens Inventory (same as the 🎒 button). Inventory is browse-only (◂ Home).
- Home, Splash and Setup all sit over the real arena + lava scene.

### 7.2 Persistence (this device only, `localStorage`, wrapped in try/catch)

| Key | Value | Default |
|---|---|---|
| nickname | 1–12 chars, sanitized (existing rule) | prompt-free random `PlayerNNN` |
| equipped fighter | `elephant` \| `monkey` \| `turtle` | `elephant` |
| bot difficulty | `easy` \| `medium` \| `hard` | `medium` |
| selected arena | an available arena ID (see 7.3) | `arena.volcano` |
| inventory | owned item IDs (see 7.3) | all 3 fighters |
| anonymous ID | UUID (already exists) | generated once |

If storage is unavailable (private mode), the game still works with defaults for the session.

### 7.3 Inventory data model (built to grow)

- A **catalog** (static data in the client) lists items: `{ id, kind: "fighter" | "skin", name, role?, fighterId? (for skins), order }`. Fighter gameplay stats stay in `packages/shared/src/characters.ts`; the catalog references them by ID and never duplicates numbers.
- An **owned set** (persisted) lists item IDs. At launch it is initialized to all 3 fighters; unknown IDs are ignored, and newly added catalog fighters can be granted by a simple "default owned" flag.
- **Equipped state:** one equipped fighter; *(future)* one equipped skin per fighter. The schema reserves that field now so skins don't need a migration.
- **Arenas** (PO 2026-11-19, D-SQP-3): a static arena list `{ id, name, emoji, available, order }`. Only `arena.volcano` (the current lava arena, which the simulation already plays) is available now; the Setup screen pads with "coming soon" cards. New arenas get added as data later; making the simulation take an arena definition is future work, not this feature.
- **Grid:** the Fighters tab shows owned fighters first, then empty "?" slots padding to a full row (minimum 6 cells in a 3×2 grid at landscape phone size). The Skins tab shows a friendly "coming soon" empty state.

### 7.4 Skills (shared simulation, SPEC A.5 values)

| Fighter (P/A/E) | Skill | Behavior | Cooldown | Telegraph / counter-play |
|---|---|---|---|---|
| 🐘 Elephant 5/2/3 | **Ground Slam** | 0.4 s wind-up (can't move), then radial knockback to everyone within 2.0 m | 8 s | Visible wind-up (rear-up animation + growing ring on the floor); step out of the ring |
| 🐒 Monkey 2/5/3 | **Dash** | 4 m in 0.25 s in the facing/input direction; crosses 1-tile gaps; a hit during the dash = ×1.5 knockback | 6 s | Mis-aimed dash into lava = self-elimination; short streak trail |
| 🐢 Turtle 3/2/5 | **Shell** | 1.5 s immobile, knockback-immune; anyone who collides is reflected at full force | 10 s | Shell visual; the floor can still melt under it |

- The skill button (right thumb) shows a **cooldown ring**; Space on desktop.
- Skills run inside `step()` at the "update skills/cooldowns" stage of the tick order (SPEC §3.1) and produce `skillUsed` events for VFX.
- Exact knockback magnitudes (slam strength, reflect formula) are tuning numbers in `config.ts`, set by the builder to the balance target below.
- **Balance target (SPEC A.5), measured as *share of wins*:** in headless bot-vs-bot matches with **4 bots of random fighters** (repeats allowed), each fighter's share of all match wins is **30–36%** (the three shares sum to ~100%; draws excluded; a win counts once for the winner's fighter). Gate runs at **Hard** (skills fully used) and is reported at **Medium** too; Easy is not a balance gate. *(Builder's call.)*
- **Triangle** (Elephant > Turtle > Monkey > Elephant) is a **design intent**, checked informally with 1-v-1 headless sims and reported in `DECISIONS.md`; it does not block. *(Builder's call.)*

### 7.5 Ember spirits (SPEC A.6)

- On elimination, the player becomes a spirit floating above the lava at the arena edge (keeps slot color), visibly "not a fighter" (translucent/glowing).
- The joystick aims; the skill button **throws a lava rock**: soft auto-aim cone, 0.6 s arcing flight with a landing shadow.
- Impact: 30% of a base shove + 0.2 s stagger; it cannot eliminate directly, only push someone already near the edge. Cooldown 4 s.
- **Bots become spirits too** and throw rocks (so the player gets pelted fairly, and bots knocked out early stay in the fight).
- Credit: if a rock push leads to a fall within the shove-credit window, the cause is `LAVA_ROCK` by that spirit.

### 7.6 Eruption (SPEC A.3)

- Once per match at a seeded time t ∈ [30, 50] s: rumble + camera shake; **3–4 target circles (r = 1.5 m)** glow on the floor for **1.5 s**, then lava bombs land: radial knockback ≈ 40% of a shove; tiles hit go to WARNING.
- Cause on a resulting fall: `ERUPTION`.
- Must respect the M1 floor rules (D-M1-1/D-M1-5): it must not break the "no isolation before 30 s" guarantee, so it fires only at ≥ 30 s.

### 7.7 Bots (SPEC §3.4)

- Bots live in **`packages/shared`** (pure, seeded, deterministic), produce the same `PlayerInput` as humans, and run client-side for now. In Milestone 2 the server imports the same module unchanged.
- Utility AI: score candidate move directions on distance from edge, tiles about to sink, opponents near the edge, and threats (Elephant wind-up, incoming dash, eruption circles); pick the best with difficulty-based noise. Think at 10 Hz, steer at 30 Hz; ≤ 1 ms per bot per tick.

| Difficulty | Reaction delay | Behavior |
|---|---|---|
| Easy | 600 ms | Wanders, leaves warning tiles late, rarely uses its skill |
| Medium | 300 ms | Avoids warning tiles, holds center, charges players near the edge, uses its skill in range |
| Hard | 120 ms | Baits opponents onto warning tiles, times skills, dodges wind-ups and eruption circles |

- Each bot gets a **random fighter** and a **fun name** from a list; two bots may share a fighter.
- They replace the M1 dummy AI, which is deleted.
- **Acceptance, part 1 (headless, repeatable):** over many seeded matches, *Hard beats Medium beats Easy* clearly in win rate.
- **Acceptance, part 2 (human playtest, decided by the PO; blocks the public deploy):** the PO + 2 friends (casual, non-gamer players) each play **5 matches vs Easy and 5 vs Hard**. Pass if vs **Easy** they finish **top 2 in most matches**, and vs **Hard** they finish **top 2 in fewer than half**. On a fail, retune and re-test before deploying.

### 7.8 Fighter looks (placeholder until the M4 art pass)

- The three fighters must be **tellable apart at a glance** on a phone, in the match, the home showcase and the inventory grid, by shape, not just color (e.g. trunk + big ears, long tail + round ears, shell). Built from simple primitives; slot color stays on the belt.

### 7.9 Results screen

Placement, cause of elimination (now including Eruption and Lava rock), match time, and the three actions from 7.1. Quick Play difficulty is shown ("vs Medium bots").

### 7.10 Deploy

- A GitHub Actions workflow builds the client and publishes it to **GitHub Pages** on every push to `main`. **The first public deploy waits until the playtest in 7.7 passes** (until then, testers play the local/Wi-Fi dev build).
- The build uses a **relative base path** so it works under any repo name; only the README "Play" link changes if the repo is renamed. *(Builder's call.)* The game name/repo rename question stays open but no longer blocks.
- Pages must be enabled for the repo (a repo setting); this is done once, with the PO's OK.
- README gets a **"Play it here"** link.

## 8. Left to the builder

- Exact tuning of skill strengths, bot scoring weights and noise, to hit the balance and difficulty targets (in `config.ts`, logged in `DECISIONS.md`).
- Code structure inside `client/src/ui` for the screens, transitions and animations between them.
- Placeholder model details within 7.8.
- Bot name list, empty-state copy for the Skins tab, exact Home/Inventory spacing (following the approved mockups: `.superpowers/brainstorm/…/home-layout.html` option B, `inventory-layout.html` option A).
- Test plan details, beyond: unit tests for each skill, ember-spirit rock, eruption scheduling and determinism; headless bot-difficulty and fighter-balance simulations.

## 9. Open items needing the PO

- Game name / repo name: affects only the public URL and README link now. See 7.10.
