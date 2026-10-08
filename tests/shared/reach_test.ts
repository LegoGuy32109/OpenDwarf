// Reach and interact preview tests (ADR 0009).
import { assert, assertEquals } from "@std/assert";
import { addPlayer, createWorld, type World } from "../../src/shared/world.js";
import {
  ensureChunk,
  OPEN,
  STONE,
  writeTile,
} from "../../src/shared/terrain.js";
import {
  addStack,
  dropItem,
  inventoryOf,
  STONE_ITEM,
} from "../../src/shared/items.js";
import { setHeldItem } from "../../src/shared/held-item.js";
import {
  inReach,
  interactPreview,
  itemSeen,
  pathReach,
  seesFrom,
} from "../../src/shared/reach.js";
import { SHOP_TILE } from "../../src/shared/shop.js";
import { tileKey } from "../../src/shared/visibility.js";

const sees = () => true;

/** Solid rock everywhere; the dwarf stands at (5, 5) on level 2 in an open cell. */
function rock() {
  const world = createWorld();
  ensureChunk(world, 0, 0).fill(STONE);
  const player = addPlayer(world, "self", { x: 5, y: 5, z: 2 });
  open(world, 5, 5, 2);
  return { world, player };
}

function open(world: World, x: number, y: number, z: number) {
  writeTile(world, x, y, z, OPEN);
}

const reach = (world: World, x: number, y: number, z: number) =>
  pathReach(world, world.players.self, { x, y, z });

Deno.test("same level: orthogonals always, a diagonal needs one open side", () => {
  const { world } = rock();
  for (const [x, y] of [[6, 5], [4, 5], [5, 6], [5, 4]]) {
    assert(reach(world, x, y, 2), `orthogonal ${x},${y} in solid rock`);
  }
  assert(!reach(world, 6, 6, 2), "diagonal blocked on both sides");
  open(world, 6, 5, 2);
  assert(reach(world, 6, 6, 2), "diagonal open on one side");
  const other = rock();
  open(other.world, 5, 6, 2);
  assert(reach(other.world, 6, 6, 2), "the other side");
  assert(!reach(world, 7, 5, 2), "two tiles away");
  assert(reach(world, 5, 5, 2), "the dwarf's own tile");
});

Deno.test("level above: the tile over the dwarf always, others need headroom", () => {
  const { world } = rock();
  assert(reach(world, 5, 5, 3), "directly above, in solid rock");
  assert(!reach(world, 6, 5, 3), "no headroom");
  open(world, 5, 5, 3);
  assert(reach(world, 6, 5, 3), "headroom, orthogonal");
  assert(!reach(world, 6, 6, 3), "headroom, diagonal blocked on both sides");
  open(world, 6, 5, 3);
  assert(reach(world, 6, 6, 3), "headroom, diagonal open on one side");
  assert(!reach(world, 7, 5, 3), "two tiles away");
});

Deno.test("level below: never the floor, others through an open tile above", () => {
  const { world } = rock();
  assert(!reach(world, 5, 5, 1), "the tile under the dwarf");
  assert(!reach(world, 6, 5, 1), "closed tile on the dwarf's level above");
  open(world, 6, 5, 2);
  assert(reach(world, 6, 5, 1), "below through an open tile");
  assert(!reach(world, 6, 6, 1), "diagonal under a closed tile");
  open(world, 6, 6, 2);
  assert(reach(world, 6, 6, 1), "diagonal under an open tile");
  assert(!reach(world, 5, 5, 1), "still never the floor");
  assert(!reach(world, 6, 5, 0), "two levels down");
});

Deno.test("inReach adds sight, and seesFrom reads a visible set", () => {
  const { world, player } = rock();
  const tile = { x: 6, y: 5, z: 2 };
  assert(inReach(world, player, tile, sees));
  assert(!inReach(world, player, tile, () => false), "an unseen tile");
  assert(!inReach(world, player, { x: 8, y: 5, z: 2 }, sees));
  const visible = new Set([tileKey(6, 5, 2)]);
  assert(seesFrom(visible)(tile));
  assert(!seesFrom(visible)({ x: 4, y: 5, z: 2 }));
  assert(seesFrom(visible, true)({ x: 4, y: 5, z: 2 }), "master view");
});

Deno.test("a dropped item shows when its tile or the floor under it is seen", () => {
  const visible = new Set([tileKey(6, 5, 1)]);
  assert(itemSeen(visible, { x: 6, y: 5, z: 1 }));
  assert(itemSeen(visible, { x: 6, y: 5, z: 2 }), "the floor under it");
  assert(!itemSeen(visible, { x: 6, y: 5, z: 3 }));
  assert(!itemSeen(visible, { x: 7, y: 5, z: 1 }));
});

Deno.test("interactPreview names the action the host would take", () => {
  const { world, player } = rock();
  const at = (x: number, y: number, z: number) =>
    interactPreview(world, player, { x, y, z }, sees, "test");
  assertEquals(at(6, 5, 2), "mine");
  assertEquals(at(6, 5, 1), null, "nothing to mine, and out of reach");
  assertEquals(at(8, 5, 2), null, "out of reach");
  assertEquals(
    interactPreview(world, player, { x: 6, y: 5, z: 2 }, () => false, "test"),
    null,
    "unseen",
  );
  open(world, 6, 5, 2);
  assertEquals(at(6, 5, 2), null, "an open tile and no stone");
  assertEquals(at(6, 5, 1), "mine", "down through the open tile");

  addStack(inventoryOf(player), STONE_ITEM, 1);
  setHeldItem(world, "self", STONE_ITEM);
  assertEquals(at(6, 5, 2), "place");
  assertEquals(at(7, 5, 2), null, "out of reach");
  assertEquals(at(5, 5, 2), null, "the dwarf's own tile");
  assertEquals(at(6, 6, 2), null, "a solid tile cannot take a stone");

  dropItem(world, { x: 6, y: 5, z: 2 }, "coal", 1);
  assertEquals(at(6, 5, 2), "pickup", "a stack wins over place");
  dropItem(world, { x: 5, y: 5, z: 2 }, "coal", 1);
  assertEquals(at(5, 5, 2), "pickup", "the dwarf's own tile");
});

Deno.test("interactPreview names the shopkeeper outside the test layout", () => {
  const world = createWorld();
  ensureChunk(world, 0, 0).fill(OPEN);
  const player = addPlayer(world, "self", {
    x: SHOP_TILE.x + 1,
    y: SHOP_TILE.y,
    z: SHOP_TILE.z,
  });
  assertEquals(interactPreview(world, player, SHOP_TILE, sees, "room"), "shop");
  assertEquals(interactPreview(world, player, SHOP_TILE, sees), "shop");
  assert(interactPreview(world, player, SHOP_TILE, sees, "test") !== "shop");
});
