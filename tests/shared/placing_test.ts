import { assert, assertEquals } from "@std/assert";
import { addPlayer, createWorld, type World } from "../../src/shared/world.js";
import {
  drainTileChanges,
  ensureChunk,
  OPEN,
  readTile,
  STONE,
  writeTile,
} from "../../src/shared/terrain.js";
import {
  addStack,
  dropItem,
  droppedAt,
  inventoryOf,
  STONE_ITEM,
} from "../../src/shared/items.js";
import { setHeldItem } from "../../src/shared/held-item.js";
import { enableLocomotion } from "../../src/shared/locomotion.js";
import { completeMining, startMining } from "../../src/shared/mining.js";
import {
  IN_THE_WAY,
  placeStone,
  reservedTiles,
} from "../../src/shared/placing.js";
import { SHOP_TILE } from "../../src/shared/shop.js";
import { decodeControl } from "../../src/shared/wire.js";

/** Open air at level 1 and above, a stone floor at level 0. */
function field(): World {
  const world = createWorld();
  const data = ensureChunk(world, 0, 0);
  data.fill(OPEN);
  data.fill(STONE, 0, 256);
  return world;
}

/** A player at (5, 5, 1) holding 3 stone, with open air at (6, 5, 1). */
function builder() {
  const world = field();
  const player = addPlayer(world, "self", { x: 5, y: 5, z: 1 });
  addStack(inventoryOf(player), STONE_ITEM, 3);
  setHeldItem(world, "self", STONE_ITEM);
  return { world, player };
}

const stoneCount = (world: World) =>
  inventoryOf(world.players.self).find((s) => s.kind === STONE_ITEM)?.count ??
    0;

Deno.test("placing turns an open adjacent tile to stone and spends one stone", () => {
  const { world } = builder();
  const result = placeStone(world, "self", { x: 6, y: 5, z: 1 });
  assertEquals(result, { ok: true, tile: { x: 6, y: 5, z: 1 } });
  assertEquals(readTile(world, 6, 5, 1), STONE);
  assertEquals(stoneCount(world), 2);
  assertEquals(drainTileChanges(world).map((c) => [c.x, c.y, c.z]), [[
    6,
    5,
    1,
  ]]);
});

Deno.test("the last stone leaves the inventory, so the pickaxe is held again", () => {
  const { world } = builder();
  inventoryOf(world.players.self).find((s) => s.kind === STONE_ITEM)!.count = 1;
  assert(placeStone(world, "self", { x: 6, y: 5, z: 1 }).ok);
  assertEquals(stoneCount(world), 0);
  assertEquals(placeStone(world, "self", { x: 4, y: 5, z: 1 }).ok, false);
});

Deno.test("the host rejects a place with no stone held", () => {
  const { world } = builder();
  setHeldItem(world, "self", "pickaxe");
  const result = placeStone(world, "self", { x: 6, y: 5, z: 1 });
  assertEquals(result, { ok: false, reason: "no stone held" });
  assertEquals(readTile(world, 6, 5, 1), OPEN);
  assertEquals(stoneCount(world), 3);
});

Deno.test("the host rejects a place with zero stone", () => {
  const { world, player } = builder();
  inventoryOf(player).splice(
    inventoryOf(player).findIndex((s) => s.kind === STONE_ITEM),
    1,
  );
  const result = placeStone(world, "self", { x: 6, y: 5, z: 1 });
  assertEquals(result, { ok: false, reason: "no stone held" });
  assertEquals(readTile(world, 6, 5, 1), OPEN);
});

Deno.test("the host rejects a place out of reach or on another level", () => {
  const { world } = builder();
  assertEquals(placeStone(world, "self", { x: 7, y: 5, z: 1 }), {
    ok: false,
    reason: "out of reach",
  });
  assertEquals(placeStone(world, "self", { x: 6, y: 5, z: 2 }), {
    ok: false,
    reason: "out of reach",
  });
  assertEquals(placeStone(world, "self", { x: 6, y: 5, z: 99 }).ok, false);
  assertEquals(stoneCount(world), 3);
});

Deno.test("the host rejects a place on a solid tile", () => {
  const { world } = builder();
  writeTile(world, 6, 5, 1, STONE);
  assertEquals(placeStone(world, "self", { x: 6, y: 5, z: 1 }), {
    ok: false,
    reason: "tile is not open",
  });
  assertEquals(stoneCount(world), 3);
});

Deno.test("the host rejects a place on a tile with dropped items", () => {
  const { world } = builder();
  dropItem(world, { x: 6, y: 5, z: 1 }, "coal", 1);
  assertEquals(placeStone(world, "self", { x: 6, y: 5, z: 1 }), {
    ok: false,
    reason: IN_THE_WAY,
  });
  assertEquals(readTile(world, 6, 5, 1), OPEN);
  assertEquals(droppedAt(world, { x: 6, y: 5, z: 1 }).length, 1);
});

Deno.test("the host rejects a place on the player's own tile", () => {
  const { world } = builder();
  assertEquals(placeStone(world, "self", { x: 5, y: 5, z: 1 }), {
    ok: false,
    reason: IN_THE_WAY,
  });
  assertEquals(stoneCount(world), 3);
});

Deno.test("the host rejects a place on a tile another entity overlaps", () => {
  const { world } = builder();
  addPlayer(world, "guest", { x: 6, y: 5, z: 1 });
  assertEquals(placeStone(world, "self", { x: 6, y: 5, z: 1 }).ok, false);
  // An NPC standing in the neighbor tile blocks it the same way.
  const { world: other } = builder();
  addPlayer(other, "npc-corner", { x: 6, y: 5, z: 1 });
  assertEquals(placeStone(other, "self", { x: 6, y: 5, z: 1 }).ok, false);
});

Deno.test("an entity that straddles the tile edge, or is walking into it, blocks it", () => {
  const { world } = builder();
  const walker = enableLocomotion(
    addPlayer(world, "guest", { x: 7, y: 5, z: 1 }),
  );
  // Footprint 0.5 wide centered at 6.7 reaches 6.45, inside tile 6 (5.5 to 6.5).
  walker.x = 6.7;
  assertEquals(placeStone(world, "self", { x: 6, y: 5, z: 1 }).ok, false);
  walker.x = 7;
  assert(placeStone(world, "self", { x: 6, y: 5, z: 1 }).ok);
  const { world: moving } = builder();
  const stepper = addPlayer(moving, "guest", { x: 7, y: 5, z: 1 });
  stepper.move = {
    origin: { x: 7, y: 5, z: 1 },
    target: { x: 6, y: 5, z: 1 },
    startPosition: { x: 7, y: 5, z: 1 },
    startTick: 0,
    durationTicks: 10,
    sequence: 1,
  };
  assertEquals(placeStone(moving, "self", { x: 6, y: 5, z: 1 }).ok, false);
});

Deno.test("the shopkeeper's tile is reserved in the room layout only", () => {
  assertEquals(reservedTiles("room"), [SHOP_TILE]);
  assertEquals(reservedTiles("test"), []);
  assertEquals(reservedTiles(undefined), []);
  const world = field();
  const player = addPlayer(world, "self", {
    x: SHOP_TILE.x,
    y: SHOP_TILE.y + 1,
    z: SHOP_TILE.z,
  });
  addStack(inventoryOf(player), STONE_ITEM, 1);
  setHeldItem(world, "self", STONE_ITEM);
  writeTile(world, SHOP_TILE.x, SHOP_TILE.y, SHOP_TILE.z, OPEN);
  assertEquals(
    placeStone(world, "self", SHOP_TILE, reservedTiles("room")).ok,
    false,
  );
});

Deno.test("a placed stone can be mined again and drops one stone", () => {
  const { world } = builder();
  assert(placeStone(world, "self", { x: 6, y: 5, z: 1 }).ok);
  setHeldItem(world, "self", "pickaxe");
  const started = startMining(world, "self", { x: 6, y: 5, z: 1 });
  assert(started.ok);
  if (started.ok) completeMining(world, started.action);
  assertEquals(readTile(world, 6, 5, 1), OPEN);
  assertEquals(droppedAt(world, { x: 6, y: 5, z: 1 }), [
    { kind: STONE_ITEM, count: 1 },
  ]);
});

Deno.test("the wire accepts a place request with whole-number coordinates only", () => {
  const request = { type: "place", x: 6, y: 5, z: 1 };
  assertEquals(decodeControl(request), request);
  assertEquals(decodeControl({ ...request, x: 6.5 }), null);
  assertEquals(decodeControl({ ...request, z: 8 }), null);
  assertEquals(decodeControl({ type: "place", x: 6, y: 5 }), null);
});
