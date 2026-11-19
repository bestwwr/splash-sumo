/**
 * Eruption: one seeded event per match. Telegraphs 3-4 circles, then after
 * ERUPTION_TELEGRAPH_MS knocks back players inside and warns the tiles below.
 * Pure: only mutates the (already cloned) state. RNG: the state's seeded RNG.
 */
import { CONFIG } from "./config";
import { isSupportive, warnTile } from "./collapse";
import { hexToWorld } from "./hex";
import { applyRadialImpulse } from "./physics";
import { nextInt } from "./rng";
import { isShelled } from "./skills";
import { EliminationCause, TileState, type MatchState, type SimEvent } from "./types";

export function updateEruption(state: MatchState, events: SimEvent[]): void {
  const e = state.eruption;
  const now = state.timeMs;

  if (e.phase === 0 && now >= e.atMs) {
    const pool = state.tiles.filter((t) => isSupportive(t.state));
    const count = Math.min(
      pool.length,
      CONFIG.ERUPTION_TARGETS_MIN + nextInt(state, CONFIG.ERUPTION_TARGETS_MAX - CONFIG.ERUPTION_TARGETS_MIN + 1),
    );
    const targets: { x: number; z: number }[] = [];
    for (let i = 0; i < count; i++) {
      const [t] = pool.splice(nextInt(state, pool.length), 1);
      targets.push(hexToWorld(t!));
    }
    e.targets = targets;
    e.impactAtMs = now + CONFIG.ERUPTION_TELEGRAPH_MS;
    e.phase = 1;
    events.push({ type: "eruptionIncoming", targets: targets.map((t) => ({ ...t })), impactAtMs: e.impactAtMs });
    // fall through: a zero-length telegraph would impact this tick
  }

  if (e.phase === 1 && now >= e.impactAtMs) {
    const hitIds: string[] = [];
    for (const p of state.players) {
      if (!p.alive || p.fallingMs >= 0 || isShelled(p)) continue;
      let best: { x: number; z: number } | null = null;
      let bestD = Infinity;
      for (const t of e.targets) {
        const d = Math.hypot(p.x - t.x, p.z - t.z);
        if (d <= CONFIG.ERUPTION_RADIUS && d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (!best) continue;
      applyRadialImpulse(p, best.x, best.z, CONFIG.ERUPTION_KNOCK_SPEED, CONFIG.ERUPTION_STUN_MS, null, now, EliminationCause.ERUPTION);
      hitIds.push(p.id);
    }
    for (const tile of state.tiles) {
      if (tile.state !== TileState.SOLID) continue;
      const c = hexToWorld(tile);
      if (e.targets.some((t) => Math.hypot(c.x - t.x, c.z - t.z) <= CONFIG.ERUPTION_RADIUS)) warnTile(tile, now);
    }
    events.push({ type: "eruptionImpact", targets: e.targets.map((t) => ({ ...t })), hitIds });
    e.phase = 2;
  }
}
