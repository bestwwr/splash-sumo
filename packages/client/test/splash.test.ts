// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOT_TIPS, createSplashScreen } from "../src/ui/screens/splash";

function mount() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const onContinue = vi.fn();
  const splash = createSplashScreen(root, { onContinue });
  splash.show();
  const el = document.querySelector<HTMLElement>(".splash")!;
  return { root, onContinue, splash, el };
}

describe("splash / loading screen", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("taps do nothing while loading; once ready, click dismisses exactly once (pointerdown alone doesn't)", () => {
    const { onContinue, splash, el } = mount();
    el.click();
    expect(onContinue).not.toHaveBeenCalled();
    splash.ready();
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onContinue).not.toHaveBeenCalled();
    el.click();
    el.click();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("progress moves the bar (clamped to 0..100) and shows the stage label", () => {
    const { splash, el } = mount();
    splash.setProgress(80, "Heating the volcano…");
    const bar = el.querySelector<HTMLElement>(".boot-bar")!;
    expect(bar.getAttribute("aria-valuenow")).toBe("80");
    expect(el.querySelector<HTMLElement>(".boot-bar i")!.style.width).toBe("80%");
    expect(el.querySelector(".boot-status")!.textContent).toBe("Heating the volcano…");
    expect(el.querySelector(".boot-pct")!.textContent).toBe("80%");
    splash.setProgress(150, "x");
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
  });

  it("progress never goes backwards", () => {
    const { splash, el } = mount();
    splash.setProgress(80, "a");
    splash.setProgress(50, "b");
    expect(el.querySelector(".boot-bar")!.getAttribute("aria-valuenow")).toBe("80");
  });

  it("ready() swaps the bar for 'Tap to play'", () => {
    const { splash, el } = mount();
    expect(el.classList.contains("ready")).toBe(false);
    splash.ready();
    expect(el.classList.contains("ready")).toBe(true);
    expect(el.querySelector(".boot-bar")!.getAttribute("aria-valuenow")).toBe("100");
  });

  it("adopts the loading screen already in the page instead of creating a second one", () => {
    document.body.innerHTML = `<div id="boot" class="splash boot"><div class="boot-bar"><i></i></div><p class="boot-status"></p><p class="boot-tip-text"></p></div>`;
    const { el } = mount();
    expect(document.querySelectorAll(".splash")).toHaveLength(1);
    expect(el.id).toBe("boot");
  });

  it("tips rotate every few seconds and keep going on the tap screen", () => {
    vi.useFakeTimers();
    const { splash, el } = mount();
    const tip = () => el.querySelector(".boot-tip-text")!.textContent;
    const first = tip();
    expect(BOOT_TIPS).toContain(first);
    vi.advanceTimersByTime(4000);
    expect(tip()).not.toBe(first);
    splash.ready();
    const t2 = tip();
    vi.advanceTimersByTime(4000);
    expect(tip()).not.toBe(t2);
    splash.hide();
    const t3 = tip();
    vi.advanceTimersByTime(8000);
    expect(tip()).toBe(t3); // stops once hidden
  });
});
