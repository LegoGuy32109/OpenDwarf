// @ts-check

import { createWorld, EXPANDED_WORLD_EDGE, WORLD_EDGE } from "./world.js";
import {
  CHUNK_EDGE,
  chunkIndex,
  getChunk,
  OPEN,
  STONE,
  WORLD_TOP,
} from "./terrain.js";
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
  const world = createWorld(edge);
  for (let z = 0; z <= WORLD_TOP; z++) {
    for (let y = 0; y < edge; y++) {
      for (let x = 0; x < edge; x++) {
        const solid = (x === 8 && y === 8) ||
          (y === 13 && x >= 2 && x <= 8 && z <= x - 2) ||
          (x >= 9 && x <= 12 && (y === 13 || y === 14) && z <= 6) ||
          (edge === EXPANDED_WORLD_EDGE && x === 23 && y === 23);
        const chunk = getChunk(
          world,
          Math.floor(x / CHUNK_EDGE),
          Math.floor(y / CHUNK_EDGE),
        );
        if (!chunk) continue;
        const ore = y === ORE_ROW_Y && z === 0
          ? ORE_ROW[x - ORE_ROW_X]
          : undefined;
        chunk[chunkIndex(x % CHUNK_EDGE, y % CHUNK_EDGE, z)] = ore ??
          (solid ? STONE : OPEN);
      }
    }
  }
  return world;
}
