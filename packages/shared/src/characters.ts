/**
 * Characters (A.5). Stats are 1–5 and total 10. Skills are in skills.ts.
 */
import { CONFIG } from "./config";

export type CharacterId = "elephant" | "monkey" | "turtle";

export interface CharacterStats {
  power: number;
  agility: number;
  endurance: number;
}

export const CHARACTERS: Record<CharacterId, { name: string; stats: CharacterStats }> = {
  elephant: { name: "Magma Tank", stats: { power: 5, agility: 2, endurance: 3 } },
  monkey: { name: "Ember Dash", stats: { power: 2, agility: 5, endurance: 3 } },
  turtle: { name: "Turtle", stats: { power: 3, agility: 2, endurance: 5 } },
};

export type SkillId = "slam" | "dash" | "shell";

export const SKILL_OF: Record<CharacterId, SkillId> = {
  elephant: "slam",
  monkey: "dash",
  turtle: "shell",
};

export const CHARACTER_IDS: readonly CharacterId[] = ["elephant", "monkey", "turtle"];

export function maxSpeed(c: CharacterId): number {
  return CONFIG.BASE_SPEED + CONFIG.SPEED_PER_AGILITY * CHARACTERS[c].stats.agility;
}

export function powerMult(c: CharacterId): number {
  return CONFIG.POWER_MULT_BASE + CONFIG.POWER_MULT_PER_POINT * CHARACTERS[c].stats.power;
}

export function enduranceMult(c: CharacterId): number {
  return CONFIG.ENDURANCE_MULT_BASE + CONFIG.ENDURANCE_MULT_PER_POINT * CHARACTERS[c].stats.endurance;
}
