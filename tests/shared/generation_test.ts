import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { CHUNK_CELLS, chunkIndex, OPEN } from "../../src/shared/terrain.js";
import {
  COAL,
  DIAMOND,
  EMERALD,
  GOLD_ORE,
  IRON_ORE,
  LAPIS,
  REDSTONE,
} from "../../src/shared/materials.js";
import {
  createChunkGenerator,
  generateAround,
  generateChunkData,
  seedFromText,
} from "../../src/shared/generation.js";
import { createAuthoredWorld } from "../../src/shared/authored-terrain.js";
import { createWorld } from "../../src/shared/world.js";

/** Count each material per level over `size`×`size` chunks around the origin. */
function survey(seed: number, size: number) {
  const counts = Array.from({ length: 8 }, () => new Map<number, number>());
  for (let cy = 0; cy < size; cy++) {
    for (let cx = 0; cx < size; cx++) {
      const data = generateChunkData(seed, cx + 50, cy - 50);
      for (let z = 0; z < 8; z++) {
        for (let i = z * 256; i < (z + 1) * 256; i++) {
          counts[z].set(data[i], (counts[z].get(data[i]) ?? 0) + 1);
        }
      }
    }
  }
  return counts;
}

Deno.test("the same seed always gives the same chunk, and other seeds differ", () => {
  const a = generateChunkData(12345, 3, -4);
  const b = generateChunkData(12345, 3, -4);
  assertEquals(a.length, CHUNK_CELLS);
  assertEquals(a, b);
  assertNotEquals(a, generateChunkData(54321, 3, -4));
  assertNotEquals(a, generateChunkData(12345, 4, -4));
  assertEquals(seedFromText("session-a"), seedFromText("session-a"));
  assertNotEquals(seedFromText("session-a"), seedFromText("session-b"));
});

Deno.test("chunk order does not change generated terrain", () => {
  const forward = createChunkGenerator(7);
  const backward = createChunkGenerator(7);
  const first = forward(1, 1);
  backward(2, 2);
  backward(0, 1);
  assertEquals(backward(1, 1), first);
});

Deno.test("generated terrain is mostly stone with caves at every level", () => {
  const counts = survey(99, 12);
  for (let z = 0; z < 8; z++) {
    const total = 144 * 256;
    const open = (counts[z].get(OPEN) ?? 0) / total;
    assert(open > 0.03 && open < 0.4, `level ${z} is ${open} open`);
    assertEquals(counts[z].get(0) ?? 0, 0, "no unknown tiles");
  }
});

Deno.test("caves continue across chunk borders", () => {
  const left = generateChunkData(5, 0, 0);
  const right = generateChunkData(5, 1, 0);
  let joined = 0;
  for (let z = 0; z < 8; z++) {
    for (let y = 0; y < 16; y++) {
      if (
        left[chunkIndex(15, y, z)] === OPEN &&
        right[chunkIndex(0, y, z)] === OPEN
      ) joined++;
    }
  }
  assert(joined > 0, "an open tile at the border has an open neighbor");
});

Deno.test("ore frequencies follow depth bands over many chunks", () => {
  const counts = survey(2026, 24);
  const chunks = 24 * 24;
  /** Ore tiles of one material in a level range, per chunk. */
  const perChunk = (material: number, zMin: number, zMax: number) => {
    let sum = 0;
    for (let z = zMin; z <= zMax; z++) sum += counts[z].get(material) ?? 0;
    return sum / chunks;
  };
  const report: Record<string, number> = {};
  const bands: [string, number, number, number][] = [
    ["coal", COAL, 5, 7],
    ["iron surface", IRON_ORE, 5, 7],
    ["iron middle", IRON_ORE, 2, 4],
    ["gold", GOLD_ORE, 2, 4],
    ["lapis", LAPIS, 2, 4],
    ["redstone", REDSTONE, 2, 4],
    ["diamond", DIAMOND, 0, 1],
    ["emerald", EMERALD, 0, 1],
  ];
  for (const [name, material, zMin, zMax] of bands) {
    report[name] = Number(perChunk(material, zMin, zMax).toFixed(2));
  }
  console.log("ore tiles per chunk by band", JSON.stringify(report));
  // Coal and iron live near the surface; gold, lapis, redstone in the middle.
  for (const z of [0, 1, 2, 3, 4]) assertEquals(counts[z].get(COAL) ?? 0, 0);
  for (const z of [0, 1]) {
    for (const m of [GOLD_ORE, LAPIS, REDSTONE, IRON_ORE]) {
      assertEquals(counts[z].get(m) ?? 0, 0);
    }
  }
  for (const z of [5, 6, 7]) {
    for (const m of [GOLD_ORE, LAPIS, REDSTONE, DIAMOND, EMERALD]) {
      assertEquals(counts[z].get(m) ?? 0, 0);
    }
  }
  for (const z of [2, 3, 4]) {
    for (const m of [DIAMOND, EMERALD]) assertEquals(counts[z].get(m) ?? 0, 0);
  }
  // Every band has ore, and the rare ores are rarer than the common ones.
  for (const [name, material, zMin, zMax] of bands) {
    assert(perChunk(material, zMin, zMax) > 0, `${name} appears`);
  }
  assert(perChunk(COAL, 5, 7) > perChunk(IRON_ORE, 5, 7));
  assert(perChunk(IRON_ORE, 5, 7) > perChunk(IRON_ORE, 2, 4));
  assert(perChunk(REDSTONE, 2, 4) > perChunk(GOLD_ORE, 2, 4));
  assert(perChunk(DIAMOND, 0, 1) < perChunk(GOLD_ORE, 2, 4));
  assert(perChunk(EMERALD, 0, 1) < perChunk(DIAMOND, 0, 1));
  assert(perChunk(DIAMOND, 0, 1) < 2, "diamond stays rare");
});

Deno.test("ores come in clusters", () => {
  let clustered = 0;
  let ores = 0;
  for (let cx = 0; cx < 20; cx++) {
    const data = generateChunkData(77, cx, 0);
    for (let z = 5; z <= 7; z++) {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (data[chunkIndex(x, y, z)] !== COAL) continue;
          ores++;
          const near = [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 1, 0],
            [0, -1, 0],
            [0, 0, 1],
            [
              0,
              0,
              -1,
            ],
          ].some(([dx, dy, dz]) =>
            x + dx >= 0 && x + dx < 16 && y + dy >= 0 && y + dy < 16 &&
            z + dz >= 0 && z + dz <= 7 &&
            data[chunkIndex(x + dx, y + dy, z + dz)] === COAL
          );
          if (near) clustered++;
        }
      }
    }
  }
  assert(ores > 100);
  assert(clustered / ores > 0.7, `${clustered} of ${ores} coal tiles touch`);
});

Deno.test("generateAround creates missing chunks near a tile, nearest first, within the budget", () => {
  const world = createWorld();
  world.generateChunk = createChunkGenerator(1);
  assertEquals(generateAround(world, [{ x: 8, y: 8 }], 2), 2);
  // Chunk 0,0 is authored; the two nearest missing chunks are edge neighbors.
  assertEquals(world.chunks.size, 3);
  assertEquals(generateAround(world, [{ x: 8, y: 8 }], 100), 6);
  assertEquals(world.chunks.size, 9);
  assertEquals(generateAround(world, [{ x: 8, y: 8 }], 100), 0);
  assertEquals(generateAround(world, [{ x: -1, y: -1 }], 100), 5);
  assert(world.chunks.has("-2,-2"));
});

Deno.test("generation never replaces the authored area", () => {
  const world = createAuthoredWorld(32);
  const before = new Map(
    [...world.chunks].map(([key, data]) => [key, data.slice()]),
  );
  world.generateChunk = createChunkGenerator(3);
  generateAround(world, [{ x: 16, y: 16 }, { x: 2, y: 2 }], 100);
  for (const [key, data] of before) {
    assertEquals(world.chunks.get(key), data, `chunk ${key} is unchanged`);
  }
  assert(world.chunks.has("-1,-1"));
  assert(world.chunks.has("2,2"));
});

Deno.test("without a generator nothing is created", () => {
  const world = createWorld();
  assertEquals(generateAround(world, [{ x: 8, y: 8 }]), 0);
  assertEquals(world.chunks.size, 1);
});

Deno.test("generating a chunk takes a measured time", () => {
  const generate = createChunkGenerator(2026);
  generate(0, 0); // warm up the JIT
  const warm = generate.stats.chunks;
  const start = performance.now();
  for (let i = 0; i < 200; i++) generate(i, -i);
  const mean = (performance.now() - start) / 200;
  console.log(
    `generation: mean ${mean.toFixed(3)} ms per chunk, max ${
      generate.stats.maxMs.toFixed(3)
    } ms over ${generate.stats.chunks - warm} chunks`,
  );
  // A host tick lasts 50 ms; one chunk must stay a small part of it.
  assert(mean < 10, `mean ${mean} ms`);
});
