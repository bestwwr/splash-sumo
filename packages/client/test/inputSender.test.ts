import { describe, expect, it } from "vitest";
import type { ClientMsg } from "@splash-sumo/shared";
import { CONFIG } from "@splash-sumo/shared";
import { RoomLogic } from "../../server/src/room";
import { InputSender } from "../src/net/inputSender";

function make() {
  const sent: Array<Extract<ClientMsg, { t: "in" }>> = [];
  let now = 0;
  const s = new InputSender((m) => sent.push(m as Extract<ClientMsg, { t: "in" }>), () => now);
  return { s, sent, at: (t: number) => (now = t) };
}

describe("InputSender", () => {
  it("sends nothing for identical inputs until keep-alive", () => {
    const { s, sent, at } = make();
    for (let t = 0; t < 1000; t += 16) {
      at(t);
      s.update({ dirX: 0, dirZ: 0, skill: false });
    }
    expect(sent).toHaveLength(0);
    at(1000);
    s.update({ dirX: 0, dirZ: 0, skill: false });
    expect(sent).toHaveLength(1);
  });

  it("limits to 15 sends in one second of changing input and quantizes to 2dp", () => {
    const { s, sent, at } = make();
    for (let i = 0; i < 60; i++) {
      at(i * (1000 / 60));
      s.update({ dirX: Math.sin(i), dirZ: Math.cos(i), skill: false });
    }
    expect(sent.length).toBeLessThanOrEqual(15);
    expect(sent.length).toBeGreaterThan(5);
    for (const m of sent) expect(m.dirX).toBe(Math.round(m.dirX * 100) / 100);
  });

  it("sends skill press and release even inside the rate window", () => {
    const { s, sent, at } = make();
    at(0);
    s.update({ dirX: 1, dirZ: 0, skill: false });
    at(10);
    s.update({ dirX: 1, dirZ: 0, skill: true });
    at(20);
    s.update({ dirX: 1, dirZ: 0, skill: false });
    for (let t = 30; t < 400; t += 10) {
      at(t);
      s.update({ dirX: 1, dirZ: 0, skill: false });
    }
    expect(sent.map((m) => m.skill)).toEqual([false, true, false]);
  });

  it("seq strictly increases and reset restarts at 1", () => {
    const { s, sent, at } = make();
    for (let i = 0; i < 10; i++) {
      at(i * 100);
      s.update({ dirX: i / 10, dirZ: 0, skill: false });
    }
    const seqs = sent.map((m) => m.seq);
    expect(seqs[0]).toBe(1);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    s.reset();
    at(2000);
    s.update({ dirX: 0, dirZ: 0, skill: false });
    expect(sent[sent.length - 1]!.seq).toBe(1);
  });
});

describe("InputSender final-review fixes", () => {
  it("I5: no keep-alive while keepAlive is false; resumes when true", () => {
    const { s, sent, at } = make();
    for (let t = 0; t <= 5000; t += 100) {
      at(t);
      s.update({ dirX: 0, dirZ: 0, skill: false }, false);
    }
    expect(sent).toHaveLength(0);
    at(5100);
    s.update({ dirX: 0, dirZ: 0, skill: false }, true);
    expect(sent).toHaveLength(1);
  });

  it("I3: sendNeutral emits zero input immediately with a monotonic seq and clears queued moves", () => {
    const { s, sent, at } = make();
    at(0);
    s.update({ dirX: 1, dirZ: 0, skill: false });
    at(10);
    s.update({ dirX: 0, dirZ: 1, skill: false }); // queued behind the rate limit
    at(20);
    s.sendNeutral();
    expect(sent.map((m) => [m.seq, m.dirX, m.dirZ, m.skill])).toEqual([
      [1, 1, 0, false],
      [2, 0, 0, false],
    ]);
    at(500);
    s.update({ dirX: 0, dirZ: 0, skill: false });
    expect(sent).toHaveLength(2); // the stale queued move was dropped
  });

  it("I4: 10 s of steering with +-30 ms send jitter passes the server limiter: nothing dropped, no KICKED", () => {
    let n = 0;
    const room = new RoomLogic("ABCD", { random: () => 0.25, randomSeed: () => 1234 + n++ }, 0);
    let t = 0;
    room.connect("c1", 0);
    room.message("c1", { t: "join", token: "tok", nickname: "A", character: "elephant" }, 0);
    room.message("c1", { t: "start" }, 0);
    const sender = new InputSender((m) => outbox.push(m), () => t);
    const outbox: ClientMsg[] = [];
    let rng = 42;
    const jitter = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 60 - 30;
    const inflight: Array<{ at: number; m: ClientMsg }> = [];
    let delivered = 0;
    let kicked = false;
    const cs = (room as unknown as { conns: Map<string, { windowCount: number; overSince: number | null }> }).conns;
    let everOver = false;
    for (let f = 0; f * (1000 / 60) < 10_000; f++) {
      t = f * (1000 / 60);
      sender.update({ dirX: Math.sin(f / 7), dirZ: Math.cos(f / 7), skill: false });
      for (const m of outbox.splice(0)) inflight.push({ at: t + 30 + jitter(), m });
      inflight.sort((a, b) => a.at - b.at);
      while (inflight.length > 0 && inflight[0]!.at <= t) {
        const { at, m } = inflight.shift()!;
        const out = room.message("c1", m, at);
        delivered++;
        if (out.some((o) => "close" in o)) kicked = true;
        const c = cs.get("c1");
        if (c && (c.windowCount > CONFIG.NET_SERVER_MSG_MAX_PER_SEC || c.overSince !== null)) everOver = true;
      }
    }
    expect(delivered).toBeGreaterThan(100);
    expect(everOver).toBe(false);
    expect(kicked).toBe(false);
  });
});
