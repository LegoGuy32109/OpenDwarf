import { assert, assertEquals } from "@std/assert";
import {
  addPlayer,
  advanceTicks,
  createWorld,
  TICK_MS,
  type World,
} from "../../src/shared/world.js";
import {
  COAL,
  DIAMOND,
  EMERALD,
  GOLD_ORE,
  IRON_ORE,
  LAPIS,
  materialInfo,
  REDSTONE,
} from "../../src/shared/materials.js";
import {
  drainTileChanges,
  ensureChunk,
  OPEN,
  readTile,
  STONE,
  UNKNOWN,
  writeTile,
} from "../../src/shared/terrain.js";
import {
  cancelMining,
  decalFrame,
  inMiningReach,
  miningActions,
  miningCancelReason,
  miningEntries,
  miningTicks,
  startMining,
  stepMining,
} from "../../src/shared/mining.js";
import { setHeldItem } from "../../src/shared/held-item.js";
import { addStack, inventoryOf } from "../../src/shared/items.js";
import { highlightedTile } from "../../src/shared/target.js";
import {
  decodeControl,
  decodeMining,
  decodeTerrainChanges,
} from "../../src/shared/wire.js";

/** Open air at levels 1 and above, a stone floor at level 0. */
function field(): World {
  const world = createWorld();
  const data = ensureChunk(world, 0, 0);
  data.fill(OPEN);
  data.fill(STONE, 0, 256);
  return world;
}

/** A player standing at (5, 5) on level 1 with stone at (6, 5, 1). */
function miner() {
  const world = field();
  const player = addPlayer(world, "self", { x: 5, y: 5, z: 1 });
  writeTile(world, 6, 5, 1, STONE);
  drainTileChanges(world);
  addStack(inventoryOf(player), "coal", 1);
  return { world, player };
}

Deno.test("mining times come from the materials table", () => {
  const seconds = (material: number) => materialInfo(material)?.miningSeconds;
  assertEquals(seconds(STONE), 1);
  assertEquals(seconds(COAL), 1.5);
  assertEquals(seconds(IRON_ORE), 2);
  assertEquals([GOLD_ORE, LAPIS, REDSTONE].map(seconds), [3, 3, 3]);
  assertEquals([DIAMOND, EMERALD].map(seconds), [4.5, 4.5]);
  assertEquals(seconds(OPEN), null);
  assertEquals(seconds(UNKNOWN), null);
  assertEquals(miningTicks(STONE), 1000 / TICK_MS);
  assertEquals(miningTicks(DIAMOND), 4500 / TICK_MS);
  assertEquals(miningTicks(OPEN), null);
});

Deno.test("reach is a neighboring tile on the same level, never the entity's own tile", () => {
  const { player } = miner();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      assertEquals(
        inMiningReach(player, { x: 5 + dx, y: 5 + dy, z: 1 }),
        dx !== 0 || dy !== 0,
        `offset ${dx},${dy}`,
      );
    }
  }
  assert(!inMiningReach(player, { x: 7, y: 5, z: 1 }), "two tiles away");
  assert(!inMiningReach(player, { x: 6, y: 5, z: 2 }), "level above");
  assert(!inMiningReach(player, { x: 6, y: 5, z: 0 }), "level below");
  // Reach follows the tile the entity's center is in, not its footprint.
  player.x = 5.4;
  assert(inMiningReach(player, { x: 6, y: 5, z: 1 }));
  assert(!inMiningReach(player, { x: 7, y: 5, z: 1 }), "center still in 5");
  player.x = 5.6;
  assert(!inMiningReach(player, { x: 6, y: 5, z: 1 }), "now its own tile");
  assert(inMiningReach(player, { x: 7, y: 5, z: 1 }));
});

Deno.test("the host rejects mining that is out of reach or not solid", () => {
  const { world } = miner();
  const reason = (x: number, y: number, z: number) => {
    const result = startMining(world, "self", { x, y, z });
    return result.ok ? "ok" : result.reason;
  };
  assertEquals(reason(7, 5, 1), "out of reach");
  assertEquals(reason(4, 5, 1), "nothing to mine");
  assertEquals(reason(5, 5, 1), "aim at a neighboring tile");
  assertEquals(reason(6, 5, 2), "not on your level");
  assertEquals(reason(6, 5, 99), "invalid tile");
  assertEquals(reason(6.5, 5, 1), "invalid tile");
  assertEquals(miningActions(world).size, 0);
  assertEquals(startMining(world, "nobody", { x: 6, y: 5, z: 1 }), {
    ok: false,
    reason: "unknown player",
  });
  setHeldItem(world, "self", "coal");
  assertEquals(reason(6, 5, 1), "no pickaxe");
  assertEquals(miningActions(world).size, 0);
  setHeldItem(world, "self", "pickaxe");
  assertEquals(reason(6, 5, 1), "ok");
  assertEquals(miningActions(world).size, 1);
});

Deno.test("an unknown tile cannot be mined", () => {
  const { world } = miner();
  writeTile(world, 6, 5, 1, UNKNOWN);
  const result = startMining(world, "self", { x: 6, y: 5, z: 1 });
  assertEquals(result, { ok: false, reason: "nothing to mine" });
});

Deno.test("a finished action turns the tile to air and queues one change", () => {
  const { world } = miner();
  assert(startMining(world, "self", { x: 6, y: 5, z: 1 }).ok);
  const ticks = miningTicks(STONE)!;
  for (let i = 0; i < ticks - 1; i++) {
    advanceTicks(world);
    assertEquals(stepMining(world), []);
  }
  assertEquals(readTile(world, 6, 5, 1), STONE);
  advanceTicks(world);
  const finished = stepMining(world);
  assertEquals(finished.length, 1);
  assertEquals(finished[0].material, STONE);
  assertEquals(finished[0].tile, { x: 6, y: 5, z: 1 });
  assertEquals(readTile(world, 6, 5, 1), OPEN);
  assertEquals(drainTileChanges(world), [
    { x: 6, y: 5, z: 1, material: OPEN },
  ]);
  assertEquals(miningActions(world).size, 0);
});

Deno.test("each ore takes its own time", () => {
  for (
    const [material, seconds] of [[COAL, 1.5], [IRON_ORE, 2], [GOLD_ORE, 3], [
      DIAMOND,
      4.5,
    ]]
  ) {
    const { world } = miner();
    writeTile(world, 6, 5, 1, material);
    assert(startMining(world, "self", { x: 6, y: 5, z: 1 }).ok);
    advanceTicks(world, seconds * 1000 / TICK_MS - 1);
    assertEquals(stepMining(world), []);
    advanceTicks(world);
    assertEquals(stepMining(world).length, 1, `material ${material}`);
  }
});

Deno.test("moving keeps the action while the target stays adjacent", () => {
  const { world, player } = miner();
  startMining(world, "self", { x: 6, y: 5, z: 1 });
  player.y = 6.2; // still next to (6, 5) diagonally
  assertEquals(
    miningCancelReason(world, miningActions(world).get("self")!),
    null,
  );
  advanceTicks(world, 5);
  stepMining(world);
  assertEquals(miningActions(world).size, 1);
  player.x = 6;
  player.y = 6; // directly below the target
  advanceTicks(world);
  stepMining(world);
  assertEquals(miningActions(world).size, 1);
});

Deno.test("moving out of reach cancels", () => {
  const { world, player } = miner();
  startMining(world, "self", { x: 6, y: 5, z: 1 });
  player.x = 3;
  advanceTicks(world);
  stepMining(world);
  assertEquals(miningActions(world).size, 0);
  assertEquals(readTile(world, 6, 5, 1), STONE);
  // A change of level cancels as well.
  const other = miner();
  startMining(other.world, "self", { x: 6, y: 5, z: 1 });
  other.player.z = 2;
  stepMining(other.world);
  assertEquals(miningActions(other.world).size, 0);
});

Deno.test("a changed held item cancels", () => {
  const { world, player } = miner();
  startMining(world, "self", { x: 6, y: 5, z: 1 });
  // Set the field directly: `setHeldItem` would cancel the action itself.
  (player as { held?: string }).held = "coal";
  assertEquals(
    miningCancelReason(world, miningActions(world).get("self")!),
    "held item changed",
  );
  stepMining(world);
  assertEquals(miningActions(world).size, 0);
});

Deno.test("aiming elsewhere cancels through cancelMining", () => {
  const { world } = miner();
  startMining(world, "self", { x: 6, y: 5, z: 1 });
  assert(cancelMining(world, "self"));
  assert(!cancelMining(world, "self"));
  advanceTicks(world, 40);
  assertEquals(stepMining(world), []);
  assertEquals(readTile(world, 6, 5, 1), STONE);
});

Deno.test("a new target replaces the old one and the same target keeps its progress", () => {
  const { world } = miner();
  writeTile(world, 6, 6, 1, COAL);
  const first = startMining(world, "self", { x: 6, y: 5, z: 1 });
  advanceTicks(world, 5);
  const again = startMining(world, "self", { x: 6, y: 5, z: 1 });
  assert(first.ok && again.ok && first.action === again.action);
  const second = startMining(world, "self", { x: 6, y: 6, z: 1 });
  assert(second.ok);
  assertEquals(second.action.startTick, 5);
  assertEquals(miningActions(world).size, 1);
});

Deno.test("two players mining one tile: the first to finish wins, the other stops", () => {
  const { world } = miner();
  addPlayer(world, "guest", { x: 6, y: 4, z: 1 });
  startMining(world, "self", { x: 6, y: 5, z: 1 });
  advanceTicks(world, 4);
  startMining(world, "guest", { x: 6, y: 5, z: 1 });
  advanceTicks(world, miningTicks(STONE)! - 4);
  const finished = stepMining(world);
  assertEquals(finished.map((item) => item.playerId), ["self"]);
  advanceTicks(world);
  assertEquals(stepMining(world), []);
  assertEquals(miningActions(world).size, 0);
});

Deno.test("a player who leaves stops mining", () => {
  const { world } = miner();
  startMining(world, "self", { x: 6, y: 5, z: 1 });
  delete world.players.self;
  stepMining(world);
  assertEquals(miningActions(world).size, 0);
});

Deno.test("entries report elapsed and total time and drive the decal frames", () => {
  const { world } = miner();
  startMining(world, "self", { x: 6, y: 5, z: 1 });
  advanceTicks(world, 4);
  assertEquals(miningEntries(world), [
    { id: "self", x: 6, y: 5, z: 1, elapsedMs: 200, totalMs: 1000 },
  ]);
  assertEquals(
    [0, 0.19, 0.2, 0.5, 0.79, 0.8, 1].map(decalFrame),
    [0, 0, 1, 2, 3, 4, 4],
  );
});

Deno.test("the highlight is the aimed neighbor, or the entity's own tile with no aim", () => {
  const { world, player } = miner();
  assertEquals(highlightedTile(player, { x: 1, y: 0 }, 1, world), {
    x: 6,
    y: 5,
    z: 1,
  });
  assertEquals(highlightedTile(player, { x: 0, y: 0 }, 1, world), {
    x: 5,
    y: 5,
    z: 1,
  });
  assertEquals(highlightedTile(player, { x: 0, y: 0 }, 2, world), {
    x: 5,
    y: 5,
    z: 2,
  });
  assertEquals(highlightedTile(player, { x: 0, y: 0 }, 5, world), null);
  // Mining the own tile fails: the entity stands in air.
  assertEquals(startMining(world, "self", { x: 5, y: 5, z: 1 }), {
    ok: false,
    reason: "aim at a neighboring tile",
  });
});

Deno.test("mine messages are validated", () => {
  assert(decodeControl({ type: "mine", x: 6, y: 5, z: 1 }));
  assert(decodeControl({ type: "mine-cancel" }));
  for (
    const bad of [
      { type: "mine", x: 6.5, y: 5, z: 1 },
      { type: "mine", x: "6", y: 5, z: 1 },
      { type: "mine", x: 6, y: 5, z: 8 },
      { type: "mine", x: 6, y: 5, z: -1 },
      { type: "mine", x: 6, y: 5 },
      { type: "mine", x: 1e12, y: 5, z: 1 },
    ]
  ) assertEquals(decodeControl(bad), null, JSON.stringify(bad));
});

Deno.test("terrain and mining messages from the host are validated", () => {
  const change = { x: 6, y: 5, z: 1, material: OPEN };
  assertEquals(decodeTerrainChanges({ type: "terrain", changes: [change] }), [
    change,
  ]);
  for (
    const bad of [
      { type: "terrain" },
      { type: "terrain", changes: [{ ...change, material: 10 }] },
      { type: "terrain", changes: [{ ...change, z: 8 }] },
      { type: "terrain", changes: [{ ...change, x: 0.5 }] },
      { type: "terrain", changes: Array(257).fill(change) },
      { type: "mining", changes: [change] },
    ]
  ) assertEquals(decodeTerrainChanges(bad), null, JSON.stringify(bad));
  const entry = {
    id: "self",
    x: 6,
    y: 5,
    z: 1,
    elapsedMs: 200,
    totalMs: 1000,
  };
  assertEquals(decodeMining({ type: "mining", entries: [entry] }), [entry]);
  assertEquals(decodeMining({ type: "mining", entries: [] }), []);
  for (
    const bad of [
      { type: "mining" },
      { type: "mining", entries: [{ ...entry, totalMs: 0 }] },
      { type: "mining", entries: [{ ...entry, id: "" }] },
      { type: "mining", entries: [{ ...entry, z: 9 }] },
    ]
  ) assertEquals(decodeMining(bad), null, JSON.stringify(bad));
});
