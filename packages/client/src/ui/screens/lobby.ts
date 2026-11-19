import { CHARACTER_IDS, Phase, type BotDifficulty, type CharacterId, type ClientMsg, type ServerMsg } from "@lava-sumo/shared";
import { FIGHTER_EMOJI } from "../../meta/catalog";

type LobbyMsg = Extract<ServerMsg, { t: "lobby" }>;

export interface LobbyDeps {
  send(m: ClientMsg): void;
  onLeave(): void;
  /** Called after a pick is sent, so the caller can persist the choice. */
  onPick?(c: CharacterId): void;
  /** Called with a short status ("Link copied"). */
  onNotice?(text: string): void;
}
export interface LobbyScreen {
  show(): void;
  hide(): void;
  update(lobby: LobbyMsg, you: string, code: string): void;
}

const DIFFS: ReadonlyArray<{ id: BotDifficulty; label: string }> = [
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
];
const FINISHING = "Match finishing…";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createLobbyScreen(root: HTMLElement, deps: LobbyDeps): LobbyScreen {
  const el = document.createElement("div");
  el.className = "lobby-screen hidden";
  el.innerHTML = `
    <div class="lobby-top">
      <button class="btn ghost lobby-leave" type="button">◂ Leave</button>
      <div class="lobby-codebox"><span class="lobby-label">ROOM CODE</span><span class="lobby-code"></span></div>
      <button class="btn lobby-share" type="button">Share</button>
    </div>
    <div class="lobby-slots"></div>
    <div class="lobby-row"><span class="lobby-label">FIGHTER</span><div class="lobby-fighters"></div></div>
    <div class="lobby-row lobby-host hidden">
      <span class="lobby-label">BOTS</span>
      <div class="setup-seg lobby-diffs" role="group" aria-label="Bot difficulty"></div>
      <button class="btn primary lobby-start" type="button">START</button>
    </div>
    <p class="lobby-wait">Waiting for the host to start…</p>
    <p class="lobby-note" role="status"></p>`;
  root.appendChild(el);

  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const slots = q<HTMLDivElement>(".lobby-slots");
  const fighters = q<HTMLDivElement>(".lobby-fighters");
  const diffs = q<HTMLDivElement>(".lobby-diffs");
  const hostRow = q<HTMLDivElement>(".lobby-host");
  const wait = q<HTMLParagraphElement>(".lobby-wait");
  const note = q<HTMLParagraphElement>(".lobby-note");
  let code = "";

  function update(lobby: LobbyMsg, you: string, c: string) {
    code = c;
    q(".lobby-code").textContent = c;
    // A match is still wrapping up (we joined during RESULTS): no controls until the lobby phase.
    const finishing = lobby.phase !== Phase.LOBBY;
    const isHost = lobby.hostId === you && !finishing;
    hostRow.classList.toggle("hidden", !isHost);
    wait.classList.toggle("hidden", isHost);
    if (finishing) note.textContent = FINISHING;
    else if (note.textContent === FINISHING) note.textContent = "";

    slots.innerHTML = "";
    for (let i = 0; i < 4; i++) {
      const m = lobby.members[i];
      const d = document.createElement("div");
      d.className = "lobby-slot";
      if (!m) {
        d.classList.add("bot");
        d.innerHTML = `<span class="lobby-face">🤖</span><span class="lobby-name">Bot</span>`;
      } else {
        if (!m.connected) d.classList.add("dim");
        if (m.id === you) d.classList.add("me");
        d.innerHTML = `<span class="lobby-face">${FIGHTER_EMOJI[m.character]}</span><span class="lobby-name">${esc(m.nickname)}${
          m.id === lobby.hostId ? " 👑" : ""
        }</span>`;
      }
      slots.appendChild(d);
    }

    const mine = lobby.members.find((m) => m.id === you)?.character;
    fighters.innerHTML = "";
    for (const id of CHARACTER_IDS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "setup-diff lobby-fighter";
      b.dataset.fighter = id;
      b.classList.toggle("selected", id === mine);
      b.setAttribute("aria-pressed", String(id === mine));
      b.textContent = FIGHTER_EMOJI[id];
      fighters.appendChild(b);
    }

    diffs.innerHTML = "";
    for (const d of DIFFS) {
      const sel = d.id === lobby.difficulty;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "setup-diff";
      b.dataset.diff = d.id;
      b.classList.toggle("selected", sel);
      b.setAttribute("aria-pressed", String(sel));
      b.textContent = sel ? `✓ ${d.label}` : d.label;
      diffs.appendChild(b);
    }
  }

  async function share() {
    const url = `${location.origin}${location.pathname}?room=${code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Lava Sumo", text: `Join my Lava Sumo room ${code}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      note.textContent = "Link copied";
      deps.onNotice?.("Link copied");
    } catch {
      note.textContent = url;
    }
  }

  fighters.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.fighter as CharacterId | undefined;
    if (!id) return;
    deps.send({ t: "pick", character: id });
    deps.onPick?.(id);
  });
  diffs.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.diff as BotDifficulty | undefined;
    if (id) deps.send({ t: "diff", difficulty: id });
  });
  q<HTMLButtonElement>(".lobby-start").addEventListener("click", () => deps.send({ t: "start" }));
  q<HTMLButtonElement>(".lobby-share").addEventListener("click", () => void share());
  q<HTMLButtonElement>(".lobby-leave").addEventListener("click", () => deps.onLeave());

  return {
    show() {
      note.textContent = "";
      el.classList.remove("hidden");
    },
    hide() {
      el.classList.add("hidden");
    },
    update,
  };
}
