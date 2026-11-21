import { CHARACTER_IDS } from "@splash-sumo/shared";
import type { GameScene } from "../render/scene";
import { buildFighter } from "../render/fighters";
import type { SplashScreen } from "../ui/screens/splash";

/** Upper bound on the whole boot: the player is never stuck on the loading screen. */
const BOOT_TIMEOUT_MS = 10_000;

function settle(p: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([p.then(() => undefined, () => undefined), new Promise<void>((r) => setTimeout(r, ms))]);
}
const nextFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * Prepares everything Home and a match need, reporting progress on the loading screen, then flips it to
 * "Tap to play". Code has already loaded when this runs (the bar crept to ~40 % in CSS before that).
 */
export async function runBoot(gs: GameScene, splash: SplashScreen): Promise<void> {
  const fallback = setTimeout(() => splash.ready(), BOOT_TIMEOUT_MS);
  try {
    splash.setProgress(50, "Building the arena…");
    // Compile every shader now (arena, lava, fighters) so Home and the first match don't stutter.
    const warm = CHARACTER_IDS.map((c) => buildFighter(c, 0, { isLocal: true, showcase: true }).root);
    for (const r of warm) gs.scene.add(r);
    await settle(gs.renderer.compileAsync(gs.scene, gs.camera), 6000);
    for (const r of warm) gs.scene.remove(r);
    splash.setProgress(80, "Heating the volcano…");

    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("#boot img"));
    await settle(Promise.all(imgs.map((i) => i.decode().catch(() => undefined))), 3000);
    splash.setProgress(90, "Waking the fighters…");

    await settle(nextFrames(), 1000); // the idle scene has drawn behind the loading screen
  } finally {
    clearTimeout(fallback);
    splash.ready();
  }
}
