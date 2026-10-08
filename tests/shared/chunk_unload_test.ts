// Chunk unloading and edit diffs (ADR 0005).
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { createChunkUnloader } from "../../src/shared/chunk-unload.js";
import {
  createChunkGenerator,
  seedFromText,
  UNLOAD_GRACE_MS,
  UNLOAD_RADIUS,
} from "../../src/shared/generation.js";
import {
  CHUNK_CELLS,
  chunkKey,
  ensureChunk,
  OPEN,
  pinLoadedChunks,
  readTile,
  STONE,
  unloadChunk,
  writeTile,
} from "../../src/shared/terrain.js";
import {
  createVisibility,
  recomputeVisibility,
  tileKey,
} from "../../src/shared/visibility.js";
import { createWorld } from "../../src/shared/world.js";
import { dropItem, droppedAt } from "../../src/shared/items.js";

const FAR = 16 * 40;

/** An authored world whose chunks are pinned, with a seeded generator. */
function hostWorld() {
  const world = createWorld();
  world.generateChunk = createChunkGenerator(seedFromText("unload"));
  pinLoadedChunks(world);
  return world;
}

const origin = [{ x: 8, y: 8 }];
const away = [{ x: FAR, y: FAR }];

Deno.test("a chunk unloads after the grace period with no player near, and not before", () => {
  const world = hostWorld();
  const unloader = createChunkUnloader();
  ensureChunk(world, 10, 10);
  unloader.update(world, origin, 0);
  assertEquals(unloader.update(world, origin, UNLOAD_GRACE_MS - 1), 0);
  assert(world.chunks.has("10,10"));
  assertEquals(unloader.update(world, origin, UNLOAD_GRACE_MS), 1);
  assert(!world.chunks.has("10,10"));
});

Deno.test("a player within the unload radius keeps a chunk loaded", () => {
  const world = hostWorld();
  const unloader = createChunkUnloader();
  ensureChunk(world, 10, 10);
  const near = [{ x: (10 + UNLOAD_RADIUS) * 16 + 15, y: 10 * 16 }];
  unloader.update(world, near, 0);
  unloader.update(world, near, UNLOAD_GRACE_MS * 5);
  assert(world.chunks.has("10,10"));
  // Walking away starts the grace period from the last time it was near.
  unloader.update(world, origin, UNLOAD_GRACE_MS * 5 + 1);
  assert(world.chunks.has("10,10"));
  unloader.update(world, origin, UNLOAD_GRACE_MS * 6 + 1);
  assert(!world.chunks.has("10,10"));
});

Deno.test("a master-view player, a free mover, keeps chunks around it loaded", () => {
  const world = hostWorld();
  const unloader = createChunkUnloader();
  ensureChunk(world, 10, 10);
  const master = [{ x: 10 * 16 + 0.5, y: 10 * 16 + 0.5 }];
  unloader.update(world, master, 0);
  unloader.update(world, master, UNLOAD_GRACE_MS * 3);
  assert(world.chunks.has("10,10"));
});

Deno.test("pinned chunks never unload", () => {
  const world = hostWorld();
  const unloader = createChunkUnloader();
  unloader.update(world, away, 0);
  unloader.update(world, away, UNLOAD_GRACE_MS * 10);
  assert(world.chunks.has("0,0"));
  assert(world.pinned!.has("0,0"));
});

Deno.test("a world with no generator never unloads", () => {
  const world = createWorld();
  const unloader = createChunkUnloader();
  ensureChunk(world, 10, 10);
  unloader.update(world, away, 0);
  assertEquals(unloader.update(world, away, UNLOAD_GRACE_MS * 10), 0);
  assert(world.chunks.has("10,10"));
});

Deno.test("a mined tile and a placed stone survive an unload and reload", () => {
  const world = hostWorld();
  const unloader = createChunkUnloader();
  const generated = ensureChunk(world, 10, 10).slice();
  const x = 10 * 16 + 3;
  const y = 10 * 16 + 4;
  const mined = generated[2 * 256 + 4 * 16 + 3] === STONE ? OPEN : STONE;
  writeTile(world, x, y, 2, mined);
  const other = generated[3 * 256 + 4 * 16 + 5];
  const placed = other === STONE ? OPEN : STONE;
  writeTile(world, x + 2, y, 3, placed);
  unloader.update(world, origin, 0);
  unloader.update(world, origin, UNLOAD_GRACE_MS);
  assert(!world.chunks.has("10,10"));
  assertEquals(world.edits!.get("10,10")!.size, 2);
  ensureChunk(world, 10, 10);
  assertEquals(readTile(world, x, y, 2), mined);
  assertEquals(readTile(world, x + 2, y, 3), placed);
  // Every other tile is generated again unchanged.
  const reloaded = ensureChunk(world, 10, 10);
  assertEquals(
    reloaded.filter((v, i) => v !== generated[i]).length,
    2,
  );
});

Deno.test("dropped items on an unloaded chunk survive", () => {
  const world = hostWorld();
  const unloader = createChunkUnloader();
  ensureChunk(world, 10, 10);
  const tile = { x: 10 * 16 + 1, y: 10 * 16 + 1, z: 2 };
  dropItem(world, tile, "stone", 3);
  unloader.update(world, origin, 0);
  unloader.update(world, origin, UNLOAD_GRACE_MS);
  assert(!world.chunks.has("10,10"));
  assertEquals(droppedAt(world, tile).map((s) => s.count), [3]);
});

Deno.test("readTile after an unload does not return stale cached data", () => {
  const world = hostWorld();
  const unloader = createChunkUnloader();
  ensureChunk(world, 10, 10);
  const x = 10 * 16 + 2;
  const y = 10 * 16 + 2;
  writeTile(world, x, y, 1, OPEN);
  assertEquals(readTile(world, x, y, 1), OPEN);
  unloader.update(world, origin, 0);
  unloader.update(world, origin, UNLOAD_GRACE_MS);
  // An unloaded chunk reads as solid stone, not the cached tiles.
  assertEquals(readTile(world, x, y, 1), STONE);
  assertNotEquals(world.chunks.has(chunkKey(10, 10)), true);
});

Deno.test("the authored build leaves no edit diffs", () => {
  const world = createWorld();
  writeTile(world, 3, 3, 1, OPEN);
  world.generateChunk = createChunkGenerator(1);
  pinLoadedChunks(world);
  assertEquals(world.edits?.size ?? 0, 0);
  writeTile(world, 4, 4, 1, OPEN);
  assertEquals(world.edits?.size ?? 0, 0);
});

Deno.test("sight refreshes when a nearby chunk loads or unloads, without moving", () => {
  const world = createWorld();
  world.chunks.get("0,0")!.fill(OPEN);
  world.generateChunk = () => new Uint8Array(CHUNK_CELLS).fill(OPEN);
  const sight = createVisibility();
  const spot = { x: 8.5, y: 8.5, z: 0 };
  const far = tileKey(20, 8, 1);
  recomputeVisibility(world, sight, spot);
  assert(!sight.visible.has(far));
  assertEquals(recomputeVisibility(world, sight, spot), false);
  ensureChunk(world, 1, 0);
  assertEquals(recomputeVisibility(world, sight, spot), true);
  assert(sight.visible.has(far));
  unloadChunk(world, 1, 0);
  assertEquals(recomputeVisibility(world, sight, spot), true);
  assert(!sight.visible.has(far));
});

Deno.test("unloader keeps every chunk inside a view rectangle", () => {
  const world = hostWorld();
  for (let cx = 3; cx <= 8; cx++) ensureChunk(world, cx, 0);
  ensureChunk(world, 20, 0);
  const unloader = createChunkUnloader({ graceMs: 1000 });
  // The players are far away; the view covers chunks 3 through 8 on row 0.
  const view = { minX: 3 * 16, minY: 0, maxX: 9 * 16 - 1, maxY: 15 };
  unloader.update(world, away, 0, [view]);
  assertEquals(unloader.update(world, away, 5000, [view]), 1);
  for (let cx = 3; cx <= 8; cx++) assert(world.chunks.has(chunkKey(cx, 0)));
  assertEquals(world.chunks.has(chunkKey(20, 0)), false);
  // Once the view moves off, the chunks wait out the grace period and unload.
  assertEquals(unloader.update(world, away, 5500, []), 0);
  assertEquals(unloader.update(world, away, 7500, []), 6);
});
