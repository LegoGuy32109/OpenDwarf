// @ts-check

import { WORLD_EDGE } from "./world.js";
import { buildWorld } from "./world-builder.js";
import { authoredRecipe } from "./world-recipes.js";
import { STONE } from "./terrain.js";
import {
  COAL,
  DIAMOND,
  EMERALD,
  GOLD_ORE,
  IRON_ORE,
  LAPIS,
  REDSTONE,
} from "./materials.js";

/** A test row of stone and each ore at level 0, drawn left to right from x 2. */
export const ORE_ROW_Y = 1;
export const ORE_ROW_X = 2;
export const ORE_ROW = [
  STONE,
  COAL,
  IRON_ORE,
  GOLD_ORE,
  LAPIS,
  REDSTONE,
  DIAMOND,
  EMERALD,
];

/** The authored map is loaded only by a host. Guests receive discovered chunks. */
/** @param {number} [edge] */
export function createAuthoredWorld(edge = WORLD_EDGE) {
  return buildWorld(authoredRecipe(edge)).world;
}
