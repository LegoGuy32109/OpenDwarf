import { worldBuilder } from "../../src/shared/world-builder.js";
import { OPEN, STONE } from "../../src/shared/terrain.js";

/** One open chunk with a stone floor, for rule tests that author obstacles themselves. */
export function createOpenField() {
  const { world } = worldBuilder().base(OPEN).fill({
    minX: 0,
    maxX: 15,
    minY: 0,
    maxY: 15,
    minZ: 0,
    maxZ: 0,
  }, STONE).build();
  // Coordinate tests need unknown neighboring chunks rather than a fixed-world border.
  delete world.limits;
  return world;
}
