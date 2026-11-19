/**
 * Quick Play: a full local match against 3 bots (BotController, same PlayerInput as a human).
 * Fixed 30 Hz sim (shared `step`) + render interpolation at display rate.
 */
import * as THREE from "three";
import {
  BotController,
  pickBotSetup,
  CONFIG,
  Phase,
  SKILL_OF,
  SkillPhase,
  createMatch,
  hexKey,
  step,
  cooldownOf,
  worldToHex,
  type MatchState,
  type PlayerInput,
  type SimEvent,
} from "@lava-sumo/shared";
import type { GameScene } from "../render/scene";
import { createPlayers, type PlayersView } from "../render/players";
import type { Controls } from "../input/input";
import type { Hud } from "../ui/hud";
import { resultsSubtitle } from "../ui/resultsText";
import type { Profile } from "../meta/profile";
import { SKILL_INFO } from "../meta/catalog";

/** Dev tool: `?fx` spawns one bot of each fighter so every skill can be seen. */
const FX_MODE = import.meta.env.DEV && new URLSearchParams(location.search).has("fx");

const LOCAL_ID = "you";
const FX_CHARACTERS = ["elephant", "monkey", "turtle"] as const;

export interface QuickPlayOptions {
  profile: Profile;
  onHome: () => void;
  onChangeFighter: () => void;
}

export function startQuickPlay(gs: GameScene, controls: Controls, hud: Hud, opts: QuickPlayOptions) {
  const { profile } = opts;
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const botSetups = pickBotSetup(seed, 3);
  const botIds = botSetups.map((_, i) => `bot${i + 1}`);
  let state: MatchState = createMatch(seed, [
    { id: LOCAL_ID, nickname: profile.nickname, character: profile.equippedFighter, isBot: false },
    ...botSetups.map((b, i) => ({
      id: botIds[i]!,
      nickname: b.nickname,
      character: FX_MODE ? FX_CHARACTERS[i]! : b.character,
      isBot: true,
    })),
  ]);
  const bots = botIds.map((id, i) => new BotController(id, profile.difficulty, (seed ^ (i + 1)) >>> 0));
  let prev = state;
  const players: PlayersView = createPlayers(state.players, LOCAL_ID);
  gs.scene.add(players.group);
  gs.skillFx.reset();
  hud.setPlayers(state.players, LOCAL_ID);
  hud.setVisible(true);
  hud.hideResults();

  const tileIdx = new Map(state.tiles.map((t, i) => [hexKey(t.q, t.r), i]));
  const groundY = (x: number, z: number) => {
    const h = worldToHex(x, z);
    const i = tileIdx.get(hexKey(h.q, h.r));
    return i === undefined ? -0.6 : gs.arena.surfaceHeight(i);
  };

  // Pre-match countdown 3-2-1 (A.1) — sim is frozen during it.
  const COUNTDOWN_MS = 3000;
  let countdownLeft = COUNTDOWN_MS;
  let lastShown: number | string | null = null;
  controls.setEnabled(true);

  let seq = 0;
  let acc = 0;
  let last = performance.now();
  let running = true;
  let raf = 0;
  const frameTimes: number[] = [];
  let fpsTimer = 0;

  function handleEvents(events: SimEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case "hit": {
          const a = state.players.find((p) => p.id === e.attackerId)!;
          const v = state.players.find((p) => p.id === e.victimId)!;
          const mid = new THREE.Vector3((a.x + v.x) / 2, 0, (a.z + v.z) / 2);
          gs.fx.bonk(mid, e.strength);
          players.squash(a.id, v.x - a.x, v.z - a.z);
          players.squash(v.id, a.x - v.x, a.z - v.z);
          if (a.id === LOCAL_ID || v.id === LOCAL_ID) {
            gs.shake(0.12 + Math.min(0.25, e.strength * 0.02));
            navigator.vibrate?.(25);
          }
          break;
        }
        case "eliminated": {
          const p = state.players.find((q) => q.id === e.playerId)!;
          gs.fx.poof(new THREE.Vector3(p.x, 0, p.z));
          gs.shake(0.15);
          if (p.id === LOCAL_ID) {
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
          controls.setEnabled(false);
          window.setTimeout(() => {
            if (!running) return;
            hud.showResults(
              e.result,
              state.players,
              LOCAL_ID,
              { onAgain: again, onChangeFighter: changeFighter, onHome: home },
              resultsSubtitle(profile.difficulty, e.result.durationMs),
            );
          }, 1100);
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

    if (countdownLeft > 0) {
      countdownLeft -= dtMs;
      const n = countdownLeft > 0 ? Math.ceil(countdownLeft / 1000) : "GO!";
      if (n !== lastShown) {
        hud.countdown(n);
        lastShown = n;
        if (n === "GO!") window.setTimeout(() => hud.countdown(null), 600);
      }
    } else if (state.phase === Phase.PLAYING) {
      acc += dtMs;
      let steps = 0;
      while (acc >= CONFIG.TICK_MS && steps < CONFIG.MAX_CATCHUP_STEPS) {
        const local = controls.read();
        seq++;
        const inputs: Record<string, PlayerInput> = {
          [LOCAL_ID]: { seq, dirX: local.dirX, dirZ: local.dirZ, skill: local.skill },
        };
        for (const b of bots) inputs[b.playerId] = b.input(state, seq);
        prev = state;
        const r = step(state, inputs);
        state = r.state;
        for (const ev of r.events) gs.skillFx.onEvent(ev, state);
        handleEvents(r.events);
        acc -= CONFIG.TICK_MS;
        steps++;
      }
      if (steps === CONFIG.MAX_CATCHUP_STEPS) acc = 0; // avoid spiral of death (§3.7)
    }

    const alpha = state.phase === Phase.PLAYING && countdownLeft <= 0 ? Math.min(1, acc / CONFIG.TICK_MS) : 1;
    const renderTimeMs = prev.timeMs + (state.timeMs - prev.timeMs) * alpha;
    const t = now / 1000;
    gs.arena.update(state.tiles, renderTimeMs, t);
    players.update(prev.players, state.players, alpha, t, dtSec, groundY);
    gs.skillFx.update(state, renderTimeMs, dtSec);
    const me = state.players.find((p) => p.id === LOCAL_ID)!;
    if (me.alive) {
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

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    gs.scene.remove(players.group);
    players.dispose();
    gs.skillFx.reset();
  }
  /** Tear down this match: loop, scene objects, FX, HUD, results, input. */
  function teardown() {
    stop();
    hud.hideResults();
    hud.countdown(null);
    hud.setVisible(false);
    controls.setEnabled(false);
  }
  function again() {
    teardown();
    startQuickPlay(gs, controls, hud, opts);
  }
  function changeFighter() {
    teardown();
    opts.onChangeFighter();
  }
  function home() {
    teardown();
    opts.onHome();
  }

  return { stop: teardown };
}
