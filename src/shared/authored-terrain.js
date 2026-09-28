// @ts-check

import {
  createWorld,
  EXPANDED_WORLD_EDGE,
  terrainIndex,
  WORLD_EDGE,
  WORLD_TOP,
} from "./world.js";

/** The authored map is loaded only by a host. Guests receive discovered cells. */
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
        world.terrain[terrainIndex(x, y, z, edge)] = solid ? 2 : 1;
      }
    }
  }
  return world;
}
