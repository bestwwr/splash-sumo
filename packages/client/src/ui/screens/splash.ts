export interface SplashScreen {
  show(): void;
  hide(): void;
  /** Loading progress 0..100 with a short stage label. Never moves backwards. */
  setProgress(pct: number, label: string): void;
  /** Everything is loaded: swap the bar for "Tap to play" and start listening for the tap. */
  ready(): void;
}

/** Short lines that teach the game while it loads (shown one at a time, rotating). */
export const BOOT_TIPS: readonly string[] = [
  "Last one standing on the arena wins.",
  "Run into rivals to shove them toward the lava.",
  "The arena edge crumbles away as the match goes on.",
  "Watch for glowing circles: the volcano is about to erupt there.",
  "Magma Tank's Ground Slam blasts away everyone close by.",
  "Ember Dash can dash over small gaps. Mis-aim and you splash!",
  "Iron Gramp's Shell makes him unmovable for 1.5 s.",
  "Each fighter trades speed, power and endurance differently. Try them all!",
  "Play with friends: share a 4-letter room code.",
];

const TIP_MS = 4000;

/** Fallback markup, matching the static loading screen in index.html (used in tests or if that markup is missing). */
const MARKUP = `
  <div class="boot-logo">
    <h1 class="splash-title" aria-label="Splash Sumo"><span class="boot-l1">SPLASH</span><span class="boot-l2">SUMO</span></h1>
    <p class="boot-tag">Shove your rivals into the lava!</p>
  </div>
  <div class="boot-bottom">
    <p class="boot-tip"><span class="boot-tip-text"></span></p>
    <div class="boot-bar" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
    <div class="boot-meta"><span class="boot-status">Loading…</span><span class="boot-pct"></span></div>
    <p class="splash-tap">Tap to play</p>
  </div>
  <p class="splash-foot">BestnBen Studio</p>`;

/**
 * The loading screen that becomes "Tap to play". It is normally already painted by index.html before any JS runs;
 * this adopts that element (id="boot"). First click/keydown after ready() calls onContinue once.
 */
export function createSplashScreen(root: HTMLElement, deps: { onContinue(): void }): SplashScreen {
  let el = document.getElementById("boot");
  if (!el) {
    el = document.createElement("div");
    el.id = "boot";
    el.className = "splash boot hidden";
    el.innerHTML = MARKUP;
    root.appendChild(el);
  }
  const box = el;
  const bar = box.querySelector<HTMLElement>(".boot-bar");
  const fill = box.querySelector<HTMLElement>(".boot-bar i");
  const status = box.querySelector<HTMLElement>(".boot-status");
  const pctText = box.querySelector<HTMLElement>(".boot-pct");
  const tipText = box.querySelector<HTMLElement>(".boot-tip-text");

  let pct = 0;
  let isReady = false;
  let visible = false;
  let armed = false;
  let tipIdx = Math.floor(Math.random() * BOOT_TIPS.length);
  let tipTimer: ReturnType<typeof setInterval> | null = null;

  function showTip() {
    if (tipText) tipText.textContent = BOOT_TIPS[tipIdx % BOOT_TIPS.length]!;
  }
  function startTips() {
    showTip();
    if (tipTimer === null)
      tipTimer = setInterval(() => {
        tipIdx++;
        showTip();
      }, TIP_MS);
  }
  function stopTips() {
    if (tipTimer !== null) clearInterval(tipTimer);
    tipTimer = null;
  }

  function go(e: Event) {
    if (!armed) return;
    if (e instanceof KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta" || e.key === "CapsLock") return;
      if (e.key === "Enter" || e.key === " ") e.preventDefault();
    } else e.preventDefault();
    disarm();
    deps.onContinue();
  }
  function arm() {
    if (armed || !isReady || !visible) return;
    armed = true;
    box.addEventListener("click", go);
    window.addEventListener("keydown", go, true);
  }
  function disarm() {
    armed = false;
    window.removeEventListener("keydown", go, true);
    box.removeEventListener("click", go);
  }

  function setProgress(p: number, label: string) {
    const next = Math.round(Math.min(100, Math.max(0, p)));
    if (next < pct) return;
    pct = next;
    box.classList.add("js"); // JS owns the bar now (stops the pre-JS CSS creep)
    bar?.setAttribute("aria-valuenow", String(pct));
    if (fill) fill.style.width = `${pct}%`;
    if (status) status.textContent = label;
    if (pctText) pctText.textContent = `${pct}%`;
  }

  return {
    show() {
      visible = true;
      box.classList.remove("hidden");
      startTips();
      arm();
    },
    hide() {
      visible = false;
      disarm();
      stopTips();
      box.classList.add("hidden");
    },
    setProgress,
    ready() {
      if (isReady) return;
      setProgress(100, "Ready!");
      isReady = true;
      box.classList.add("ready");
      box.querySelector<HTMLElement>(".splash-tap")?.setAttribute("role", "button");
      arm();
    },
  };
}
