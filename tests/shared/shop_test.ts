import { assert, assertEquals } from "@std/assert";
import { addPlayer, createWorld, type World } from "../../src/shared/world.js";
import {
  addStack,
  COIN,
  inventoryOf,
  ITEM_KINDS,
  PICKAXE,
} from "../../src/shared/items.js";
import {
  coinsIn,
  isSellable,
  priceOf,
  PRICES,
  rowRequest,
  saleLine,
  sellItems,
  SHOP_TILE,
  shopRows,
} from "../../src/shared/shop.js";
import { decodeControl } from "../../src/shared/wire.js";
import { setHeldItem } from "../../src/shared/held-item.js";
import { heldItem } from "../../src/shared/mining.js";

/** A world with a player standing next to the shopkeeper, and one far away. */
function shopWorld(): World {
  const world = createWorld();
  addPlayer(world, "near", {
    x: SHOP_TILE.x,
    y: SHOP_TILE.y + 1,
    z: SHOP_TILE.z,
  });
  addPlayer(world, "far", {
    x: SHOP_TILE.x,
    y: SHOP_TILE.y + 5,
    z: SHOP_TILE.z,
  });
  return world;
}

Deno.test("prices follow the ticket and cover only ore", () => {
  assertEquals(
    { ...PRICES },
    {
      "coal": 1,
      "iron ore": 3,
      "lapis": 4,
      "redstone": 4,
      "gold ore": 8,
      "emerald": 15,
      "diamond": 20,
    },
  );
  for (const kind of ["stone", PICKAXE, COIN, "wood", 5, undefined]) {
    assertEquals(priceOf(kind), 0);
    assert(!isSellable(kind));
  }
  for (const { kind } of ITEM_KINDS) {
    assertEquals(isSellable(kind), kind in PRICES);
  }
});

Deno.test("a sale takes the items and adds coins to the inventory", () => {
  const world = shopWorld();
  const inventory = inventoryOf(world.players.near);
  addStack(inventory, "coal", 5);
  addStack(inventory, "diamond", 2);
  const result = sellItems(world, "near", { kind: "coal", count: 3 });
  assertEquals(result, {
    ok: true,
    sold: [{ kind: "coal", count: 3 }],
    coins: 3,
    line: "Sold coal ×3 for 3 coins",
  });
  assertEquals(inventory, [
    { kind: PICKAXE, count: 1 },
    { kind: "coal", count: 2 },
    { kind: "diamond", count: 2 },
    { kind: COIN, count: 3 },
  ]);
  // A second sale merges into the one coin stack and empties the coal stack.
  assert(sellItems(world, "near", { kind: "coal", count: 2 }).ok);
  assertEquals(coinsIn(inventory), 5);
  assertEquals(inventory.some((stack) => stack.kind === "coal"), false);
});

Deno.test("the host rejects selling items the player does not have", () => {
  const world = shopWorld();
  const inventory = inventoryOf(world.players.near);
  addStack(inventory, "coal", 2);
  const before = JSON.stringify(inventory);
  for (
    const request of [
      { kind: "coal", count: 3 },
      { kind: "diamond", count: 1 },
      { kind: "coal", count: 0 },
      { kind: "coal", count: -1 },
      { kind: "coal", count: 1.5 },
      { kind: "coal", count: "1" },
      { kind: "stone", count: 1 },
      { kind: PICKAXE, count: 1 },
      { kind: COIN, count: 1 },
      { kind: "wood", count: 1 },
      { count: 1 },
      { all: false },
      null,
      "coal",
    ]
  ) {
    assertEquals(sellItems(world, "near", request).ok, false, String(request));
  }
  assertEquals(JSON.stringify(inventory), before);
  assertEquals(
    sellItems(world, "near", { kind: "diamond", count: 1 }),
    { ok: false, reason: "you do not have 1 diamond" },
  );
  assertEquals(
    sellItems(world, "ghost", { kind: "coal", count: 1 }),
    { ok: false, reason: "unknown player" },
  );
});

Deno.test("selling needs the player next to the shopkeeper on its level", () => {
  const world = shopWorld();
  addStack(inventoryOf(world.players.far), "coal", 2);
  assertEquals(
    sellItems(world, "far", { kind: "coal", count: 1 }),
    { ok: false, reason: "too far from the shopkeeper" },
  );
  addPlayer(world, "below", {
    x: SHOP_TILE.x,
    y: SHOP_TILE.y + 1,
    z: SHOP_TILE.z - 1,
  });
  addStack(inventoryOf(world.players.below), "coal", 2);
  assertEquals(
    sellItems(world, "below", { kind: "coal", count: 1 }).ok,
    false,
  );
  assertEquals(inventoryOf(world.players.far)[1], { kind: "coal", count: 2 });
});

Deno.test("sell all ore sells every sellable stack and keeps the rest", () => {
  const world = shopWorld();
  const inventory = inventoryOf(world.players.near);
  addStack(inventory, "stone", 7);
  addStack(inventory, "coal", 3);
  addStack(inventory, "gold ore", 2);
  addStack(inventory, "emerald", 1);
  const result = sellItems(world, "near", { all: true });
  assert(result.ok);
  assertEquals(result.coins, 3 + 16 + 15);
  assertEquals(result.line, "Sold 6 ore for 34 coins");
  assertEquals(inventory, [
    { kind: PICKAXE, count: 1 },
    { kind: "stone", count: 7 },
    { kind: COIN, count: 34 },
  ]);
  assertEquals(sellItems(world, "near", { all: true }), {
    ok: false,
    reason: "nothing to sell",
  });
});

Deno.test("a full coin stack refuses a sale and changes nothing", () => {
  const world = shopWorld();
  const inventory = inventoryOf(world.players.near);
  addStack(inventory, COIN, 9990);
  addStack(inventory, "diamond", 1);
  const before = JSON.stringify(inventory);
  assertEquals(
    sellItems(world, "near", { kind: "diamond", count: 1 }),
    { ok: false, reason: "too many coins" },
  );
  assertEquals(JSON.stringify(inventory), before);
});

Deno.test("sale lines read in singular and plural", () => {
  assertEquals(
    saleLine([{ kind: "coal", count: 1 }], 1),
    "Sold coal ×1 for 1 coin",
  );
  assertEquals(
    saleLine([{ kind: "iron ore", count: 2 }], 6),
    "Sold iron ore ×2 for 6 coins",
  );
});

Deno.test("shop rows dim what the shopkeeper does not buy", () => {
  const rows = shopRows([
    { kind: PICKAXE, count: 1 },
    { kind: "stone", count: 4 },
    { kind: "coal", count: 3 },
    { kind: "lapis", count: 2 },
    { kind: COIN, count: 9 },
  ]);
  assertEquals(rows.map((row) => row.enabled), [
    true,
    false,
    false,
    true,
    true,
    false,
  ]);
  assertEquals(rows[0], { type: "all", count: 5, coins: 11, enabled: true });
  assertEquals(rowRequest(rows[0]), { all: true });
  assertEquals(rowRequest(rows[3]), { kind: "coal", count: 3 });
  assertEquals(shopRows([{ kind: PICKAXE, count: 1 }])[0].enabled, false);
});

Deno.test("the wire accepts a sell request and rejects malformed ones", () => {
  assert(decodeControl({ type: "sell", kind: "coal", count: 3 }));
  assert(decodeControl({ type: "sell", all: true }));
  for (
    const value of [
      { type: "sell" },
      { type: "sell", kind: "coal" },
      { type: "sell", kind: "coal", count: 0 },
      { type: "sell", kind: "coal", count: 1.5 },
      { type: "sell", kind: "coal", count: 99999 },
      { type: "sell", kind: 4, count: 1 },
      { type: "sell", kind: "x".repeat(40), count: 1 },
      { type: "sell", all: "yes" },
    ]
  ) assertEquals(decodeControl(value), null, JSON.stringify(value));
});

Deno.test("selling the last of the held kind makes the pickaxe held again", () => {
  const world = shopWorld();
  addStack(inventoryOf(world.players.near), "diamond", 2);
  assert(setHeldItem(world, "near", "diamond").ok);
  assert(sellItems(world, "near", { kind: "diamond", count: 1 }).ok);
  assertEquals(heldItem(world.players.near), "diamond");
  assert(sellItems(world, "near", { kind: "diamond", count: 1 }).ok);
  assertEquals(heldItem(world.players.near), PICKAXE);
});
