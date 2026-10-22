import { worldBuilder } from "../../src/shared/world-builder.js";
import { OPEN, STONE } from "../../src/shared/terrain.js";
import { addPlayer, type World } from "../../src/shared/world.js";

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

/** A trader NPC like Ulgar, standing still on `at`. */
export function addTrader(
  world: World,
  at: { x: number; y: number; z: number },
  id = "npc-ulgar",
) {
  const trader = addPlayer(world, id, at);
  trader.name = "Ulgar";
  trader.npc = true;
  trader.role = "trader";
  return trader;
}
