export interface SplashScreen {
  show(): void;
  hide(): void;
}

/** Full-screen "Tap to play" over the live scene. First pointerdown/keydown calls onContinue once. */
export function createSplashScreen(root: HTMLElement, deps: { onContinue(): void }): SplashScreen {
  const el = document.createElement("div");
  el.className = "splash hidden";
  el.innerHTML = `
    <h1 class="splash-title">LAVA <span>SUMO</span></h1>
    <p class="splash-tap">Tap to play</p>
    <p class="splash-foot">A Best &amp; Ben game</p>`;
  root.appendChild(el);

  let armed = false;
  function go(e: Event) {
    if (!armed) return;
    if (e instanceof KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta" || e.key === "CapsLock") return;
      if (e.key === "Enter" || e.key === " ") e.preventDefault();
    } else e.preventDefault();
    armed = false;
    window.removeEventListener("keydown", go, true);
    el.removeEventListener("pointerdown", go);
    deps.onContinue();
  }

  return {
    show() {
      el.classList.remove("hidden");
      armed = true;
      el.addEventListener("pointerdown", go);
      window.addEventListener("keydown", go, true);
    },
    hide() {
      armed = false;
      window.removeEventListener("keydown", go, true);
      el.removeEventListener("pointerdown", go);
      el.classList.add("hidden");
    },
  };
}
