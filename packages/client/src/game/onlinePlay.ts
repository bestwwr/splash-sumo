/**
 * Online flow: Friends screen -> Lobby -> match (NetSource) -> back to Lobby.
 * Owns the room connection; screens and the match view are driven from its messages.
 */
import type { CharacterId, ClientMsg, ServerMsg, StartMsg } from "@lava-sumo/shared";
import { Phase } from "@lava-sumo/shared";
import type { GameScene } from "../render/scene";
import type { Controls } from "../input/input";
import type { Hud } from "../ui/hud";
import type { Profile } from "../meta/profile";
import { checkRoom, connectRoom, createRoom, playerToken, type RoomConnection } from "../net/roomClient";
import { NetSource } from "../net/netSource";
import { createFriendsScreen } from "../ui/screens/friends";
import { createLobbyScreen } from "../ui/screens/lobby";
import { toast } from "../ui/toast";
import { runMatchView } from "./matchView";

export interface OnlineDeps {
  root: HTMLElement;
  gs: GameScene;
  controls: Controls;
  hud: Hud;
  getProfile(): Profile;
  setProfile(p: Profile): void;
  /** Idle arena animates behind menu screens; false while a match view is running. */
  setIdle(active: boolean): void;
  /** Return to the Home screen (all online screens already hidden). */
  onHome(): void;
  /** Test seams; default to the real implementations. */
  api?: Partial<OnlineApi>;
}

export interface OnlineApi {
  connectRoom: typeof connectRoom;
  createRoom: typeof createRoom;
  checkRoom: typeof checkRoom;
  runMatchView: typeof runMatchView;
  makeSource(start: StartMsg, you: string, send: (m: ClientMsg) => void): NetSource;
}

const UNAVAILABLE = "Room not available — create your own room";
const DOWN = "Online play is down or busy — try Quick Play";

export function createOnlineFlow(deps: OnlineDeps) {
  const { root, gs, controls, hud } = deps;
  const api: OnlineApi = {
    connectRoom,
    createRoom,
    checkRoom,
    runMatchView,
    makeSource: (st, id, snd) => new NetSource(st, id, snd, () => performance.now()),
    ...deps.api,
  };
  /** Bumped on back/leave/teardown; async steps compare it after each await. */
  let gen = 0;
  let conn: RoomConnection | null = null;
  let you = "";
  let code = "";
  let view: { stop(): void } | null = null;
  let net: NetSource | null = null;
  let hadLobby = false;

  const send = (m: ClientMsg) => conn?.send(m);

  const friends = createFriendsScreen(root, {
    onCreate: () => void create(),
    onJoin: (c) => void join(c),
    onBack: () => {
      teardown();
      deps.onHome();
    },
  });
  const lobby = createLobbyScreen(root, {
    send,
    onLeave: () => leave(),
    onPick: (c: CharacterId) => deps.setProfile({ ...deps.getProfile(), equippedFighter: c }),
    onNotice: (t) => toast(root, t),
  });

  function stopView() {
    const v = view;
    view = null;
    net = null;
    v?.stop();
  }

  /** Drop the connection and all online UI. */
  function teardown() {
    gen++;
    stopView();
    const c = conn;
    conn = null;
    c?.close();
    hadLobby = false;
    lobby.hide();
    friends.hide();
  }

  function leave() {
    const c = conn;
    c?.send({ t: "leave" });
    teardown();
    deps.onHome();
  }

  function showFriends(message: string | null, isError: boolean) {
    deps.setIdle(true);
    friends.setBusy(false);
    friends.setMessage(message, isError);
    friends.show();
  }

  function fail(message: string) {
    teardown();
    showFriends(message, true);
  }

  function startMatch(s: StartMsg) {
    stopView();
    lobby.hide();
    friends.hide();
    deps.setIdle(false);
    const source = api.makeSource(s, you, send);
    net = source;
    view = api.runMatchView(gs, controls, hud, source, {
      subtitle: () => "Online match",
      actions: [
        { id: "again", label: "Play again", onClick: () => send({ t: "again" }) },
        { id: "leave", label: "Leave", onClick: () => leave() },
      ],
    });
  }

  function onMsg(m: ServerMsg) {
    switch (m.t) {
      case "welcome":
        you = m.you;
        code = m.code;
        break;
      case "lobby":
        if (m.phase === Phase.LOBBY) {
          if (view || !hadLobby) {
            // First lobby, or back from results.
            stopView();
            hadLobby = true;
            friends.hide();
            deps.setIdle(true);
            lobby.show();
          }
          lobby.update(m, you, code);
        }
        break;
      case "start":
        startMatch(m);
        break;
      case "snap":
        net?.onSnap(m, performance.now());
        break;
      case "error":
        if (m.code === "UPDATE_REQUIRED") location.reload();
        else if (m.code === "REPLACED") {
          teardown();
          deps.onHome();
          toast(root, "Joined from another tab");
        } else if (m.code === "KICKED") {
          teardown();
          deps.onHome();
          toast(root, "You were removed from the room");
        } else if (m.code === "FULL" || m.code === "IN_PROGRESS" || m.code === "NOT_FOUND") fail(UNAVAILABLE);
        break;
    }
  }

  function enter(c: string) {
    const p = deps.getProfile();
    code = c;
    const g = gen;
    let reconnected = false;
    conn = api.connectRoom(
      c,
      { token: playerToken(), nickname: p.nickname, character: p.equippedFighter },
      {
        onMsg: (m) => {
          if (g === gen) onMsg(m);
        },
        onState(s) {
          if (g !== gen) return;
          if (s === "open") {
            if (reconnected) net?.resetInput();
          } else if (s === "reconnecting") {
            reconnected = true;
            toast(root, "Reconnecting…");
          } else {
            teardown();
            deps.onHome();
            toast(root, "Connection lost");
          }
        },
      },
    );
  }

  async function create() {
    friends.setBusy(true);
    friends.setMessage("Creating room…");
    const g = ++gen;
    try {
      const c = await api.createRoom();
      if (g !== gen) return;
      enter(c);
    } catch {
      if (g !== gen) return;
      friends.setBusy(false);
      friends.setMessage(DOWN, true);
    }
  }

  async function join(c: string) {
    friends.setBusy(true);
    friends.setMessage("Joining…");
    const g = ++gen;
    const r = await api.checkRoom(c);
    if (g !== gen) return;
    // IN_PROGRESS may be our own rejoin; the server decides (replies IN_PROGRESS error if not a member).
    if (r === "ok" || r === "IN_PROGRESS") enter(c);
    else {
      friends.setBusy(false);
      friends.setMessage(r === "DOWN" ? DOWN : UNAVAILABLE, true);
    }
  }

  return {
    openFriends() {
      showFriends(null, false);
    },
    /** Deep link: go straight to joining a code. */
    joinCode(c: string) {
      showFriends(null, false);
      void join(c);
    },
  };
}
