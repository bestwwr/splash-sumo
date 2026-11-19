import { CHARACTERS, SKILL_OF } from "@lava-sumo/shared";
import { CATALOG, FIGHTER_EMOJI, SKILL_INFO, type CatalogItem } from "../../meta/catalog";
import { fightersForGrid, type Profile } from "../../meta/profile";

export interface InventoryDeps {
  getProfile(): Profile;
  setProfile(p: Profile): void;
  onBack(): void;
}

export interface InventoryScreen {
  show(): void;
  hide(): void;
}

const emojiOf = (item: CatalogItem) => (item.fighterId ? FIGHTER_EMOJI[item.fighterId] : "❔");

export function createInventoryScreen(root: HTMLElement, deps: InventoryDeps): InventoryScreen {
  const el = document.createElement("div");
  el.className = "inv-screen hidden";
  el.innerHTML = `
    <div class="inv-top">
      <button class="btn ghost inv-back" type="button">◂ Home</button>
      <div class="inv-tabs" role="tablist">
        <button class="inv-tab on" type="button" role="tab" aria-selected="true" data-tab="fighters"></button>
        <button class="inv-tab" type="button" role="tab" aria-selected="false" data-tab="skins">Skins · soon</button>
      </div>
    </div>
    <div class="inv-body fighters-pane">
      <div class="inv-grid"></div>
      <div class="inv-panel"></div>
    </div>
    <div class="inv-body skins-pane hidden">
      <p class="inv-empty">Skins are coming soon. Your fighters will be able to wear them here.</p>
    </div>`;
  root.appendChild(el);

  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const grid = q<HTMLDivElement>(".inv-grid");
  const panel = q<HTMLDivElement>(".inv-panel");
  const fightersTab = q<HTMLButtonElement>('[data-tab="fighters"]');
  const skinsTab = q<HTMLButtonElement>('[data-tab="skins"]');
  const fightersPane = q<HTMLDivElement>(".fighters-pane");
  const skinsPane = q<HTMLDivElement>(".skins-pane");

  let selectedId = "";

  function cellFor(id: string): CatalogItem | undefined {
    return fightersForGrid(deps.getProfile()).find((c) => c?.id === id) ?? undefined;
  }

  function renderGrid() {
    const p = deps.getProfile();
    const cells = fightersForGrid(p);
    const count = cells.filter(Boolean).length;
    fightersTab.textContent = `Fighters (${count})`;
    grid.textContent = "";
    for (const c of cells) {
      if (!c) {
        const e = document.createElement("div");
        e.className = "inv-cell empty";
        e.setAttribute("aria-hidden", "true");
        e.textContent = "?";
        grid.appendChild(e);
        continue;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "inv-cell";
      b.dataset.id = c.id;
      const equipped = c.fighterId === p.equippedFighter;
      const selected = c.id === selectedId;
      b.classList.toggle("selected", selected);
      b.classList.toggle("equipped", equipped);
      b.setAttribute("aria-pressed", String(selected));
      b.innerHTML = `<span class="inv-face">${emojiOf(c)}</span><span class="inv-name">${c.name}</span>${
        equipped ? '<span class="inv-tag">EQUIPPED</span>' : ""
      }`;
      grid.appendChild(b);
    }
  }

  function bar(label: string, v: number): string {
    return `<div class="inv-stat"><span>${label}</span><div class="inv-bar" role="img" aria-label="${label} ${v} of 5"><i style="width:${(v / 5) * 100}%"></i></div><b>${v}/5</b></div>`;
  }

  function renderPanel() {
    const item = cellFor(selectedId);
    if (!item?.fighterId) {
      panel.textContent = "";
      return;
    }
    const ch = CHARACTERS[item.fighterId];
    const skill = SKILL_INFO[SKILL_OF[item.fighterId]];
    const equipped = deps.getProfile().equippedFighter === item.fighterId;
    panel.innerHTML = `
      <div class="inv-head"><span class="inv-big">${emojiOf(item)}</span><div><div class="inv-title">${item.name}</div><div class="inv-role">${item.role ?? ""}</div></div></div>
      ${bar("Power", ch.stats.power)}${bar("Agility", ch.stats.agility)}${bar("Endurance", ch.stats.endurance)}
      <div class="inv-skill"><b>${skill.name}</b> — ${skill.blurb}</div>
      <button class="btn primary inv-equip" type="button" ${equipped ? "disabled" : ""}>${equipped ? "✓ Equipped" : "Equip"}</button>`;
  }

  function render() {
    renderGrid();
    renderPanel();
  }

  function setTab(tab: "fighters" | "skins") {
    const f = tab === "fighters";
    fightersTab.classList.toggle("on", f);
    skinsTab.classList.toggle("on", !f);
    fightersTab.setAttribute("aria-selected", String(f));
    skinsTab.setAttribute("aria-selected", String(!f));
    fightersPane.classList.toggle("hidden", !f);
    skinsPane.classList.toggle("hidden", f);
  }

  // Listeners attached once; the grid and panel are re-rendered, so delegate.
  grid.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.inv-cell");
    if (!b?.dataset.id) return;
    selectedId = b.dataset.id;
    render();
  });
  panel.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".inv-equip")) return;
    const item = cellFor(selectedId);
    const p = deps.getProfile();
    if (!item?.fighterId || item.fighterId === p.equippedFighter) return;
    deps.setProfile({ ...p, equippedFighter: item.fighterId });
    render();
  });
  fightersTab.addEventListener("click", () => setTab("fighters"));
  skinsTab.addEventListener("click", () => setTab("skins"));
  q<HTMLButtonElement>(".inv-back").addEventListener("click", () => deps.onBack());

  return {
    show() {
      const p = deps.getProfile();
      selectedId = CATALOG.find((c) => c.kind === "fighter" && c.fighterId === p.equippedFighter)?.id ?? "";
      setTab("fighters");
      render();
      el.classList.remove("hidden");
    },
    hide() {
      el.classList.add("hidden");
    },
  };
}
