import "./style.css";
import { createTiles } from "@lava-sumo/shared";
import { createScene } from "./render/scene";
import { createControls } from "./input/input";
import { createHud } from "./ui/hud";
import { startLocalGame } from "./game/localGame";

const NICK_KEY = "lavasumo.nickname";
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

function sanitizeNickname(raw: string): string {
  const clean = raw.replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 12);
  return clean || `Player${Math.floor(100 + Math.random() * 900)}`;
}

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ui = document.querySelector<HTMLDivElement>("#ui")!;
const tiles = createTiles();
const gs = createScene(canvas, tiles.length);
const controls = createControls(ui);
controls.setEnabled(false);
const hud = createHud(ui);

// --- Home screen (F1: nickname → play in ≤ 2 taps) ---
const home = document.createElement("div");
home.className = "home";
home.innerHTML = `
  <div class="home-card">
    <h1>Lava <span>Sumo</span></h1>
    <p class="tag">Shove your friends into the lava. Last one standing wins.</p>
    <label class="nick">
      <span>Nickname</span>
      <input maxlength="12" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Your name" />
    </label>
    <button class="btn primary play">Play vs Dummies</button>
    <p class="hint"><b>Phone:</b> drag left side to move · <b>Desktop:</b> WASD / arrows</p>
    <p class="build">Milestone 1 · local prototype</p>
  </div>`;
ui.appendChild(home);
const nickInput = home.querySelector<HTMLInputElement>("input")!;
nickInput.value = storage(NICK_KEY) ?? "";

function showHome() {
  home.classList.remove("hidden");
}

home.querySelector<HTMLButtonElement>(".play")!.addEventListener("click", () => {
  const nickname = sanitizeNickname(nickInput.value);
  storage(NICK_KEY, nickname);
  nickInput.value = nickname;
  nickInput.blur();
  home.classList.add("hidden");
  // Landscape is preferred; try to lock it on phones that allow it (ignored elsewhere).
  (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
    .lock?.("landscape")
    .catch(() => {});
  startLocalGame(gs, controls, hud, { nickname, character: "elephant", onExit: showHome });
});

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
  if (home.classList.contains("hidden")) return;
  const t = now / 1000;
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
