import type { GameScene } from "../../render/scene";
import { buildFighter, type FighterModel } from "../../render/fighters";
import { CATALOG } from "../../meta/catalog";
import { sanitizeNickname, type Profile } from "../../meta/profile";

export interface HomeScreen {
  show(): void;
  hide(): void;
  /** Animate the showcase fighter's idle pose; call each frame while visible. */
  tick(t: number): void;
}

export interface HomeDeps {
  gs: GameScene;
  getProfile(): Profile;
  setProfile(p: Profile): void;
  onQuickPlay(): void;
  onInventory(): void;
}

export function createHomeScreen(root: HTMLElement, deps: HomeDeps): HomeScreen {
  const el = document.createElement("div");
  el.className = "home hidden";
  el.innerHTML = `
    <h1 class="home-title">LAVA <span>SUMO</span></h1>
    <div class="home-fighter">
      <button class="chip nick-chip" type="button"><span class="nick-text"></span></button>
      <input class="nick-input hidden" maxlength="12" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Nickname" />
      <button class="chip change-chip" type="button">Tap to change ▸</button>
    </div>
    <div class="home-menu">
      <button class="btn primary quick" type="button">⚡ Quick Play</button>
      <button class="btn ghost inv" type="button">🎒 Inventory</button>
      <button class="btn soon" type="button" disabled>👥 Play with friends · coming soon</button>
    </div>`;
  root.appendChild(el);

  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const nickChip = q<HTMLButtonElement>(".nick-chip");
  const nickText = q<HTMLSpanElement>(".nick-text");
  const nickInput = q<HTMLInputElement>(".nick-input");

  let model: FighterModel | null = null;
  let shownFighter = "";

  function fighterName(): string {
    const p = deps.getProfile();
    return CATALOG.find((c) => c.kind === "fighter" && c.fighterId === p.equippedFighter)?.name ?? p.equippedFighter;
  }

  function refresh() {
    const p = deps.getProfile();
    nickText.textContent = `${p.nickname} · ${fighterName()}`;
    if (p.equippedFighter !== shownFighter) {
      shownFighter = p.equippedFighter;
      model = buildFighter(p.equippedFighter, 0, { isLocal: true, showcase: true });
      deps.gs.setShowcase(model);
    }
  }

  function commitNick() {
    if (nickInput.classList.contains("hidden")) return;
    const p = deps.getProfile();
    const nickname = sanitizeNickname(nickInput.value);
    nickInput.classList.add("hidden");
    nickChip.classList.remove("hidden");
    if (nickname !== p.nickname) deps.setProfile({ ...p, nickname });
    refresh();
  }

  nickChip.addEventListener("click", () => {
    nickInput.value = deps.getProfile().nickname;
    nickChip.classList.add("hidden");
    nickInput.classList.remove("hidden");
    nickInput.focus();
    nickInput.select();
  });
  nickInput.addEventListener("blur", commitNick);
  nickInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") nickInput.blur();
  });
  q<HTMLButtonElement>(".change-chip").addEventListener("click", () => deps.onInventory());
  q<HTMLButtonElement>(".inv").addEventListener("click", () => deps.onInventory());
  q<HTMLButtonElement>(".quick").addEventListener("click", () => deps.onQuickPlay());

  return {
    show() {
      el.classList.remove("hidden");
      shownFighter = "";
      refresh();
    },
    hide() {
      commitNick();
      el.classList.add("hidden");
      model = null;
      shownFighter = "";
      deps.gs.setShowcase(null);
    },
    tick(t) {
      model?.setPose("idle", t);
    },
  };
}
