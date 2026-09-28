// @ts-check

import { createWorld, terrainIndex, WORLD_EDGE, WORLD_TOP } from "./world.js";

/** The authored map is loaded only by a host. Guests receive discovered cells. */
export function createAuthoredWorld() {
  const world = createWorld();
  for (let z = 0; z <= WORLD_TOP; z++) {
    for (let y = 0; y < WORLD_EDGE; y++) {
      for (let x = 0; x < WORLD_EDGE; x++) {
        const solid = (x === 8 && y === 8) ||
          (y === 13 && x >= 2 && x <= 8 && z <= x - 2) ||
          (x >= 9 && x <= 12 && (y === 13 || y === 14) && z <= 6);
        world.terrain[terrainIndex(x, y, z)] = solid ? 2 : 1;
      }
    }
  }
  return world;
}
