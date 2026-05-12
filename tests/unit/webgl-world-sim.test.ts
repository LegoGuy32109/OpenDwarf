import { assert, assertEquals, assertGreater } from "$std/assert/mod.ts";
import {
  advanceWorldMovement,
  createWorldSim,
  recomputeFov,
  startEntityMove,
  worldBlockAt,
} from "../../lib/webgl-world-sim.ts";

Deno.test("webgl world sim spawns entity in starter room on supported air", () => {
  const world = createWorldSim("single-rock-step1");
  const pos = world.entity.position;

  assertEquals(worldBlockAt(world.seed, pos), "air");
  assertEquals(worldBlockAt(world.seed, { ...pos, z: pos.z - 1 }), "solid");
});

Deno.test("webgl world sim movement resolves through terrain over fixed ticks", () => {
  const world = createWorldSim("single-rock-step1");
  const loaded = new Set(["0,0,0"]);
  const start = { ...world.entity.position };

  const result = startEntityMove(world, { x: 1, y: 0, z: 0 }, loaded);
  assert(result.ok);
  assert(world.entity.movement);

  for (let i = 0; i < 10; i++) {
    advanceWorldMovement(world);
  }

  assertEquals(world.entity.position, {
    x: start.x + 1,
    y: start.y,
    z: start.z,
  });
  assertEquals(world.entity.movement, null);
});

Deno.test("webgl world sim fov tracks visible and remembered tiles separately", () => {
  const world = createWorldSim("single-rock-step1");
  recomputeFov(world);
  const firstVisibleCount = world.visible.size;
  assertGreater(firstVisibleCount, 0);

  const loaded = new Set(["0,0,0"]);
  for (let step = 0; step < 7; step++) {
    const result = startEntityMove(world, { x: 1, y: 0, z: 0 }, loaded);
    assert(result.ok);
    for (let i = 0; i < 10; i++) {
      world.tick += 1;
      advanceWorldMovement(world);
    }
    recomputeFov(world);
  }

  assertGreater(world.visible.size, 0);
  assertGreater(world.memory.size, 0);
});
