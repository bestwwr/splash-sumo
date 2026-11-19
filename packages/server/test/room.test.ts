import { describe, expect, it } from "vitest";
import { CONFIG, Phase, type ClientMsg, type ServerMsg } from "@lava-sumo/shared";
import { RoomLogic, type Outgoing } from "../src/room";

function makeRoom() {
  let n = 0;
  const room = new RoomLogic("ABCD", { random: () => 0.25, randomSeed: () => 1234 + n++ });
  let now = 0;
  const log: Outgoing[] = [];
  const send = (conn: string, msg: ClientMsg | unknown): Outgoing[] => {
    const out = room.message(conn, msg, now);
    log.push(...out);
    return out;
  };
  const join = (conn: string, token: string, nickname = "Nick"): Outgoing[] => {
    room.connect(conn, now);
    return send(conn, { t: "join", token, nickname, character: "elephant" });
  };
  /** Advance the fake clock by ms, ticking every TICK_MS; returns everything emitted. */
  const run = (ms: number): Outgoing[] => {
    const out: Outgoing[] = [];
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + CONFIG.TICK_MS);
      out.push(...room.tick(now));
    }
    log.push(...out);
    return out;
  };
  return { room, send, join, run, log, now: () => now, advance: (ms: number) => (now += ms) };
}

const msgsTo = (out: Outgoing[], to: string, t: string): ServerMsg[] =>
  out.flatMap((o) => ("msg" in o && (o.to === to || o.to === "all") && o.msg.t === t ? [o.msg] : []));
const snaps = (out: Outgoing[]) => out.flatMap((o) => ("msg" in o && o.msg.t === "snap" ? [o.msg] : []));
const closes = (out: Outgoing[]) => out.flatMap((o) => ("close" in o ? [o] : []));
const lastLobby = (out: Outgoing[]) => {
  const l = out.filter((o) => "msg" in o && o.msg.t === "lobby").pop();
  return l && "msg" in l && l.msg.t === "lobby" ? l.msg : null;
};

function startedRoom(humans = 2) {
  const h = makeRoom();
  for (let i = 1; i <= humans; i++) h.join(`c${i}`, `tok${i}`);
  const out = h.send("c1", { t: "start" });
  return { ...h, startOut: out };
}

describe("lobby", () => {
  it("join sends welcome to the joiner and lobby to all; nickname sanitized; host is first joiner", () => {
    const h = makeRoom();
    const out = h.join("c1", "tok1", "  <b>Bob</b>  ");
    expect(msgsTo(out, "c1", "welcome")).toEqual([{ t: "welcome", you: "p1", code: "ABCD" }]);
    const lobby = lastLobby(out)!;
    expect(lobby.hostId).toBe("p1");
    expect(lobby.members.map((m) => m.nickname)).toEqual(["bBobb"]);
    const out2 = h.join("c2", "tok2", "");
    expect(lastLobby(out2)!.members[1]!.nickname.length).toBeGreaterThan(0);
    expect(lastLobby(out2)!.hostId).toBe("p1");
  });

  it("rejects a 5th human with FULL and a join during a match with IN_PROGRESS", () => {
    const h = makeRoom();
    for (let i = 1; i <= 4; i++) h.join(`c${i}`, `tok${i}`);
    expect(h.room.joinable()).toEqual({ ok: false, code: "FULL" });
    expect(closes(h.join("c5", "tok5"))).toEqual([{ close: "c5", code: "FULL" }]);
    h.send("c1", { t: "start" });
    expect(h.room.joinable()).toEqual({ ok: false, code: "IN_PROGRESS" });
    expect(closes(h.join("c6", "tok6"))).toEqual([{ close: "c6", code: "IN_PROGRESS" }]);
    h.run(3100);
    expect(closes(h.join("c7", "tok7"))).toEqual([{ close: "c7", code: "IN_PROGRESS" }]);
  });

  it("same token on a second conn replaces the first", () => {
    const h = makeRoom();
    h.join("c1", "tok1");
    const out = h.join("c2", "tok1");
    expect(closes(out)).toEqual([{ close: "c1", code: "REPLACED" }]);
    expect(msgsTo(out, "c2", "welcome")).toEqual([{ t: "welcome", you: "p1", code: "ABCD" }]);
    expect(lastLobby(out)!.members).toHaveLength(1);
    expect(h.room.disconnect("c1", h.now())).toEqual([]);
    expect(lastLobby(h.send("c2", { t: "diff", difficulty: "hard" }))!.difficulty).toBe("hard");
  });

  it("rejects over-long tokens and ignores invalid messages without throwing", () => {
    const h = makeRoom();
    h.room.connect("c1", 0);
    expect(h.send("c1", { t: "join", token: "x".repeat(65), nickname: "a", character: "elephant" })).toEqual([]);
    expect(h.send("c1", "garbage")).toEqual([]);
    expect(h.send("c1", { t: "nope" })).toEqual([]);
    expect(h.send("c1", { t: "start" })).toEqual([]); // not joined
  });

  it("diff and start from non-host are ignored; pick only in LOBBY", () => {
    const h = makeRoom();
    h.join("c1", "tok1");
    h.join("c2", "tok2");
    expect(h.send("c2", { t: "diff", difficulty: "hard" })).toEqual([]);
    expect(h.send("c2", { t: "start" })).toEqual([]);
    expect(h.room.joinable()).toEqual({ ok: true });
    const out = h.send("c2", { t: "pick", character: "turtle" });
    expect(lastLobby(out)!.members[1]!.character).toBe("turtle");
    h.send("c1", { t: "start" });
    expect(h.send("c2", { t: "pick", character: "monkey" })).toEqual([]);
  });

  it("host leaving the lobby passes host to the next oldest", () => {
    const h = makeRoom();
    h.join("c1", "tok1");
    h.join("c2", "tok2");
    h.join("c3", "tok3");
    const out = h.room.disconnect("c1", h.now());
    const l = lastLobby(out)!;
    expect(l.members.map((m) => m.id)).toEqual(["p2", "p3"]);
    expect(l.hostId).toBe("p2");
  });
});

describe("match", () => {
  it("start from host sends 4 setups, then countdown -> playing with snaps every ~50ms", () => {
    const h = startedRoom(2);
    const start = msgsTo(h.startOut, "c1", "start")[0] as Extract<ServerMsg, { t: "start" }>;
    expect(start.setups.map((s) => s.id)).toEqual(["p1", "p2", "bot1", "bot2"]);
    expect(start.setups.map((s) => s.isBot)).toEqual([false, false, true, true]);
    expect(start.countdownMs).toBe(3000);
    expect(lastLobby(h.startOut)!.phase).toBe(Phase.COUNTDOWN);

    const cd = h.run(2900);
    expect(snaps(cd).every((s) => s.phase === Phase.COUNTDOWN)).toBe(true);
    expect(snaps(cd)[0]!.tiles).toHaveLength(91);
    expect(snaps(cd)[0]!.tick).toBe(0);
    const after = h.run(300);
    expect(snaps(after).some((s) => s.phase === Phase.PLAYING)).toBe(true);
    const play = snaps(h.run(1000));
    expect(play.length).toBeGreaterThanOrEqual(19);
    expect(play.length).toBeLessThanOrEqual(21);
    expect(play.every((s) => s.tiles.length < 91)).toBe(true);
    expect(play[play.length - 1]!.tick).toBeGreaterThan(play[0]!.tick);
  });

  it("applies input, ignores stale seq, reports lastProcessedSeq", () => {
    const h = startedRoom(1);
    h.run(3100);
    h.send("c1", { t: "in", seq: 5, dirX: 1, dirZ: 0, skill: false });
    h.send("c1", { t: "in", seq: 3, dirX: -1, dirZ: 0, skill: false }); // stale
    const s = snaps(h.run(500));
    const p = s[s.length - 1]!.players[0]!;
    expect(p.lastProcessedSeq).toBe(5);
    expect(p.vx).toBeGreaterThan(0);
  });

  it("rate-limits inputs and kicks sustained abuse", () => {
    const h = startedRoom(1);
    h.run(3100);
    for (let i = 1; i <= 30; i++) h.send("c1", { t: "in", seq: i, dirX: 0, dirZ: 1, skill: false });
    const s = snaps(h.run(100));
    expect(s[s.length - 1]!.players[0]!.lastProcessedSeq).toBe(15);

    let seq = 100;
    let kicked: Outgoing[] = [];
    for (let sec = 0; sec < 7 && kicked.length === 0; sec++) {
      for (let i = 0; i < 30; i++) h.send("c1", { t: "in", seq: seq++, dirX: 0, dirZ: 1, skill: false });
      kicked = closes(h.run(1000));
      kicked.push(...closes(h.log.splice(0)));
    }
    expect(kicked.some((c) => "code" in c && c.code === "KICKED")).toBe(true);
  });

  it("host disconnecting mid-match: slot goes bot-driven and host passes on", () => {
    const h = startedRoom(2);
    h.run(3100);
    const out = h.room.disconnect("c1", h.now());
    const l = lastLobby(out)!;
    expect(l.hostId).toBe("p2");
    expect(l.members.find((m) => m.id === "p1")!.connected).toBe(false);
    const a = snaps(h.run(100)).pop()!.players[0]!;
    const b = snaps(h.run(1500)).pop()!.players[0]!;
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(0);
  });

  it("reconnects within 15s with same id; after 15s IN_PROGRESS", () => {
    const h = startedRoom(2);
    h.run(3100);
    h.room.disconnect("c1", h.now());
    h.run(10_000);
    const out = h.join("c9", "tok1");
    expect(msgsTo(out, "c9", "welcome")).toEqual([{ t: "welcome", you: "p1", code: "ABCD" }]);
    expect(lastLobby(out)!.members.find((m) => m.id === "p1")!.connected).toBe(true);
    h.send("c9", { t: "in", seq: 1, dirX: 1, dirZ: 0, skill: false });
    expect(snaps(h.run(300)).pop()!.players[0]!.lastProcessedSeq).toBe(1);

    h.room.disconnect("c9", h.now());
    h.run(15_000);
    expect(closes(h.join("c10", "tok1"))).toEqual([{ close: "c10", code: "IN_PROGRESS" }]);
  });

  it("runs to RESULTS with a final snap carrying result; again returns to LOBBY", () => {
    const h = startedRoom(1);
    let all: Outgoing[] = [];
    for (let i = 0; i < 400 && !snaps(all).some((s) => s.phase === Phase.RESULTS); i++) all = all.concat(h.run(1000));
    const fin = snaps(all).filter((s) => s.phase === Phase.RESULTS);
    expect(fin).toHaveLength(1);
    expect(fin[0]!.result).not.toBeNull();
    expect(h.run(1000)).toEqual([]);
    const out = h.send("c1", { t: "again" });
    const l = lastLobby(out)!;
    expect(l.phase).toBe(Phase.LOBBY);
    expect(l.members.map((m) => m.id)).toEqual(["p1"]);
    expect(h.room.needsTicking()).toBe(false);
  });
});

describe("empty room", () => {
  it("is dead exactly 30s after the last human leaves", () => {
    const h = makeRoom();
    h.join("c1", "tok1");
    expect(h.room.isDead(1e9)).toBe(false);
    const t = h.now();
    h.room.disconnect("c1", t);
    expect(h.room.needsTicking()).toBe(true);
    expect(h.room.isDead(t + 29_999)).toBe(false);
    expect(h.room.isDead(t + 30_000)).toBe(true);
  });
});
