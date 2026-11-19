import * as THREE from "three";
import { CONFIG, type Player } from "@lava-sumo/shared";

/** Slot colors (belt + outline). Paired with slot numbers in the HUD so color is never the only cue. */
export const SLOT_COLORS = ["#ff4d4d", "#3fa7ff", "#5bd85b", "#ffd23f"] as const;

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
  root: THREE.Group;
  body: THREE.Group;
  shadow: THREE.Mesh;
  ring: THREE.Mesh | null;
  squashT: number;
  squashDir: THREE.Vector2;
}

/**
 * Placeholder sumo: chubby body + belt in slot color + head with eyes (shows facing).
 * Replaced by low-poly animal models in Milestone 3/4.
 */
function buildSumo(slot: number, isLocal: boolean, shadowTex: THREE.Texture): PlayerMesh {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const R = CONFIG.PLAYER_RADIUS;
  const skin = new THREE.MeshStandardMaterial({ color: "#f2c9a0", roughness: 0.7, flatShading: true });
  const beltMat = new THREE.MeshStandardMaterial({ color: SLOT_COLORS[slot % 4], roughness: 0.5, emissive: SLOT_COLORS[slot % 4], emissiveIntensity: 0.25 });
  const dark = new THREE.MeshBasicMaterial({ color: "#1b1b1b" });

  const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 1), skin);
  torso.scale.set(1.05, 0.95, 1.05);
  torso.position.y = R * 0.95;
  const belt = new THREE.Mesh(new THREE.TorusGeometry(R * 0.93, R * 0.2, 6, 16), beltMat);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = R * 0.7;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(R * 0.5, 1), skin);
  head.position.set(0, R * 1.85, R * 0.05);
  const topknot = new THREE.Mesh(new THREE.SphereGeometry(R * 0.17, 8, 6), dark);
  topknot.position.set(0, R * 2.35, -R * 0.12);
  const eyeGeo = new THREE.SphereGeometry(R * 0.08, 6, 4);
  const eyeL = new THREE.Mesh(eyeGeo, dark);
  const eyeR = new THREE.Mesh(eyeGeo, dark);
  eyeL.position.set(-R * 0.18, R * 1.92, R * 0.48);
  eyeR.position.set(R * 0.18, R * 1.92, R * 0.48);
  body.add(torso, belt, head, topknot, eyeL, eyeR);

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
  return { root, body, shadow, ring, squashT: 0, squashDir: new THREE.Vector2() };
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
    const m = buildSumo(p.slot, p.id === localId, shadowTex);
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
        m.body.rotation.z = Math.sin(frameSec * 30) * 0.3 * f;
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
      m.body.position.y = Math.abs(Math.sin(frameSec * 14)) * 0.06 * waddle;
      m.body.rotation.x = 0.12 * waddle;

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
