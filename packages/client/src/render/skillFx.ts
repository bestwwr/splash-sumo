import * as THREE from "three";
import { CONFIG, SKILL_OF, SkillPhase, isDashing, isShelled, spiritPosition, type MatchState, type SimEvent } from "@splash-sumo/shared";
import { SLOT_COLORS } from "./fighters";

/**
 * Skill, rock, eruption and spirit visuals. Pooled meshes, shared geometries,
 * no per-frame allocation. Positions come from the sim state; events only
 * trigger one-shot bursts.
 */
export interface SkillFx {
  onEvent(e: SimEvent, state: MatchState): void;
  update(state: MatchState, renderTimeMs: number, dt: number): void;
  /** Hide everything and drop in-flight bursts. Call on match start and stop. */
  reset(): void;
}

const Y = 0.12; // just above the tile surface
const MAX_ERUPTION = 6;
const MAX_ROCKS = 8;
const BURST_LIFE = 0.45;
/**
 * Spirits are drawn at a smaller ring than the sim's SPIRIT_RING_RADIUS (7.2) so they stay
 * inside the camera's fit radius (6.7) on every aspect. Rocks launch from the drawn orb.
 */
const SPIRIT_VISUAL_RADIUS = 5.9;
const SPIRIT_SCALE = SPIRIT_VISUAL_RADIUS / CONFIG.SPIRIT_RING_RADIUS;
const ORB_Y = 1.0;
const slotColors = SLOT_COLORS.map((c) => new THREE.Color(c));

const basic = (color: string, opacity: number, additive = false) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

interface Burst {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxScale: number;
  peak: number;
}

export function createSkillFx(scene: THREE.Scene): SkillFx {
  const group = new THREE.Group();
  scene.add(group);

  const ringGeo = new THREE.RingGeometry(0.9, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const discGeo = new THREE.CircleGeometry(1, 32);
  discGeo.rotateX(-Math.PI / 2);
  const sphereGeo = new THREE.SphereGeometry(1, 14, 10);
  const rockGeo = new THREE.IcosahedronGeometry(0.3, 0);
  const streakGeo = new THREE.PlaneGeometry(1, 1);
  streakGeo.rotateX(-Math.PI / 2);
  streakGeo.translate(0, 0, -0.5); // extends backward (-z) from origin

  const add = <T extends THREE.Object3D>(o: T): T => {
    o.visible = false;
    group.add(o);
    return o;
  };

  // --- per-player skill visuals (index matches state.players) ---
  interface PerPlayer {
    slamRing: THREE.Mesh;
    slamFull: THREE.Mesh;
    streak: THREE.Mesh;
    glow: THREE.Mesh;
    orb: THREE.Mesh;
    orbCore: THREE.Mesh;
    orbMat: THREE.MeshBasicMaterial;
  }
  const per: PerPlayer[] = [];
  function ensurePlayers(n: number) {
    while (per.length < n) {
      const orbMat = basic("#ffffff", 0.55, true);
      const entry: PerPlayer = {
        slamRing: add(new THREE.Mesh(ringGeo, basic("#ffb347", 0.95, true))),
        slamFull: add(new THREE.Mesh(ringGeo, basic("#ff6a2a", 0.35, true))),
        streak: add(new THREE.Mesh(streakGeo, basic("#fff3c4", 0.7, true))),
        glow: add(new THREE.Mesh(sphereGeo, basic("#7fe0ff", 0.35, true))),
        orb: add(new THREE.Mesh(sphereGeo, orbMat)),
        orbCore: add(new THREE.Mesh(sphereGeo, basic("#ffffff", 0.9, true))),
        orbMat,
      };
      per.push(entry);
    }
  }

  // --- rocks ---
  const rockMat = new THREE.MeshStandardMaterial({ color: "#3a2a24", emissive: "#ff5a1a", emissiveIntensity: 0.9, flatShading: true });
  const rocks = Array.from({ length: MAX_ROCKS }, () => ({
    rock: add(new THREE.Mesh(rockGeo, rockMat)),
    shadow: add(new THREE.Mesh(discGeo, basic("#000000", 0.5))),
    mark: add(new THREE.Mesh(ringGeo, basic("#ff8a3a", 0.8, true))),
  }));

  // --- eruption telegraph circles ---
  const eruptions = Array.from({ length: MAX_ERUPTION }, () => ({
    fill: add(new THREE.Mesh(discGeo, basic("#ff4a10", 0.3, true))),
    ring: add(new THREE.Mesh(ringGeo, basic("#ffd070", 0.9, true))),
  }));

  // --- one-shot bursts (shockwave, rock impact, eruption bomb) ---
  const bursts: Burst[] = [];
  const burstFree: Burst[] = [];
  function burst(kind: "ring" | "dome", color: string, x: number, z: number, maxScale: number, life = BURST_LIFE, peak = 0.9) {
    let b = burstFree.pop();
    if (!b) {
      b = { mesh: new THREE.Mesh(ringGeo, basic(color, 1, true)), life: 0, maxLife: 1, maxScale: 1, peak: 1 };
      group.add(b.mesh);
    }
    b.mesh.geometry = kind === "ring" ? ringGeo : sphereGeo;
    (b.mesh.material as THREE.MeshBasicMaterial).color.set(color);
    b.mesh.position.set(x, kind === "ring" ? Y + 0.03 : Y, z);
    b.mesh.visible = true;
    b.life = b.maxLife = life;
    b.maxScale = maxScale;
    b.peak = peak;
    bursts.push(b);
  }

  function onEvent(e: SimEvent, state: MatchState) {
    switch (e.type) {
      case "slamImpact":
        burst("ring", "#ffcf7a", e.x, e.z, CONFIG.SLAM_RADIUS);
        burst("ring", "#ff7a2a", e.x, e.z, CONFIG.SLAM_RADIUS * 0.7, 0.35, 0.7);
        break;
      case "rockImpact":
        burst("ring", "#ff8a3a", e.x, e.z, CONFIG.ROCK_HIT_RADIUS * 1.6, 0.35);
        burst("dome", "#ffb347", e.x, e.z, CONFIG.ROCK_HIT_RADIUS * 0.7, 0.3, 0.7);
        break;
      case "eruptionImpact":
        for (const t of e.targets) {
          burst("dome", "#ff8a2a", t.x, t.z, CONFIG.ERUPTION_RADIUS * 0.9, 0.55, 0.9);
          burst("ring", "#ffd070", t.x, t.z, CONFIG.ERUPTION_RADIUS * 1.3, 0.55);
        }
        break;
      default:
        break;
    }
  }

  function update(state: MatchState, renderTimeMs: number, dt: number) {
    const t = renderTimeMs / 1000;
    ensurePlayers(state.players.length);

    for (let i = state.players.length; i < per.length; i++) {
      const f = per[i]!;
      f.slamRing.visible = f.slamFull.visible = f.streak.visible = f.glow.visible = f.orb.visible = f.orbCore.visible = false;
    }
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i]!;
      const f = per[i]!;
      const skill = SKILL_OF[p.character];
      const standing = p.alive && p.fallingMs < 0;

      // Slam: ring grows to SLAM_RADIUS over the wind-up; faint full-size ring shows where it will land.
      const winding = standing && skill === "slam" && p.skillPhase === SkillPhase.WINDUP;
      f.slamRing.visible = f.slamFull.visible = winding;
      if (winding) {
        const k = 1 - p.skillPhaseMs / CONFIG.SLAM_WINDUP_MS;
        const r = Math.max(0.1, CONFIG.SLAM_RADIUS * k);
        f.slamRing.position.set(p.x, Y + 0.02, p.z);
        f.slamRing.scale.set(r, 1, r);
        f.slamFull.position.set(p.x, Y + 0.01, p.z);
        f.slamFull.scale.set(CONFIG.SLAM_RADIUS, 1, CONFIG.SLAM_RADIUS);
      }

      // Dash streak behind the monkey.
      const dashing = standing && isDashing(p);
      f.streak.visible = dashing;
      if (dashing) {
        const len = 1.6;
        f.streak.position.set(p.x, Y + 0.4, p.z);
        f.streak.rotation.y = Math.atan2(p.dashDirX, p.dashDirZ);
        f.streak.scale.set(0.8, 1, len);
        (f.streak.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.2 * Math.sin(t * 40);
      }

      // Shell glow.
      const shelled = standing && isShelled(p);
      f.glow.visible = shelled;
      if (shelled) {
        const pulse = 1 + 0.06 * Math.sin(t * 10);
        const s = (CONFIG.PLAYER_RADIUS * 1.55) * pulse;
        f.glow.position.set(p.x, CONFIG.PLAYER_RADIUS * 0.95, p.z);
        f.glow.scale.setScalar(s);
        // Fade out over the last 300 ms as a "shell ending" cue.
        (f.glow.material as THREE.MeshBasicMaterial).opacity = Math.min(0.4, 0.15 + p.skillPhaseMs / 1000);
      }

      // Spirit orb for eliminated players.
      const spirit = !p.alive;
      f.orb.visible = f.orbCore.visible = spirit;
      if (spirit) {
        const sp = spiritPosition(p);
        sp.x *= SPIRIT_SCALE;
        sp.z *= SPIRIT_SCALE;
        f.orbMat.color.copy(slotColors[p.slot % 4]!);
        const bob = ORB_Y + Math.sin(t * 3 + i) * 0.15;
        const ready = p.rockCooldownMs <= 0;
        const s = ready ? 0.42 : 0.3;
        f.orb.position.set(sp.x, bob, sp.z);
        f.orb.scale.setScalar(s * (1 + 0.08 * Math.sin(t * 6)));
        f.orbCore.position.copy(f.orb.position);
        f.orbCore.scale.setScalar(s * 0.45);
        f.orbMat.opacity = ready ? 0.6 : 0.3;
      }
    }

    // Rocks in flight.
    for (let i = 0; i < MAX_ROCKS; i++) {
      const slot = rocks[i]!;
      const r = state.rocks[i];
      const k = r ? (renderTimeMs - r.thrownAtMs) / CONFIG.ROCK_FLIGHT_MS : -1;
      const on = !!r && k >= 0 && k <= 1;
      slot.rock.visible = slot.shadow.visible = slot.mark.visible = on;
      if (on && r) {
        const fx0 = r.fromX * SPIRIT_SCALE;
        const fz0 = r.fromZ * SPIRIT_SCALE;
        const x = fx0 + (r.targetX - fx0) * k;
        const z = fz0 + (r.targetZ - fz0) * k;
        slot.rock.position.set(x, Y + 0.3 + (ORB_Y - 0.3) * (1 - k) + 3.2 * 4 * k * (1 - k), z);
        slot.rock.rotation.x = t * 8;
        slot.rock.rotation.z = t * 5;
        // Landing shadow grows as the rock comes down.
        const sr = CONFIG.ROCK_HIT_RADIUS * (0.35 + 0.65 * k);
        slot.shadow.position.set(r.targetX, Y + 0.01, r.targetZ);
        slot.shadow.scale.set(sr, 1, sr);
        slot.mark.position.set(r.targetX, Y + 0.02, r.targetZ);
        slot.mark.scale.set(CONFIG.ROCK_HIT_RADIUS, 1, CONFIG.ROCK_HIT_RADIUS);
      }
    }

    // Eruption telegraph: circles glow for ERUPTION_TELEGRAPH_MS before impact.
    const er = state.eruption;
    const telegraph = er.phase === 1;
    const left = er.impactAtMs - renderTimeMs;
    const prog = Math.min(1, Math.max(0, 1 - left / CONFIG.ERUPTION_TELEGRAPH_MS));
    for (let i = 0; i < MAX_ERUPTION; i++) {
      const slot = eruptions[i]!;
      const tg = er.targets[i];
      const on = telegraph && !!tg && left > -50;
      slot.fill.visible = slot.ring.visible = on;
      if (on && tg) {
        const flash = 0.5 + 0.5 * Math.sin(t * (8 + prog * 22));
        slot.fill.position.set(tg.x, Y + 0.01, tg.z);
        slot.fill.scale.set(CONFIG.ERUPTION_RADIUS, 1, CONFIG.ERUPTION_RADIUS);
        (slot.fill.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.25 * prog + 0.2 * flash * prog;
        slot.ring.position.set(tg.x, Y + 0.02, tg.z);
        slot.ring.scale.set(CONFIG.ERUPTION_RADIUS, 1, CONFIG.ERUPTION_RADIUS);
        (slot.ring.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.4 * flash;
      }
    }

    // Bursts.
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i]!;
      b.life -= dt;
      if (b.life <= 0) {
        b.mesh.visible = false;
        bursts[i] = bursts[bursts.length - 1]!;
        bursts.pop();
        burstFree.push(b);
        continue;
      }
      const k = 1 - b.life / b.maxLife;
      const s = b.maxScale * (0.25 + 0.75 * Math.sqrt(k));
      b.mesh.scale.setScalar(s);
      if (b.mesh.geometry === ringGeo) b.mesh.scale.y = 1;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = b.peak * (1 - k);
    }
  }

  function reset() {
    for (const f of per) {
      f.slamRing.visible = f.slamFull.visible = f.streak.visible = f.glow.visible = f.orb.visible = f.orbCore.visible = false;
    }
    for (const r of rocks) r.rock.visible = r.shadow.visible = r.mark.visible = false;
    for (const e of eruptions) e.fill.visible = e.ring.visible = false;
    for (const b of bursts) {
      b.mesh.visible = false;
      burstFree.push(b);
    }
    bursts.length = 0;
  }

  return {
    onEvent,
    update,
    reset,
  };
}
