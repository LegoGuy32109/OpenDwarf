import { assertEquals } from "@std/assert";
import { adjacentTarget } from "../../src/shared/target.js";
import { createAuthoredWorld } from "../../src/shared/authored-terrain.js";
import { addPlayer } from "../../src/shared/world.js";

Deno.test("entity target covers eight neighbors on three adjacent levels", () => {
  const world = createAuthoredWorld();
  const player = addPlayer(world, "self", { x: 7, y: 7, z: 3 });
  for (const z of [2, 3, 4]) {
    for (const x of [-1, 0, 1]) {
      for (const y of [-1, 0, 1]) {
        if (!x && !y) continue;
        assertEquals(adjacentTarget(player, { x, y }, z, world), {
          x: 7 + x,
          y: 7 + y,
          z,
        });
      }
    }
  }
  assertEquals(adjacentTarget(player, { x: 1, y: 0 }, 5, world), null);
  assertEquals(adjacentTarget(player, { x: 0, y: 0 }, 3, world), null);
  player.x = 15;
  assertEquals(adjacentTarget(player, { x: 1, y: 0 }, 3, world), null);
  player.x = 0;
  assertEquals(adjacentTarget(player, { x: -1, y: 0 }, 3, world), null);
});
