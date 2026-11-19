/**
 * Ember spirits (eliminated players) and the lava rocks they throw.
 * Pure: only mutates the (already cloned) state. Deterministic, no RNG.
 */
import { CONFIG } from "./config";
import { applyRadialImpulse, clampInput } from "./physics";
import { isShelled } from "./skills";
import { EliminationCause, type Inputs, type MatchState, type Player, type SimEvent } from "./types";

const EPS = 1e-6;

/** A spirit's position on the ring around the arena. */
export function spiritPosition(p: Player): { x: number; z: number } {
  return { x: Math.cos(p.spiritAngle) * CONFIG.SPIRIT_RING_RADIUS, z: Math.sin(p.spiritAngle) * CONFIG.SPIRIT_RING_RADIUS };
}

const isTarget = (v: Player): boolean => v.alive && v.fallingMs < 0;

/** Pick where a rock thrown from (sx, sz) with joystick (dirX, dirZ) lands, or null if nowhere. */
function aimTarget(state: MatchState, sx: number, sz: number, dirX: number, dirZ: number): { x: number; z: number } | null {
  const len = Math.hypot(dirX, dirZ);
  const targets = state.players.filter(isTarget);
  if (len <= EPS) {
    let best: Player | null = null;
    let bestD = Infinity;
    for (const v of targets) {
      const d = Math.hypot(v.x - sx, v.z - sz);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best ? { x: best.x, z: best.z } : null;
  }
  const ax = dirX / len;
  const az = dirZ / len;
  const cosCone = Math.cos((CONFIG.ROCK_AIM_CONE_DEG * Math.PI) / 180);
  let best: Player | null = null;
  let bestD = Infinity;
  for (const v of targets) {
    const dx = v.x - sx;
    const dz = v.z - sz;
    const d = Math.hypot(dx, dz);
    if (d > CONFIG.ROCK_RANGE) continue;
    if (d > EPS && (dx * ax + dz * az) / d < cosCone) continue;
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  if (best) return { x: best.x, z: best.z }; // position at throw time
  return { x: sx + ax * CONFIG.ROCK_RANGE * len, z: sz + az * CONFIG.ROCK_RANGE * len };
}

/** Spirits drift around the ring and throw a rock on each skill press. */
export function updateSpirits(state: MatchState, inputs: Inputs, events: SimEvent[]): void {
  const dtMs = CONFIG.TICK_MS;
  for (const p of state.players) {
    if (p.alive) continue;
    const input = inputs[p.id];
    const pressed = !!input?.skill && !p.skillHeld;
    p.skillHeld = !!input?.skill;
    p.rockCooldownMs = Math.max(0, p.rockCooldownMs - dtMs);

    const { dirX, dirZ } = clampInput(input?.dirX ?? 0, input?.dirZ ?? 0);
    // Sideways (tangential) part of the joystick drifts the spirit around the ring.
    const tangent = -Math.sin(p.spiritAngle) * dirX + Math.cos(p.spiritAngle) * dirZ;
    p.spiritAngle += (tangent * CONFIG.SPIRIT_DRIFT_SPEED * dtMs) / 1000;

    if (!pressed || p.rockCooldownMs > EPS) continue;
    const pos = spiritPosition(p);
    const target = aimTarget(state, pos.x, pos.z, dirX, dirZ);
    if (!target) continue;
    const landAtMs = state.timeMs + CONFIG.ROCK_FLIGHT_MS;
    state.rocks.push({
      id: state.nextRockId++,
      fromId: p.id,
      fromX: pos.x,
      fromZ: pos.z,
      targetX: target.x,
      targetZ: target.z,
      thrownAtMs: state.timeMs,
      landAtMs,
    });
    p.rockCooldownMs = CONFIG.ROCK_COOLDOWN_MS;
    events.push({ type: "lavaRockThrown", fromId: p.id, targetX: target.x, targetZ: target.z, landAtMs });
  }
}

/** Land due rocks: flat-speed radial knockback on standing players in the hit radius. */
export function updateRocks(state: MatchState, events: SimEvent[]): void {
  const remaining = [];
  for (const rock of state.rocks) {
    if (rock.landAtMs > state.timeMs + EPS) {
      remaining.push(rock);
      continue;
    }
    const hitIds: string[] = [];
    for (const v of state.players) {
      if (!isTarget(v) || isShelled(v)) continue;
      if (Math.hypot(v.x - rock.targetX, v.z - rock.targetZ) > CONFIG.ROCK_HIT_RADIUS) continue;
      applyRadialImpulse(v, rock.targetX, rock.targetZ, CONFIG.ROCK_KNOCK_SPEED, CONFIG.ROCK_STAGGER_MS, rock.fromId, state.timeMs, EliminationCause.LAVA_ROCK);
      hitIds.push(v.id);
    }
    events.push({ type: "rockImpact", fromId: rock.fromId, x: rock.targetX, z: rock.targetZ, hitIds });
  }
  state.rocks = remaining;
}
