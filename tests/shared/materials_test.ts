import { assert, assertEquals } from "@std/assert";
import {
  COAL,
  DIAMOND,
  EMERALD,
  GOLD_ORE,
  IRON_ORE,
  isMaterial,
  LAPIS,
  materialInfo,
  MATERIALS,
  MAX_MATERIAL,
  ORE_FRAMES,
  ORE_MATERIALS,
  REDSTONE,
} from "../../src/shared/materials.js";
import {
  CHUNK_CELLS,
  createChunkData,
  OPEN,
  readTile,
  STONE,
  UNKNOWN,
  writeTile,
} from "../../src/shared/terrain.js";
import {
  decodeChunk,
  decodeChunks,
  encodeChunk,
  encodeChunks,
} from "../../src/shared/chunk-wire.js";
import {
  createAuthoredWorld,
  ORE_ROW,
  ORE_ROW_X,
  ORE_ROW_Y,
} from "../../src/shared/authored-terrain.js";
import { addPlayer, isSolid } from "../../src/shared/world.js";
import { createVisibility } from "../../src/shared/visibility.js";
import { entityView } from "../../src/shared/view.js";
import {
  applyReveal,
  createPendingReveal,
  drainReveal,
} from "../../src/shared/reveal.js";
import { decodeState, encodeWorld } from "../../src/shared/wire.js";

Deno.test("material ids are stable", () => {
  assertEquals(
    [
      UNKNOWN,
      OPEN,
      STONE,
      COAL,
      IRON_ORE,
      GOLD_ORE,
      LAPIS,
      REDSTONE,
      DIAMOND,
      EMERALD,
    ],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assertEquals(MAX_MATERIAL, EMERALD);
  MATERIALS.forEach((info, id) => assertEquals(info.id, id));
});

Deno.test("each ore has its own atlas frame and item kind", () => {
  assertEquals(ORE_MATERIALS.length, 7);
  const frames = ORE_MATERIALS.map((id) => materialInfo(id)?.oreFrame);
  assertEquals(new Set(frames).size, 7);
  for (const frame of frames) {
    assert(frame !== null && frame !== undefined && frame < ORE_FRAMES);
    assert(frame !== 5, "copper frame is not used");
  }
  assertEquals(materialInfo(COAL)?.itemKind, "coal");
  assertEquals(materialInfo(STONE)?.oreFrame, null);
  assertEquals(materialInfo(MAX_MATERIAL + 1), null);
  assert(isMaterial(EMERALD));
  assert(!isMaterial(MAX_MATERIAL + 1));
  assert(!isMaterial(-1));
  assert(!isMaterial(2.5));
});

Deno.test("every material except air blocks movement like stone", () => {
  const world = createAuthoredWorld();
  for (const material of MATERIALS.map((info) => info.id)) {
    writeTile(world, 0, 0, 1, material);
    assertEquals(
      isSolid(world, 0, 0, 1),
      material !== OPEN,
      `material ${material}`,
    );
  }
});

Deno.test("chunks holding every material survive the wire", () => {
  const data = createChunkData(STONE);
  MATERIALS.forEach((info, i) => data[i * 5] = info.id);
  assertEquals(decodeChunk(encodeChunk(data)), data);
  const chunks = new Map([["0,0", data]]);
  assertEquals(decodeChunks(encodeChunks(chunks)), chunks);
});

Deno.test("the wire rejects a material no one has defined", () => {
  for (const bad of [MAX_MATERIAL + 1, 100, 255]) {
    const data = createChunkData(STONE);
    data[CHUNK_CELLS - 1] = bad;
    assertEquals(decodeChunk(encodeChunk(data)), null, `material ${bad}`);
  }
});

Deno.test("the authored area holds stone and every ore", () => {
  const world = createAuthoredWorld();
  const row = ORE_ROW.map((_, i) =>
    readTile(world, ORE_ROW_X + i, ORE_ROW_Y, 0)
  );
  assertEquals(row, [STONE, ...ORE_MATERIALS]);
  assertEquals(readTile(world, ORE_ROW_X, ORE_ROW_Y, 1), OPEN);
});

Deno.test("a joining player's state and remembered terrain keep ore materials", () => {
  const world = createAuthoredWorld();
  addPlayer(world, "viewer", { x: 5, y: 2, z: 0 });
  const remembered = new Map();
  const pending = createPendingReveal();
  const view = entityView(
    world,
    "viewer",
    createVisibility(),
    remembered,
    pending,
  );
  const decoded = decodeState(JSON.parse(JSON.stringify({
    type: "state",
    attempt: "a",
    viewRevision: 1,
    sightRevision: 1,
    acknowledgedSequence: 0,
    mode: "entity",
    playerId: "viewer",
    world: encodeWorld(view.world),
    reveal: drainReveal(remembered, pending),
    visibility: view.visibility,
    chat: [],
  })));
  assert(decoded, "the state decodes");
  const guest = { chunks: new Map<string, Uint8Array>() };
  applyReveal(guest, decoded.reveal);
  const seen = ORE_ROW.map((_, i) =>
    readTile(guest, ORE_ROW_X + i, ORE_ROW_Y, 0)
  );
  assertEquals(seen, [STONE, ...ORE_MATERIALS]);
  // Memory keeps the materials after the viewer looks elsewhere.
  const kept = remembered.get("0,0") as Uint8Array;
  assertEquals(kept[ORE_ROW_Y * 16 + ORE_ROW_X + 7], EMERALD);
});
