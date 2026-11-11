// @ts-check

import { WORLD_EDGE } from "./world.js";
import { buildWorld, worldBuilder } from "./world-builder.js";
import { OPEN, STONE, WORLD_TOP } from "./terrain.js";
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

/** Explicit legacy 3D fixture for unit tests. Playable worlds use world-recipes.js. */
/** @param {number} [edge] */
export function createAuthoredWorld(edge = WORLD_EDGE) {
  if (edge !== 16 && edge !== 32) {
    throw new RangeError("unsupported authored area size");
  }
  const b = worldBuilder().base(OPEN).bounds({
    minX: 0,
    minY: 0,
    minZ: 0,
    maxX: edge - 1,
    maxY: edge - 1,
    maxZ: WORLD_TOP,
  });
  b.fill({ minX: 8, maxX: 8, minY: 8, maxY: 8, minZ: 0, maxZ: 7 }, STONE);
  for (let x = 2; x <= 8; x++) {
    b.fill(
      { minX: x, maxX: x, minY: 13, maxY: 13, minZ: 0, maxZ: x - 2 },
      STONE,
    );
  }
  b.fill({ minX: 9, maxX: 12, minY: 13, maxY: 14, minZ: 0, maxZ: 6 }, STONE);
  if (edge === 32) {
    b.fill({ minX: 23, maxX: 23, minY: 23, maxY: 23, minZ: 0, maxZ: 7 }, STONE);
  }
  ORE_ROW.forEach((material, i) =>
    b.tile({ x: ORE_ROW_X + i, y: ORE_ROW_Y, z: 0 }, material)
  );
  return buildWorld(b.definition()).world;
}
