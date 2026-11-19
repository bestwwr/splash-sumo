import { describe, expect, it } from "vitest";
import type { ClientMsg } from "@lava-sumo/shared";
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
