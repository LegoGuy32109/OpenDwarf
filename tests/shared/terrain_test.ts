import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  CHUNK_CELLS,
  chunkCoord,
  chunkIndex,
  chunkKey,
  drainTileChanges,
  ensureChunk,
  hasChunk,
  localCoord,
  OPEN,
  parseChunkKey,
  readTile,
  STONE,
  terrainExtent,
  unloadChunk,
  writeTile,
} from "../../src/shared/terrain.js";
import {
  decodeChunk,
  decodeChunks,
  encodeChunk,
  encodeChunks,
} from "../../src/shared/chunk-wire.js";
import { MAX_MATERIAL } from "../../src/shared/materials.js";
import { createAuthoredWorld } from "../../src/shared/authored-terrain.js";
import {
  addPlayer,
  advanceTicks,
  createWorld,
  isSolid,
  startMove,
  type World,
} from "../../src/shared/world.js";
import { enableLocomotion, moveEntity } from "../../src/shared/locomotion.js";
import {
  createVisibility,
  hasLineOfSight,
  recomputeVisibility,
  tileKey,
} from "../../src/shared/visibility.js";
import { entityView } from "../../src/shared/view.js";
import { createPendingReveal, drainReveal } from "../../src/shared/reveal.js";
import { adjacentTarget } from "../../src/shared/target.js";
import {
  decodeState,
  encodeWorld,
  MAX_PACKET_BYTES,
} from "../../src/shared/wire.js";

Deno.test("chunk addressing floors negative coordinates and respects borders", () => {
  const cases: [number, number, number][] = [
    [0, 0, 0],
    [15, 0, 15],
    [16, 1, 0],
    [31, 1, 15],
    [32, 2, 0],
    [-1, -1, 15],
    [-16, -1, 0],
    [-17, -2, 15],
    [-32, -2, 0],
    [-33, -3, 15],
  ];
  for (const [tile, chunk, local] of cases) {
    assertEquals(chunkCoord(tile), chunk, `chunk of ${tile}`);
    assertEquals(localCoord(tile), local, `local of ${tile}`);
    assertEquals(chunk * 16 + local, tile);
  }
  assertEquals(chunkKey(chunkCoord(-1), chunkCoord(16)), "-1,1");
  assertEquals(chunkIndex(15, 15, 7), CHUNK_CELLS - 1);
  assertEquals(parseChunkKey("-3,12"), { cx: -3, cy: 12 });
  for (const bad of ["-0,1", "01,1", "1", "1,1,1", "a,b", "1, 1", ""]) {
    assertEquals(parseChunkKey(bad), null);
  }
});

Deno.test("a tile in a missing chunk reads as stone and a write creates the chunk", () => {
  const world = createWorld();
  assertEquals(readTile(world, 40, -40, 3), STONE);
  assert(isSolid(world, 40, -40, 3));
  assert(!hasChunk(world, 2, -3));
  assert(writeTile(world, 40, -40, 3, OPEN));
  assert(hasChunk(world, 2, -3));
  assertEquals(readTile(world, 40, -40, 3), OPEN);
  assertEquals(readTile(world, 41, -40, 3), STONE);
  assertEquals(readTile(world, 40, -40, 4), STONE);
  assert(!isSolid(world, 40, -40, 3));
  // Writing the same material changes nothing.
  assertEquals(writeTile(world, 40, -40, 3, OPEN), false);
  assertThrows(() => writeTile(world, 0, 0, 8, OPEN), RangeError);
  assertThrows(() => writeTile(world, 0, 0, -1, OPEN), RangeError);
  assertThrows(() => writeTile(world, 0.5, 0, 0, OPEN), RangeError);
  assertThrows(() => writeTile(world, 0, 0, 0, 256), RangeError);
});

Deno.test("levels outside the chunk read as before: below is stone, above is open air", () => {
  const world = createAuthoredWorld();
  assertEquals(readTile(world, 3, 3, -1), STONE);
  assertEquals(readTile(world, 3, 3, 8), OPEN);
  assert(isSolid(world, 3, 3, -1));
  assert(!isSolid(world, 3, 3, 8));
  assert(isSolid(world, 16, 3, 8), "above a missing chunk is still stone");
});

Deno.test("the generator hook creates a missing chunk once", () => {
  const world = createWorld();
  const calls: string[] = [];
  world.generateChunk = (cx, cy) => {
    calls.push(chunkKey(cx, cy));
    const data = new Uint8Array(CHUNK_CELLS).fill(OPEN);
    data[chunkIndex(0, 0, 0)] = STONE;
    return data;
  };
  ensureChunk(world, -1, 2);
  ensureChunk(world, -1, 2);
  assertEquals(calls, ["-1,2"]);
  assertEquals(readTile(world, -16, 32, 0), STONE);
  assertEquals(readTile(world, -15, 32, 0), OPEN);
  // A write into another missing chunk goes through the hook too.
  writeTile(world, 100, 100, 1, STONE);
  assertEquals(calls, ["-1,2", "6,6"]);
  assertEquals(readTile(world, 100, 100, 1), STONE);
  assertEquals(readTile(world, 101, 100, 1), OPEN);
  world.generateChunk = () => new Uint8Array(3);
  assertThrows(() => ensureChunk(world, 9, 9), RangeError);
});

Deno.test("written tiles are reported once and cleared when drained", () => {
  const world = createWorld();
  assertEquals(drainTileChanges(world), []);
  writeTile(world, 1, 1, 1, OPEN);
  writeTile(world, -1, 1, 1, OPEN);
  writeTile(world, 1, 1, 1, STONE);
  const changes = drainTileChanges(world);
  assertEquals(changes, [
    { x: 1, y: 1, z: 1, material: STONE },
    { x: -1, y: 1, z: 1, material: OPEN },
  ]);
  assertEquals(drainTileChanges(world), []);
});

Deno.test("terrain extent covers the loaded chunks", () => {
  assertEquals(terrainExtent(createAuthoredWorld()), {
    minX: 0,
    minY: 0,
    maxX: 16,
    maxY: 16,
  });
  const world = createAuthoredWorld(32);
  ensureChunk(world, -1, 0);
  assertEquals(terrainExtent(world), {
    minX: -16,
    minY: 0,
    maxX: 32,
    maxY: 32,
  });
});

/** Open ground on level 0 across the chunks from -1 to 1 on both axes. */
function openField(): World {
  const world = createWorld();
  for (let cy = -1; cy <= 1; cy++) {
    for (let cx = -1; cx <= 1; cx++) {
      const data = ensureChunk(world, cx, cy);
      data.fill(OPEN);
      data.fill(STONE, 0, 256);
    }
  }
  return world;
}

Deno.test("movement crosses chunk borders in both directions and onto negative chunks", () => {
  const world = openField();
  const player = addPlayer(world, "self", { x: 14, y: 14, z: 1 });
  let sequence = 0;
  for (
    const [dx, dy, x, y] of [[1, 0, 15, 14], [1, 0, 16, 14], [0, 1, 16, 15], [
      0,
      1,
      16,
      16,
    ]]
  ) {
    assertEquals(startMove(world, "self", dx, dy, ++sequence).ok, true);
    advanceTicks(world, 20);
    assertEquals([player.x, player.y], [x, y]);
  }
  player.x = 0;
  player.y = 0;
  for (
    const [dx, dy, x, y] of [[-1, 0, -1, 0], [0, -1, -1, -1], [-1, -1, -2, -2]]
  ) {
    assertEquals(startMove(world, "self", dx, dy, ++sequence).ok, true);
    advanceTicks(world, 20);
    assertEquals([player.x, player.y], [x, y]);
  }
});

Deno.test("support and stairs work across a chunk border", () => {
  const world = openField();
  // A stair spans x 14 through 17: levels 1 through 4 rise over the border.
  for (let step = 0; step < 4; step++) {
    for (let z = 1; z <= 1 + step; z++) {
      writeTile(world, 14 + step, 5, z, STONE);
    }
  }
  const player = addPlayer(world, "self", { x: 13, y: 5, z: 1 });
  let sequence = 0;
  for (let step = 0; step < 4; step++) {
    assertEquals(startMove(world, "self", 1, 0, ++sequence).ok, true);
    advanceTicks(world, 20);
    assertEquals([player.x, player.z], [14 + step, 2 + step]);
  }
  assertEquals(player.x, 17);
  // Remove the floor under a player standing on the far side of the border.
  const faller = enableLocomotion(
    addPlayer(world, "faller", { x: 16, y: 9, z: 1 }),
  );
  writeTile(world, 16, 9, 0, OPEN);
  for (let i = 0; i < 30; i++) {
    advanceTicks(world);
    moveEntity(world, "faller", 0, 0);
  }
  assert(faller.z < 1, "lost support across the border drops the entity");
});

Deno.test("free movement collides with a wall on the far side of a chunk border", () => {
  const world = openField();
  // Two levels high, so the entity cannot climb it.
  for (let y = 0; y < 16; y++) {
    writeTile(world, 17, y, 1, STONE);
    writeTile(world, 17, y, 2, STONE);
  }
  const player = enableLocomotion(
    addPlayer(world, "self", { x: 14, y: 8, z: 1 }),
  );
  for (let i = 0; i < 80; i++) {
    advanceTicks(world);
    moveEntity(world, "self", 1, 0, 2.8);
  }
  assert(player.x > 16 - 0.01, `crossed the border, x=${player.x}`);
  assert(player.x < 16.5, `stopped at the wall, x=${player.x}`);
});

Deno.test("line of sight and visibility reach across chunk borders", () => {
  const world = openField();
  assert(hasLineOfSight(world, { x: 10, y: 5, z: 1 }, { x: 25, y: 5, z: 1 }));
  assert(hasLineOfSight(world, { x: 10, y: 5, z: 1 }, { x: -5, y: -3, z: 1 }));
  writeTile(world, 16, 5, 1, STONE);
  assert(!hasLineOfSight(world, { x: 10, y: 5, z: 1 }, { x: 25, y: 5, z: 1 }));
  const sight = createVisibility();
  recomputeVisibility(world, sight, { x: 15, y: 5, z: 1 });
  assert(sight.visible.has(tileKey(13, 5, 1)));
  assert(sight.visible.has(tileKey(16, 5, 1)), "the wall itself is visible");
  assert(
    !sight.visible.has(tileKey(18, 5, 1)),
    "stone hides what lies behind it",
  );
  assert(sight.visible.has(tileKey(-1, 5, 1)));
  assert(sight.visible.has(tileKey(15, -1, 1)), "reaches the negative chunk");
  // Stone beyond the loaded chunks is seen one tile deep, like the old edge.
  const edge = createAuthoredWorld();
  const edgeSight = createVisibility();
  recomputeVisibility(edge, edgeSight, { x: 10, y: 7, z: 0 });
  assert(edgeSight.visible.has(tileKey(16, 7, 0)));
  assert(!edgeSight.visible.has(tileKey(17, 7, 0)));
});

Deno.test("targets exist only inside loaded chunks", () => {
  const world = openField();
  const player = addPlayer(world, "self", { x: 15, y: 5, z: 1 });
  assertEquals(adjacentTarget(player, { x: 1, y: 0 }, 1, world), {
    x: 16,
    y: 5,
    z: 1,
  });
  player.x = 31;
  assertEquals(adjacentTarget(player, { x: 1, y: 0 }, 1, world), null);
});

Deno.test("a chunk survives the wire and bad chunks are rejected", () => {
  const data = new Uint8Array(CHUNK_CELLS);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7919) % 3;
  assertEquals(decodeChunk(encodeChunk(data)), data);
  const uniform = new Uint8Array(CHUNK_CELLS).fill(STONE);
  assertEquals(decodeChunk(encodeChunk(uniform)), uniform);
  assert(encodeChunk(uniform).length < 40, "uniform chunks stay small");
  for (const bad of [null, 5, "", "!!!!", "AQE=", encodeChunk(data).slice(4)]) {
    assertEquals(decodeChunk(bad), null);
  }
  const unassigned = new Uint8Array(CHUNK_CELLS).fill(MAX_MATERIAL + 1);
  assertEquals(decodeChunk(encodeChunk(unassigned)), null);
  const chunks = new Map([["-1,4", data], ["0,0", uniform]]);
  assertEquals(decodeChunks(encodeChunks(chunks)), chunks);
  assertEquals(decodeChunks({ "1,1": 5 }), null);
});

/** A world with `count` chunks of cave-like terrain, which RLE handles poorly. */
function noisyWorld(count: number): World {
  const world = createWorld();
  addPlayer(world, "guest", { x: 7, y: 7, z: 0 });
  for (let i = 0; i < count; i++) {
    const data = ensureChunk(world, (i % 5) - 2, Math.floor(i / 5) - 2);
    for (let j = 0; j < data.length; j++) {
      data[j] = ((j * 2654435761 + i * 40503) >>> 7) % 5 === 0 ? STONE : OPEN;
    }
  }
  return world;
}

for (const count of [4, 25]) {
  Deno.test(`a state message with ${count} noisy chunks stays under the packet cap`, () => {
    const world = noisyWorld(count);
    const sight = createVisibility();
    const remembered = new Map();
    // Every tile of every chunk counts as seen, the largest possible state.
    for (const key of world.chunks.keys()) {
      const { cx, cy } = parseChunkKey(key)!;
      for (let z = 0; z < 8; z++) {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            sight.visible.add(tileKey(cx * 16 + x, cy * 16 + y, z));
          }
        }
      }
    }
    sight.sample = tileKey(7, 7, 0); // the viewer's tile, so sight is not recomputed
    const pending = createPendingReveal();
    const view = entityView(world, "guest", sight, remembered, pending);
    assertEquals(remembered.size, world.chunks.size);
    // A packet carries MAX_REVEAL_CHUNKS chunks; the rest follows in later ones.
    const reveal = drainReveal(remembered, pending);
    const packet = {
      type: "state",
      attempt: "a",
      viewRevision: 1,
      sightRevision: 1,
      acknowledgedSequence: 0,
      mode: "entity",
      playerId: "guest",
      world: encodeWorld(view.world),
      reveal,
      visibility: view.visibility,
      chat: [],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(packet)).byteLength;
    assert(bytes < MAX_PACKET_BYTES, `${count} chunks: ${bytes} bytes`);
    const decoded = decodeState(JSON.parse(JSON.stringify(packet)));
    assert(decoded, "the packet decodes");
    assertEquals(decoded.reveal.size, Object.keys(reveal).length);
  });
}

Deno.test("a guest receives only the chunks it has seen", () => {
  const world = createAuthoredWorld(32);
  ensureChunk(world, -1, 0);
  ensureChunk(world, 9, 9);
  addPlayer(world, "viewer", { x: 3, y: 3, z: 0 });
  const remembered = new Map();
  entityView(world, "viewer", createVisibility(), remembered);
  const keys = [...remembered.keys()];
  assert(keys.includes("0,0"));
  assert(keys.includes("-1,0"), "the chunk beside the viewer is visible");
  assert(!keys.includes("9,9"), "a far chunk is never sent");
});

Deno.test("terrain extent is cached until a chunk is added or unloaded", () => {
  const world = createAuthoredWorld(32);
  const first = terrainExtent(world);
  assertEquals(terrainExtent(world), first);
  assertEquals(terrainExtent(world) === first, true);
  ensureChunk(world, -1, 0);
  const second = terrainExtent(world);
  assertEquals(second.minX, -16);
  assertEquals(terrainExtent(world) === second, true);
  world.generateChunk = () => new Uint8Array(CHUNK_CELLS);
  unloadChunk(world, -1, 0);
  assertEquals(terrainExtent(world).minX, 0);
});
