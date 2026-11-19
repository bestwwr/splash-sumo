// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFriendsScreen } from "../src/ui/screens/friends";

function make() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const deps = { onCreate: vi.fn(), onJoin: vi.fn(), onBack: vi.fn() };
  const screen = createFriendsScreen(root, deps);
  screen.show();
  const input = root.querySelector<HTMLInputElement>(".friends-code")!;
  const join = root.querySelector<HTMLButtonElement>(".friends-join")!;
  const type = (v: string) => {
    input.value = v;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  return { root, deps, screen, input, join, type };
}

describe("friends screen", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("'ab cd' enables Join with ABCD; 'AB1' keeps it disabled", () => {
    const t = make();
    expect(t.join.disabled).toBe(true);
    t.type("ab cd");
    expect(t.join.disabled).toBe(false);
    t.join.click();
    expect(t.deps.onJoin).toHaveBeenCalledWith("ABCD");
    t.type("AB1");
    expect(t.join.disabled).toBe(true);
  });

  it("create and back call through; error text shows", () => {
    const t = make();
    t.root.querySelector<HTMLButtonElement>(".friends-create")!.click();
    t.root.querySelector<HTMLButtonElement>(".friends-back")!.click();
    expect(t.deps.onCreate).toHaveBeenCalled();
    expect(t.deps.onBack).toHaveBeenCalled();
    t.screen.setMessage("Room not available", true);
    expect(t.root.querySelector(".friends-msg")!.textContent).toBe("Room not available");
  });
});
