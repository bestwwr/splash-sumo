/**
 * Custom 2D circle physics on the XZ plane (SPEC §3.1, D3).
 */
import { CONFIG } from "./config";
import { enduranceMult, maxSpeed, powerMult } from "./characters";
import type { Player, PlayerInput, SimEvent } from "./types";

/** Clamp an input vector to length ≤ 1 and sanitize NaN/Infinity (§2.4, §3.7). */
export function clampInput(dirX: number, dirZ: number): { dirX: number; dirZ: number } {
  const x = Number.isFinite(dirX) ? dirX : 0;
  const z = Number.isFinite(dirZ) ? dirZ : 0;
  const len = Math.hypot(x, z);
  if (len > CONFIG.MAX_INPUT_LENGTH) return { dirX: x / len, dirZ: z / len };
  return { dirX: x, dirZ: z };
}

/** Exponential approach factor for a rate (1/s) over dt seconds. */
function approach(rate: number, dtSec: number): number {
  return 1 - Math.exp(-rate * dtSec);
}

/**
 * Steer velocity toward `input × maxSpeed`. When moving faster than maxSpeed
 * (i.e. carrying knockback), control is reduced so shoves carry players.
 */
export function applyMovement(p: Player, input: PlayerInput | undefined, dtMs: number): void {
  const dt = dtMs / 1000;
  const stunned = p.hitStunMs > 0 || p.fallingMs >= 0;

  if (stunned) {
    const k = approach(CONFIG.STUN_DECAY_RATE, dt);
    p.vx -= p.vx * k;
    p.vz -= p.vz * k;
  } else {
    const { dirX, dirZ } = clampInput(input?.dirX ?? 0, input?.dirZ ?? 0);
    const vmax = maxSpeed(p.character);
    const speed = Math.hypot(p.vx, p.vz);
    const rate = speed > vmax * 1.05 ? CONFIG.KNOCKBACK_DECAY_RATE : CONFIG.ACCEL_RATE;
    const k = approach(rate, dt);
    p.vx += (dirX * vmax - p.vx) * k;
    p.vz += (dirZ * vmax - p.vz) * k;
    if (dirX !== 0 || dirZ !== 0) p.facing = Math.atan2(dirX, dirZ);
  }

  p.x += p.vx * dt;
  p.z += p.vz * dt;
  if (p.hitStunMs > 0) p.hitStunMs = Math.max(0, p.hitStunMs - dtMs);
}

/**
 * Resolve one pair of overlapping players: separate them, cancel their closing
 * motion (so they don't re-collide next tick), then apply the shove impulse in
 * both directions:
 *   impulse = BASE_KNOCK × powerMult(A) × max(closingSpeed, MIN_SPEED) / enduranceMult(B)
 * Returns hit events (attacker = the faster mover into the contact).
 */
export function resolveCollision(a: Player, b: Player, nowMs: number): SimEvent[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const minDist = CONFIG.PLAYER_RADIUS * 2;
  const distSq = dx * dx + dz * dz;
  if (distSq >= minDist * minDist) return [];

  const dist = Math.sqrt(distSq);
  // Normal from A to B; if exactly overlapping, pick a stable axis.
  const nx = dist > 1e-6 ? dx / dist : 1;
  const nz = dist > 1e-6 ? dz / dist : 0;

  // 1) Positional separation, split evenly.
  const overlap = minDist - dist;
  a.x -= nx * overlap * 0.5;
  a.z -= nz * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.z += nz * overlap * 0.5;

  // 2) Closing speed along the normal (positive = approaching).
  const aN = a.vx * nx + a.vz * nz;
  const bN = b.vx * nx + b.vz * nz;
  const closing = Math.max(0, aN - bN);
  const effective = Math.max(closing, CONFIG.MIN_SHOVE_SPEED);

  // 3) Cancel the normal relative motion (perfectly inelastic along normal).
  const mean = (aN + bN) / 2;
  a.vx += (mean - aN) * nx;
  a.vz += (mean - aN) * nz;
  b.vx += (mean - bN) * nx;
  b.vz += (mean - bN) * nz;

  // 4) Shove impulses, both directions.
  const impulseOnB = (CONFIG.BASE_KNOCK * powerMult(a.character) * effective) / enduranceMult(b.character);
  const impulseOnA = (CONFIG.BASE_KNOCK * powerMult(b.character) * effective) / enduranceMult(a.character);
  b.vx += nx * impulseOnB;
  b.vz += nz * impulseOnB;
  a.vx -= nx * impulseOnA;
  a.vz -= nz * impulseOnA;

  a.hitStunMs = CONFIG.HIT_STUN_MS;
  b.hitStunMs = CONFIG.HIT_STUN_MS;
  a.lastHitById = b.id;
  a.lastHitAtMs = nowMs;
  b.lastHitById = a.id;
  b.lastHitAtMs = nowMs;

  // The one moving harder into the contact is the "attacker" for VFX/analytics.
  const aInto = aN;
  const bInto = -bN;
  const [attacker, victim, strength] = aInto >= bInto ? [a, b, impulseOnB] : [b, a, impulseOnA];
  return [{ type: "hit", attackerId: attacker.id, victimId: victim.id, strength }];
}

/** All-pairs collision for living, standing players (n ≤ 4, so O(n²) is fine). */
export function resolveCollisions(players: Player[], nowMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < players.length; i++) {
    const a = players[i]!;
    if (!a.alive || a.fallingMs >= 0) continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j]!;
      if (!b.alive || b.fallingMs >= 0) continue;
      events.push(...resolveCollision(a, b, nowMs));
    }
  }
  return events;
}
