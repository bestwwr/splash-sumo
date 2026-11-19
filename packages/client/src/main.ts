import "./style.css";
import { createTiles } from "@lava-sumo/shared";
import { createScene } from "./render/scene";
import { createControls } from "./input/input";
import { createHud } from "./ui/hud";
import { startLocalGame } from "./game/localGame";
import { defaultRandomNick, loadProfile, saveProfile, type Profile } from "./meta/profile";
import { createSplashScreen } from "./ui/screens/splash";
import { createHomeScreen } from "./ui/screens/home";
import { createInventoryScreen } from "./ui/screens/inventory";

const ID_KEY = "lavasumo.anonId";

function storage(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Anonymous ID for analytics (D8). Generated once per browser. */
if (!storage(ID_KEY)) storage(ID_KEY, crypto.randomUUID?.() ?? String(Math.random()).slice(2));

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ui = document.querySelector<HTMLDivElement>("#ui")!;
const tiles = createTiles();
const gs = createScene(canvas, tiles.length);
const controls = createControls(ui);
controls.setEnabled(false);
const hud = createHud(ui);

// --- Profile (device-only; localStorage may be unavailable) ---
let profileStore: Storage | null = null;
try {
  profileStore = localStorage;
} catch {
  profileStore = null;
}
let profile: Profile = loadProfile(profileStore, defaultRandomNick);
saveProfile(profileStore, profile);

/** True while Splash or Home is up and the idle scene should animate. */
let idleActive = true;
let homeActive = false;

function startMatch() {
  idleActive = false;
  homeActive = false;
  // Landscape is preferred; try to lock it on phones that allow it (ignored elsewhere).
  (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
    .lock?.("landscape")
    .catch(() => {});
  home.hide(); // also restores the match camera
  startLocalGame(gs, controls, hud, {
    nickname: profile.nickname,
    character: profile.equippedFighter,
    onExit: () => {
      idleActive = true;
      homeActive = true;
      home.show();
    },
  });
}

const home = createHomeScreen(ui, {
  gs,
  getProfile: () => profile,
  setProfile: (p) => {
    profile = p;
    saveProfile(profileStore, p);
  },
  onQuickPlay: startMatch, // Task 12/13 replace this with the Setup screen / Quick Play loop
  onInventory: () => {
    home.hide();
    homeActive = false;
    inventory.show();
  },
});
const inventory = createInventoryScreen(ui, {
  getProfile: () => profile,
  setProfile: (p) => {
    profile = p;
    saveProfile(profileStore, p);
  },
  onBack: () => {
    inventory.hide();
    home.show();
    homeActive = true;
  },
});
const splash = createSplashScreen(ui, {
  onContinue: () => {
    splash.hide();
    home.show();
    homeActive = true;
  },
});
splash.show();

// --- Portrait prompt (A.7) ---
const rotate = document.createElement("div");
rotate.className = "rotate";
rotate.innerHTML = `<div><div class="phone">📱</div><p>Rotate your phone for the best view</p><button class="btn ghost">Play anyway</button></div>`;
ui.appendChild(rotate);
let rotateDismissed = false;
rotate.querySelector("button")!.addEventListener("click", () => {
  rotateDismissed = true;
  rotate.classList.remove("show");
});
const coarse = window.matchMedia("(pointer: coarse)");
function checkOrientation() {
  const portrait = window.innerHeight > window.innerWidth;
  rotate.classList.toggle("show", coarse.matches && portrait && !rotateDismissed);
}

// --- Idle background: render the arena behind the home screen ---
function idle(now: number) {
  requestAnimationFrame(idle);
  if (!idleActive) return;
  const t = now / 1000;
  if (homeActive) home.tick(t);
  gs.arena.update(tiles, 0, t);
  gs.updateLava(t);
  gs.render(1 / 60);
}
requestAnimationFrame(idle);

window.addEventListener("resize", () => {
  gs.resize();
  checkOrientation();
});
checkOrientation();

// Block pinch-zoom / double-tap zoom / context menu during play.
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("contextmenu", (e) => e.preventDefault());
