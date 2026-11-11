import { assert, assertEquals } from "@std/assert";
import { buildWorld, worldBuilder } from "../../src/shared/world-builder.js";
import { OPEN, STONE } from "../../src/shared/terrain.js";
import {
  createVisibility,
  recomputeVisibility,
} from "../../src/shared/visibility.js";
Deno.test("planar sight reveals play cells and support without upper-level or floor-ray leaks", () => {
  const { world } = buildWorld(
    worldBuilder().planar().base(OPEN).fill({
      minX: 0,
      maxX: 15,
      minY: 0,
      maxY: 15,
      minZ: 1,
      maxZ: 1,
    }, OPEN).fill(
      { minX: 5, maxX: 5, minY: 0, maxY: 15, minZ: 1, maxZ: 1 },
      STONE,
    ).spawn({ x: 3, y: 4, z: 1 }).definition(),
  );
  const sight = createVisibility();
  recomputeVisibility(world, sight, { x: 3, y: 4, z: 1 });
  assert(sight.visible.has("4,4,1"));
  assert(sight.visible.has("4,4,0"));
  assert(sight.visible.has("5,4,1"));
  assert(!sight.visible.has("6,4,1"));
  assert(!sight.visible.has("6,4,0"));
  assert([...sight.visible].every((k) => ["0", "1"].includes(k.split(",")[2])));
  recomputeVisibility(world, sight, { x: 7, y: 4, z: 1 });
  assert(sight.memory.has("4,4,1"));
  assertEquals(sight.visible.has("6,4,1"), true);
});
