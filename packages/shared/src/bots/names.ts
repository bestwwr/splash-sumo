/**
 * Bot nicknames and random fighter picks for Play vs Bots. Seeded; no Math.random.
 */
import { CHARACTER_IDS, type CharacterId } from "../characters";
import { nextInt, type RngState } from "../rng";

export const BOT_NAMES: readonly string[] = [
  "Magma Mo",
  "Cinder",
  "Basalt Bob",
  "Ember Jo",
  "Pumice",
  "Ash Kicker",
  "Lava Lou",
  "Obsidian",
  "Scoria",
  "Fumarole",
  "Sizzle",
  "Crater Kai",
  "Smokey",
  "Tephra",
  "Blaze Bea",
  "Caldera",
];

/** `count` bots with distinct names (from BOT_NAMES) and random fighters (repeats allowed). */
export function pickBotSetup(seed: number, count: number): { nickname: string; character: CharacterId }[] {
  if (!Number.isInteger(count) || count < 0 || count > BOT_NAMES.length) {
    throw new RangeError(`pickBotSetup: count must be 0..${BOT_NAMES.length}, got ${count}`);
  }
  const rng: RngState = { rng: seed >>> 0 };
  const names = [...BOT_NAMES];
  const out: { nickname: string; character: CharacterId }[] = [];
  for (let i = 0; i < count; i++) {
    const j = i + nextInt(rng, names.length - i);
    const pick = names[j]!;
    names[j] = names[i]!;
    names[i] = pick;
    out.push({ nickname: pick, character: CHARACTER_IDS[nextInt(rng, CHARACTER_IDS.length)]! });
  }
  return out;
}
