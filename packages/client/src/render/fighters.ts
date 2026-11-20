import * as THREE from "three";
import { CONFIG, type CharacterId } from "@splash-sumo/shared";

/** Slot colors (belt + outline). Paired with slot numbers in the HUD so color is never the only cue. */
export const SLOT_COLORS = ["#ff4d4d", "#3fa7ff", "#5bd85b", "#ffd23f"] as const;

export type FighterPose = "idle" | "walk" | "windup" | "dash" | "shell" | "fall";

export interface FighterModel {
  root: THREE.Group;
  /** Facing/scale target for the renderer; contains the animated rig. */
  body: THREE.Group;
  /** t: seconds for looping poses (idle/walk), 0..1 progress for windup, ignored otherwise. */
  setPose(pose: FighterPose, t: number): void;
}

const R = CONFIG.PLAYER_RADIUS;

// Shared geometries/materials (created once at module load, reused by every fighter).
const geo = {
  body: new THREE.IcosahedronGeometry(1, 1),
  sphere: new THREE.SphereGeometry(1, 10, 8),
  disc: new THREE.CylinderGeometry(1, 1, 1, 14),
  cone: new THREE.ConeGeometry(1, 1, 8),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  belt: new THREE.TorusGeometry(R * 0.93, R * 0.2, 6, 16),
  dome: new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  tail: new THREE.TorusGeometry(1, 0.12, 6, 14, Math.PI * 1.5),
};
const std = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true });
const mats = {
  elephant: std("#9aa3b5"),
  elephantInner: std("#e7a9b5"),
  tusk: std("#fff4dc"),
  monkey: std("#9a6335"),
  monkeyFace: std("#f0c9a0"),
  turtle: std("#6fb36a"),
  shell: std("#3f7f4a"),
  shellRim: std("#d8c98a"),
  dark: new THREE.MeshBasicMaterial({ color: "#1b1b1b" }),
};
const beltMats = SLOT_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, emissive: c, emissiveIntensity: 0.25 }));

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  return o;
}

export function buildFighter(character: CharacterId, slot: number, _opts: { isLocal: boolean; showcase?: boolean }): FighterModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const rig = new THREE.Group();
  root.add(body);
  body.add(rig);
  const head = new THREE.Group();
  const skin = character === "elephant" ? mats.elephant : character === "monkey" ? mats.monkey : mats.turtle;
  // Elephant is bulky, monkey slimmer, turtle low and wide.
  const [bw, bh] = character === "elephant" ? [1.1, 1.0] : character === "monkey" ? [0.88, 0.95] : [1.05, 0.8];

  rig.add(mesh(geo.body, skin, 0, R * 0.95, 0, R * bw, R * bh, R * bw));
  const belt = new THREE.Mesh(geo.belt, beltMats[slot % 4]);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = R * 0.7;
  belt.scale.set(bw, bw, 1);
  rig.add(belt);
  rig.add(head);

  const eye = (x: number, y: number, z: number, s = R * 0.08) => head.add(mesh(geo.sphere, mats.dark, x, y, z, s));

  if (character === "elephant") {
    head.position.set(0, R * 1.85, R * 0.05);
    head.add(mesh(geo.body, skin, 0, 0, 0, R * 0.55));
    // Big flat ears
    for (const s of [-1, 1]) {
      const ear = mesh(geo.disc, skin, s * R * 0.62, 0.02, -R * 0.05, R * 0.5, R * 0.07, R * 0.5);
      ear.rotation.z = Math.PI / 2;
      ear.rotation.y = s * 0.5;
      const inner = mesh(geo.disc, mats.elephantInner, 0, 0, 0, 0.7, 1.15, 0.7);
      ear.add(inner);
      head.add(ear);
    }
    // Trunk: two stacked angled cylinders hanging in front, plus tusks.
    const t1 = mesh(geo.cyl, skin, 0, -R * 0.2, R * 0.55, R * 0.16, R * 0.5, R * 0.16);
    t1.rotation.x = 0.35;
    const t2 = mesh(geo.cyl, skin, 0, -R * 0.55, R * 0.72, R * 0.13, R * 0.35, R * 0.13);
    t2.rotation.x = -0.2;
    head.add(t1, t2);
    for (const s of [-1, 1]) {
      const tusk = mesh(geo.cone, mats.tusk, s * R * 0.2, -R * 0.3, R * 0.58, R * 0.06, R * 0.3, R * 0.06);
      tusk.rotation.x = Math.PI / 2 - 0.4;
      head.add(tusk);
    }
    eye(-R * 0.22, R * 0.1, R * 0.5);
    eye(R * 0.22, R * 0.1, R * 0.5);
  } else if (character === "monkey") {
    head.position.set(0, R * 1.8, R * 0.05);
    head.add(mesh(geo.body, skin, 0, 0, 0, R * 0.48));
    head.add(mesh(geo.sphere, mats.monkeyFace, 0, -R * 0.05, R * 0.25, R * 0.32, R * 0.28, R * 0.25));
    for (const s of [-1, 1]) {
      head.add(mesh(geo.sphere, skin, s * R * 0.5, R * 0.1, 0, R * 0.22));
      head.add(mesh(geo.sphere, mats.monkeyFace, s * R * 0.5, R * 0.1, R * 0.1, R * 0.13));
    }
    eye(-R * 0.14, R * 0.08, R * 0.46, R * 0.065);
    eye(R * 0.14, R * 0.08, R * 0.46, R * 0.065);
    // Long curled tail
    const tail = mesh(geo.tail, skin, 0, R * 1.0, -R * 0.95, R * 0.55);
    tail.rotation.y = Math.PI / 2;
    tail.rotation.x = 0.3;
    rig.add(tail);
  } else {
    head.position.set(0, R * 1.45, R * 0.75);
    head.add(mesh(geo.body, skin, 0, 0, 0, R * 0.4));
    eye(-R * 0.16, R * 0.08, R * 0.34, R * 0.065);
    eye(R * 0.16, R * 0.08, R * 0.34, R * 0.065);
    // Domed shell on the back
    const shell = mesh(geo.dome, mats.shell, 0, R * 1.0, -R * 0.1, R * 1.2, R * 1.0, R * 1.2);
    rig.add(shell);
    const rim = mesh(geo.disc, mats.shellRim, 0, R * 1.02, -R * 0.1, R * 1.2, R * 0.08, R * 1.2);
    rig.add(rim);
    for (const [x, z] of [[0, -0.1], [0.5, 0.25], [-0.5, 0.25], [0.45, -0.55], [-0.45, -0.55]] as const) {
      shell.add(mesh(geo.sphere, mats.shellRim, x, 0.75, z, 0.17, 0.07, 0.17));
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rig.add(mesh(geo.sphere, skin, sx * R * 0.65, R * 0.2, sz * R * 0.6, R * 0.22, R * 0.2, R * 0.28));
  }

  function setPose(pose: FighterPose, t: number) {
    rig.position.set(0, 0, 0);
    rig.rotation.set(0, 0, 0);
    rig.scale.set(1, 1, 1);
    head.scale.set(1, 1, 1);
    switch (pose) {
      case "walk":
        rig.position.y = Math.abs(Math.sin(t * 14)) * 0.06;
        rig.rotation.x = 0.12;
        rig.rotation.z = Math.sin(t * 14) * 0.06;
        break;
      case "idle":
        rig.scale.y = 1 + Math.sin(t * 2.5) * 0.02;
        break;
      case "windup": {
        const k = Math.min(1, Math.max(0, t));
        rig.scale.set(1 + 0.12 * k, 1 - 0.22 * k, 1 + 0.12 * k);
        rig.position.y = -0.04 * k;
        break;
      }
      case "dash":
        rig.rotation.x = 0.55;
        rig.scale.set(0.92, 0.95, 1.2);
        break;
      case "shell":
        rig.scale.set(1.05, 0.8, 1.05);
        head.scale.setScalar(0.15);
        break;
      case "fall":
        rig.rotation.z = Math.sin(t * 30) * 0.3;
        break;
    }
  }
  return { root, body, setPose };
}
