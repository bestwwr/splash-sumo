/**
 * Match view: renders any MatchSource (local sim or network) and drives HUD, FX, haptics and results.
 * Free of networking and sim timing; sources own both.
 */
import * as THREE from "three";
import { CONFIG, Phase, SKILL_OF, SkillPhase, cooldownOf, hexKey, worldToHex, type MatchResult, type MatchState, type SimEvent } from "@lava-sumo/shared";
import type { GameScene } from "../render/scene";
import { createPlayers, type PlayersView } from "../render/players";
import type { Controls } from "../input/input";
import type { Hud } from "../ui/hud";
import { SKILL_INFO } from "../meta/catalog";
import type { MatchSource } from "./matchSource";

export interface MatchViewOptions {
  subtitle: (r: MatchResult) => string;
  actions: Array<{ id: string; label: string; onClick: () => void }>;
}

export function runMatchView(gs: GameScene, controls: Controls, hud: Hud, source: MatchSource, opts: MatchViewOptions) {
  const localId = source.localId;
  let state = source.frame().cur;
  const players: PlayersView = createPlayers(state.players, localId);
  gs.scene.add(players.group);
  gs.skillFx.reset();
  hud.setPlayers(state.players, localId);
  hud.setVisible(true);
  hud.hideResults();

  const tileIdx = new Map(state.tiles.map((t, i) => [hexKey(t.q, t.r), i]));
  const groundY = (x: number, z: number) => {
    const h = worldToHex(x, z);
    const i = tileIdx.get(hexKey(h.q, h.r));
    return i === undefined ? -0.6 : gs.arena.surfaceHeight(i);
  };

  controls.setEnabled(true);

  let last = performance.now();
  let lastShown: number | string | null = null;
  let running = true;
  let raf = 0;
  let resultsScheduled = false;
  const frameTimes: number[] = [];
  let fpsTimer = 0;

  /** Show the results screen once (a matchEnd event and the RESULTS-phase fallback can both ask). */
  function scheduleResults(result: MatchResult, st: MatchState, delayMs: number) {
    if (resultsScheduled) return;
    resultsScheduled = true;
    controls.setEnabled(false);
    window.setTimeout(() => {
      if (!running) return;
      hud.showResults(result, st.players, localId, opts.actions, opts.subtitle(result));
    }, delayMs);
  }

  function handleEvents(events: SimEvent[], state: MatchState) {
    for (const e of events) {
      switch (e.type) {
        case "hit": {
          const a = state.players.find((p) => p.id === e.attackerId)!;
          const v = state.players.find((p) => p.id === e.victimId)!;
          const mid = new THREE.Vector3((a.x + v.x) / 2, 0, (a.z + v.z) / 2);
          gs.fx.bonk(mid, e.strength);
          players.squash(a.id, v.x - a.x, v.z - a.z);
          players.squash(v.id, a.x - v.x, a.z - v.z);
          if (a.id === localId || v.id === localId) {
            gs.shake(0.12 + Math.min(0.25, e.strength * 0.02));
            navigator.vibrate?.(25);
          }
          break;
        }
        case "eliminated": {
          const p = state.players.find((q) => q.id === e.playerId)!;
          gs.fx.poof(new THREE.Vector3(p.x, 0, p.z));
          gs.shake(0.15);
          if (p.id === localId) {
            navigator.vibrate?.([60, 40, 90]);
            hud.banner("You fell in the lava! 🔥", 2200);
          } else hud.banner(`${p.nickname} is out!`, 1400);
          break;
        }
        case "edgeShrink":
          gs.shake(0.06);
          break;
        case "eruptionIncoming":
          hud.banner("ERUPTION! 🌋 Get out of the circles!", 2200);
          gs.shake(0.1);
          break;
        case "suddenDeath":
          hud.banner("SUDDEN DEATH! 🌋", 2200);
          gs.shake(0.3);
          break;
        case "matchEnd":
          scheduleResults(e.result, state, CONFIG.RESULTS_DELAY_MS);
          break;
        case "fall":
          break;
      }
    }
  }

  function frame(now: number) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    let dtMs = now - last;
    last = now;
    if (dtMs > 250) dtMs = 250; // tab was hidden; don't fast-forward
    const dtSec = dtMs / 1000;

    const events = source.advance(dtMs, controls.read());
    const f = source.frame();
    state = f.cur;
    for (const batch of events) {
      for (const ev of batch.events) gs.skillFx.onEvent(ev, batch.state);
      handleEvents(batch.events, batch.state);
    }

    // Rejoined into a finished match: no matchEnd event will ever arrive, so go by the state itself.
    // Online, the interpolated frame can reach RESULTS before the matchEnd event is drained, so keep the same delay.
    if (!resultsScheduled && state.phase === Phase.RESULTS && state.result) scheduleResults(state.result, state, CONFIG.RESULTS_DELAY_MS);

    const n = source.countdown();
    if (n !== lastShown) {
      hud.countdown(n);
      lastShown = n;
    }

    const t = now / 1000;
    gs.arena.update(state.tiles, f.renderTimeMs, t);
    players.update(f.prev.players, state.players, f.alpha, t, dtSec, groundY);
    gs.skillFx.update(state, f.renderTimeMs, dtSec);
    const me = state.players.find((p) => p.id === localId);
    if (!me) {
      // Not a participant (spectating): no skill button.
      controls.setEnabled(false);
    } else if (me.alive) {
      const sk = SKILL_OF[me.character];
      const total = cooldownOf(sk);
      const busy = me.skillPhase !== SkillPhase.NONE;
      controls.setSkillState({ label: SKILL_INFO[sk].name, cooldownFrac: me.skillCooldownMs / total, ready: me.skillCooldownMs <= 0 && !busy });
    } else {
      controls.setSkillState({ label: "THROW", cooldownFrac: me.rockCooldownMs / CONFIG.ROCK_COOLDOWN_MS, ready: me.rockCooldownMs <= 0 });
    }
    gs.updateLava(t);
    hud.update(state.players, state.timeMs, state.suddenDeath);
    gs.render(dtSec);

    // FPS readout (avg over 0.5 s). p10 is collected for analytics later (§4.5).
    frameTimes.push(dtMs);
    fpsTimer += dtMs;
    if (fpsTimer >= 500) {
      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      hud.setFps(1000 / avg);
      frameTimes.length = 0;
      fpsTimer = 0;
    }
  }
  raf = requestAnimationFrame(frame);

  /** Tear down this match: loop, scene objects, FX, HUD, results, input. */
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    gs.scene.remove(players.group);
    players.dispose();
    gs.skillFx.reset();
    source.dispose();
    hud.hideResults();
    hud.countdown(null);
    hud.setVisible(false);
    controls.setEnabled(false);
  }

  return { stop };
}
