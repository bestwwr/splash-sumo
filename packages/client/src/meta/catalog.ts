import type { CharacterId, SkillId } from "@lava-sumo/shared";
import elephantArt from "../assets/fighters/elephant.jpg";
import monkeyArt from "../assets/fighters/monkey.jpg";
import turtleArt from "../assets/fighters/turtle.jpg";

export interface CatalogItem {
  id: string;
  kind: "fighter" | "skin";
  name: string;
  role?: string;
  fighterId?: CharacterId;
  order: number;
  defaultOwned: boolean;
}

export const CATALOG: readonly CatalogItem[] = [
  { id: "fighter.elephant", kind: "fighter", name: "Magma Tank", role: "Tank", fighterId: "elephant", order: 0, defaultOwned: true },
  { id: "fighter.monkey", kind: "fighter", name: "Ember Dash", role: "Speedster", fighterId: "monkey", order: 1, defaultOwned: true },
  { id: "fighter.turtle", kind: "fighter", name: "Iron Gramp", role: "Anchor", fighterId: "turtle", order: 2, defaultOwned: true },
];

export const SKILL_INFO: Record<SkillId, { name: string; blurb: string }> = {
  slam: { name: "Ground Slam", blurb: "Wind up, then blast everyone within 2 m." },
  dash: { name: "Dash", blurb: "Burst 4 m forward and hop small gaps. Mis-aim and you splash." },
  shell: { name: "Shell", blurb: "Hide for 1.5 s. Nothing moves you, and whoever hits you bounces off." },
};

export interface ArenaInfo {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  available: boolean;
  order: number;
}

export const DEFAULT_ARENA = "arena.volcano";

export const ARENAS: readonly ArenaInfo[] = [
  {
    id: DEFAULT_ARENA,
    name: "Volcano",
    emoji: "🌋",
    blurb: "The floor crumbles into lava. Don't be the one who splashes.",
    available: true,
    order: 0,
  },
];

/** Available arenas by order, padded with null ("coming soon") to at least `minCells`. */
export function arenasForPicker(minCells = 3): Array<ArenaInfo | null> {
  const cells: Array<ArenaInfo | null> = ARENAS.filter((a) => a.available).sort((a, b) => a.order - b.order);
  while (cells.length < minCells) cells.push(null);
  return cells;
}

export const FIGHTER_EMOJI: Record<CharacterId, string> = { elephant: "🐘", monkey: "🐒", turtle: "🐢" };

/** Portrait art per fighter (square). Fighters without art fall back to their emoji. */
export const FIGHTER_ART: Partial<Record<CharacterId, string>> = { elephant: elephantArt, monkey: monkeyArt, turtle: turtleArt };

/**
 * The fighter's picture for a card: its portrait if it has one, else the emoji.
 * alt is empty because the fighter's name is always printed next to it. If the image fails to load, the emoji shows instead.
 */
export function fighterFaceHtml(id: CharacterId, cls: string): string {
  const art = FIGHTER_ART[id];
  const emoji = FIGHTER_EMOJI[id];
  if (!art) return `<span class="${cls}">${emoji}</span>`;
  return `<img class="${cls} face-art" src="${art}" alt="" draggable="false" onerror="this.outerHTML='<span class=&quot;${cls}&quot;>${emoji}</span>'">`;
}
