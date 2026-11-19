import * as THREE from "three";
import { CONFIG, SkillPhase, SKILL_OF, isDashing, isShelled, type CharacterId, type Player } from "@lava-sumo/shared";

import { buildFighter, SLOT_COLORS, type FighterModel } from "./fighters";
export { SLOT_COLORS };

function blobShadowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grd.addColorStop(0, "rgba(0,0,0,0.55)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface PlayerMesh {
  fighter: FighterModel;
  root: THREE.Group;
  body: THREE.Group;
  shadow: THREE.Mesh;
  ring: THREE.Mesh | null;
  squashT: number;
  squashDir: THREE.Vector2;
}

function buildPlayerMesh(character: CharacterId, slot: number, isLocal: boolean, shadowTex: THREE.Texture): PlayerMesh {
  const fighter = buildFighter(character, slot, { isLocal });
  const { root, body } = fighter;
  const R = CONFIG.PLAYER_RADIUS;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(R * 2.6, R * 2.6),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  root.add(shadow);
  let ring: THREE.Mesh | null = null;
  if (isLocal) {
    ring = new THREE.Mesh(
      new THREE.RingGeometry(R * 1.15, R * 1.4, 32),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    root.add(ring);
  }
  return { fighter, root, body, shadow, ring, squashT: 0, squashDir: new THREE.Vector2() };
}

export interface PlayersView {
  group: THREE.Group;
  /** p/prev are sim snapshots; alpha interpolates between them. */
  update(prev: Player[], cur: Player[], alpha: number, frameSec: number, dtSec: number, groundY: (x: number, z: number) => number): void;
  squash(playerId: string, dirX: number, dirZ: number): void;
  positionOf(playerId: string): THREE.Vector3 | null;
}

export function createPlayers(players: Player[], localId: string): PlayersView {
  const group = new THREE.Group();
  const shadowTex = blobShadowTexture();
  const meshes = new Map<string, PlayerMesh>();
  for (const p of players) {
    const m = buildPlayerMesh(p.character, p.slot, p.id === localId, shadowTex);
    meshes.set(p.id, m);
    group.add(m.root);
  }

  const lerpAngle = (a: number, b: number, t: number) => {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  };

  function update(prev: Player[], cur: Player[], alpha: number, frameSec: number, dtSec: number, groundY: (x: number, z: number) => number) {
    cur.forEach((p, i) => {
      const m = meshes.get(p.id);
      const pp = prev[i] ?? p;
      if (!m) return;
      const x = pp.x + (p.x - pp.x) * alpha;
      const z = pp.z + (p.z - pp.z) * alpha;
      m.root.position.x = x;
      m.root.position.z = z;
      m.body.rotation.y = lerpAngle(m.body.rotation.y, p.facing, Math.min(1, dtSec * 14));

      const speed = Math.hypot(p.vx, p.vz);
      const ground = groundY(x, z);
      if (p.fallingMs >= 0 || !p.alive) {
        // Cartoony sink: drop + shrink, then hide.
        const f = p.alive ? p.fallingMs / CONFIG.FALL_ELIMINATE_MS : 1;
        m.root.position.y = ground - f * f * 1.4;
        const s = Math.max(0, 1 - f * 0.6);
        m.body.scale.setScalar(s);
        m.fighter.setPose("fall", frameSec);
        m.shadow.visible = false;
        if (m.ring) m.ring.visible = p.alive;
        m.root.visible = p.alive || f < 1;
        if (!p.alive) m.root.visible = false;
        return;
      }
      m.root.visible = true;
      m.shadow.visible = true;
      m.root.position.y = ground;
      m.body.rotation.z = 0;

      // Waddle while moving.
      const waddle = Math.min(1, speed / 4);
      const skill = SKILL_OF[p.character];
      if (p.skillPhase === SkillPhase.WINDUP && skill === "slam") {
        m.fighter.setPose("windup", 1 - p.skillPhaseMs / CONFIG.SLAM_WINDUP_MS);
      } else if (isDashing(p)) m.fighter.setPose("dash", frameSec);
      else if (isShelled(p)) m.fighter.setPose("shell", frameSec);
      else m.fighter.setPose(waddle > 0.1 ? "walk" : "idle", frameSec);

      // Squash & stretch on impact.
      let sx = 1, sy = 1;
      if (m.squashT > 0) {
        m.squashT = Math.max(0, m.squashT - dtSec);
        const k = Math.sin((m.squashT / 0.18) * Math.PI);
        sy = 1 - 0.28 * k;
        sx = 1 + 0.22 * k;
      }
      if (p.hitStunMs > 0) m.body.rotation.z = Math.sin(frameSec * 60) * 0.08;
      m.body.scale.set(sx, sy, sx);
      if (m.ring) {
        m.ring.visible = true;
        (m.ring.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.3 * Math.sin(frameSec * 5);
      }
    });
  }

  return {
    group,
    update,
    squash(id, dirX, dirZ) {
      const m = meshes.get(id);
      if (!m) return;
      m.squashT = 0.18;
      m.squashDir.set(dirX, dirZ);
    },
    positionOf(id) {
      return meshes.get(id)?.root.position ?? null;
    },
  };
}
