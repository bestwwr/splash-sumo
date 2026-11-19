# Lava Sumo

**Sumo in a volcano.** 90-second matches, one thumb, send a link and play.
Up to 4 players stand on basalt tiles over a lava lake. The floor cracks and melts tile by tile, and you shove each other in. Last one standing wins.

> Portfolio project: a Product Owner shipping a real-time multiplayer browser game with AI coding agents. Full spec: [`SPEC.md`](SPEC.md) · build decisions: [`DECISIONS.md`](DECISIONS.md).

## Play it here

[**Play Lava Sumo**](https://bestwwr.github.io/splash-sumo/) (goes live after the playtest)

## Status

| Milestone | Scope | Status |
|---|---|---|
| 1 · Core loop (local) | Shared deterministic sim, hex arena, collapse, shove, elimination, joystick + keyboard, 3 dummies | ✅ Built, pending real-phone check |
| 2 · Online | Cloudflare Workers + Durable Objects, private rooms, server snapshots + interpolation, reconnection | 🧪 Built, playtest pending |
| 3 · Characters & bots | Elephant / Monkey / Turtle skills, ember spirits, eruption, bot difficulties, solo Quick Play screens | 🧪 Built, playtest pending |
| 4 · Polish & launch | Art, audio, PWA, analytics, itch.io | ⏳ |

## Play with friends

Home → **Play with friends** → **Create room**, then share the link or the room code. Up to 4 players; bots fill any empty slots.

## Run it

```bash
pnpm install
pnpm dev          # client on http://localhost:5173 (plus a Network URL for phones) and local server on :8787
pnpm test         # shared simulation unit tests
pnpm typecheck
pnpm build
pnpm deploy:staging   # staging Worker lava-sumo-staging (client + server, TEST badge); deploy freely
pnpm deploy:prod      # prod Worker lava-sumo; only with maintainer approval
```

To test online play locally, use two browser windows on different origins (e.g. `localhost:5173` and `127.0.0.1:5173`): tabs on one origin share a player token.

**Controls:** phone: drag anywhere on the left half to move. Desktop: WASD / arrow keys.

## Layout

```
packages/
  shared/   pure deterministic simulation (no DOM, no Date.now, seeded RNG); used by client and server
    src/    config · rng · hex · characters · types · physics · collapse · simulation
    test/   hex, rng, physics/shove, collapse schedule, simulation
  client/   Vite + Three.js
    src/    render/ (scene, arena, lava, players, fx) · input/ · ui/ · game/ (local loop, dummy AI)
```
