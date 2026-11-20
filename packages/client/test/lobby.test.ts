// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Phase, type LobbyMember } from "@lava-sumo/shared";
import { createLobbyScreen } from "../src/ui/screens/lobby";

const members: LobbyMember[] = [
  { id: "a", nickname: "Ann", character: "monkey", connected: true },
  { id: "b", nickname: "Bo", character: "turtle", connected: false },
];
const lobby = (hostId: string) => ({ t: "lobby" as const, phase: Phase.LOBBY, hostId, difficulty: "easy" as const, members });

function make() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const deps = { send: vi.fn(), onLeave: vi.fn(), onPick: vi.fn() };
  const screen = createLobbyScreen(root, deps);
  screen.show();
  return { root, deps, screen };
}

describe("lobby screen", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders 4 slots: 2 members + 2 Bot; code shown", () => {
    const t = make();
    t.screen.update(lobby("a"), "a", "ABCD");
    const slots = t.root.querySelectorAll(".lobby-slot");
    expect(slots.length).toBe(4);
    expect(slots[0]!.textContent).toContain("Ann");
    expect(slots[0]!.textContent).toContain("👑");
    expect(slots[1]!.classList.contains("dim")).toBe(true);
    expect(slots[2]!.textContent).toContain("Bot");
    expect(slots[3]!.textContent).toContain("Bot");
    expect(t.root.querySelector(".lobby-code")!.textContent).toBe("ABCD");
  });

  it("host sees Start + difficulty; guest does not; Medium sends diff", () => {
    const t = make();
    t.screen.update(lobby("b"), "a", "ABCD");
    expect(t.root.querySelector(".lobby-host")!.classList.contains("hidden")).toBe(true);
    t.screen.update(lobby("a"), "a", "ABCD");
    expect(t.root.querySelector(".lobby-host")!.classList.contains("hidden")).toBe(false);
    t.root.querySelector<HTMLButtonElement>('[data-diff="medium"]')!.click();
    expect(t.deps.send).toHaveBeenCalledWith({ t: "diff", difficulty: "medium" });
    t.root.querySelector<HTMLButtonElement>(".lobby-start")!.click();
    expect(t.deps.send).toHaveBeenCalledWith({ t: "start" });
  });

  it("picker sends pick; leave calls onLeave", () => {
    const t = make();
    t.screen.update(lobby("a"), "a", "ABCD");
    t.root.querySelector<HTMLButtonElement>('[data-fighter="elephant"]')!.click();
    expect(t.deps.send).toHaveBeenCalledWith({ t: "pick", character: "elephant" });
    expect(t.deps.onPick).toHaveBeenCalledWith("elephant");
    t.root.querySelector<HTMLButtonElement>(".lobby-leave")!.click();
    expect(t.deps.onLeave).toHaveBeenCalled();
  });
});
