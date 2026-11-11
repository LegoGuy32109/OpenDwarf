import { assert, assertEquals } from "@std/assert";
import { createOpenField } from "./fixtures.ts";
import { addPlayer, advanceTicks } from "../../src/shared/world.js";
import { OPEN, readTile, STONE, writeTile } from "../../src/shared/terrain.js";
import {
  addStack,
  dropItem,
  droppedAt,
  hasItemTag,
  inventoryOf,
  MAX_STACK_COUNT,
  pickUp,
} from "../../src/shared/items.js";
import { setHeldItem } from "../../src/shared/held-item.js";
import {
  cancelMining,
  holdMining,
  miningActions,
  stepMining,
} from "../../src/shared/mining.js";
import { startThrow, stepThrows } from "../../src/shared/throws.js";
import {
  decodeControl,
  decodeMotion,
  decodeState,
  encodeMotionPlayers,
  encodeWorld,
  PROTOCOL_VERSION,
} from "../../src/shared/wire.js";
import { placeStone } from "../../src/shared/placing.js";
import { createSimulation } from "../../src/shared/simulation.js";
import { worldBuilder } from "../../src/shared/world-builder.js";

function setup(kind = "coin", count = 3) {
  const world = createOpenField();
  world.planeZ = 1;
  const player = addPlayer(world, "self", { x: 5, y: 5, z: 1 });
  addStack(inventoryOf(player), kind, count);
  setHeldItem(world, player.id, kind);
  return { world, player };
}
function fly(world: ReturnType<typeof createOpenField>, count = 10) {
  for (let i = 0; i < count; i++) {
    advanceTicks(world);
    stepThrows(world);
  }
}
Deno.test("capabilities distinguish mining, placement and throwing", () => {
  assert(hasItemTag("coin", "throwable"));
  assert(hasItemTag("stone", "placeable"));
  assert(hasItemTag("stone", "throwable"));
  assert(hasItemTag("pickaxe", "mineable-tool"));
  assert(!hasItemTag("pickaxe", "throwable"));
  assert(!hasItemTag("coal", "throwable"));
});
Deno.test("held mining renews progress, expires at ten ticks, retargets and cancels", () => {
  const { world, player } = setup("pickaxe");
  writeTile(world, 6, 5, 1, STONE);
  const target = { x: 6, y: 5, z: 1 };
  assert(holdMining(world, player.id, target).ok);
  const first = miningActions(world).get(player.id)!;
  advanceTicks(world, 4);
  assert(holdMining(world, player.id, target).ok);
  assertEquals(miningActions(world).get(player.id), first);
  assertEquals(first.startTick, 0);
  advanceTicks(world, 9);
  stepMining(world);
  assertEquals(miningActions(world).size, 1);
  advanceTicks(world);
  stepMining(world);
  assertEquals(miningActions(world).size, 0);
  assertEquals(readTile(world, 6, 5, 1), STONE);
  holdMining(world, player.id, target);
  assert(!holdMining(world, player.id, { x: 9, y: 5, z: 1 }).ok);
  assertEquals(miningActions(world).size, 0);
  holdMining(world, player.id, target);
  cancelMining(world, player.id);
  advanceTicks(world, 30);
  stepMining(world);
  assertEquals(readTile(world, 6, 5, 1), STONE);
});
Deno.test("four-tick renewals complete mining once and enforce the plane and corners", () => {
  const { world, player } = setup("pickaxe");
  writeTile(world, 6, 5, 1, STONE);
  for (let i = 0; i <= 20; i++) {
    if (i % 4 === 0) holdMining(world, player.id, { x: 6, y: 5, z: 1 });
    stepMining(world);
    advanceTicks(world);
  }
  assertEquals(readTile(world, 6, 5, 1), OPEN);
  assertEquals(droppedAt(world, { x: 6, y: 5, z: 1 }), [{
    kind: "stone",
    count: 1,
  }]);
  assert(!holdMining(world, player.id, { x: 6, y: 5, z: 0 }).ok);
  writeTile(world, 6, 5, 1, STONE);
  writeTile(world, 5, 6, 1, STONE);
  writeTile(world, 6, 6, 1, STONE);
  assert(!holdMining(world, player.id, { x: 6, y: 6, z: 1 }).ok);
});
Deno.test("throws spend one item, normalize distance, and use the host release position", () => {
  for (const [dx, dy] of [[1, 0], [1, 1], [-1, 0], [-1, -1]]) {
    const { world, player } = setup();
    player.x = 6;
    assert(startThrow(world, player.id, dx, dy).ok);
    assertEquals(world.throws![0].x, 6);
    fly(world, 4);
    const shot = world.throws![0];
    assert(Math.abs(Math.hypot(shot.x - 6, shot.y - 5) - 2) < 1e-9);
    assertEquals(shot.z, 1);
    fly(world);
    assertEquals(world.throws, []);
    assertEquals(inventoryOf(player).find((s) => s.kind === "coin")!.count, 2);
    const length = Math.hypot(dx, dy);
    assertEquals(
      droppedAt(world, {
        x: Math.round(6 + 4 * dx / length),
        y: Math.round(5 + 4 * dy / length),
        z: 1,
      }),
      [{ kind: "coin", count: 1 }],
    );
  }
});
Deno.test("sweeps stop at walls and closed corners, with last-open-tile landing", () => {
  for (const diagonal of [false, true]) {
    const { world, player } = setup();
    writeTile(world, 6, 5, 1, STONE);
    if (diagonal) writeTile(world, 5, 6, 1, STONE);
    startThrow(world, player.id, 1, diagonal ? 1 : 0);
    fly(world);
    assertEquals(world.throws, []);
    assertEquals(droppedAt(world, { x: 5, y: 5, z: 1 }), [{
      kind: "coin",
      count: 1,
    }]);
  }
});
Deno.test("player and NPC half-tile hitboxes stop flight without damage or catch", () => {
  for (const npc of [false, true]) {
    const { world, player } = setup("stone");
    const other = addPlayer(world, "other", { x: 6, y: 5.2, z: 1 });
    other.npc = npc;
    startThrow(world, player.id, 1, 0);
    fly(world);
    assertEquals(droppedAt(world, { x: 6, y: 5, z: 1 }), [{
      kind: "stone",
      count: 1,
    }]);
    assertEquals(inventoryOf(other), [{ kind: "pickaxe", count: 1 }]);
    assertEquals(readTile(world, 6, 5, 1), OPEN);
  }
});
Deno.test("landing merges stacks and retains overflow until pickup frees space", () => {
  const { world, player } = setup();
  const tile = { x: 9, y: 5, z: 1 };
  // Host drops use the same bounded stack rule as ordinary mining drops.
  assert(dropItem(world, tile, "coin", MAX_STACK_COUNT));
  startThrow(world, player.id, 1, 0);
  fly(world);
  assertEquals(world.throws!.length, 1);
  assertEquals(world.throws![0].remaining, 0);
  const collector = addPlayer(world, "collector", tile);
  assert(pickUp(world, collector.id, tile, "coin").ok);
  fly(world);
  assertEquals(world.throws, []);
  assertEquals(droppedAt(world, tile), [{ kind: "coin", count: 1 }]);
  player.x = 5;
  startThrow(world, player.id, 1, 0);
  fly(world);
  // The collector now stops the second throw on the same tile.
  assertEquals(droppedAt(world, tile), [{ kind: "coin", count: 2 }]);
});
Deno.test("malformed and unavailable actions are atomic and protocol 8 carries facing and flight", () => {
  const { world, player } = setup();
  const before = structuredClone(inventoryOf(player));
  for (const [dx, dy] of [[0, 0], [2, 0], [NaN, 1], ["1", 0]]) {
    assert(!startThrow(world, player.id, dx, dy).ok);
  }
  player.z = 0;
  assert(!startThrow(world, player.id, 1, 0).ok);
  player.z = 1;
  assertEquals(inventoryOf(player), before);
  assertEquals(decodeControl({ type: "throw", dx: 1, dy: 0, count: 4 }), null);
  assertEquals(decodeControl({ type: "throw", dx: "1", dy: 0 }), null);
  assert(decodeControl({ type: "mine-hold", x: 6, y: 5, z: 1 }));
  player.facing = { x: -1, y: 1 };
  startThrow(world, player.id, 1, 0);
  const packet = {
    type: "state",
    attempt: "a",
    viewRevision: 0,
    sightRevision: 0,
    acknowledgedSequence: 0,
    mode: "master",
    playerId: player.id,
    chat: [],
    reveal: {},
    visibility: null,
    world: encodeWorld(world),
  };
  const decoded = decodeState(packet)!;
  assertEquals(PROTOCOL_VERSION, 8);
  assertEquals(decoded.world.planeZ, 1);
  assertEquals(decoded.world.players.self.facing, player.facing);
  assertEquals(decoded.world.throws, world.throws);
  assertEquals(
    decodeState({ ...packet, world: { ...packet.world, planeZ: 2 } }),
    null,
  );
  assertEquals(
    decodeState({
      ...packet,
      world: {
        ...packet.world,
        throws: [{ ...world.throws![0], remaining: 5 }],
      },
    }),
    null,
  );
  assertEquals(
    decodeState({
      ...packet,
      world: {
        ...packet.world,
        players: {
          self: { ...packet.world.players.self, facing: { x: 0, y: 0 } },
        },
      },
    }),
    null,
  );
  setHeldItem(world, player.id, "pickaxe");
  assert(!startThrow(world, player.id, 1, 0).ok);
  setHeldItem(world, player.id, "coin");
  assert(!placeStone(world, player.id, { x: 6, y: 5, z: 0 }).ok);
});
Deno.test("simulation validates direct actions and advances authoritative flight", () => {
  const simulation = createSimulation(
    worldBuilder().base(OPEN).spawn({ x: 5, y: 5, z: 1 }).definition(),
  );
  const player = simulation.join("self");
  addStack(inventoryOf(player), "coin", 2);
  setHeldItem(simulation.world, player.id, "coin");
  let result: Record<string, unknown> | undefined;
  simulation.enqueue(
    player.id,
    { type: "throw", dx: "1", dy: 0 },
    (r) => result = r,
  );
  simulation.advanceTicks();
  assertEquals(result?.ok, false);
  simulation.enqueue(player.id, { type: "throw", dx: 1, dy: 0 });
  simulation.advanceTicks();
  assertEquals(simulation.world.throws!.length, 1);
  simulation.advanceTicks(8);
  assertEquals(simulation.world.throws, []);
  assertEquals(inventoryOf(player).find((s) => s.kind === "coin")!.count, 1);
});

Deno.test("motion carries valid facing and rejects malformed octants", () => {
  const { world, player } = setup();
  player.facing = { x: -1, y: 1 };
  const packet = {
    type: "motion",
    attempt: "a",
    viewRevision: 0,
    sightRevision: 0,
    acknowledgedSequence: 0,
    tick: 1,
    planeZ: 1,
    players: encodeMotionPlayers(world.players),
  };
  assertEquals(decodeMotion(packet)?.players.self.facing, player.facing);
  assertEquals(decodeMotion(packet)?.planeZ, 1);
  assertEquals(decodeMotion({ ...packet, planeZ: 2 }), null);
  assertEquals(
    decodeMotion({
      ...packet,
      players: { self: { ...packet.players.self, z: 2 } },
    }),
    null,
  );
  packet.players.self.facing = { x: 0, y: 0 };
  assertEquals(decodeMotion(packet), null);
});
Deno.test("the final equipped item is spent once and cannot be thrown again", () => {
  const { world, player } = setup("stone", 1);
  assert(startThrow(world, player.id, 1, 0).ok);
  assert(!inventoryOf(player).some((stack) => stack.kind === "stone"));
  assert(!startThrow(world, player.id, 1, 0).ok);
  fly(world);
  assertEquals(droppedAt(world, { x: 9, y: 5, z: 1 }), [{
    kind: "stone",
    count: 1,
  }]);
});
Deno.test("flight crosses a chunk boundary and stops at the nearest swept entity", () => {
  const { world, player } = setup();
  player.x = 14;
  for (let x = 16; x <= 20; x++) writeTile(world, x, 5, 1, OPEN);
  startThrow(world, player.id, 1, 0);
  fly(world);
  assertEquals(droppedAt(world, { x: 18, y: 5, z: 1 }), [{
    kind: "coin",
    count: 1,
  }]);
  addPlayer(world, "far", { x: 17, y: 5, z: 1 });
  addPlayer(world, "near", { x: 15.1, y: 5.2, z: 1 });
  startThrow(world, player.id, 1, 0);
  fly(world);
  assertEquals(droppedAt(world, { x: 15, y: 5, z: 1 }), [{
    kind: "coin",
    count: 1,
  }]);
});
