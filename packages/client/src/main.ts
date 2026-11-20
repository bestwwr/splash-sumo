import "./style.css";
import { createTiles } from "@splash-sumo/shared";
import { createScene } from "./render/scene";
import { createControls } from "./input/input";
import { createHud } from "./ui/hud";
import { startQuickPlay } from "./game/quickPlay";
import { defaultRandomNick, loadProfile, saveProfile, type Profile } from "./meta/profile";
import { createSplashScreen } from "./ui/screens/splash";
import { createHomeScreen } from "./ui/screens/home";
import { createInventoryScreen } from "./ui/screens/inventory";
import { createSetupScreen } from "./ui/screens/setup";
import { createOnlineFlow } from "./game/onlinePlay";
import { mountEnvBadge } from "./ui/toast";
import { normalizeRoomCode } from "@splash-sumo/shared";
import { migrateStorageKeys } from "./meta/storageKeys";

// Must run before anything below reads storage (the game was renamed from Lava Sumo).
try {
  migrateStorageKeys(localStorage);
} catch {
  /* storage unavailable */
}

const ID_KEY = "splashsumo.anonId";

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
  startQuickPlay(gs, controls, hud, {
    profile,
    onHome: () => {
      idleActive = true;
      homeActive = true;
      home.show();
    },
    onChangeFighter: () => {
      idleActive = true;
      homeActive = false;
      setup.show();
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
  onQuickPlay: () => {
    home.hide();
    homeActive = false;
    setup.show();
  },
  onInventory: () => {
    home.hide();
    homeActive = false;
    inventory.show();
  },
  onFriends: () => {
    home.hide();
    homeActive = false;
    online.openFriends();
  },
});
const online = createOnlineFlow({
  root: ui,
  gs,
  controls,
  hud,
  getProfile: () => profile,
  setProfile: (p) => {
    profile = p;
    saveProfile(profileStore, p);
  },
  setIdle: (active) => {
    idleActive = active;
    homeActive = false;
  },
  onHome: () => {
    idleActive = true;
    homeActive = true;
    home.show();
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
const setup = createSetupScreen(ui, {
  getProfile: () => profile,
  setProfile: (p) => {
    profile = p;
    saveProfile(profileStore, p);
  },
  onBack: () => {
    setup.hide();
    home.show();
    homeActive = true;
  },
  onFight: () => {
    setup.hide();
    startMatch();
  },
});
// ?room=ABCD deep link: consumed once, then removed from the address bar.
const linkedRoom = normalizeRoomCode(new URLSearchParams(location.search).get("room") ?? "");
if (new URLSearchParams(location.search).has("room")) {
  try {
    history.replaceState(null, "", location.pathname + location.hash);
  } catch {
    /* ignore */
  }
}
const splash = createSplashScreen(ui, {
  onContinue: () => {
    splash.hide();
    if (linkedRoom) {
      idleActive = true;
      online.joinCode(linkedRoom);
      return;
    }
    home.show();
    homeActive = true;
  },
});
mountEnvBadge(document.body);
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
