/**
 * Character skills (SPEC §3.1 step 2). Runs after inputs are read and before
 * movement integration. Pure: only mutates the (already cloned) state.
 */
import { CONFIG } from "./config";
import { enduranceMult, powerMult, SKILL_OF, type SkillId } from "./characters";
import { applyRadialImpulse } from "./physics";
import { SkillPhase, type Inputs, type MatchState, type Player, type SimEvent } from "./types";

const EPS = 1e-6;

function cooldownOf(skill: SkillId): number {
  switch (skill) {
    case "slam":
      return CONFIG.SLAM_COOLDOWN_MS;
    case "dash":
      return CONFIG.DASH_COOLDOWN_MS;
    case "shell":
      return CONFIG.SHELL_COOLDOWN_MS;
  }
}

function slamImpact(state: MatchState, p: Player, events: SimEvent[]): void {
  const hitIds: string[] = [];
  for (const v of state.players) {
    if (v === p || !v.alive || v.fallingMs >= 0) continue;
    if (Math.hypot(v.x - p.x, v.z - p.z) > CONFIG.SLAM_RADIUS) continue;
    const speed = (CONFIG.SLAM_KNOCK_SPEED * powerMult(p.character)) / enduranceMult(v.character);
    applyRadialImpulse(v, p.x, p.z, speed, CONFIG.HIT_STUN_MS, p.id, state.timeMs);
    hitIds.push(v.id);
  }
  events.push({ type: "slamImpact", playerId: p.id, x: p.x, z: p.z, hitIds });
}

export function updateSkills(state: MatchState, inputs: Inputs, events: SimEvent[]): void {
  const dtMs = CONFIG.TICK_MS;
  for (const p of state.players) {
    if (!p.alive) continue;
    const input = inputs[p.id];
    const pressed = !!input?.skill && !p.skillHeld;
    p.skillHeld = !!input?.skill;

    p.skillCooldownMs = Math.max(0, p.skillCooldownMs - dtMs);
    const skill = SKILL_OF[p.character];

    // Advance an in-progress phase.
    if (p.skillPhase !== SkillPhase.NONE) {
      if (p.fallingMs >= 0) {
        p.skillPhase = SkillPhase.NONE;
        p.skillPhaseMs = 0;
      } else if (skill === "slam") {
        p.skillPhaseMs -= dtMs;
        if (p.skillPhaseMs <= EPS) {
          p.skillPhase = SkillPhase.NONE;
          p.skillPhaseMs = 0;
          slamImpact(state, p, events);
        }
      } else {
        // next task: dash / shell phases
      }
    }

    // Activation.
    if (
      pressed &&
      p.skillCooldownMs === 0 &&
      p.fallingMs < 0 &&
      p.hitStunMs === 0 &&
      p.skillPhase === SkillPhase.NONE
    ) {
      if (skill === "slam") {
        p.skillPhase = SkillPhase.WINDUP;
        p.skillPhaseMs = CONFIG.SLAM_WINDUP_MS;
      } else {
        continue; // next task: dash / shell activation (no-op for now)
      }
      p.skillCooldownMs = cooldownOf(skill);
      events.push({ type: "skillUsed", playerId: p.id, skill });
    }
  }
}
