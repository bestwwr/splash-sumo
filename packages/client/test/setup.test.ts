// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSetupScreen } from "../src/ui/screens/setup";
import { loadProfile, type Profile } from "../src/meta/profile";

function make(over: Partial<Profile> = {}) {
  let profile: Profile = { ...loadProfile(null, () => "Rando42"), ...over };
  const setProfile = vi.fn((p: Profile) => {
    profile = p;
  });
  const onBack = vi.fn();
  const onFight = vi.fn();
  const root = document.createElement("div");
  document.body.appendChild(root);
  const screen = createSetupScreen(root, { getProfile: () => profile, setProfile, onBack, onFight });
  screen.show();
  return { root, setProfile, onBack, onFight, screen, get: () => profile };
}
const click = (el: Element | null) => (el as HTMLElement).click();

describe("setup screen", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders 1 volcano card + 2 coming-soon cards; coming-soon cards ignore taps", () => {
    const t = make();
    const cards = t.root.querySelectorAll(".setup-map");
    expect(cards.length).toBe(3);
    expect(cards[0]?.textContent).toContain("Volcano");
    const soon = t.root.querySelectorAll('.setup-map[aria-disabled="true"]');
    expect(soon.length).toBe(2);
    expect(soon[0]?.textContent).toContain("Coming soon");
    click(soon[0] ?? null);
    expect(t.setProfile).not.toHaveBeenCalled();
    expect(t.root.querySelectorAll(".setup-map.selected").length).toBe(1);
  });

  it("picking a fighter equips and saves it", () => {
    const t = make();
    click(t.root.querySelector('[data-fighter="monkey"]'));
    expect(t.get().equippedFighter).toBe("monkey");
    expect(t.setProfile).toHaveBeenCalledTimes(1);
    expect(t.root.querySelector('[data-fighter="monkey"]')?.textContent).toContain("✓");
    expect(t.root.querySelector('[data-fighter="elephant"]')?.textContent).not.toContain("✓");
  });

  it("picking a difficulty saves it", () => {
    const t = make();
    click(t.root.querySelector('[data-diff="hard"]'));
    expect(t.get().difficulty).toBe("hard");
    expect(t.root.querySelector('[data-diff="hard"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(t.root.querySelector('[data-diff="medium"]')?.getAttribute("aria-pressed")).toBe("false");
  });

  it("opens with the saved picks pre-selected", () => {
    const t = make({ equippedFighter: "turtle", difficulty: "easy" });
    expect(t.root.querySelector('[data-fighter="turtle"]')?.classList.contains("selected")).toBe(true);
    expect(t.root.querySelector('[data-diff="easy"]')?.classList.contains("selected")).toBe(true);
    expect(t.root.querySelector(".setup-map.selected")?.textContent).toContain("✓");
  });

  it("re-reads the profile on every show()", () => {
    const t = make();
    t.get().difficulty = "hard";
    t.screen.show();
    expect(t.root.querySelector('[data-diff="hard"]')?.classList.contains("selected")).toBe(true);
  });

  it("Fight! calls onFight; Back calls onBack", () => {
    const t = make();
    click(t.root.querySelector(".setup-fight"));
    expect(t.onFight).toHaveBeenCalledTimes(1);
    click(t.root.querySelector(".setup-back"));
    expect(t.onBack).toHaveBeenCalledTimes(1);
  });
});
