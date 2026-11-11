import { assert, assertEquals, assertThrows } from "@std/assert";
import { authoredRecipe, roomRecipe } from "../../src/shared/world-recipes.js";
import { buildWorld, worldBuilder } from "../../src/shared/world-builder.js";
import { createAuthoredWorld } from "../../src/shared/authored-terrain.js";
import { FLOOR_Z, PLAY_Z } from "../../src/shared/single-plane.js";
import { addPlayer, advanceTicks, startMove } from "../../src/shared/world.js";
import { enableLocomotion, moveEntity } from "../../src/shared/locomotion.js";
import { adjacentTarget, highlightedTile } from "../../src/shared/target.js";
import { pathReach } from "../../src/shared/reach.js";
import { decodeChunk, encodeChunk } from "../../src/shared/chunk-wire.js";
import { isCaveTile } from "../../src/shared/generation.js";
import {
  chunkIndex,
  ensureChunk,
  OPEN,
  readTile,
  STONE,
  unloadChunk,
  writeTile,
} from "../../src/shared/terrain.js";
import { createSimulation } from "../../src/shared/simulation.js";

function field() {
  return worldBuilder().planar().base(OPEN)
    .spawn({ x: 7, y: 7, z: PLAY_Z }).build().world;
}

Deno.test("all playable recipes carry the plane through JSON replay and safe spawns", () => {
  for (
    const definition of [
      roomRecipe(),
      roomRecipe(123, { npc: false }),
      ...[16, 32].flatMap(
        (edge) => [
          authoredRecipe(edge),
          authoredRecipe(edge, { generator: true, npc: true }),
        ],
      ),
    ]
  ) {
    const built = buildWorld(JSON.parse(JSON.stringify(definition)));
    assertEquals(built.world.planeZ, PLAY_Z);
    for (
      const at of [
        ...definition.spawns,
        ...definition.entities.map((e) => e.at),
      ]
    ) {
      assertEquals(at.z, PLAY_Z);
      assertEquals(readTile(built.world, at.x, at.y, PLAY_Z), OPEN);
      assertEquals(readTile(built.world, at.x, at.y, FLOOR_Z), STONE);
    }
    for (const chunk of built.world.chunks.values()) {
      assert(chunk.subarray(0, 256).every((m) => m === STONE));
      assert(chunk.subarray(512).every((m) => m === OPEN));
      // Existing guest chunk transport retains all eight levels and ore IDs.
      assertEquals(decodeChunk(encodeChunk(chunk)), chunk);
    }
  }
  assertEquals(
    createAuthoredWorld().planeZ,
    undefined,
    "legacy 3D test helper is explicit",
  );
  assertThrows(() =>
    worldBuilder().planar().spawn({ x: 2, y: 2, z: 4 }).build()
  );
});

Deno.test("continuous and legacy movement refuse climbs and retain blocked facing", () => {
  for (const free of [false, true]) {
    const world = field();
    const player = addPlayer(world, "self", { x: 7, y: 7, z: 7 });
    assertEquals(player.z, PLAY_Z);
    assertEquals(player.facing, { x: 0, y: 1 });
    writeTile(world, 8, 7, PLAY_Z, STONE);
    if (free) enableLocomotion(player);
    for (let i = 0; i < 50; i++) {
      if (free) moveEntity(world, player.id, 1, 0);
      else assertEquals(startMove(world, player.id, 1, 0, i).ok, false);
      advanceTicks(world);
      assertEquals(player.z, PLAY_Z);
      assertEquals(player.move, null);
      assert(player.x < 7.26);
    }
    assertEquals(player.facing, { x: 1, y: 0 });
    assertEquals(player.facingLeft, false);
    if (free) moveEntity(world, player.id, 0, 0);
    assertEquals(player.facing, { x: 1, y: 0 });
    // The same rule refuses a corrupted/off-plane entity instead of moving it.
    player.z = 2;
    assertEquals(
      free
        ? moveEntity(world, player.id, -1, 0)
        : startMove(world, player.id, -1, 0, 99).ok,
      false,
    );
    assertEquals(player.facing, { x: -1, y: 0 });
    assertEquals(player.facingLeft, true);
  }
});

Deno.test("planar movement refuses unsupported ground instead of descending", () => {
  const world = field();
  const player = enableLocomotion(addPlayer(world, "self"));
  // Corrupt a fixture directly to exercise a missing support tile. Gameplay writes refuse it.
  world.chunks.get("0,0")![chunkIndex(7, 7, FLOOR_Z)] = OPEN;
  assertEquals(moveEntity(world, player.id, 1, 0), false);
  assertEquals(player.move, null);
  assertEquals(player.z, PLAY_Z);
});

Deno.test("plane targeting uses retained facing and reach refuses floor, air and closed corners", () => {
  const world = field();
  const player = addPlayer(world, "self");
  assertEquals(highlightedTile(player, { x: 0, y: 0 }, PLAY_Z, world), {
    x: 7,
    y: 8,
    z: PLAY_Z,
  });
  startMove(world, player.id, -1, -1, 1);
  assertEquals(highlightedTile(player, { x: 0, y: 0 }, PLAY_Z, world), {
    x: 6,
    y: 6,
    z: PLAY_Z,
  });
  for (const z of [0, 2, 7]) {
    assertEquals(adjacentTarget(player, { x: 1, y: 0 }, z, world), null);
    assertEquals(highlightedTile(player, { x: 0, y: 0 }, z, world), null);
    assertEquals(pathReach(world, player, { x: 7, y: 7, z }), false);
  }
  writeTile(world, 8, 7, PLAY_Z, STONE);
  writeTile(world, 7, 8, PLAY_Z, STONE);
  assertEquals(pathReach(world, player, { x: 8, y: 8, z: PLAY_Z }), false);
  writeTile(world, 7, 8, PLAY_Z, OPEN);
  assert(pathReach(world, player, { x: 8, y: 8, z: PLAY_Z }));
});

Deno.test("permanent floor refuses edits and planar edits replay after chunk unload", () => {
  const { world } = buildWorld(roomRecipe());
  const chunk = ensureChunk(world, 4, -2);
  const x = 4 * 16 + 3, y = -2 * 16 + 7;
  const before = chunk.slice();
  for (const z of [0, 2, 7]) {
    assertEquals(writeTile(world, x, y, z, OPEN), false);
  }
  assertEquals(chunk, before);
  const material = readTile(world, x, y, PLAY_Z) === OPEN ? STONE : OPEN;
  assert(writeTile(world, x, y, PLAY_Z, material));
  const edited = chunk.slice();
  assert(unloadChunk(world, 4, -2));
  assertEquals(ensureChunk(world, 4, -2), edited);
});

Deno.test("cave seams match the global field on both sides including negative chunks", () => {
  const { world } = buildWorld(roomRecipe(91));
  for (const cx of [-3, -1, 3]) {
    ensureChunk(world, cx, -3);
    ensureChunk(world, cx + 1, -3);
    for (const x of [cx * 16 + 15, (cx + 1) * 16]) {
      for (let y = -48; y < -32; y++) {
        assertEquals(
          readTile(world, x, y, PLAY_Z) === OPEN,
          isCaveTile(91, x, y, PLAY_Z),
        );
      }
    }
  }
});

Deno.test("NPC and player simulation input remain on the plane", () => {
  const sim = createSimulation(
    authoredRecipe(32, { npc: true, generator: true }),
  );
  sim.join("host");
  sim.input("host", { x: 0, y: 1 });
  for (let i = 0; i < 180; i++) {
    sim.advanceTicks();
    for (const player of Object.values(sim.world.players)) {
      assertEquals(player.z, PLAY_Z);
      assertEquals(player.move?.target.z ?? PLAY_Z, PLAY_Z);
    }
  }
  assertEquals(sim.world.players.host.facing, { x: 0, y: 1 });
  assert(sim.world.players["npc-corner"].facing);
});

Deno.test("host and prediction using shared movement agree after chunk data transport", () => {
  const host = field();
  writeTile(host, 8, 7, PLAY_Z, STONE);
  const guest: import("../../src/shared/world.js").World = {
    ...host,
    chunks: new Map(
      [...host.chunks].map((
        [key, chunk],
      ) => [key, decodeChunk(encodeChunk(chunk))!]),
    ),
    players: {},
  };
  enableLocomotion(addPlayer(host, "self"));
  enableLocomotion(addPlayer(guest, "self"));
  for (const [dx, dy] of [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 0]]) {
    for (let tick = 0; tick < 30; tick++) {
      for (const world of [host, guest]) {
        advanceTicks(world);
        moveEntity(world, "self", dx, dy);
      }
      assertEquals(guest.players.self, host.players.self);
      assertEquals(host.players.self.z, PLAY_Z);
    }
  }
});

Deno.test("varied seeds connect spawn to at least 96 cells beyond its shell", () => {
  for (const seed of [0, 1, 5, 17, 91, 2026, 0xffffffff]) {
    const { world } = buildWorld(roomRecipe(seed));
    for (let cy = -3; cy <= 5; cy++) {
      for (let cx = 0; cx <= 7; cx++) ensureChunk(world, cx, cy);
    }
    const queue = [{ x: 16, y: 15 }];
    const seen = new Set(["16,15"]);
    let beyond = 0;
    for (let i = 0; i < queue.length; i++) {
      const at = queue[i];
      if (at.x >= 28) beyond++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = at.x + dx, y = at.y + dy, key = `${x},${y}`;
        if (
          x < 0 || x > 127 || y < -48 || y > 95 || seen.has(key) ||
          readTile(world, x, y, PLAY_Z) !== OPEN
        ) continue;
        seen.add(key);
        queue.push({ x, y });
      }
    }
    assert(beyond >= 96, `seed ${seed} reaches only ${beyond} cave cells`);
  }
});
