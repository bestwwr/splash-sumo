/**
 * Quick Play: a full local match against 3 bots (BotController, same PlayerInput as a human).
 * Thin wrapper: shared match view + LocalSource (fixed 30 Hz sim, render interpolation).
 */
import type { GameScene } from "../render/scene";
import type { Controls } from "../input/input";
import type { Hud } from "../ui/hud";
import { resultsSubtitle } from "../ui/resultsText";
import type { Profile } from "../meta/profile";
import { LocalSource } from "./localSource";
import { runMatchView } from "./matchView";

export interface QuickPlayOptions {
  profile: Profile;
  onHome: () => void;
  onChangeFighter: () => void;
}

export function startQuickPlay(gs: GameScene, controls: Controls, hud: Hud, opts: QuickPlayOptions) {
  const { profile } = opts;
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const view = runMatchView(gs, controls, hud, new LocalSource(profile, seed), {
    subtitle: (r) => resultsSubtitle(profile.difficulty, r.durationMs),
    actions: [
      { id: "again", label: "Play again", onClick: () => { view.stop(); startQuickPlay(gs, controls, hud, opts); } },
      { id: "change", label: "Change fighter", onClick: () => { view.stop(); opts.onChangeFighter(); } },
      { id: "home", label: "Home", onClick: () => { view.stop(); opts.onHome(); } },
    ],
  });
  return { stop: view.stop };
}
