import { assert, assertEquals } from "@std/assert";
import { createPresentation } from "../../src/client/presentation.js";
import {
  addPlayer,
  advanceTicks,
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

Deno.test("back-to-back remote moves keep every visible step", () => {
  const world = createWorld();
  addPlayer(world, "npc-corner", { x: 2, y: 2, z: 0 });
  const visual = createPresentation();
  assert(startMove(world, "npc-corner", 1, 0, 1).ok);
  const positions = [];
  for (let tick = 0; tick <= 24; tick++) {
    if (tick) advanceTicks(world);
    if (tick === 10) assert(startMove(world, "npc-corner", 0, 1, 2).ok);
    const player = visual.playerAt(world.players["npc-corner"], tick, false);
    positions.push(renderPosition(player, tick));
  }
  assertEquals(positions[9], { x: 2.7, y: 2, z: 0 });
  assertEquals(positions[10], { x: 2.8, y: 2, z: 0 });
  assertEquals(positions[11], { x: 2.9, y: 2, z: 0 });
  assertEquals(positions[12], { x: 3, y: 2, z: 0 });
  assertEquals(positions[13], { x: 3, y: 2.1, z: 0 });
  for (let i = 1; i < positions.length; i++) {
    const a = positions[i - 1];
    const b = positions[i];
    assert(Math.hypot(b.x - a.x, b.y - a.y) <= 0.101);
  }
});

Deno.test("two pending remote turns keep both corners", () => {
  const world = createWorld();
  const player = addPlayer(world, "npc-corner", { x: 2, y: 2, z: 0 });
  const visual = createPresentation();
  assert(startMove(world, player.id, 1, 0, 1).ok);
  visual.playerAt(player, 0, false);
  advanceTicks(world, 10);
  assert(startMove(world, player.id, 0, 1, 2).ok);
  visual.playerAt(player, 10, false);
  const third = {
    ...player,
    move: {
      origin: { x: 3, y: 3, z: 0 },
      target: { x: 2, y: 3, z: 0 },
      startPosition: { x: 3, y: 3, z: 0 },
      startTick: 20,
      durationTicks: 10,
      sequence: 3,
    },
  };
  for (let tick = 11; tick <= 32; tick++) {
    const position = renderPosition(visual.playerAt(third, tick, false), tick);
    if (tick === 12) assertEquals(position, { x: 3, y: 2, z: 0 });
    if (tick === 22) assertEquals(position, { x: 3, y: 3, z: 0 });
    if (tick === 32) assertEquals(position, { x: 2, y: 3, z: 0 });
  }
});
