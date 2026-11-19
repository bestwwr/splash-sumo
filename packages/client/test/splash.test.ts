// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSplashScreen } from "../src/ui/screens/splash";

describe("splash screen", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("pointerdown alone does not dismiss; click dismisses exactly once", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const onContinue = vi.fn();
    const splash = createSplashScreen(root, { onContinue });
    splash.show();
    const el = root.querySelector(".splash")!;
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onContinue).not.toHaveBeenCalled();
    (el as HTMLElement).click();
    (el as HTMLElement).click();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
