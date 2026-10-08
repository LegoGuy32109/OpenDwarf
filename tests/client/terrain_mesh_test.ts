import { assert, assertEquals } from "@std/assert";
import {
  buildTerrainMesh,
  FLOATS_PER_QUAD,
  meshIsFresh,
} from "../../src/client/terrain-mesh.js";
import { createChunkGenerator } from "../../src/shared/generation.js";
import { applyReveal } from "../../src/shared/reveal.js";
import { elevationMask, surfaceAt } from "../../src/shared/surface.js";
import {
  CHUNK_CELLS,
  createChunkData,
  ensureChunk,
  OPEN,
  setChunk,
  STONE,
  touchChunk,
  unloadChunk,
  writeTile,
} from "../../src/shared/terrain.js";
import { createVisibility } from "../../src/shared/visibility.js";
import { createWorld } from "../../src/shared/world.js";

const visibility = createVisibility();
const Z = 3;

function loadedWorld() {
  const world = createWorld();
  world.generateChunk = createChunkGenerator(7);
  for (let cy = -1; cy <= 2; cy++) {
    for (let cx = -1; cx <= 2; cx++) ensureChunk(world, cx, cy);
  }
  return world;
}

Deno.test("a mesh holds the tiles and edge shading of its chunk", () => {
  const world = loadedWorld();
  const mesh = buildTerrainMesh(world, 0, 0, Z, visibility);
  let tiles = 0;
  let edges = 0;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (surfaceAt(world, x, y, Z, "master", visibility)) tiles++;
      if (elevationMask(world, x, y, Z, "master", visibility)) edges++;
    }
  }
  assertEquals(mesh.tiles, tiles);
  assertEquals(
    (mesh.parts.floor.length + mesh.parts.ores.length) / FLOATS_PER_QUAD,
    tiles,
  );
  assertEquals(mesh.parts.edge.length / FLOATS_PER_QUAD, edges);
});

Deno.test("a mesh stays fresh while nothing it reads changes", () => {
  const world = loadedWorld();
  const mesh = buildTerrainMesh(world, 0, 0, Z, visibility);
  assert(meshIsFresh(mesh, world, 0, 0, Z));
  // A far chunk, and the chunks to the left and above, are not read.
  writeTile(world, 40, 40, Z, STONE);
  writeTile(world, -1, 5, Z, OPEN);
  writeTile(world, 5, -1, Z, OPEN);
  assert(meshIsFresh(mesh, world, 0, 0, Z));
});

Deno.test("a mesh is stale after a tile write in its chunk or a chunk it reads across", () => {
  for (
    const [x, y] of [[5, 5], [16, 5], [5, 16], [16, 16]] as const
  ) {
    const world = loadedWorld();
    const mesh = buildTerrainMesh(world, 0, 0, Z, visibility);
    const before = world.chunks.size;
    const material = writeTile(world, x, y, Z, OPEN) ? OPEN : STONE;
    assertEquals(world.chunks.size, before);
    assertEquals(material, OPEN, `tile ${x},${y} was already open`);
    assert(!meshIsFresh(mesh, world, 0, 0, Z), `write at ${x},${y}`);
  }
});

Deno.test("a mesh is stale after a level change", () => {
  const world = loadedWorld();
  const mesh = buildTerrainMesh(world, 0, 0, Z, visibility);
  assert(!meshIsFresh(mesh, world, 0, 0, Z + 1));
  assert(!meshIsFresh(mesh, world, 0, 0, Z - 1));
});

Deno.test("a mesh is stale after a chunk it reads loads, unloads or is replaced", () => {
  const world = loadedWorld();
  const mesh = buildTerrainMesh(world, 0, 0, Z, visibility);
  setChunk(world, 1, 0, createChunkData(OPEN));
  assert(!meshIsFresh(mesh, world, 0, 0, Z), "replaced");
  const again = buildTerrainMesh(world, 0, 0, Z, visibility);
  assert(meshIsFresh(again, world, 0, 0, Z));
  assert(unloadChunk(world, 1, 1));
  assert(!meshIsFresh(again, world, 0, 0, Z), "unloaded");
  const missing = buildTerrainMesh(world, 0, 0, Z, visibility);
  ensureChunk(world, 1, 1);
  assert(!meshIsFresh(missing, world, 0, 0, Z), "loaded");
});

Deno.test("a mesh is stale after a guest reveal changes a held chunk", () => {
  const world = loadedWorld();
  const mesh = buildTerrainMesh(world, 0, 0, Z, visibility);
  const delta = new Uint8Array(CHUNK_CELLS);
  delta[0] = OPEN;
  applyReveal(world, new Map([["0,0", delta]]));
  assert(!meshIsFresh(mesh, world, 0, 0, Z));
});

Deno.test("touchChunk marks an in-place edit", () => {
  const world = loadedWorld();
  const mesh = buildTerrainMesh(world, 0, 0, Z, visibility);
  touchChunk(ensureChunk(world, 0, 0));
  assert(!meshIsFresh(mesh, world, 0, 0, Z));
});

Deno.test("mining a tile changes the rebuilt mesh", () => {
  const world = loadedWorld();
  const before = buildTerrainMesh(world, 0, 0, Z, visibility);
  // Open a column from the surface down, so the tile's surface changes depth.
  for (let z = Z; z >= 0; z--) writeTile(world, 8, 8, z, OPEN);
  const after = buildTerrainMesh(world, 0, 0, Z, visibility);
  assert(
    after.parts.edge.length !== before.parts.edge.length ||
      after.parts.bands.length !== before.parts.bands.length ||
      after.tiles !== before.tiles,
  );
});
