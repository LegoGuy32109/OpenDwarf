import { assert, assertEquals } from "@std/assert";
import {
  buildTerrainMesh,
  FLOATS_PER_QUAD,
  meshIsFresh,
} from "../../src/client/terrain-mesh.js";
import {
  ceilingMask,
  REMEMBERED_TINT,
  surfaceAt,
  surfaceColor,
  terrainFrame,
  terrainPatch,
  terrainUv,
} from "../../src/shared/surface.js";
import { createFixtureWorld } from "../../src/shared/world-builder.js";
import {
  createChunkData,
  OPEN,
  setChunk,
  STONE,
  unloadChunk,
  writeTile,
} from "../../src/shared/terrain.js";
import { createVisibility } from "../../src/shared/visibility.js";
import { FLOOR_Z, PLAY_Z } from "../../src/shared/single-plane.js";

function planarWorld() {
  const world = createFixtureWorld();
  setChunk(world, 0, 0, createChunkData(OPEN));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) writeTile(world, x, y, FLOOR_Z, STONE);
  }
  writeTile(world, 4, 4, PLAY_Z, STONE);
  world.planeZ = PLAY_Z;
  return world;
}
Deno.test("planar surfaces use play/support levels and play-cell sight, ignoring upper solids", () => {
  const world = planarWorld(), sight = createVisibility();
  world.chunks.get("0,0")![7 * 256 + 5 * 16 + 5] = STONE;
  sight.visible.add("4,4,1");
  sight.visible.add("5,5,1");
  const wall = surfaceAt(world, 4, 4, 7, "entity", sight)!;
  const floor = surfaceAt(world, 5, 5, 7, "entity", sight)!;
  assertEquals([wall.z, wall.depth, floor.z, floor.depth], [
    PLAY_Z,
    0,
    FLOOR_Z,
    0,
  ]);
  assertEquals(surfaceAt(world, 6, 5, 7, "entity", sight), null);
  sight.visible.clear();
  sight.memory.add("5,5,1");
  const remembered = surfaceAt(world, 5, 5, 7, "entity", sight)!;
  assertEquals(surfaceColor(remembered, true), [1, 0.86, 0.34, 0.95]);
  assertEquals(REMEMBERED_TINT, [1, 0.86, 0.34, 0.95]);
  assertEquals(ceilingMask(world, 4, 4, 1, "master", sight), 0);
});
Deno.test("cached planar mesh matches dynamic UV/colors and omits depth passes", () => {
  const world = planarWorld(), sight = createVisibility();
  const mesh = buildTerrainMesh(world, 0, 0, 7, sight);
  assertEquals(mesh.parts.terrain.length / FLOATS_PER_QUAD, 256);
  for (const name of ["edge", "bands", "ceiling", "floor"] as const) {
    assertEquals(mesh.parts[name].length, 0);
  }
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const tile = surfaceAt(world, x, y, 7, "master", sight)!;
      const uv = terrainUv(tile, x, y), color = surfaceColor(tile, true);
      const offset = (y * 16 + x) * FLOATS_PER_QUAD;
      assertEquals(
        Array.from(mesh.parts.terrain.slice(offset + 2, offset + 8)),
        [uv[0], uv[1], ...color].map(Math.fround),
      );
    }
  }
  world.planeZ = undefined;
  assert(!meshIsFresh(mesh, world, 0, 0, 7));
});
Deno.test("terrain patches are coherent across chunk edges and deterministic after unload", () => {
  const world = planarWorld();
  const frames = [];
  for (let y = -32; y < 32; y++) {
    for (let x = -32; x < 32; x++) {
      frames.push(terrainFrame(x, y, PLAY_Z));
      assert(Math.abs(terrainPatch(x, y) - terrainPatch(x + 1, y)) < 0.22);
    }
  }
  assert(new Set(frames).size >= 5);
  const before = terrainFrame(15, 9, PLAY_Z);
  unloadChunk(world, 0, 0);
  setChunk(world, 0, 0, createChunkData(STONE));
  assertEquals(terrainFrame(15, 9, PLAY_Z), before);
  assert(Math.abs(terrainPatch(15, 9) - terrainPatch(16, 9)) < 0.22);
  for (let x = -100; x < 100; x++) {
    assert(terrainFrame(x, 9, FLOOR_Z) >= 6);
    assert(terrainFrame(x, 9, PLAY_Z) < 6);
  }
});
