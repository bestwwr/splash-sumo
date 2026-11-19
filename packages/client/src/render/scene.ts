import * as THREE from "three";
import { createArena, createCrater, type ArenaView } from "./arena";
import { createLava } from "./lava";
import { createFx } from "./fx";
import type { FighterModel } from "./fighters";
import { createSkillFx, type SkillFx } from "./skillFx";

export interface GameScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  arena: ArenaView;
  fx: ReturnType<typeof createFx>;
  skillFx: SkillFx;
  updateLava(t: number): void;
  shake(amount: number): void;
  render(dt: number): void;
  resize(): void;
  /** Mounts a fighter at the arena center with a close camera framed left (~35% of width); null restores the match camera. */
  setShowcase(model: FighterModel | null): void;
}

/** Half-width (m) of the play area the camera must always fit. */
const FIT_RADIUS = 6.7;
/** Showcase camera: distance multiplier and how far (fraction of width) the view shifts so the fighter sits at ~35%. */
const SHOWCASE_DIST = 9.5;
const SHOWCASE_PITCH = THREE.MathUtils.degToRad(24);
const SHOWCASE_YAW = 0.5; // 3/4 view
const SHOWCASE_SHIFT = 0.15;
const CAMERA_PITCH = THREE.MathUtils.degToRad(58); // elevation angle above the floor

export function createScene(canvas: HTMLCanvasElement, tileCount: number): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // DPR cap (§3.5)
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1a0d0a");
  scene.fog = new THREE.Fog("#1a0d0a", 22, 45);

  // Camera sits on +z looking at the origin: screen-right = +x, screen-up = −z.
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

  // Lighting: warm lava bounce from below + soft sky + key light. No shadow maps (blob shadows instead).
  scene.add(new THREE.HemisphereLight("#ffd8b0", "#ff4a10", 1.1));
  const key = new THREE.DirectionalLight("#fff1dd", 1.6);
  key.position.set(-4, 10, 6);
  scene.add(key);
  const lavaGlow = new THREE.PointLight("#ff5a1a", 30, 18, 1.6);
  lavaGlow.position.set(0, -1.5, 0);
  scene.add(lavaGlow);

  const lava = createLava();
  scene.add(lava.mesh);
  scene.add(createCrater());
  const arena = createArena(tileCount);
  scene.add(arena.group);
  const fx = createFx(scene);
  const skillFx = createSkillFx(scene);

  let shakeAmt = 0;
  let showcase: FighterModel | null = null;
  const base = new THREE.Vector3();
  const footPos = new THREE.Vector3();

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Distance so that FIT_RADIUS fits horizontally and vertically (foreshortened by pitch).
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const distV = (FIT_RADIUS * Math.sin(CAMERA_PITCH) + 0.5) / Math.tan(vFov / 2);
    const distH = FIT_RADIUS / Math.tan(hFov / 2);
    const dist = Math.max(distV, distH);
    if (showcase) base.set(0, Math.sin(SHOWCASE_PITCH) * SHOWCASE_DIST, Math.cos(SHOWCASE_PITCH) * SHOWCASE_DIST);
    else base.set(0, Math.sin(CAMERA_PITCH) * dist, Math.cos(CAMERA_PITCH) * dist);
    camera.position.copy(base);
    camera.lookAt(0, showcase ? 0.9 : -0.3, showcase ? 0 : 0.4);
    if (showcase) camera.setViewOffset(w, h, w * SHOWCASE_SHIFT, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (showcase) {
      // Publish the fighter's foot position (px) so the Home chips can sit just under it.
      camera.updateMatrixWorld();
      footPos.set(0, 0, 0).project(camera);
      const rootEl = document.documentElement.style;
      rootEl.setProperty("--showcase-x", `${((footPos.x + 1) / 2) * w}px`);
      rootEl.setProperty("--showcase-y", `${((1 - footPos.y) / 2) * h}px`);
    }
  }
  resize();

  return {
    renderer,
    scene,
    camera,
    arena,
    fx,
    skillFx,
    updateLava: lava.update,
    shake(a) {
      shakeAmt = Math.max(shakeAmt, a);
    },
    render(dt) {
      if (shakeAmt > 0.001) {
        camera.position.set(
          base.x + (Math.random() - 0.5) * shakeAmt,
          base.y + (Math.random() - 0.5) * shakeAmt,
          base.z + (Math.random() - 0.5) * shakeAmt,
        );
        shakeAmt *= Math.exp(-dt * 9);
      } else camera.position.copy(base);
      fx.update(dt);
      renderer.render(scene, camera);
    },
    resize,
    setShowcase(model) {
      if (showcase) scene.remove(showcase.root);
      showcase = model;
      if (model) {
        model.root.position.set(0, 0, 0);
        model.root.rotation.y = SHOWCASE_YAW;
        scene.add(model.root);
      }
      resize();
    },
  };
}
