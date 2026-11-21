import { normalizeRoomCode } from "@splash-sumo/shared";

export interface FriendsDeps {
  onCreate(): void;
  onJoin(code: string): void;
  onBack(): void;
}
export interface FriendsScreen {
  show(): void;
  hide(): void;
  /** Status or error line under the buttons; null clears it. */
  setMessage(text: string | null, isError?: boolean): void;
  setBusy(busy: boolean): void;
}

export function createFriendsScreen(root: HTMLElement, deps: FriendsDeps): FriendsScreen {
  const el = document.createElement("div");
  el.className = "friends-screen hidden";
  el.innerHTML = `
    <div class="friends-top">
      <button class="btn ghost friends-back" type="button">◂ Back</button>
      <h1 class="friends-title">PLAY WITH FRIENDS</h1>
    </div>
    <div class="friends-body">
      <button class="btn primary friends-create" type="button">Create room</button>
      <div class="friends-or">or enter a code</div>
      <div class="friends-join-row">
        <input class="friends-code" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" aria-label="Room code" />
        <button class="btn friends-join" type="button" disabled>Join</button>
      </div>
      <p class="friends-msg" role="status"></p>
    </div>`;
  root.appendChild(el);

  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const input = q<HTMLInputElement>(".friends-code");
  const joinBtn = q<HTMLButtonElement>(".friends-join");
  const createBtn = q<HTMLButtonElement>(".friends-create");
  const msg = q<HTMLParagraphElement>(".friends-msg");
  let busy = false;

  const validCode = () => normalizeRoomCode(input.value);
  const sync = () => {
    joinBtn.disabled = busy || validCode() === null;
    createBtn.disabled = busy;
  };

  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !joinBtn.disabled) joinBtn.click();
  });
  el.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b || b.disabled) return;
    if (b === createBtn) deps.onCreate();
    else if (b === joinBtn) {
      const code = validCode();
      if (code) deps.onJoin(code);
    } else if (b.classList.contains("friends-back")) deps.onBack();
  });

  return {
    show() {
      el.classList.remove("hidden");
      sync();
    },
    hide() {
      el.classList.add("hidden");
    },
    setMessage(text, isError = false) {
      msg.textContent = text ?? "";
      msg.classList.toggle("error", !!text && isError);
    },
    setBusy(b) {
      busy = b;
      sync();
    },
  };
}
