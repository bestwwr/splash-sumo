/**
 * Utility scoring for bot move directions (SPEC §3.4). Pure and deterministic.
 *
 * Everything is derived from the state data (tiles, players, eruption, rocks): no arena radius or
 * shape is assumed, so other arenas work too. "Edge" = distance to the nearest tile the bot sees
 * as unsafe: a missing cell next to the floor, a SINKING/GONE tile, or a warned tile that sinks
 * within the bot's `warnSenseMs`.
 */
import { CONFIG } from "../config";
import { maxSpeed, SKILL_OF } from "../characters";
import { HEX_DIRECTIONS, hexToWorld, worldToHex } from "../hex";
import { isDashing } from "../physics";
import { isShelled } from "../skills";
import { SkillPhase, TileState, type MatchState, type Player, type Tile } from "../types";

export interface BotWeights {
  /** Floor safety along the predicted path (SOLID > WARNING > SINKING/GONE). */
  floor: number;
  /** A warned tile only looks unsafe once it sinks within this many ms of arrival. */
  warnSenseMs: number;
  /** Distance from the (perceived) edge, capped at `edgeCap` meters. */
  edge: number;
  edgeCap: number;
  /** Pull toward the centroid of the safe floor (per meter). */
  center: number;
  /** Attraction to the spot behind an opponent near the edge (push them out). */
  pressure: number;
  /** Plain attraction to the nearest opponent. */
  chase: number;
  /** Avoid slam wind-ups, dash lines, eruption circles and incoming rocks. */
  threat: number;
  /** Controller-only: bias toward a slowly changing random direction. */
  wander: number;
  /** Controller-only: bias toward the previous decision (less jitter). */
  inertia: number;
  /** Controller-only: skill timing level (0 sloppy, 1 in range, 2 timed). */
  skillSmart: number;
  /** Controller-only: joystick magnitude the bot moves with (0..1). */
  speed: number;
}

const HALF_TILE = CONFIG.TILE_WIDTH / 2;
const EPS = 1e-6;

/** Numeric axial key (arenas are far smaller than ±512 cells). */
const keyOf = (q: number, r: number): number => (q + 512) * 1024 + (r + 512);

export interface ArenaView {
  nowMs: number;
  warnSenseMs: number;
  tiles: Map<number, Tile>;
  /** Perceived hole centers as x,z pairs. */
  holes: number[];
  /** Centroid of the floor that looks safe. */
  cx: number;
  cz: number;
}

/** When a tile will stop supporting players (ms), or Infinity if it is not scheduled. */
function sinkAtMs(t: Tile): number {
  if (t.state === TileState.WARNING) return t.changedAtMs + CONFIG.WARNING_MS;
  if (t.state === TileState.SOLID && t.warnAtMs >= 0) return t.warnAtMs + CONFIG.WARNING_MS;
  if (t.state === TileState.SOLID) return Infinity;
  return -Infinity;
}

// Memo per tiles array (the simulation clones tiles every tick, so this is per tick and shared by
// every bot looking at the same state). Keyed again by warnSenseMs; rebuilt if the clock moved.
const viewCache = new WeakMap<Tile[], Map<number, ArenaView>>();

export function arenaView(state: MatchState, warnSenseMs: number): ArenaView {
  let byWarn = viewCache.get(state.tiles);
  if (!byWarn) {
    byWarn = new Map();
    viewCache.set(state.tiles, byWarn);
  }
  const cached = byWarn.get(warnSenseMs);
  if (cached && cached.nowMs === state.timeMs) return cached;

  const now = state.timeMs;
  const tiles = new Map<number, Tile>();
  for (const t of state.tiles) tiles.set(keyOf(t.q, t.r), t);
  const holes: number[] = [];
  const seenMissing = new Set<number>();
  let cx = 0;
  let cz = 0;
  let safe = 0;
  for (const t of state.tiles) {
    const c = hexToWorld(t);
    if (sinkAtMs(t) - now < warnSenseMs) {
      holes.push(c.x, c.z);
    } else {
      cx += c.x;
      cz += c.z;
      safe++;
    }
    for (const d of HEX_DIRECTIONS) {
      const k = keyOf(t.q + d.q, t.r + d.r);
      if (!tiles.has(k)) seenMissing.add(k);
    }
  }
  // Cells just outside the floor count as holes: this is what makes the arena's rim an edge.
  for (const k of seenMissing) {
    const q = Math.floor(k / 1024) - 512;
    const r = (k % 1024) - 512;
    const c = hexToWorld({ q, r });
    holes.push(c.x, c.z);
  }
  const view: ArenaView = {
    nowMs: now,
    warnSenseMs,
    tiles,
    holes,
    cx: safe > 0 ? cx / safe : 0,
    cz: safe > 0 ? cz / safe : 0,
  };
  byWarn.set(warnSenseMs, view);
  return view;
}

/** Distance (m) from a point to the nearest perceived hole's edge, and that hole. */
export function edgeInfo(view: ArenaView, x: number, z: number): { dist: number; hx: number; hz: number } {
  let best = Infinity;
  let hx = x;
  let hz = z;
  const h = view.holes;
  for (let i = 0; i < h.length; i += 2) {
    const dx = h[i]! - x;
    const dz = h[i + 1]! - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) {
      best = d2;
      hx = h[i]!;
      hz = h[i + 1]!;
    }
  }
  return { dist: best === Infinity ? 1e3 : Math.sqrt(best) - HALF_TILE, hx, hz };
}

export const edgeDistance = (view: ArenaView, x: number, z: number): number => edgeInfo(view, x, z).dist;

/** Floor safety at a point reached `arriveMs` from now: 1 safe … −1 no support. */
export function floorSafety(view: ArenaView, x: number, z: number, arriveMs: number): number {
  const h = worldToHex(x, z);
  const t = view.tiles.get(keyOf(h.q, h.r));
  if (!t) return -1;
  const left = sinkAtMs(t) - (view.nowMs + arriveMs);
  if (left === Infinity || left > view.warnSenseMs) return 1;
  if (left <= 0) return -1;
  return Math.min(0.5, -1 + (1.5 * left) / view.warnSenseMs);
}

/** Predicted position `t` seconds ahead if `p` steers along (dirX, dirZ) from now. */
export function predict(p: Player, dirX: number, dirZ: number, t: number): { x: number; z: number } {
  if (isDashing(p)) {
    const left = Math.min(t, p.skillPhaseMs / 1000);
    const speed = CONFIG.DASH_DISTANCE / (CONFIG.DASH_DURATION_MS / 1000);
    return { x: p.x + p.dashDirX * speed * left, z: p.z + p.dashDirZ * speed * left };
  }
  const rooted = isShelled(p);
  if (rooted) return { x: p.x, z: p.z };
  const stunned = p.hitStunMs > 0 || p.fallingMs >= 0 || p.skillPhase === SkillPhase.WINDUP;
  const vmax = maxSpeed(p.character);
  const tx = stunned ? 0 : dirX * vmax;
  const tz = stunned ? 0 : dirZ * vmax;
  const fast = Math.hypot(p.vx, p.vz) > vmax * 1.05;
  const k = stunned ? CONFIG.STUN_DECAY_RATE : fast ? CONFIG.KNOCKBACK_DECAY_RATE : CONFIG.ACCEL_RATE;
  const f = (1 - Math.exp(-k * t)) / k;
  return { x: p.x + tx * t + (p.vx - tx) * f, z: p.z + tz * t + (p.vz - tz) * f };
}

function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz;
  const u = len2 > EPS ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2)) : 0;
  return Math.hypot(px - (ax + u * vx), pz - (az + u * vz));
}

export const isStanding = (o: Player): boolean => o.alive && o.fallingMs < 0;

/** Ramp penalty: 1 at the center of a radius-R danger zone, 0 at its rim. */
const ramp = (d: number, r: number): number => (d < r ? (r - d) / r : 0);

/** Threat penalty (≥ 0, unweighted) for `p` steering along (dirX, dirZ). */
function threatPenalty(state: MatchState, p: Player, dirX: number, dirZ: number): number {
  let pen = 0;
  const now = state.timeMs;
  for (const o of state.players) {
    if (o === p || !isStanding(o)) continue;
    if (o.skillPhase === SkillPhase.WINDUP && SKILL_OF[o.character] === "slam") {
      const pos = predict(p, dirX, dirZ, Math.max(o.skillPhaseMs / 1000, 0.3));
      // A winding-up elephant is rooted: a path through it is blocked, not an escape.
      const blocked = segmentDistance(o.x, o.z, p.x, p.z, pos.x, pos.z) < CONFIG.PLAYER_RADIUS * 2;
      pen += 3 * (blocked ? 1 : ramp(Math.hypot(pos.x - o.x, pos.z - o.z), CONFIG.SLAM_RADIUS + 0.5));
    } else if (isDashing(o)) {
      const leftS = o.skillPhaseMs / 1000;
      const reach = (CONFIG.DASH_DISTANCE * o.skillPhaseMs) / CONFIG.DASH_DURATION_MS;
      const pos = predict(p, dirX, dirZ, Math.max(leftS, 0.2));
      const d = segmentDistance(pos.x, pos.z, o.x, o.z, o.x + o.dashDirX * reach, o.z + o.dashDirZ * reach);
      pen += 2 * ramp(d, CONFIG.PLAYER_RADIUS * 2 + 0.3);
    }
  }
  const e = state.eruption;
  if (e.phase === 1) {
    const tImp = (e.impactAtMs - now) / 1000;
    const pos = predict(p, dirX, dirZ, Math.max(tImp, 0.2));
    for (const t of e.targets) pen += 2 * ramp(Math.hypot(pos.x - t.x, pos.z - t.z), CONFIG.ERUPTION_RADIUS + 0.4);
  }
  for (const r of state.rocks) {
    const pos = predict(p, dirX, dirZ, Math.max((r.landAtMs - now) / 1000, 0.1));
    pen += 1.5 * ramp(Math.hypot(pos.x - r.targetX, pos.z - r.targetZ), CONFIG.ROCK_HIT_RADIUS + 0.3);
  }
  return pen;
}

/** Score a move direction for `p` (higher is better). (0, 0) scores standing still. */
export function scoreDirection(state: MatchState, p: Player, dirX: number, dirZ: number, weights: BotWeights): number {
  const w = weights;
  const view = arenaView(state, w.warnSenseMs);
  const look = CONFIG.BOT_LOOKAHEAD_S;

  let floor = 0;
  let minEdge = Infinity;
  let end = { x: p.x, z: p.z };
  let fell = false;
  for (const t of look) {
    end = predict(p, dirX, dirZ, t);
    // Once the path loses support the bot falls: nothing after that point can save it.
    const f = fell ? -1 : floorSafety(view, end.x, end.z, t * 1000);
    if (f <= -1) fell = true;
    floor += f;
    minEdge = Math.min(minEdge, fell ? -1 : edgeDistance(view, end.x, end.z));
  }
  let score = (w.floor * floor) / look.length;
  score += w.edge * Math.min(minEdge, w.edgeCap);
  score -= w.center * Math.hypot(end.x - view.cx, end.z - view.cz);

  const moving = Math.abs(dirX) + Math.abs(dirZ) > EPS;
  if (moving && (w.pressure > 0 || w.chase > 0)) {
    let nearest: Player | null = null;
    let nearestD = Infinity;
    for (const o of state.players) {
      if (o === p || !isStanding(o)) continue;
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < nearestD) {
        nearestD = d;
        nearest = o;
      }
      if (w.pressure <= 0 || isShelled(o)) continue;
      const oe = edgeInfo(view, o.x, o.z);
      const danger = Math.max(0, Math.min(1, 1 - oe.dist / w.edgeCap));
      if (danger <= 0) continue;
      // Push them toward their nearest hole: aim for the spot behind them, then through them.
      const nx0 = oe.hx - o.x;
      const nz0 = oe.hz - o.z;
      const nl = Math.hypot(nx0, nz0);
      if (nl < EPS) continue;
      const nx = nx0 / nl;
      const nz = nz0 / nl;
      const ax = o.x - nx * 0.8 - p.x;
      const az = o.z - nz * 0.8 - p.z;
      const al = Math.hypot(ax, az);
      const gx = al > 0.5 ? ax / al : nx;
      const gz = al > 0.5 ? az / al : nz;
      score += (w.pressure * danger * (dirX * gx + dirZ * gz)) / (1 + 0.3 * al);
    }
    if (nearest && nearestD > EPS && !isShelled(nearest)) {
      score += (w.chase * (dirX * (nearest.x - p.x) + dirZ * (nearest.z - p.z))) / nearestD / (1 + 0.3 * nearestD);
    }
  }

  if (w.threat > 0) score -= w.threat * threatPenalty(state, p, dirX, dirZ);
  return score;
}
