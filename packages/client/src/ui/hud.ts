import { CONFIG, EliminationCause, type MatchResult, type Player } from "@lava-sumo/shared";
import { SLOT_COLORS } from "../render/players";

const CAUSE_LABEL: Record<EliminationCause, string> = {
  [EliminationCause.NONE]: "Survived",
  [EliminationCause.SHOVE]: "Shoved",
  [EliminationCause.FLOOR]: "Floor melted",
  [EliminationCause.ERUPTION]: "Eruption",
  [EliminationCause.LAVA_ROCK]: "Lava rock",
};

const ORDINAL = ["", "1st", "2nd", "3rd", "4th"];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface Hud {
  setPlayers(players: Player[], localId: string): void;
  update(players: Player[], timeMs: number, suddenDeath: boolean): void;
  countdown(n: number | "GO!" | null): void;
  banner(text: string, ms?: number): void;
  showResults(result: MatchResult, players: Player[], localId: string, onAgain: () => void, onHome: () => void): void;
  hideResults(): void;
  setFps(fps: number): void;
  setVisible(on: boolean): void;
}

export function createHud(root: HTMLElement): Hud {
  const el = document.createElement("div");
  el.className = "hud hidden";
  el.innerHTML = `
    <div class="hud-top">
      <div class="portraits"></div>
      <div class="timer"><span class="timer-value">1:30</span><small class="timer-label">to sudden death</small></div>
    </div>
    <div class="fps"></div>
    <div class="center-text"></div>
    <div class="banner"></div>
    <div class="results hidden"></div>
  `;
  root.appendChild(el);
  const portraits = el.querySelector<HTMLDivElement>(".portraits")!;
  const timerValue = el.querySelector<HTMLSpanElement>(".timer-value")!;
  const timerLabel = el.querySelector<HTMLElement>(".timer-label")!;
  const timer = el.querySelector<HTMLDivElement>(".timer")!;
  const fpsEl = el.querySelector<HTMLDivElement>(".fps")!;
  const center = el.querySelector<HTMLDivElement>(".center-text")!;
  const bannerEl = el.querySelector<HTMLDivElement>(".banner")!;
  const results = el.querySelector<HTMLDivElement>(".results")!;
  let bannerTimer = 0;
  const portraitEls = new Map<string, HTMLDivElement>();

  return {
    setPlayers(players, localId) {
      portraits.innerHTML = "";
      portraitEls.clear();
      for (const p of players) {
        const d = document.createElement("div");
        d.className = "portrait" + (p.id === localId ? " me" : "");
        d.style.setProperty("--slot", SLOT_COLORS[p.slot % 4]!);
        d.innerHTML = `<div class="avatar"><span>P${p.slot + 1}</span></div><div class="pname">${esc(p.id === localId ? "You" : p.nickname)}</div>`;
        portraits.appendChild(d);
        portraitEls.set(p.id, d);
      }
    },
    update(players, timeMs, suddenDeath) {
      for (const p of players) portraitEls.get(p.id)?.classList.toggle("out", !p.alive);
      if (suddenDeath) {
        timerValue.textContent = "SUDDEN DEATH";
        timerLabel.textContent = "";
        timer.classList.add("sd");
      } else {
        const left = Math.max(0, Math.ceil((CONFIG.SUDDEN_DEATH_AT_MS - timeMs) / 1000));
        timerValue.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
        timerLabel.textContent = "to sudden death";
        timer.classList.remove("sd");
        timer.classList.toggle("urgent", left <= 10);
      }
    },
    countdown(n) {
      center.textContent = n === null ? "" : String(n);
      center.classList.remove("pop");
      void center.offsetWidth; // restart animation
      if (n !== null) center.classList.add("pop");
    },
    banner(text, ms = 1800) {
      bannerEl.textContent = text;
      bannerEl.classList.add("show");
      clearTimeout(bannerTimer);
      bannerTimer = window.setTimeout(() => bannerEl.classList.remove("show"), ms);
    },
    showResults(result, players, localId, onAgain, onHome) {
      const byId = new Map(players.map((p) => [p.id, p]));
      const mine = result.placements.find((p) => p.playerId === localId);
      const title = result.draw && mine?.place === 1
        ? "Draw!"
        : result.winnerId === localId
          ? "You win! 🏆"
          : `${ORDINAL[mine?.place ?? 4]} place`;
      const rows = result.placements
        .map((pl) => {
          const p = byId.get(pl.playerId)!;
          const by = pl.byId ? byId.get(pl.byId) : null;
          const cause = pl.cause === EliminationCause.SHOVE && by
            ? `Shoved by ${esc(by.id === localId ? "you" : by.nickname)}`
            : CAUSE_LABEL[pl.cause];
          return `<li class="${pl.playerId === localId ? "me" : ""}" style="--slot:${SLOT_COLORS[p.slot % 4]}">
            <span class="place">${ORDINAL[pl.place]}</span>
            <span class="swatch">P${p.slot + 1}</span>
            <span class="rname">${esc(p.id === localId ? `${p.nickname} (you)` : p.nickname)}</span>
            <span class="cause">${cause}</span></li>`;
        })
        .join("");
      results.innerHTML = `
        <div class="card">
          <h2>${title}</h2>
          <p class="sub">${(result.durationMs / 1000).toFixed(1)} s match</p>
          <ol>${rows}</ol>
          <div class="actions">
            <button class="btn primary act-again">Play again</button>
            <button class="btn ghost act-home">Home</button>
          </div>
        </div>`;
      results.classList.remove("hidden");
      results.querySelector<HTMLButtonElement>(".act-again")!.onclick = onAgain;
      results.querySelector<HTMLButtonElement>(".act-home")!.onclick = onHome;
      results.querySelector<HTMLButtonElement>(".act-again")!.focus();
    },
    hideResults() {
      results.classList.add("hidden");
    },
    setFps(fps) {
      fpsEl.textContent = `${Math.round(fps)} fps`;
    },
    setVisible(on) {
      el.classList.toggle("hidden", !on);
    },
  };
}
