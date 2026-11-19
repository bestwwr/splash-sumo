import { SKILL_OF, type BotDifficulty, type CharacterId } from "@lava-sumo/shared";
import { arenasForPicker, FIGHTER_EMOJI, SKILL_INFO } from "../../meta/catalog";
import { fightersForGrid, type Profile } from "../../meta/profile";

export interface SetupDeps {
  getProfile(): Profile;
  setProfile(p: Profile): void;
  onBack(): void;
  onFight(): void;
}

export interface SetupScreen {
  show(): void;
  hide(): void;
}

const DIFFS: ReadonlyArray<{ id: BotDifficulty; label: string }> = [
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
];

export function createSetupScreen(root: HTMLElement, deps: SetupDeps): SetupScreen {
  const el = document.createElement("div");
  el.className = "setup-screen hidden";
  el.innerHTML = `
    <div class="setup-top">
      <button class="btn ghost setup-back" type="button">◂ Back</button>
      <h1 class="setup-title">QUICK PLAY</h1>
    </div>
    <div class="setup-row"><div class="setup-label">MAP</div><div class="setup-cards setup-maps"></div></div>
    <div class="setup-row"><div class="setup-label">FIGHTER</div><div class="setup-cards setup-fighters"></div></div>
    <div class="setup-row setup-bottom">
      <div class="setup-label">BOTS</div>
      <div class="setup-seg" role="group" aria-label="Bot difficulty"></div>
      <button class="btn primary setup-fight" type="button">FIGHT!</button>
    </div>`;
  root.appendChild(el);

  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const maps = q<HTMLDivElement>(".setup-maps");
  const fighters = q<HTMLDivElement>(".setup-fighters");
  const seg = q<HTMLDivElement>(".setup-seg");

  function render() {
    const p = deps.getProfile();

    maps.textContent = "";
    for (const a of arenasForPicker()) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "setup-card setup-map";
      if (!a) {
        b.classList.add("locked");
        b.setAttribute("aria-disabled", "true");
        b.innerHTML = `<span class="setup-face">🔒</span><span class="setup-name">Coming soon</span>`;
      } else {
        const sel = a.id === p.arena;
        b.dataset.arena = a.id;
        b.classList.toggle("selected", sel);
        b.setAttribute("aria-pressed", String(sel));
        b.innerHTML = `<span class="setup-face">${a.emoji}</span><span class="setup-name">${a.name}</span>${
          sel ? '<span class="setup-check" aria-hidden="true">✓</span>' : ""
        }`;
      }
      maps.appendChild(b);
    }

    fighters.textContent = "";
    for (const c of fightersForGrid(p)) {
      if (!c?.fighterId) continue;
      const sel = c.fighterId === p.equippedFighter;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "setup-card setup-fighter";
      b.dataset.fighter = c.fighterId;
      b.classList.toggle("selected", sel);
      b.setAttribute("aria-pressed", String(sel));
      b.innerHTML = `<span class="setup-face">${FIGHTER_EMOJI[c.fighterId]}</span>
        <span class="setup-info"><span class="setup-name">${c.name}</span><span class="setup-sub">${c.role ?? ""} · ${
          SKILL_INFO[SKILL_OF[c.fighterId]].name
        }</span></span>${sel ? '<span class="setup-check" aria-hidden="true">✓</span>' : ""}`;
      fighters.appendChild(b);
    }

    seg.textContent = "";
    for (const d of DIFFS) {
      const sel = d.id === p.difficulty;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "setup-diff";
      b.dataset.diff = d.id;
      b.classList.toggle("selected", sel);
      b.setAttribute("aria-pressed", String(sel));
      b.textContent = sel ? `✓ ${d.label}` : d.label;
      seg.appendChild(b);
    }
  }

  // Listeners attached once; rows are re-rendered, so delegate.
  maps.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.setup-map");
    if (!b || b.getAttribute("aria-disabled") === "true" || !b.dataset.arena) return;
    const p = deps.getProfile();
    if (p.arena !== b.dataset.arena) deps.setProfile({ ...p, arena: b.dataset.arena });
    render();
  });
  fighters.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.setup-fighter");
    const id = b?.dataset.fighter as CharacterId | undefined;
    if (!id) return;
    const p = deps.getProfile();
    if (p.equippedFighter !== id) deps.setProfile({ ...p, equippedFighter: id });
    render();
  });
  seg.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.setup-diff");
    const id = b?.dataset.diff as BotDifficulty | undefined;
    if (!id) return;
    const p = deps.getProfile();
    if (p.difficulty !== id) deps.setProfile({ ...p, difficulty: id });
    render();
  });
  q<HTMLButtonElement>(".setup-back").addEventListener("click", () => deps.onBack());
  q<HTMLButtonElement>(".setup-fight").addEventListener("click", () => deps.onFight());

  return {
    show() {
      render();
      el.classList.remove("hidden");
    },
    hide() {
      el.classList.add("hidden");
    },
  };
}
