import * as THREE from "three";
import { CONFIG, HEX_SIZE, TileState, createRng, hexToWorld, type Tile } from "@lava-sumo/shared";

const COLUMN_HEIGHT = 3.2;
const BASALT = new THREE.Color("#3b3533");
const BASALT_ALT = new THREE.Color("#2f2a29");
const WARN_TINT = new THREE.Color("#d9561f");
const SINK_TINT = new THREE.Color("#7a1d0c");
const CRACK_DIM = new THREE.Color("#5a1606");
const CRACK_HOT = new THREE.Color("#ffb020");

/** Hand-drawn crack pattern on a canvas → used on every tile top, glowing on WARNING. */
function crackTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, size, size);
  const rnd = createRng(7);
  g.strokeStyle = "#fff";
  g.lineCap = "round";
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    if (depth <= 0 || len < 6) return;
    let cx = x, cy = y;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(cx, cy);
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      a += (rnd() - 0.5) * 0.9;
      cx += Math.cos(a) * (len / steps);
      cy += Math.sin(a) * (len / steps);
      g.lineTo(cx, cy);
    }
    g.stroke();
    branch(cx, cy, a + 0.6, len * 0.6, w * 0.7, depth - 1);
    if (rnd() > 0.4) branch(cx, cy, a - 0.7, len * 0.55, w * 0.65, depth - 1);
  };
  for (let i = 0; i < 5; i++) {
    branch(size / 2, size / 2, (i / 5) * Math.PI * 2 + rnd() * 0.5, 70 + rnd() * 30, 7, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface ArenaView {
  group: THREE.Group;
  /** Update visuals from interpolated sim time (ms). */
  update(tiles: Tile[], timeMs: number, frameSec: number): void;
  /** Top-surface height of a tile (for placing players while it sinks). */
  surfaceHeight(index: number): number;
}

export function createArena(tileCount: number): ArenaView {
  const group = new THREE.Group();

  // Pointy-top hex columns: CylinderGeometry's first vertex is on +z, matching the sim's grid.
  const colGeo = new THREE.CylinderGeometry(HEX_SIZE * 0.97, HEX_SIZE * 0.9, COLUMN_HEIGHT, 6, 1);
  colGeo.translate(0, -COLUMN_HEIGHT / 2, 0); // top face at y = 0
  const colMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
  const columns = new THREE.InstancedMesh(colGeo, colMat, tileCount);
  columns.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // Crack overlay on the top face, additive → black instance color = invisible.
  const capGeo = new THREE.CircleGeometry(HEX_SIZE * 0.93, 6);
  capGeo.rotateX(-Math.PI / 2);
  capGeo.rotateY(Math.PI / 6 + Math.PI / 3); // align circle(6) corners with pointy-top
  const capMat = new THREE.MeshBasicMaterial({
    map: crackTexture(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const caps = new THREE.InstancedMesh(capGeo, capMat, tileCount);
  caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  group.add(columns, caps);

  const heights = new Float32Array(tileCount);
  const rnd = createRng(3);
  const jitter = Array.from({ length: tileCount }, () => ({ h: rnd() * 0.08, rot: Math.floor(rnd() * 6), alt: rnd() > 0.5 }));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const crack = new THREE.Color();
  const yAxis = new THREE.Vector3(0, 1, 0);

  function update(tiles: Tile[], timeMs: number, frameSec: number): void {
    tiles.forEach((t, i) => {
      const w = hexToWorld(t);
      const j = jitter[i]!;
      let y = j.h;
      let shakeX = 0, shakeZ = 0;
      let visible = true;
      const since = timeMs - t.changedAtMs;
      col.copy(j.alt ? BASALT_ALT : BASALT);
      crack.copy(CRACK_DIM).multiplyScalar(0.55);

      // Pre-scheduled ripple (edge shrink) — show a faint pre-glow.
      if (t.state === TileState.SOLID && t.warnAtMs >= 0) crack.copy(CRACK_DIM);

      if (t.state === TileState.WARNING) {
        const k = Math.min(1, since / CONFIG.WARNING_MS);
        // Danger cue = shake + crack pattern + color (accessibility: never color alone).
        const amp = 0.025 + 0.05 * k;
        shakeX = Math.sin(frameSec * 55 + i) * amp;
        shakeZ = Math.cos(frameSec * 47 + i * 1.7) * amp;
        col.lerp(WARN_TINT, 0.25 + 0.45 * k);
        const pulse = 0.65 + 0.35 * Math.sin(frameSec * (10 + 14 * k));
        crack.copy(CRACK_HOT).multiplyScalar(pulse * (0.7 + 0.6 * k));
      } else if (t.state === TileState.SINKING) {
        const k = Math.min(1, since / CONFIG.SINKING_MS);
        y -= k * k * 1.2;
        col.lerp(SINK_TINT, 0.7);
        crack.copy(CRACK_HOT).multiplyScalar(1.2 - k);
      } else if (t.state === TileState.GONE) {
        const k = Math.min(1, since / 600);
        y -= 1.2 + k * 2.5;
        col.copy(SINK_TINT);
        crack.setRGB(0, 0, 0);
        if (k >= 1) visible = false;
      }
      heights[i] = y;

      pos.set(w.x + shakeX, y, w.z + shakeZ);
      q.setFromAxisAngle(yAxis, (j.rot * Math.PI) / 3);
      scl.setScalar(visible ? 1 : 0);
      m.compose(pos, q, scl);
      columns.setMatrixAt(i, m);
      columns.setColorAt(i, col);

      pos.y += 0.005;
      m.compose(pos, q, scl);
      caps.setMatrixAt(i, m);
      caps.setColorAt(i, crack);
    });
    columns.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    if (columns.instanceColor) columns.instanceColor.needsUpdate = true;
    if (caps.instanceColor) caps.instanceColor.needsUpdate = true;
  }

  return { group, update, surfaceHeight: (i) => heights[i] ?? 0 };
}

/** Volcano crater walls around the lava lake. */
export function createCrater(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(26, 12, 10, 28, 4, true);
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const rnd = createRng(11);
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), z = posAttr.getZ(i);
    const k = 1 + (rnd() - 0.5) * 0.12;
    posAttr.setXYZ(i, x * k, posAttr.getY(i) + (rnd() - 0.5) * 0.6, z * k);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: "#2a1c18", roughness: 1, flatShading: true, side: THREE.BackSide });
  const wall = new THREE.Mesh(geo, mat);
  wall.position.y = 3.5;
  g.add(wall);

  // A few scattered boulders on the lava for depth.
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: "#241917", roughness: 1, flatShading: true });
  for (let i = 0; i < 10; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 10 + rnd() * 5;
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(Math.cos(a) * r, -0.6, Math.sin(a) * r);
    rock.scale.setScalar(0.4 + rnd() * 0.9);
    rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    g.add(rock);
  }
  return g;
}
