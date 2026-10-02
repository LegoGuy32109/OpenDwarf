import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { createAuthoredWorld } from "../../src/shared/authored-terrain.js";
import {
  centerTile,
  enableLocomotion,
  moveEntity,
  speedTilesPerSecond,
} from "../../src/shared/locomotion.js";
import {
  addPlayer,
  advanceTicks,
  createWorld,
  renderPosition,
  terrainIndex,
} from "../../src/shared/world.js";

/** These tests were tuned at the former 2.8 tiles per second. */
const FORMER_SPEED = 2.8;

Deno.test("flat travel can stop between tile centers", () => {
  const world = createAuthoredWorld();
  const player = enableLocomotion(addPlayer(world, "self", {
    x: 7,
    y: 7,
    z: 0,
  }));
  for (let i = 0; i < 4; i++) {
    advanceTicks(world);
    moveEntity(world, "self", 1, 0, FORMER_SPEED);
  }
  for (let i = 0; i < 8; i++) {
    advanceTicks(world);
    moveEntity(world, "self", 0, 0);
  }
  assert(player.x > 7.4 && player.x < 7.7);
  assertEquals(player.move, null);
  assertEquals(centerTile(player.x), 8);
  assertAlmostEquals(player.vx ?? 0, 0, 0.02);
});

Deno.test("half-tile footprints share a tile but block when boxes touch", () => {
  const world = createAuthoredWorld();
  const first = enableLocomotion(addPlayer(world, "first", {
    x: 6.75,
    y: 7,
    z: 0,
  }));
  enableLocomotion(addPlayer(world, "second", { x: 7.3, y: 7, z: 0 }));
  assertEquals(centerTile(first.x), centerTile(world.players.second.x));
  for (let i = 0; i < 10; i++) {
    advanceTicks(world);
    moveEntity(world, "first", 1, 0);
  }
  assert(first.x <= 6.802);
});

Deno.test("a raised face commits a step to the near edge and changes z at 75 percent", () => {
  const world = createAuthoredWorld();
  const player = enableLocomotion(addPlayer(world, "self", {
    x: 2,
    y: 12,
    z: 0,
  }));
  for (let i = 0; i < 10 && !player.move; i++) {
    advanceTicks(world);
    moveEntity(world, "self", 0, 1);
  }
  assert(player.move);
  assertAlmostEquals(player.move.target.y, 12.751);
  assertEquals(player.move.target.z, 1);
  advanceTicks(world, 4);
  assertEquals(player.z, 0);
  advanceTicks(world);
  assertEquals(player.z, 1);
  advanceTicks(world);
  assertEquals(player.move, null);
  assertAlmostEquals(player.y, 12.751);
});

Deno.test("a one-level drop begins when the center crosses the edge", () => {
  const world = createAuthoredWorld();
  const player = enableLocomotion(addPlayer(world, "self", {
    x: 3,
    y: 13,
    z: 2,
  }));
  for (let i = 0; i < 10 && !player.move; i++) {
    advanceTicks(world);
    moveEntity(world, "self", -1, 0, FORMER_SPEED);
  }
  assert(player.move);
  assert(player.x > 2.5);
  assertAlmostEquals(player.move.target.x, 2.249);
  assertEquals(player.move.target.z, 1);
});

Deno.test("loss of support chains downward steps without changing x or y", () => {
  const world = createWorld();
  world.terrain.fill(1);
  world.terrain[terrainIndex(7, 7, 0)] = 2;
  const player = enableLocomotion(addPlayer(world, "self", {
    x: 7,
    y: 7,
    z: 3,
  }));
  for (let i = 0; i < 30; i++) {
    advanceTicks(world);
    moveEntity(world, "self", 0, 0);
  }
  assertEquals(player.z, 1);
  assertEquals(player.x, 7);
  assertEquals(player.y, 7);
});

Deno.test("an occupied landing blocks a climb until the entity moves away", () => {
  const world = createWorld();
  world.terrain.fill(1);
  world.terrain[terrainIndex(8, 7, 0)] = 2;
  const climber = enableLocomotion(addPlayer(world, "climber", {
    x: 7,
    y: 7,
    z: 0,
  }));
  const blocker = enableLocomotion(addPlayer(world, "blocker", {
    x: 8,
    y: 7,
    z: 1,
  }));
  for (let i = 0; i < 12; i++) {
    advanceTicks(world);
    moveEntity(world, "climber", 1, 0);
  }
  assertEquals(climber.move, null);
  assert(climber.x < 7.251);
  blocker.y = 8;
  for (let i = 0; i < 12 && !climber.move; i++) {
    advanceTicks(world);
    moveEntity(world, "climber", 1, 0);
  }
  assert(climber.move);
  assertEquals(climber.move.target.z, 1);
});

Deno.test("an occupied diagonal landing blocks both directions", () => {
  const world = createWorld();
  world.terrain.fill(1);
  world.terrain[terrainIndex(8, 8, 0)] = 2;
  const climber = enableLocomotion(addPlayer(world, "climber", {
    x: 7,
    y: 7,
    z: 0,
  }));
  enableLocomotion(addPlayer(world, "blocker", {
    x: 8,
    y: 8,
    z: 1,
  }));
  for (let i = 0; i < 12; i++) {
    advanceTicks(world);
    moveEntity(world, "climber", 1, 1);
  }
  assertEquals(climber.move, null);
  assert(climber.x < 7.251 && climber.y < 7.251);
  assertAlmostEquals(climber.x, climber.y);
});

Deno.test("stopping diagonal travel does not reverse the rendered path", () => {
  const world = createAuthoredWorld();
  const player = enableLocomotion(addPlayer(world, "self", {
    x: 5,
    y: 5,
    z: 0,
  }));
  for (let i = 0; i < 4; i++) {
    advanceTicks(world);
    moveEntity(world, "self", 1, 1);
  }
  for (let i = 0; i < 6; i++) {
    const prior = renderPosition(player, world.tick + 0.99);
    advanceTicks(world);
    moveEntity(world, "self", 0, 0);
    const next = renderPosition(player, world.tick + 0.01);
    assert(next.x >= prior.x - 0.002);
    assert(next.y >= prior.y - 0.002);
  }
});

Deno.test("diagonal descent lands over the crossed edge's support", () => {
  const world = createWorld();
  world.terrain.fill(1);
  world.terrain[terrainIndex(7, 7, 1)] = 2;
  world.terrain[terrainIndex(8, 7, 0)] = 2;
  const player = enableLocomotion(addPlayer(world, "self", {
    x: 7.4,
    y: 7,
    z: 2,
  }));
  for (let i = 0; i < 8 && !player.move; i++) {
    advanceTicks(world);
    moveEntity(world, "self", 1, 1);
  }
  assert(player.move);
  assertEquals(player.move.target.z, 1);
  assertAlmostEquals(player.move.target.x, 7.751);
  assertAlmostEquals(player.move.target.y, player.move.origin.y);
  advanceTicks(world, 6);
  assertEquals(player.z, 1);
  assertEquals(player.move, null);
  advanceTicks(world);
  moveEntity(world, "self", 0, 0);
  assertEquals(player.move, null);
});

Deno.test("speed converts D&D feet per round to tiles per second", () => {
  assertEquals(speedTilesPerSecond(), 1);
  assertEquals(speedTilesPerSecond(30), 1);
  assertAlmostEquals(speedTilesPerSecond(50), 5 / 3);
  assertEquals(speedTilesPerSecond(60), 2);
  assertEquals(speedTilesPerSecond(30, true), 2);
  assertEquals(speedTilesPerSecond(60, true), 4);
  assertEquals(speedTilesPerSecond(45), 1);
});

Deno.test("sprint covers twice the distance of the same speed", () => {
  const distance = (sprint: boolean) => {
    const world = createWorld();
    world.terrain.fill(1);
    for (let x = 0; x < world.edge; x++) {
      for (let y = 0; y < world.edge; y++) {
        world.terrain[terrainIndex(x, y, 0)] = 2;
      }
    }
    const player = enableLocomotion(addPlayer(world, "self", {
      x: 2,
      y: 7,
      z: 1,
    }));
    for (let i = 0; i < 40; i++) {
      advanceTicks(world);
      moveEntity(world, "self", 1, 0, speedTilesPerSecond(30, sprint));
    }
    return player.x - 2;
  };
  const walk = distance(false);
  assert(walk > 1.5 && walk < 2.1, `walked ${walk}`);
  assertAlmostEquals(distance(true) / walk, 2, 0.15);
});
