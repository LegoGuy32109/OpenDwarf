import { createAuthoredWorld } from "../../src/shared/authored-terrain.js";
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { createPresentation } from "../../src/client/presentation.js";
import {
  addPlayer,
  advanceTicks,
  renderPosition,
  startMove,
} from "../../src/shared/world.js";
import { createVisibility } from "../../src/shared/visibility.js";
import { enableLocomotion } from "../../src/shared/locomotion.js";

Deno.test("sight transition fades a removed player at the last visible position", () => {
  const world = createAuthoredWorld();
  const local = addPlayer(world, "local", { x: 1, y: 1, z: 0 });
  const remote = addPlayer(world, "remote", { x: 2.25, y: 1, z: 0 });
  enableLocomotion(remote);
  const sight = createVisibility();
  sight.visible.add("2,1,0");
  sight.sample = "1,1,0";
  const visual = createPresentation();
  const initial = visual.sightEntries(
    [local, remote],
    "local",
    "entity",
    sight,
    0,
    100,
  );
  assertEquals(initial[0].opacity, 1);
  assertEquals(initial[1].opacity, 0);
  const shown = visual.sightEntries(
    [local, remote],
    "local",
    "entity",
    sight,
    0,
    250,
  );
  assertAlmostEquals(shown[1].opacity, 0.5);
  const leaving = visual.sightEntries(
    [local],
    "local",
    "entity",
    sight,
    0,
    300,
  );
  assertEquals(leaving.length, 2);
  assertAlmostEquals(leaving[1].pos.x, shown[1].pos.x);
  assert(leaving[1].opacity > 0);
  const gone = visual.sightEntries([local], "local", "entity", sight, 0, 451);
  assertEquals(gone.length, 1);
});

Deno.test("remote player and NPC follow their current simulation positions", () => {
  const world = createAuthoredWorld();
  addPlayer(world, "admin", { x: 2, y: 4, z: 0 });
  addPlayer(world, "npc-corner", { x: 2, y: 2, z: 0 });
  const visual = createPresentation();
  for (const id of ["admin", "npc-corner"]) {
    const player = world.players[id];
    assertEquals(visual.positionAt(player, 0, false).x, 2);
    assert(startMove(world, id, 1, 0, 1).ok);
    for (let tick = 1; tick <= 12; tick++) {
      const position = visual.positionAt(player, tick, false);
      const authoritative = renderPosition(player, tick);
      assert(Math.abs(position.x - authoritative.x) <= 0.75);
    }
    assertAlmostEquals(visual.positionAt(player, 20, false).x, 3, 0.01);
  }
});

Deno.test("back-to-back remote moves remain smooth and close to authority", () => {
  const world = createAuthoredWorld();
  addPlayer(world, "npc-corner", { x: 2, y: 2, z: 0 });
  const visual = createPresentation();
  assert(startMove(world, "npc-corner", 1, 0, 1).ok);
  let previous = visual.positionAt(world.players["npc-corner"], 0, false);
  for (let tick = 1; tick <= 24; tick++) {
    advanceTicks(world);
    if (tick === 10) assert(startMove(world, "npc-corner", 0, 1, 2).ok);
    const player = world.players["npc-corner"];
    const position = visual.positionAt(player, tick, false);
    const authoritative = renderPosition(player, tick);
    assert(
      Math.hypot(position.x - previous.x, position.y - previous.y) <= 0.126,
    );
    assert(
      Math.hypot(position.x - authoritative.x, position.y - authoritative.y) <=
        0.751,
    );
    previous = position;
  }
  assert(previous.x > 2.9 && previous.y > 2.9);
});

Deno.test("an interrupted path cannot build a visual move backlog", () => {
  const world = createAuthoredWorld();
  const player = addPlayer(world, "npc-corner", { x: 2, y: 2, z: 0 });
  const visual = createPresentation();
  visual.positionAt(player, 0, false);
  assert(startMove(world, player.id, 1, 0, 1).ok);
  for (let tick = 1; tick <= 7; tick++) {
    advanceTicks(world);
    visual.positionAt(player, tick, false);
  }
  assert(startMove(world, player.id, 0, 1, 2).ok);
  const turn = visual.positionAt(player, 7, false);
  const target = renderPosition(player, 7);
  assert(Math.hypot(turn.x - target.x, turn.y - target.y) <= 0.751);
  for (let tick = 8; tick <= 25; tick++) {
    advanceTicks(world);
    const position = visual.positionAt(player, tick, false);
    const current = renderPosition(player, tick);
    assert(Math.hypot(position.x - current.x, position.y - current.y) <= 0.751);
  }
  const final = visual.positionAt(player, 25, false);
  assertAlmostEquals(final.x, player.x, 0.01);
  assertAlmostEquals(final.y, player.y, 0.01);
});

Deno.test("newer remote positions replace unfinished visual paths", () => {
  const world = createAuthoredWorld();
  const player = addPlayer(world, "peer", { x: 2, y: 2, z: 0 });
  const visual = createPresentation();
  visual.positionAt(player, 0, false);
  for (let tick = 1; tick <= 12; tick++) {
    if (tick <= 3) {
      player.move = {
        origin: { x: tick + 1, y: 2, z: 0 },
        target: { x: tick + 2, y: 2, z: 0 },
        startPosition: { x: 2 + tick * 0.1, y: 2, z: 0 },
        startTick: tick,
        durationTicks: 10,
        sequence: tick,
      };
    }
    const position = visual.positionAt(player, tick, false);
    const current = renderPosition(player, tick);
    assert(Math.abs(position.x - current.x) <= 0.751);
  }
  assert(visual.positionAt(player, 12, false).x > 3.4);
});
