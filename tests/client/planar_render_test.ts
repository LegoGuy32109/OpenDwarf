import { assert, assertEquals } from "@std/assert";
import {
  buildTerrainMesh,
  FLOATS_PER_QUAD,
  meshIsFresh,
} from "../../src/client/terrain-mesh.js";
import {
  ceilingMask,
  NATURAL_TERRAIN_TEXTURES,
  REMEMBERED_TINT,
  surfaceAt,
  surfaceColor,
  TERRAIN_FRAMES,
  TERRAIN_TEXTURES,
  terrainFrame,
  terrainPatch,
  terrainUv,
} from "../../src/shared/surface.js";
import { authoredRecipe, roomRecipe } from "../../src/shared/world-recipes.js";
import { buildWorld } from "../../src/shared/world-builder.js";
import { materialInfo, ORE_FRAMES } from "../../src/shared/materials.js";
import { SPAWN_FLOOR } from "../../src/shared/single-plane.js";
import { createFixtureWorld } from "../../src/shared/world-builder.js";
import {
  createChunkData,
  ensureChunk,
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
  assertEquals(surfaceColor(wall, true), [1, 1, 1, 1]);
  assertEquals(surfaceColor(floor, true), [0.62, 0.62, 0.62, 1]);
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
  const { world } = buildWorld(roomRecipe());
  ensureChunk(world, -2, -2);
  const frames = [];
  for (let y = -32; y < 32; y++) {
    for (let x = -32; x < 32; x++) {
      frames.push(terrainFrame(x, y, PLAY_Z));
      assert(Math.abs(terrainPatch(x, y) - terrainPatch(x + 1, y)) < 0.22);
    }
  }
  assertEquals(new Set(frames).size, 4);
  const before = surfaceAt(
    world,
    -17,
    -23,
    PLAY_Z,
    "master",
    createVisibility(),
  )!;
  const uv = terrainUv(before, -17, -23);
  assert(unloadChunk(world, -2, -2));
  ensureChunk(world, -2, -2);
  assertEquals(
    terrainUv(
      surfaceAt(world, -17, -23, PLAY_Z, "master", createVisibility())!,
      -17,
      -23,
    ),
    uv,
  );
  assert(Math.abs(terrainPatch(15, 9) - terrainPatch(16, 9)) < 0.22);
  for (let x = -100; x < 100; x++) {
    const tile = { depth: 0, seen: "visible", material: STONE };
    assertEquals(
      terrainUv({ ...tile, z: FLOOR_Z }, x, 9),
      terrainUv({ ...tile, z: PLAY_Z }, x, 9),
    );
    assert(terrainFrame(x, 9, PLAY_Z) < 4);
  }
});

Deno.test("natural palette contains only stone, andesite, diorite and granite with measured dominant stone", () => {
  assertEquals(NATURAL_TERRAIN_TEXTURES, [
    "stone",
    "andesite",
    "diorite",
    "granite",
  ]);
  assertEquals(TERRAIN_TEXTURES.slice(0, 4), NATURAL_TERRAIN_TEXTURES);
  // Four 512-square windows cover every tile, chunk seam, both coordinate
  // signs, and distant regions; smooth noise cannot be treated as uniform.
  for (
    const [left, top] of [[-1024, -1024], [0, 0], [-8192, 4096], [4096, -8192]]
  ) {
    const counts = [0, 0, 0, 0];
    let matchingNeighbors = 0;
    for (let y = top; y < top + 512; y++) {
      for (let x = left; x < left + 512; x++) {
        const frame = terrainFrame(x, y, PLAY_Z);
        assert(frame >= 0 && frame < 4, `natural frame ${frame}`);
        counts[frame]++;
        if (frame === terrainFrame(x + 1, y, PLAY_Z)) matchingNeighbors++;
      }
    }
    const shares = counts.map((count) => count / (512 * 512));
    assert(
      shares[0] > 0.72 && shares[0] < 0.78,
      `stone coverage ${shares[0]} at ${left},${top}`,
    );
    for (const share of shares.slice(1)) {
      assert(share > 0.06 && share < 0.11, `accent coverage ${share}`);
    }
    assert(
      matchingNeighbors / (512 * 512) > 0.88,
      "spatially coherent patches",
    );
  }
});
Deno.test("authored paving is confined to the spawn interior floor, retained exactly and shared by both paths", () => {
  const { world } = buildWorld(roomRecipe());
  const visibility = createVisibility();
  const meshes = new Map<string, ReturnType<typeof buildTerrainMesh>>();
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      meshes.set(
        `${cx},${cy}`,
        buildTerrainMesh(world, cx, cy, PLAY_Z, visibility),
      );
    }
  }
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const tile = surfaceAt(world, x, y, PLAY_Z, "master", visibility)!;
      const roomFloor = x >= SPAWN_FLOOR.minX && x <= SPAWN_FLOOR.maxX &&
        y >= SPAWN_FLOOR.minY && y <= SPAWN_FLOOR.maxY;
      const uv = terrainUv(tile, x, y);
      const frame = Math.round(uv[1] * TERRAIN_FRAMES);
      if (roomFloor) {
        assertEquals(tile.z, FLOOR_Z);
        // Same source tile and old four-way noise selection as the preview.
        assertEquals(
          frame,
          4 + Math.min(3, Math.floor(terrainPatch(x, y) * 4)),
        );
      } else assert(frame < 4, `paving escaped to ${x},${y},${tile.z}`);
      const mesh = meshes.get(`${Math.floor(x / 16)},${Math.floor(y / 16)}`)!;
      const ore = materialInfo(tile.material)!.oreFrame;
      const part = ore === null ? mesh.parts.terrain : mesh.parts.ores;
      const offset = part.findIndex((value, index) =>
        index % FLOATS_PER_QUAD === 0 && value === x * 64 &&
        part[index + 1] === y * 64
      );
      assert(offset >= 0);
      assertEquals(
        part[offset + 3],
        Math.fround(ore === null ? uv[1] : ore / ORE_FRAMES),
      );
    }
  }
  const mesh = meshes.get("0,0")!;
  world.floorStyle = undefined;
  assert(!meshIsFresh(mesh, world, 0, 0, PLAY_Z));
  const floor = surfaceAt(world, 15, 15, PLAY_Z, "master", visibility)!;
  assert(terrainUv(floor, 15, 15)[1] * TERRAIN_FRAMES < 4);
  // Coordinates alone never opt a different authored/generated world into paving.
  const natural = buildWorld(authoredRecipe(32, { generator: true })).world;
  assert(
    !surfaceAt(natural, 15, 15, PLAY_Z, "master", visibility)!.authoredFloor,
  );
  // A player-built wall on the room floor must also remain natural stone.
  world.floorStyle = "spawn-room";
  writeTile(world, 15, 15, PLAY_Z, STONE);
  assert(
    terrainUv(
          surfaceAt(world, 15, 15, PLAY_Z, "master", visibility)!,
          15,
          15,
        )[1] * TERRAIN_FRAMES < 4,
  );
});
