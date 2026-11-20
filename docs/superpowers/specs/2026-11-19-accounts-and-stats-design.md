# Player accounts, profile sync and stats (Supabase): design

Status: draft for PO approval · 2026-11-19 · Builds on the online multiplayer branch (`feat/online-multiplayer`). Changes SPEC F1/privacy row "no accounts" to "**no required** accounts" (see §4, D-ACC-1).

## 1. Intent

The platform should recognize every player across visits, and a player should be able to keep their profile and stats on any device. Today identity is a random token in `localStorage` and the profile (`packages/client/src/meta/profile.ts`) lives only on the device. Clearing the browser or changing phones makes you a new player, and nothing is remembered after a match.

**Success:** a guest plays a few matches on a phone, later logs in on a laptop with Google or an email link, and sees the same nickname, fighter and stats. Play still starts from a link with zero sign-up steps.

## 2. Goals / non-goals / anti-goals

**Goals**
- Every visitor gets a stable player ID automatically (silent guest account). No screen, no taps.
- Optional login (Google, email magic link) upgrades that same account and lets it be restored on other devices.
- Profile and stats stored server-side and loaded on any device after login.
- Online-match stats written by the game server (trusted); solo-match stats written by the client.
- Guest → existing-account merge: stats are added together, the logged-in account's profile wins, the guest is retired.
- Separate Supabase projects for test (staging) and prod, matching the two Cloudflare environments.

**Non-goals (later)**
- Leaderboards, public profiles, friends lists, viewing other players' stats.
- Anti-cheat for solo stats (they are personal, so cheating only fools yourself).
- Password login, Apple/Facebook login.
- Analytics (PostHog) and the SPEC Phase-C metrics pipeline. Stats here are player-facing, not analytics.

**Anti-goals** (would be a failure even if it "works")
- Any login wall or pop-up before the first match, or anything that adds taps to "link → play".
- The game breaks or blocks when Supabase is down, slow or paused. Solo and online play must still work; stats are best-effort.
- Losing a player's progress on login or merge.
- Exposing the Supabase service key to browsers, or letting a client write online stats or other users' data.
- Collecting personal data beyond what login needs (the email/Google identity Supabase stores). No real names, no contacts.

## 3. Constraints

- Supabase free plan: 2 projects (exactly test + prod), 50,000 monthly active users (anonymous users count), 500 MB database. Free projects **pause after ~7 days of inactivity**; prod needs a keep-alive (§5.6). Verify current limits when setting up.
- Supabase built-in email sending is heavily rate-limited (a few emails per hour). Fine for testing; prod needs custom SMTP (free tier of an email provider) before public launch. This is a launch checklist item, not a blocker for building.
- Google login needs an OAuth client in Google Cloud Console, created by the PO with step-by-step guidance.
- The PO creates the Supabase account and projects; Claude does not sign up or handle passwords. Keys go into env vars / Wrangler secrets that the PO pastes or approves.
- `packages/shared` stays pure (no network or Supabase SDK). All tuning numbers in `config.ts`.
- Client stays static on GitHub Pages / Cloudflare assets. The Supabase **anon (publishable) key** may be in the client bundle; the **service-role (secret) key** only in Cloudflare Worker secrets.
- Keep the bundle lean: `@supabase/supabase-js` is lazy-loaded after the first frame so it doesn't delay the splash.

## 4. Approaches (decided)

- **A. Automatic Supabase guest account for everyone, optional login upgrades it. (Picked.)** Supabase anonymous sign-in on first visit; Google via identity linking, email via `updateUser({ email })` on the anonymous user. Online stats are written by the Cloudflare Worker with the service key after verifying the player's Supabase token.
- **B. Guests stay device-only; Supabase only after login.** Dropped: the PO requires the platform to recognize guests too.
- **C. Own auth on Cloudflare (D1 + custom login).** Dropped: the PO asked for Supabase, and hand-rolled auth is costly and risky.

**D-ACC-1:** SPEC F1 ("no sign-up") still holds: nobody has to sign up. The SPEC privacy row changes from "no accounts" to "anonymous accounts by default; optional login stores an email/Google identity". Record in DECISIONS.md and add a short privacy note on the Profile screen.

## 5. Design

### 5.1 Identity
- On boot the client restores a Supabase session from local storage. If there is none, it calls anonymous sign-in. This happens in the background; the splash/Home never wait on it.
- **The player ID is the Supabase `auth.users.id` (UUID).** Online rooms keep using the existing per-device reconnect token for slot reclaiming. The `join` message gains an optional `accessToken` (the Supabase JWT) so the server can attribute stats. Bump `PROTOCOL_VERSION`.
- If Supabase is unreachable, the game runs exactly as today (device profile, no stats). It retries sign-in on the next boot. Matches played without a session aren't recorded (accepted loss, since stats are best-effort).
- **Device profile upload rule:** whenever the signed-in user has **no `profiles` row yet** (first boot after this ships, or a brand-new user), the device profile (`lavasumo.profile.v1`) is uploaded as their profile, so nobody loses their nickname or fighter. If a row exists, the server copy wins (§5.5). In the merge case the target account's profile wins (PO decision).
- **Token lifetime:** the server verifies the token once at `join` and trusts that user ID for the rest of the room's life (a match is minutes; the ~1 h token expiry doesn't matter). A reconnect sends a fresh token.
- **Abuse:** enable anonymous sign-ins with Supabase's built-in per-IP rate limit for anonymous sign-ups (keep the default or lower it). CAPTCHA is deferred until abuse is seen.

### 5.2 Data model (Postgres in Supabase)
- `profiles` (1 row per user): `user_id` (PK, → auth.users), `nickname`, `equipped_fighter`, `difficulty`, `arena`, `owned` (text[]), `equipped_skins` (jsonb), `updated_at`. Mirrors the client `Profile` type.
- `player_stats` (1 row per user): counters: `matches`, `wins`, `solo_matches`, `solo_wins`, `online_matches`, `online_wins`, `wins_easy`, `wins_medium`, `wins_hard`, per-fighter `matches_<fighter>` / `wins_<fighter>` (or a jsonb `by_fighter` map; builder's call), `shoves_dealt`, `times_shoved`, `best_place`, `current_streak`, `best_streak`, `updated_at`.
- `match_history`: `id`, `user_id`, `played_at`, `mode` (`solo`|`online`), `difficulty` (solo only), `fighter`, `place`, `players`, `cause` (`survived`/`shove`/`floor`/`rock`/…), `shoves_dealt`, `duration_ms`. Only the latest 20 per user are kept (trim on insert).
- **Row Level Security on every table.** A user can read their own rows and update their own `profiles` row. Stats and history are written **only** through:
  - `record_solo_match(...)`, a Postgres function (`security definer`) callable by the signed-in user for their own ID only. It validates inputs (place 1–4, known fighter and difficulty, sane duration) and updates stats + history in one transaction.
  - The Worker, using the service key, for online matches.
- Stat definitions: a "win" = place 1 and `MatchResult.draw === false` (a draw sets `draw: true`; tied places share a number). Places are 1–4: matches never exceed 4 players (`NET_MAX_HUMANS` 4, bots fill to 4). "Shoves dealt" = eliminations credited to you with cause `SHOVE`. "Times shoved" = your elimination had cause `SHOVE`. A streak counts consecutive wins across both modes.

### 5.3 Who writes what
- **Solo:** on the results screen the client calls `record_solo_match` once (idempotency key = local match seed + start time, so a retry doesn't double count).
- **Online:** when a room reaches RESULTS, the `MatchRoom` DO calls a service-role-only Postgres function `record_online_match(match_id, rows[])` once, with one row per human that has a verified user ID (bots and unverified players skipped). `match_id` = room code + match start time. A `recorded_matches(user_id, match_key)` unique constraint (shared with solo's idempotency key) makes retries safe: timeout-then-success never double counts. It retries a couple of times and gives up quietly; the match flow never waits on it.
- **Merged guests:** if a user ID in a write was merged away (e.g. the guest logged in to another account mid-match), the function resolves it through `merged_users(guest_id → target_id)` and credits the target. Merge therefore keeps an alias row rather than leaving dangling IDs.
- **Token verification in the Worker:** verify the Supabase JWT signature with the project's public signing keys (JWKS, cached), plus `exp` and audience. Never trust a user ID sent without a valid token.

### 5.4 Login and merge
- **Profile screen** (new; reached from a Home button): stats summary, per-fighter wins, recent matches, account state (Guest / email), login buttons, Log out, privacy note. Layout per the sketch the PO approved:
  ```
  ┌ PROFILE ─────────────────────────────────────┐
  │ 🐢 Ben                         Guest player   │
  │ Matches 42 · Wins 11 (26%) · Best streak 4    │
  │ Solo 30 · Online 12 · Shoves 57               │
  │ 🐘 8 wins   🐒 2 wins   🐢 1 win              │
  │ Save your progress on any device:             │
  │ [ Continue with Google ]  [ Email me a code ] │
  └───────────────────────────────────────────────┘
  ```
- **Upgrade (no existing account):** Google → link the identity to the current guest user; email → set the email on the guest user and confirm with a **6-digit code typed into the game** (email OTP), so it works even when the mail app opens links in another browser. Same user ID, nothing to merge. (The button reads "Email me a code"; this is my call, replacing "Email me a link" in the sketch.)
- **Email for an existing account:** sign in to it with the same 6-digit code flow in the same tab, so the guest token is still at hand for the merge.
- **Merge (identity already belongs to another account):** before switching, the client keeps the guest's access token. It signs in to the existing account, then calls Worker `POST /account/merge` with both tokens. The Worker verifies both and, with the service key in one transaction (a `merge_guest_into(guest, target)` SQL function): adds the guest's counters into the target's stats, `best_*` = max, streak = target's, history = the newer 20 of both, profile = target's, moves the guest's `recorded_matches` keys to the target (so late retries stay deduped), writes `merged_users(guest → target)`, then deletes the guest's data and auth user. Idempotent if repeated.
- **Log out:** signs out, clears the previous account's profile and history from this device (shared devices), then immediately starts a fresh guest with a default profile (the game always has a player ID).
- **Nudge:** after a guest's 3rd recorded match, the results screen shows one dismissible line: "Log in to keep your stats on other phones." It is shown at most once per device.
- **Redirects:** login redirect URLs must cover the prod Pages URL, the staging Worker URL and localhost. Login returns to Home with the Profile screen open.

### 5.5 Profile sync
- Profile edits (nickname, fighter, difficulty, arena) save to the device immediately (as today), then are pushed to `profiles` debounced (~1 s). On boot/login the server profile is loaded and overwrites the device copy. Last write wins; no conflict UI.
- A server profile load must never block Home: show the device profile first, then swap it in quietly when the server copy arrives.

### 5.6 Environments and operations
- Two Supabase projects: **lava-sumo-staging** and **lava-sumo**. Schema lives in versioned SQL migrations in the repo (e.g. `supabase/migrations/`) and is applied to staging first, then to prod with PO OK.
- Client build env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` per environment, set the same way as `VITE_SERVER_URL` today (staging: `build:staging` script; prod: Pages workflow repo variables). `/account/merge` lives on the same Worker as the rooms (same `serverUrl()`), and its CORS uses the existing allow-list. Worker secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` per Worker (`wrangler secret put`, run by the PO or approved per command).
- Keep-alive: a Cloudflare Worker **cron trigger** (daily) does a trivial query on the prod project so it never pauses. Staging may pause; that's fine.
- Unset Supabase env (local dev without keys) means accounts are off and the game behaves like today.

## 6. Testing
- SQL: RLS denies reading/writing other users' rows; `record_solo_match` validates and updates counters; `merge_guest_into` sums and keeps max correctly and is idempotent. Run against a local Supabase (Supabase CLI) or the staging project.
- Worker: JWT verification (valid / expired / wrong signature / wrong project); online results produce one stats write per verified human and none for bots; `/account/merge` rejects mismatched or invalid tokens.
- Client: boot with no session → guest sign-in; Supabase down → game still playable and no errors shown; device profile migration; debounced profile push; solo result recorded once on retry; nudge shown once.
- Manual (staging): guest plays on phone → logs in with email → laptop logs in → same stats; merge case (guest with stats logs in to an existing account → counts add up).

## 7. Left to the builder
Exact supabase-js version (pin current stable), counter column layout (columns vs jsonb), the JWT library (or WebCrypto), history trimming mechanism, Profile screen styling (match existing screens), how the auth module is lazy-loaded, and migration tooling details.

## 8. Open (not blocking)
- Custom SMTP provider for prod email (before public launch).
- Whether to show stats on the results screen ("Win #12!").
- Account deletion button (good practice; add if cheap).
