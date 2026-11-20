export interface SplashScreen {
  show(): void;
  hide(): void;
}

/** Full-screen "Tap to play" over the live scene. First click/keydown calls onContinue once. */
export function createSplashScreen(root: HTMLElement, deps: { onContinue(): void }): SplashScreen {
  const el = document.createElement("div");
  el.className = "splash hidden";
  el.innerHTML = `
    <h1 class="splash-title">SPLASH <span>SUMO</span></h1>
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
    el.removeEventListener("click", go);
    deps.onContinue();
  }

  return {
    show() {
      el.classList.remove("hidden");
      armed = true;
      el.addEventListener("click", go);
      window.addEventListener("keydown", go, true);
    },
    hide() {
      armed = false;
      window.removeEventListener("keydown", go, true);
      el.removeEventListener("click", go);
      el.classList.add("hidden");
    },
  };
}
