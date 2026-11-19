import { EliminationCause, type Player } from "../src/types";
import type { CharacterId } from "../src/characters";

export function makePlayer(id: string, x: number, z: number, opts: Partial<Player> & { character?: CharacterId } = {}): Player {
  return {
    id, nickname: id, character: "elephant", slot: 0, isBot: false, alive: true,
    x, z, vx: 0, vz: 0, facing: 0, hitStunMs: 0, fallingMs: -1,
    lastHitById: null, lastHitAtMs: -Infinity, lastProcessedSeq: 0,
    eliminatedCause: EliminationCause.NONE, eliminatedAtMs: -1, eliminatedById: null,
    ...opts,
  };
}
