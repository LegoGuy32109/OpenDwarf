import { assert, assertEquals } from "@std/assert";
import {
  addPlayer,
  advanceTicks,
  createWorld,
  type World,
} from "../../src/shared/world.js";
import {
  COAL,
  DIAMOND,
  EMERALD,
  GOLD_ORE,
  IRON_ORE,
  LAPIS,
  MATERIALS,
  REDSTONE,
} from "../../src/shared/materials.js";
import {
  drainTileChanges,
  ensureChunk,
  OPEN,
  STONE,
  writeTile,
} from "../../src/shared/terrain.js";
import {
  addStack,
  cycleIndex,
  dropItem,
  droppedAt,
  droppedEntries,
  droppedItems,
  ICON_CYCLE_MS,
  inPickupReach,
  inventoryOf,
  isItemKind,
  ITEM_FRAMES,
  ITEM_KINDS,
  MAX_STACK_COUNT,
  PICKAXE,
  pickUp,
  pickupLine,
  takeStack,
} from "../../src/shared/items.js";
import {
  heldItem,
  miningTicks,
  startMining,
  stepMining,
} from "../../src/shared/mining.js";
import {
  decodeControl,
  decodeInventory,
  decodeItems,
} from "../../src/shared/wire.js";

/** Open air at level 1 and above, a stone floor at level 0. */
function field(): World {
  const world = createWorld();
  const data = ensureChunk(world, 0, 0);
  data.fill(OPEN);
  data.fill(STONE, 0, 256);
  return world;
}

const tile = { x: 6, y: 5, z: 1 };

Deno.test("every material's item kind is an item kind with its own frame", () => {
  for (const info of MATERIALS) {
    if (info.itemKind !== null) assert(isItemKind(info.itemKind), info.name);
  }
  assertEquals(new Set(ITEM_KINDS.map((info) => info.frame)).size, ITEM_FRAMES);
  assertEquals(ITEM_KINDS.map((info) => info.frame), [
    ...Array(ITEM_FRAMES).keys(),
  ]);
  assert(isItemKind("coin") && isItemKind(PICKAXE));
  assert(!isItemKind("dirt") && !isItemKind(undefined));
});

Deno.test("stacks merge by kind and refuse bad counts", () => {
  const stacks: { kind: string; count: number }[] = [];
  assert(addStack(stacks, "coal"));
  assert(addStack(stacks, "stone", 3));
  assert(addStack(stacks, "coal", 2));
  assertEquals(stacks, [{ kind: "coal", count: 3 }, {
    kind: "stone",
    count: 3,
  }]);
  assert(!addStack(stacks, "dirt"));
  assert(!addStack(stacks, "coal", 0));
  assert(!addStack(stacks, "coal", 1.5));
  assert(!addStack(stacks, "coal", MAX_STACK_COUNT));
  assertEquals(stacks[0].count, 3);
  assertEquals(takeStack(stacks, 0), { kind: "coal", count: 3 });
  assertEquals(takeStack(stacks, 5), null);
  assertEquals(stacks, [{ kind: "stone", count: 3 }]);
});

Deno.test("every entity starts with one pickaxe, held", () => {
  const world = field();
  const player = addPlayer(world, "self", { x: 5, y: 5, z: 1 });
  assertEquals(inventoryOf(player), [{ kind: PICKAXE, count: 1 }]);
  assertEquals(heldItem(player), PICKAXE);
  assert(inventoryOf(player) === inventoryOf(player), "one live list");
});

Deno.test("finished mining drops the material's item kind on the tile", () => {
  const materials = [
    [STONE, "stone"],
    [COAL, "coal"],
    [IRON_ORE, "iron ore"],
    [GOLD_ORE, "gold ore"],
    [LAPIS, "lapis"],
    [REDSTONE, "redstone"],
    [DIAMOND, "diamond"],
    [EMERALD, "emerald"],
  ] as const;
  for (const [material, kind] of materials) {
    const world = field();
    addPlayer(world, "self", { x: 5, y: 5, z: 1 });
    writeTile(world, 6, 5, 1, material);
    drainTileChanges(world);
    assert(startMining(world, "self", tile).ok);
    advanceTicks(world, miningTicks(material)!);
    const finished = stepMining(world);
    assertEquals(finished[0].kind, kind);
    assertEquals(droppedAt(world, tile), [{ kind, count: 1 }], kind);
  }
});

Deno.test("repeated drops on one tile merge counts; kinds share the tile", () => {
  const world = field();
  dropItem(world, tile, "stone");
  dropItem(world, tile, "coal");
  dropItem(world, tile, "stone", 2);
  assertEquals(droppedAt(world, tile), [
    { kind: "stone", count: 3 },
    { kind: "coal", count: 1 },
  ]);
  assertEquals(droppedAt(world, { x: 7, y: 5, z: 1 }), []);
  assert(!dropItem(world, tile, "dirt"));
  assertEquals(droppedEntries(world).length, 1);
});

Deno.test("mining the same tile twice over a refilled tile merges the stack", () => {
  const world = field();
  addPlayer(world, "self", { x: 5, y: 5, z: 1 });
  for (let i = 0; i < 2; i++) {
    writeTile(world, 6, 5, 1, STONE);
    assert(startMining(world, "self", tile).ok);
    advanceTicks(world, miningTicks(STONE)!);
    stepMining(world);
  }
  assertEquals(droppedAt(world, tile), [{ kind: "stone", count: 2 }]);
});

Deno.test("pickup moves the first whole stack into the inventory", () => {
  const world = field();
  const player = addPlayer(world, "self", { x: 5, y: 5, z: 1 });
  dropItem(world, tile, "coal", 3);
  dropItem(world, tile, "stone");
  const result = pickUp(world, "self", tile);
  assertEquals(result, { ok: true, kind: "coal", count: 3 });
  assertEquals(inventoryOf(player), [
    { kind: PICKAXE, count: 1 },
    { kind: "coal", count: 3 },
  ]);
  assertEquals(droppedAt(world, tile), [{ kind: "stone", count: 1 }]);
  assertEquals(pickUp(world, "self", tile), {
    ok: true,
    kind: "stone",
    count: 1,
  });
  assertEquals(droppedItems(world).tiles.size, 0);
  assertEquals(pickUp(world, "self", tile), {
    ok: false,
    reason: "nothing to pick up",
  });
  dropItem(world, tile, "coal");
  pickUp(world, "self", tile);
  assertEquals(inventoryOf(player)[1], { kind: "coal", count: 4 });
});

Deno.test("two simultaneous pickups give the stack to one player only", () => {
  const world = field();
  const first = addPlayer(world, "first", { x: 5, y: 5, z: 1 });
  const second = addPlayer(world, "second", { x: 7, y: 5, z: 1 });
  dropItem(world, tile, "diamond");
  const results = [pickUp(world, "first", tile), pickUp(world, "second", tile)];
  assertEquals(results[0], { ok: true, kind: "diamond", count: 1 });
  assertEquals(results[1], { ok: false, reason: "nothing to pick up" });
  assertEquals(inventoryOf(first).length, 2);
  assertEquals(inventoryOf(second), [{ kind: PICKAXE, count: 1 }]);
  assertEquals(droppedAt(world, tile), []);
});

Deno.test("the host checks reach, level, and the tile", () => {
  const world = field();
  const player = addPlayer(world, "self", { x: 5, y: 5, z: 1 });
  dropItem(world, { x: 8, y: 5, z: 1 }, "coal");
  dropItem(world, { x: 6, y: 5, z: 2 }, "coal");
  dropItem(world, { x: 5, y: 5, z: 1 }, "coal");
  const reason = (x: number, y: number, z: number) => {
    const result = pickUp(world, "self", { x, y, z });
    return result.ok ? "ok" : result.reason;
  };
  assertEquals(reason(8, 5, 1), "out of reach");
  assertEquals(reason(6, 5, 2), "not on your level");
  assertEquals(reason(1.5, 5, 1), "invalid tile");
  assertEquals(reason(5, 5, 99), "invalid tile");
  assertEquals(reason(4, 4, 1), "nothing to pick up");
  assert(inPickupReach(player, { x: 5, y: 5, z: 1 }), "own tile");
  assert(inPickupReach(player, { x: 6, y: 6, z: 1 }), "diagonal");
  // The entity's own tile counts: it can pick up what lies under it.
  assertEquals(reason(5, 5, 1), "ok");
  assertEquals(pickUp(world, "nobody", tile), {
    ok: false,
    reason: "unknown player",
  });
});

Deno.test("a full inventory stack leaves the dropped stack in place", () => {
  const world = field();
  const player = addPlayer(world, "self", { x: 5, y: 5, z: 1 });
  inventoryOf(player).push({ kind: "coal", count: MAX_STACK_COUNT });
  dropItem(world, tile, "coal");
  assertEquals(pickUp(world, "self", tile), {
    ok: false,
    reason: "inventory is full",
  });
  assertEquals(droppedAt(world, tile), [{ kind: "coal", count: 1 }]);
});

Deno.test("dropped items stay until picked up", () => {
  const world = field();
  addPlayer(world, "self", { x: 5, y: 5, z: 1 });
  dropItem(world, tile, "stone");
  advanceTicks(world, 20 * 600);
  assertEquals(droppedAt(world, tile), [{ kind: "stone", count: 1 }]);
});

Deno.test("icons on a tile take turns about once a second", () => {
  assertEquals(cycleIndex(0, 5000), 0);
  assertEquals(cycleIndex(1, 5000), 0);
  assertEquals(
    [0, 999, 1000, 1999, 2000, 3000].map((ms) => cycleIndex(3, ms)),
    [0, 0, 1, 1, 2, 0],
  );
  assertEquals(ICON_CYCLE_MS, 1000);
});

Deno.test("the pickup line names the kind and count", () => {
  assertEquals(pickupLine("coal", 1), "Picked up coal ×1");
  assertEquals(pickupLine("iron ore", 12), "Picked up iron ore ×12");
});

Deno.test("the wire accepts a pickup request, dropped items, and an inventory", () => {
  assert(decodeControl({ type: "pickup", x: 6, y: 5, z: 1 }));
  assertEquals(decodeControl({ type: "pickup", x: 6.5, y: 5, z: 1 }), null);
  assertEquals(decodeControl({ type: "pickup", x: 6, y: 5, z: 99 }), null);
  const entries = [{ x: 6, y: 5, z: 1, stacks: [{ kind: "coal", count: 2 }] }];
  assertEquals(decodeItems({ type: "items", entries }), entries);
  assertEquals(decodeItems({ type: "items", entries: [] }), []);
  for (
    const bad of [
      [{ x: 6, y: 5, z: 1, stacks: [] }],
      [{ x: 6, y: 5, z: 1, stacks: [{ kind: "dirt", count: 1 }] }],
      [{ x: 6, y: 5, z: 1, stacks: [{ kind: "coal", count: 0 }] }],
      [{ x: 6, y: 5, z: 1, stacks: [{ kind: "coal", count: 1.5 }] }],
      [{
        x: 6,
        y: 5,
        z: 1,
        stacks: [{ kind: "coal", count: 1 }, { kind: "coal", count: 1 }],
      }],
      [{ x: 6, y: 5, z: 9, stacks: [{ kind: "coal", count: 1 }] }],
    ]
  ) assertEquals(decodeItems({ type: "items", entries: bad }), null);
  assertEquals(decodeItems({ type: "items", entries: "x" }), null);
  const stacks = [{ kind: PICKAXE, count: 1 }, { kind: "coin", count: 7 }];
  assertEquals(decodeInventory({ type: "inventory", stacks }), stacks);
  assertEquals(
    decodeInventory({ type: "inventory", stacks: [{ kind: "x", count: 1 }] }),
    null,
  );
  assertEquals(decodeInventory({ type: "other", stacks }), null);
});
