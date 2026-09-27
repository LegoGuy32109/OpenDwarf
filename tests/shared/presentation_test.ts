import { assertEquals } from "@std/assert";
import { createPresentation } from "../../src/client/presentation.js";
import {
  addPlayer,
  createWorld,
  renderPosition,
  startMove,
} from "../../src/shared/world.js";

Deno.test("remote player and NPC use the same buffered move", () => {
  const world = createWorld();
  addPlayer(world, "admin", { x: 2, y: 4, z: 0 });
  addPlayer(world, "npc-corner", { x: 2, y: 2, z: 0 });
  startMove(world, "admin", 1, 0, 1);
  startMove(world, "npc-corner", 1, 0, 1);
  const visual = createPresentation();
  for (const id of ["admin", "npc-corner"]) {
    const player = world.players[id];
    const at0 = visual.playerAt(player, 0, false);
    assertEquals(renderPosition(at0, 0).x, 2);
    assertEquals(renderPosition(visual.playerAt(player, 2, false), 2).x, 2);
    assertEquals(renderPosition(visual.playerAt(player, 7, false), 7).x, 2.5);
    player.x = 3;
    player.move = null;
    assertEquals(renderPosition(visual.playerAt(player, 11, false), 11).x, 2.9);
    assertEquals(renderPosition(visual.playerAt(player, 12, false), 12).x, 3);
  }
});
