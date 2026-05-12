import { assertEquals, assertNotEquals } from "$std/assert/mod.ts";
import {
  CHUNK_EDGE_TILES,
  CHUNK_SIZE_PX,
  chunkKeyString,
  computeCeilingShadowIds,
  computeEdgeShadowIds,
  computeStreamingChunks,
  computeVisibleChunks,
  generateChunk,
  shadowMaskToAtlasId,
  updateChunkCache,
} from "../../lib/webgl-chunk-gen.ts";

Deno.test("generateChunk length is CHUNK_EDGE_TILES²", () => {
  const tiles = generateChunk("s", { chunkX: 0, chunkY: 0, chunkZ: 0 });
  assertEquals(tiles.length, CHUNK_EDGE_TILES * CHUNK_EDGE_TILES);
});

Deno.test("generateChunk is deterministic for same seed and key", () => {
  const key = { chunkX: 3, chunkY: -2, chunkZ: 0 };
  const a = generateChunk("rocks-aabb-v1", key);
  const b = generateChunk("rocks-aabb-v1", key);
  assertEquals([...a], [...b]);
});

Deno.test("generateChunk differs for different seeds", () => {
  const key = { chunkX: 0, chunkY: 0, chunkZ: 0 };
  const a = generateChunk("seed-alpha", key);
  const b = generateChunk("seed-beta", key);
  assertNotEquals([...a], [...b]);
});

Deno.test("generateChunk differs for different chunkX", () => {
  const a = generateChunk("test-seed", { chunkX: 0, chunkY: 0, chunkZ: 0 });
  const b = generateChunk("test-seed", { chunkX: 1, chunkY: 0, chunkZ: 0 });
  assertNotEquals([...a], [...b]);
});

Deno.test("generateChunk differs for different chunkY", () => {
  const a = generateChunk("test-seed", { chunkX: 0, chunkY: 0, chunkZ: 0 });
  const b = generateChunk("test-seed", { chunkX: 0, chunkY: 1, chunkZ: 0 });
  assertNotEquals([...a], [...b]);
});

Deno.test("generateChunk differs for negative vs positive coords", () => {
  const a = generateChunk("test-seed", { chunkX: -1, chunkY: 0, chunkZ: 0 });
  const b = generateChunk("test-seed", { chunkX: 1, chunkY: 0, chunkZ: 0 });
  assertNotEquals([...a], [...b]);
});

Deno.test("generateChunk all values in [0, 65535]", () => {
  const tiles = generateChunk("test-seed", {
    chunkX: 5,
    chunkY: -3,
    chunkZ: 0,
  });
  for (const v of tiles) {
    if (v < 0 || v > 65535) throw new Error(`tile value ${v} out of range`);
  }
});

Deno.test("generateChunk produces varied output (not all same value)", () => {
  const tiles = generateChunk("rocks-aabb-v1", {
    chunkX: 3,
    chunkY: -2,
    chunkZ: 0,
  });
  const unique = new Set(tiles);
  // A 256-element chunk from a good PRNG should have many distinct values
  if (unique.size < 128) {
    throw new Error(
      `Expected varied output, got only ${unique.size} distinct values`,
    );
  }
});

Deno.test("chunkKeyString formats correctly for negative coords", () => {
  assertEquals(
    chunkKeyString({ chunkX: -1, chunkY: -2, chunkZ: 0 }),
    "-1,-2,0",
  );
  assertEquals(chunkKeyString({ chunkX: 0, chunkY: 0, chunkZ: 0 }), "0,0,0");
  assertEquals(chunkKeyString({ chunkX: 3, chunkY: -2, chunkZ: 1 }), "3,-2,1");
});

Deno.test("shadowMaskToAtlasId flips north/south atlas rows", () => {
  assertEquals(shadowMaskToAtlasId(3), 12);
  assertEquals(shadowMaskToAtlasId(12), 3);
  assertEquals(shadowMaskToAtlasId(5), 5);
  assertEquals(shadowMaskToAtlasId(10), 10);
});

Deno.test("computeEdgeShadowIds returns atlas ids with horizontal shadows on air side", () => {
  const solid = new Uint8Array(CHUNK_EDGE_TILES * CHUNK_EDGE_TILES);
  solid[0] = 1;
  solid[1] = 1;
  const cache = new Map([
    [chunkKeyString({ chunkX: 0, chunkY: 0, chunkZ: 0 }), solid],
  ]);

  const shadows = computeEdgeShadowIds(0, 0, 0, cache);

  assertEquals(shadows[0], 12);
});

Deno.test("computeCeilingShadowIds emits filled mask when floor and ceiling are solid", () => {
  const floor = new Uint8Array(CHUNK_EDGE_TILES * CHUNK_EDGE_TILES);
  const ceiling = new Uint8Array(CHUNK_EDGE_TILES * CHUNK_EDGE_TILES);
  floor[0] = 1;
  floor[1] = 1;
  floor[CHUNK_EDGE_TILES] = 1;
  floor[CHUNK_EDGE_TILES + 1] = 1;
  ceiling[0] = 1;
  ceiling[1] = 1;
  ceiling[CHUNK_EDGE_TILES] = 1;
  ceiling[CHUNK_EDGE_TILES + 1] = 1;
  const cache = new Map([
    [chunkKeyString({ chunkX: 0, chunkY: 0, chunkZ: 0 }), floor],
    [chunkKeyString({ chunkX: 0, chunkY: 0, chunkZ: 1 }), ceiling],
  ]);

  const shadows = computeCeilingShadowIds(0, 0, 0, cache);

  assertEquals(shadows[0], 15);
});

Deno.test("computeCeilingShadowIds emits ceiling-only silhouettes over air", () => {
  const floor = new Uint8Array(CHUNK_EDGE_TILES * CHUNK_EDGE_TILES);
  const ceiling = new Uint8Array(CHUNK_EDGE_TILES * CHUNK_EDGE_TILES);
  ceiling[0] = 1;
  ceiling[1] = 1;
  ceiling[CHUNK_EDGE_TILES] = 1;
  ceiling[CHUNK_EDGE_TILES + 1] = 1;
  const cache = new Map([
    [chunkKeyString({ chunkX: 0, chunkY: 0, chunkZ: 0 }), floor],
    [chunkKeyString({ chunkX: 0, chunkY: 0, chunkZ: 1 }), ceiling],
  ]);

  const shadows = computeCeilingShadowIds(0, 0, 0, cache);

  assertEquals(shadows[0], 15);
});

Deno.test("computeVisibleChunks at origin with 1920x1080 viewport", () => {
  const visible = computeVisibleChunks(
    { x: 0, y: 0, zoom: 1 },
    { framebufferWidth: 1920, framebufferHeight: 1080 },
  );
  const keys = visible.map(chunkKeyString).sort();
  assertEquals(keys, ["-1,-1,0", "-1,0,0", "0,-1,0", "0,0,0"].sort());
});

Deno.test("computeVisibleChunks shifts correctly when camera pans right", () => {
  const at0 = computeVisibleChunks(
    { x: 0, y: 0, zoom: 1 },
    { framebufferWidth: 1920, framebufferHeight: 1080 },
  ).map(chunkKeyString).sort();

  const at960 = computeVisibleChunks(
    { x: 960, y: 0, zoom: 1 },
    { framebufferWidth: 1920, framebufferHeight: 1080 },
  ).map(chunkKeyString).sort();

  assertNotEquals(at0, at960);
  // At x=960 the leftmost column shifts from -1 to 0
  assertEquals(at960.includes("-1,-1,0"), false);
  assertEquals(at960.includes("1,0,0"), true);
});

Deno.test("computeStreamingChunks is superset of computeVisibleChunks", () => {
  const cam = { x: 0, y: 0, zoom: 1 };
  const vp = { framebufferWidth: 1920, framebufferHeight: 1080 };
  const visible = new Set(computeVisibleChunks(cam, vp).map(chunkKeyString));
  const streaming = new Set(
    computeStreamingChunks(cam, vp, 1).map(chunkKeyString),
  );
  for (const k of visible) {
    assertEquals(
      streaming.has(k),
      true,
      `visible chunk ${k} missing from streaming`,
    );
  }
  // streaming must be strictly larger
  assertEquals(streaming.size > visible.size, true);
});

Deno.test("computeStreamingChunks padding=1 extends by one chunk in each direction", () => {
  const cam = { x: 0, y: 0, zoom: 1 };
  const vp = { framebufferWidth: 1920, framebufferHeight: 1080 };
  const p0 = computeStreamingChunks(cam, vp, 0).map(chunkKeyString).sort();
  const p1 = computeStreamingChunks(cam, vp, 1).map(chunkKeyString).sort();
  // visible(1920, 1080): 2 cols × 2 rows = 4; padding=0 streaming = same; padding=1: +2 cols, +2 rows
  assertEquals(p0.length, 4);
  assertEquals(p1.length, (2 + 2) * (2 + 2));
});

Deno.test("computeStreamingChunks works at chunk boundaries", () => {
  // Camera exactly at chunk boundary x = CHUNK_SIZE_PX
  const cam = { x: CHUNK_SIZE_PX, y: 0, zoom: 1 };
  const vp = { framebufferWidth: 1920, framebufferHeight: 1080 };
  const streaming = computeStreamingChunks(cam, vp, 1).map(chunkKeyString);
  // chunk x=1 must be in streaming window
  assertEquals(streaming.some((k) => k.startsWith("1,")), true);
  // chunk x=-1 (padding behind) must be in streaming window
  assertEquals(streaming.some((k) => k.startsWith("-1,")), true);
});

Deno.test("updateChunkCache loads new chunks", () => {
  const cache = new Map<string, Uint16Array>();
  const keys = [
    { chunkX: 0, chunkY: 0, chunkZ: 0 },
    { chunkX: 1, chunkY: 0, chunkZ: 0 },
  ];
  const changed = updateChunkCache(cache, "test-seed", keys);
  assertEquals(changed, true);
  assertEquals(cache.size, 2);
  assertEquals(cache.has("0,0,0"), true);
  assertEquals(cache.has("1,0,0"), true);
});

Deno.test("updateChunkCache evicts chunks outside streaming window", () => {
  const cache = new Map<string, Uint16Array>();
  updateChunkCache(cache, "s", [
    { chunkX: 0, chunkY: 0, chunkZ: 0 },
    { chunkX: 1, chunkY: 0, chunkZ: 0 },
  ]);
  // Shift window — evict (1,0), keep (0,0), add (-1,0)
  const changed = updateChunkCache(cache, "s", [
    { chunkX: -1, chunkY: 0, chunkZ: 0 },
    { chunkX: 0, chunkY: 0, chunkZ: 0 },
  ]);
  assertEquals(changed, true);
  assertEquals(cache.has("-1,0,0"), true);
  assertEquals(cache.has("0,0,0"), true);
  assertEquals(cache.has("1,0,0"), false);
});

Deno.test("updateChunkCache returns false when window is unchanged", () => {
  const cache = new Map<string, Uint16Array>();
  const keys = [{ chunkX: 0, chunkY: 0, chunkZ: 0 }];
  updateChunkCache(cache, "s", keys);
  const changed = updateChunkCache(cache, "s", keys);
  assertEquals(changed, false);
});
