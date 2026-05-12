import { assertEquals, assertNotEquals } from "$std/assert/mod.ts";
import {
  CHUNK_EDGE_TILES,
  chunkKeyString,
  computeVisibleChunks,
  generateChunk,
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
