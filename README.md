# Lava Sumo

**Sumo in a volcano.** 90-second matches, one thumb, send a link and play.
Up to 4 players stand on basalt tiles over a lava lake. The floor cracks and melts tile by tile, and you shove each other in. Last one standing wins.

> Portfolio project: a Product Owner shipping a real-time multiplayer browser game with AI coding agents. Full spec: [`SPEC.md`](SPEC.md) · build decisions: [`DECISIONS.md`](DECISIONS.md).

## Status

| Milestone | Scope | Status |
|---|---|---|
| 1 · Core loop (local) | Shared deterministic sim, hex arena, collapse, shove, elimination, joystick + keyboard, 3 dummies | ✅ Built, pending real-phone check |
| 2 · Online | Colyseus server, private rooms, prediction + interpolation, reconnection | ⏳ |
| 3 · Characters & bots | Elephant / Monkey / Turtle skills, ember spirits, eruption, bot difficulties | ⏳ |
| 4 · Polish & launch | Art, audio, PWA, analytics, itch.io | ⏳ |

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:5173, plus a Network URL for phones on the same Wi-Fi
pnpm test         # shared simulation unit tests
pnpm typecheck
pnpm build
```

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
