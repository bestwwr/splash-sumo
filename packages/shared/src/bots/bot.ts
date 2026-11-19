/**
 * Utility-AI bot (SPEC §3.4). Produces the same PlayerInput as a human.
 *
 * - Thinks every BOT_THINK_MS: scores candidate directions (scoring.ts) plus difficulty noise and
 *   picks the best; also decides whether to use the skill.
 * - A decision made at time t is queued and takes effect at t + BOT_REACTION_MS[difficulty].
 * - Every tick it steers along the active decision; skill presses are one-tick rising edges.
 * - Dead: plays its ember spirit, throwing rocks at living players near the edge.
 *
 * Pure and deterministic: its only randomness is its own RngState seeded in the constructor.
 */
import { CONFIG } from "../config";
import { maxSpeed, SKILL_OF } from "../characters";
import { isDashing } from "../physics";
import { nextFloat, nextRange, type RngState } from "../rng";
import { isShelled } from "../skills";
import { spiritPosition } from "../spirits";
import { SkillPhase, type BotDifficulty, type MatchState, type Player, type PlayerInput } from "../types";
import {
  arenaView,
  edgeInfo,
  floorSafety,
  isStanding,
  predict,
  scoreDirection,
  type ArenaView,
  type BotWeights,
} from "./scoring";

interface Decision {
  applyAtMs: number;
  dirX: number;
  dirZ: number;
  skill: boolean;
}

const EPS = 1e-6;
const TIME_EPS = 1e-3;

export class BotController {
  readonly playerId: string;
  readonly difficulty: BotDifficulty;
  private readonly rng: RngState;
  private readonly weights: BotWeights;
  private readonly reactionMs: number;
  private queue: Decision[] = [];
  private active: Decision = { applyAtMs: -Infinity, dirX: 0, dirZ: 0, skill: false };
  private skillPending = false;
  private lastSkill = false;
  private nextThinkMs = NaN;
  private wanderX = 0;
  private wanderZ = 0;
  private nextWanderMs = -Infinity;
  private prevX = 0;
  private prevZ = 0;

  constructor(playerId: string, difficulty: BotDifficulty, seed: number) {
    this.playerId = playerId;
    this.difficulty = difficulty;
    this.rng = { rng: seed >>> 0 };
    this.weights = CONFIG.BOT_WEIGHTS[difficulty];
    this.reactionMs = CONFIG.BOT_REACTION_MS[difficulty];
  }

  input(state: MatchState, seq: number): PlayerInput {
    const now = state.timeMs;
    const p = state.players.find((q) => q.id === this.playerId);
    if (!p) return { seq, dirX: 0, dirZ: 0, skill: false };

    // Stagger the first think so several bots don't all think on the same tick.
    if (Number.isNaN(this.nextThinkMs)) this.nextThinkMs = now + nextFloat(this.rng) * CONFIG.BOT_THINK_MS;
    if (now + TIME_EPS >= this.nextThinkMs) {
      const d = p.alive ? this.think(state, p) : this.thinkSpirit(state, p);
      this.queue.push({ ...d, applyAtMs: now + this.reactionMs });
      while (this.nextThinkMs <= now + TIME_EPS) this.nextThinkMs += CONFIG.BOT_THINK_MS;
    }

    while (this.queue.length > 0 && this.queue[0]!.applyAtMs <= now + TIME_EPS) {
      this.active = this.queue.shift()!;
      if (this.active.skill) this.skillPending = true;
    }

    let skill = false;
    if (this.skillPending && !this.lastSkill) {
      skill = true;
      this.skillPending = false;
    }
    this.lastSkill = skill;
    return { seq, dirX: this.active.dirX, dirZ: this.active.dirZ, skill };
  }

  /** Living fighter: pick the best-scoring direction and maybe a skill press. */
  private think(state: MatchState, p: Player): Omit<Decision, "applyAtMs"> {
    const w = this.weights;
    const noise = CONFIG.BOT_NOISE[this.difficulty];
    if (w.wander > 0 && state.timeMs >= this.nextWanderMs) {
      const a = nextFloat(this.rng) * Math.PI * 2;
      this.wanderX = Math.cos(a);
      this.wanderZ = Math.sin(a);
      this.nextWanderMs = state.timeMs + nextRange(this.rng, CONFIG.BOT_WANDER_MIN_MS, CONFIG.BOT_WANDER_MAX_MS);
    }

    const delayMs = this.reactionMs * w.threatLead;
    const n = CONFIG.BOT_DIRECTIONS;
    const offset = (nextFloat(this.rng) * Math.PI * 2) / n;
    let bestX = 0;
    let bestZ = 0;
    let best = scoreDirection(state, p, 0, 0, w, delayMs) + nextFloat(this.rng) * noise;
    for (let i = 0; i < n; i++) {
      const a = offset + (i / n) * Math.PI * 2;
      const dx = Math.cos(a) * w.speed;
      const dz = Math.sin(a) * w.speed;
      let s = scoreDirection(state, p, dx, dz, w, delayMs) + nextFloat(this.rng) * noise;
      s += w.inertia * (dx * this.prevX + dz * this.prevZ);
      s += w.wander * (dx * this.wanderX + dz * this.wanderZ);
      if (s > best) {
        best = s;
        bestX = dx;
        bestZ = dz;
      }
    }
    this.prevX = bestX;
    this.prevZ = bestZ;

    const skill = this.skillDecision(state, p, bestX, bestZ);
    if (skill) return { dirX: skill.dirX, dirZ: skill.dirZ, skill: true };
    return { dirX: bestX, dirZ: bestZ, skill: false };
  }

  /** Returns a press (with the direction to hold that tick), or null. */
  private skillDecision(state: MatchState, p: Player, moveX: number, moveZ: number): { dirX: number; dirZ: number } | null {
    if (p.skillPhase !== SkillPhase.NONE || p.skillCooldownMs > this.reactionMs || p.fallingMs >= 0) return null;
    const smart = this.weights.skillSmart;
    const K = CONFIG.BOT_SKILL;
    const aim = smart === 0 ? "sloppy" : "aimed";
    const view = arenaView(state, this.weights.warnSenseMs);
    const lead = this.reactionMs / 1000;
    const opps = state.players.filter((o) => o !== p && isStanding(o));
    if (opps.length === 0) return null;
    let want: { dirX: number; dirZ: number } | null = null;

    switch (SKILL_OF[p.character]) {
      case "slam": {
        const t = lead + CONFIG.SLAM_WINDUP_MS / 1000;
        const me = predict(p, moveX, moveZ, lead);
        const range = CONFIG.SLAM_RADIUS + K.SLAM_RANGE_OFFSET[aim];
        let inRange = 0;
        let nearEdge = 0;
        for (const o of opps) {
          if (isShelled(o)) continue;
          const op = this.targetPos(o, t);
          if (Math.hypot(op.x - me.x, op.z - me.z) > range) continue;
          inRange++;
          if (edgeInfo(view, op.x, op.z).dist < this.weights.edgeCap) nearEdge++;
        }
        const ok =
          smart === 0
            ? inRange > 0
            : smart === 1
              ? inRange > 0
              : (nearEdge > 0 || inRange >= 2) && floorSafety(view, me.x, me.z, t * 1000) > K.SAFE_FLOOR;
        if (ok) want = { dirX: moveX, dirZ: moveZ };
        break;
      }
      case "dash": {
        // Escape: airborne over the gap when the floor under us is going.
        const ml = Math.hypot(moveX, moveZ);
        if (smart >= 1 && floorSafety(view, p.x, p.z, K.DASH_ESCAPE_SINK_MS) < 0 && ml > EPS) {
          const lx = p.x + (moveX / ml) * CONFIG.DASH_DISTANCE;
          const lz = p.z + (moveZ / ml) * CONFIG.DASH_DISTANCE;
          if (floorSafety(view, lx, lz, lead * 1000 + CONFIG.DASH_DURATION_MS) > K.SAFE_FLOOR) {
            want = { dirX: moveX / ml, dirZ: moveZ / ml };
            break;
          }
        }
        const me = predict(p, moveX, moveZ, lead);
        let bestO: { dx: number; dz: number; score: number } | null = null;
        for (const o of opps) {
          if (isShelled(o) && smart > 0) continue;
          const op = this.targetPos(o, lead);
          const dx = op.x - me.x;
          const dz = op.z - me.z;
          const d = Math.hypot(dx, dz);
          if (d < EPS || d > CONFIG.DASH_DISTANCE + K.DASH_RANGE_OFFSET[aim]) continue;
          const ux = dx / d;
          const uz = dz / d;
          const oe = edgeInfo(view, op.x, op.z);
          const hl = Math.hypot(oe.hx - op.x, oe.hz - op.z);
          const align = hl > EPS ? (ux * (oe.hx - op.x) + uz * (oe.hz - op.z)) / hl : 0;
          const probe = K.DASH_PROBE_BEHIND_M;
          if (smart >= 1 && floorSafety(view, op.x - ux * probe, op.z - uz * probe, lead * 1000 + K.DASH_PROBE_MS) < K.SAFE_FLOOR) continue;
          if (smart >= 2 && !(oe.dist < this.weights.edgeCap && align > K.DASH_ALIGN_MIN)) continue;
          const score = align - d * K.DASH_DIST_PENALTY;
          if (!bestO || score > bestO.score) bestO = { dx: ux, dz: uz, score };
        }
        if (bestO) want = { dirX: bestO.dx, dirZ: bestO.dz };
        break;
      }
      case "shell": {
        if (smart >= 2 && floorSafety(view, p.x, p.z, lead * 1000 + CONFIG.SHELL_DURATION_MS) < K.SAFE_FLOOR) break;
        let threat = false;
        for (const o of opps) {
          const dx = p.x - o.x;
          const dz = p.z - o.z;
          const d = Math.hypot(dx, dz);
          if (smart === 0) {
            if (d < K.SHELL_SLOPPY_M) threat = true;
            continue;
          }
          const closing = d > EPS ? (o.vx * dx + o.vz * dz) / d : 0;
          if (d < K.SHELL_CHARGE_M + closing * lead && closing > K.SHELL_CLOSING_MIN) threat = true;
          if (o.skillPhase === SkillPhase.WINDUP && SKILL_OF[o.character] === "slam" && d < CONFIG.SLAM_RADIUS + K.SHELL_WINDUP_MARGIN) threat = true;
          if (isDashing(o) && d < CONFIG.DASH_DISTANCE && closing > 0) threat = true;
        }
        if (!threat && smart >= 2) threat = this.blastIncoming(state, p);
        if (threat) want = { dirX: 0, dirZ: 0 };
        break;
      }
    }
    if (!want) return null;
    if (nextFloat(this.rng) >= CONFIG.BOT_SKILL_USE[this.difficulty]) return null;
    return want;
  }

  /** Where a target will be `t` s from now: Hard leads it (keeps its current heading); others aim at where it is. */
  private targetPos(o: Player, t: number): { x: number; z: number } {
    if (this.weights.skillSmart < 2) return { x: o.x, z: o.z };
    const v = maxSpeed(o.character);
    return predict(o, o.vx / v, o.vz / v, t);
  }

  /** An eruption circle or rock will land on us around when a shell would be up. */
  private blastIncoming(state: MatchState, p: Player): boolean {
    const from = state.timeMs + this.reactionMs;
    const to = from + CONFIG.SHELL_DURATION_MS;
    const e = state.eruption;
    if (e.phase === 1 && e.impactAtMs >= from && e.impactAtMs <= to) {
      if (e.targets.some((t) => Math.hypot(p.x - t.x, p.z - t.z) < CONFIG.ERUPTION_RADIUS + CONFIG.BOT_SKILL.SHELL_BLAST_MARGIN)) return true;
    }
    return state.rocks.some(
      (r) => r.landAtMs >= from && r.landAtMs <= to && Math.hypot(p.x - r.targetX, p.z - r.targetZ) < CONFIG.ROCK_HIT_RADIUS + CONFIG.BOT_SKILL.SHELL_BLAST_MARGIN,
    );
  }

  /** Ember spirit: aim at the living player nearest the edge (in range) and throw when ready. */
  private thinkSpirit(state: MatchState, p: Player): Omit<Decision, "applyAtMs"> {
    const view: ArenaView = arenaView(state, this.weights.warnSenseMs);
    const pos = spiritPosition(p);
    const noise = CONFIG.BOT_NOISE[this.difficulty];
    let target: Player | null = null;
    let best = Infinity;
    let nearest: Player | null = null;
    let nearestD = Infinity;
    for (const o of state.players) {
      if (o === p || !isStanding(o)) continue;
      const d = Math.hypot(o.x - pos.x, o.z - pos.z);
      if (d < nearestD) {
        nearestD = d;
        nearest = o;
      }
      if (d > CONFIG.ROCK_RANGE - CONFIG.BOT_SPIRIT_RANGE_MARGIN) continue;
      const s = edgeInfo(view, o.x, o.z).dist + nextFloat(this.rng) * noise;
      if (s < best) {
        best = s;
        target = o;
      }
    }
    const aim = target ?? nearest;
    if (!aim) return { dirX: 0, dirZ: 0, skill: false };
    const dx = aim.x - pos.x;
    const dz = aim.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < EPS) return { dirX: 0, dirZ: 0, skill: false };
    const throwNow =
      target !== null &&
      p.rockCooldownMs <= this.reactionMs &&
      nextFloat(this.rng) < CONFIG.BOT_SKILL_USE[this.difficulty];
    return { dirX: dx / d, dirZ: dz / d, skill: throwNow };
  }
}
