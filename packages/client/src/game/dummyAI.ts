/**
 * Milestone-1 dummy players: "3 random dummy players" (SPEC §7).
 * They wander randomly, mostly avoid the edge and glowing tiles, and sometimes
 * charge the nearest player so shoves happen. Real utility-AI bots: Milestone 3.
 */
import {
  CONFIG,
  maxSpeed,
  TileState,
  createRng,
  hexKey,
  worldToHex,
  type MatchState,
  type Player,
  type PlayerInput,
  type Tile,
} from "@lava-sumo/shared";

interface Brain {
  dirX: number;
  dirZ: number;
  nextThinkMs: number;
  chargeId: string | null;
  chargeUntilMs: number;
}

export function createDummyAI(seed: number) {
  const rnd = createRng(seed);
  const brains = new Map<string, Brain>();

  const safeAt = (idx: Map<string, Tile>, x: number, z: number) => {
    const h = worldToHex(x, z);
    const t = idx.get(hexKey(h.q, h.r));
    return t !== undefined && t.state === TileState.SOLID && t.warnAtMs < 0;
  };

  function think(p: Player, state: MatchState, idx: Map<string, Tile>, b: Brain) {
    b.nextThinkMs = state.timeMs + 450 + rnd() * 900;
    // Sometimes go after the nearest living opponent.
    const others = state.players.filter((o) => o.alive && o.id !== p.id && o.fallingMs < 0);
    // Charge only from safe footing, and give up after a short burst (no endless chasing).
    const nearEdge = !safeAt(idx, p.x * 1.25, p.z * 1.25);
    if (others.length && !nearEdge && rnd() < 0.22) {
      others.sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z));
      b.chargeId = others[0]!.id;
      b.chargeUntilMs = state.timeMs + 700 + rnd() * 600;
      return;
    }
    b.chargeId = null;
    // Otherwise pick a random direction; prefer ones that land on safe floor.
    let best = { x: 0, z: 0, score: -Infinity };
    for (let i = 0; i < 6; i++) {
      const a = rnd() * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      let score = rnd() * 0.5;
      for (const d of [0.8, 1.6]) if (safeAt(idx, p.x + dx * d, p.z + dz * d)) score += 1;
      if (score > best.score) best = { x: dx, z: dz, score };
    }
    const mag = 0.5 + rnd() * 0.5;
    b.dirX = best.x * mag;
    b.dirZ = best.z * mag;
  }

  return {
    inputs(state: MatchState, ids: string[], seq: number): Record<string, PlayerInput> {
      const idx = new Map(state.tiles.map((t) => [hexKey(t.q, t.r), t]));
      const out: Record<string, PlayerInput> = {};
      for (const id of ids) {
        const p = state.players.find((q) => q.id === id);
        if (!p || !p.alive) continue;
        let b = brains.get(id);
        if (!b) {
          b = { dirX: 0, dirZ: 0, nextThinkMs: 600 + rnd() * 800, chargeId: null, chargeUntilMs: 0 };
          brains.set(id, b);
        }
        if (state.timeMs >= b.nextThinkMs) think(p, state, idx, b);

        let dx = b.dirX, dz = b.dirZ;
        if (b.chargeId && state.timeMs > b.chargeUntilMs) {
          b.chargeId = null;
          b.dirX = b.dirZ = 0;
          b.nextThinkMs = Math.min(b.nextThinkMs, state.timeMs + 300);
        }
        if (b.chargeId) {
          const t = state.players.find((q) => q.id === b!.chargeId);
          if (t && t.alive && t.fallingMs < 0) {
            const d = Math.hypot(t.x - p.x, t.z - p.z) || 1;
            dx = (t.x - p.x) / d;
            dz = (t.z - p.z) / d;
          } else b.chargeId = null;
        }
        const speed = Math.hypot(p.vx, p.vz);
        if (!b.chargeId) {
          // Mild pull toward the center so wandering doesn't drift off the edge.
          dx -= p.x * 0.06;
          dz -= p.z * 0.06;
          // Brace: when carried by knockback, push against it.
          if (p.hitStunMs <= 0 && speed > maxSpeed(p.character) * 1.05) {
            dx = -p.vx / speed;
            dz = -p.vz / speed;
          }
        }
        // Reflex: if the floor just ahead is unsafe, steer back toward the center.
        const look = 0.5 + speed * 0.25;
        const ahead = Math.hypot(dx, dz) > 0.01 ? { x: p.x + (dx / Math.hypot(dx, dz)) * look, z: p.z + (dz / Math.hypot(dx, dz)) * look } : { x: p.x, z: p.z };
        if (!safeAt(idx, ahead.x, ahead.z) || !safeAt(idx, p.x, p.z)) {
          const c = Math.hypot(p.x, p.z) || 1;
          // Head for the safe neighbor tile most toward the center; fall back to the center.
          const cx = -p.x / c, cz = -p.z / c;
          let tx = cx, tz = cz, bestDot = -Infinity;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const ux = Math.cos(a), uz = Math.sin(a);
            const r = CONFIG.TILE_WIDTH;
            const dot = ux * cx + uz * cz;
            if (dot > bestDot && safeAt(idx, p.x + ux * r, p.z + uz * r)) { tx = ux; tz = uz; bestDot = dot; }
          }
          dx = tx; dz = tz;
          b.chargeId = null;
        }
        out[id] = { seq, dirX: dx, dirZ: dz, skill: false };
      }
      return out;
    },
  };
}
