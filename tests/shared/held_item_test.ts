import { assert, assertEquals } from "@std/assert";
import { addPlayer, createWorld, type World } from "../../src/shared/world.js";
import {
  ensureChunk,
  OPEN,
  STONE,
  writeTile,
} from "../../src/shared/terrain.js";
import { addStack, inventoryOf } from "../../src/shared/items.js";
import {
  heldItem,
  miningActions,
  PICKAXE,
  startMining,
  stepMining,
} from "../../src/shared/mining.js";
import { setHeldItem } from "../../src/shared/held-item.js";
import { decodeControl, decodeHeld } from "../../src/shared/wire.js";
import { COLUMNS, stepSelection } from "../../src/client/inventory-panel.js";

function miner(): World {
  const world = createWorld();
  const data = ensureChunk(world, 0, 0);
  data.fill(OPEN);
  data.fill(STONE, 0, 256);
  addPlayer(world, "self", { x: 5, y: 5, z: 1 });
  writeTile(world, 6, 5, 1, STONE);
  addStack(inventoryOf(world.players.self), "coal", 3);
  return world;
}

Deno.test("a new entity holds its pickaxe", () => {
  const world = miner();
  assertEquals(heldItem(world.players.self), PICKAXE);
});

Deno.test("an entity can hold any item in its inventory, and no other", () => {
  const world = miner();
  assertEquals(setHeldItem(world, "self", "coal"), { ok: true, kind: "coal" });
  assertEquals(heldItem(world.players.self), "coal");
  const refused = setHeldItem(world, "self", "diamond");
  assert(!refused.ok);
  assertEquals(heldItem(world.players.self), "coal", "refusal changes nothing");
  assert(!setHeldItem(world, "nobody", "coal").ok);
  assertEquals(setHeldItem(world, "self", PICKAXE).ok, true);
  assertEquals(heldItem(world.players.self), PICKAXE);
});

Deno.test("a held item that left the inventory falls back to the pickaxe", () => {
  const world = miner();
  setHeldItem(world, "self", "coal");
  inventoryOf(world.players.self).splice(1, 1); // the coal is sold
  assertEquals(heldItem(world.players.self), PICKAXE);
});

Deno.test("a held non-pickaxe item prevents mining, and switching back allows it", () => {
  const world = miner();
  setHeldItem(world, "self", "coal");
  const refused = startMining(world, "self", { x: 6, y: 5, z: 1 });
  assertEquals(refused, { ok: false, reason: "no pickaxe" });
  setHeldItem(world, "self", PICKAXE);
  assert(startMining(world, "self", { x: 6, y: 5, z: 1 }).ok);
});

Deno.test("changing the held item cancels mining", () => {
  const world = miner();
  assert(startMining(world, "self", { x: 6, y: 5, z: 1 }).ok);
  assertEquals(miningActions(world).size, 1);
  setHeldItem(world, "self", "coal");
  assertEquals(miningActions(world).size, 0);
  // Holding the same item again keeps a new action running.
  setHeldItem(world, "self", PICKAXE);
  assert(startMining(world, "self", { x: 6, y: 5, z: 1 }).ok);
  setHeldItem(world, "self", PICKAXE);
  assertEquals(miningActions(world).size, 1);
  assertEquals(stepMining(world), []);
});

Deno.test("hold messages and the held message are validated", () => {
  assertEquals(decodeControl({ type: "hold", kind: "coal" }) !== null, true);
  assertEquals(decodeControl({ type: "hold", kind: "unobtainium" }), null);
  assertEquals(decodeControl({ type: "hold" }), null);
  assertEquals(decodeHeld({ type: "held", kind: "pickaxe" }), "pickaxe");
  assertEquals(decodeHeld({ type: "held", kind: "nope" }), null);
  assertEquals(decodeHeld({ type: "other", kind: "coal" }), null);
});

Deno.test("the panel selection steps on a grid and stops at the edges", () => {
  assertEquals(COLUMNS, 4);
  // Ten stacks: rows of 4, 4, and 2.
  assertEquals(stepSelection(0, 10, 1, 0), 1);
  assertEquals(stepSelection(3, 10, 1, 0), 3, "right edge");
  assertEquals(stepSelection(0, 10, -1, 0), 0, "left edge");
  assertEquals(stepSelection(1, 10, 0, 1), 5);
  assertEquals(stepSelection(1, 10, 0, -1), 1, "top edge");
  assertEquals(stepSelection(9, 10, 0, 1), 9, "bottom edge");
  assertEquals(stepSelection(7, 10, 0, 1), 7, "no slot below");
  assertEquals(stepSelection(0, 10, 1, 1), 5, "diagonal");
  assertEquals(stepSelection(0, 0, 1, 0), 0, "no stacks");
  assertEquals(
    stepSelection(0, 10, 1, -1),
    1,
    "diagonal off the top goes sideways",
  );
  assertEquals(
    stepSelection(3, 10, 1, 1),
    7,
    "diagonal off the right goes down",
  );
  assertEquals(stepSelection(7, 10, 1, 1), 7, "diagonal into nothing");
});
