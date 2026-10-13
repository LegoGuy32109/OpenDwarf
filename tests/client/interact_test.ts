import { assert, assertEquals } from "@std/assert";
import type { Context } from "../../src/client/context.js";
import { interact } from "../../src/client/interact.js";
import { createPickupGrid } from "../../src/client/pickup-grid.js";
import {
  addStack,
  dropItem,
  droppedAt,
  type DroppedEntry,
  inventoryOf,
} from "../../src/shared/items.js";
import { setHeldItem } from "../../src/shared/held-item.js";
import {
  heldItem,
  miningActions,
  miningEntries,
  miningTicks,
  stepMining,
} from "../../src/shared/mining.js";
import { COAL, DIAMOND } from "../../src/shared/materials.js";
import { SHOP_TILE } from "../../src/shared/shop.js";
import {
  ensureChunk,
  OPEN,
  readTile,
  STONE,
  writeTile,
} from "../../src/shared/terrain.js";
import { addPlayer, advanceTicks } from "../../src/shared/world.js";
import { createFixtureWorld as createWorld } from "../../src/shared/world-builder.js";

type Tile = { x: number; y: number; z: number };
const EAST = { x: 6, y: 5, z: 1 };

/** Real world rules with only the context fields interact reads. No DOM or peer. */
function fixture(guest = false) {
  const world = createWorld();
  const data = ensureChunk(world, 0, 0);
  data.fill(OPEN);
  data.fill(STONE, 0, 256);
  const player = addPlayer(world, "self", { x: 5, y: 5, z: 1 });
  const messages: Record<string, unknown>[] = [];
  const lines: string[] = [];
  const sounds: { tags: string[]; tile: Tile }[] = [];
  const panels: string[] = [];
  let shopOpen = false;
  const scene = {
    world,
    localId: "self",
    layout: "test",
    viewMode: "entity",
    viewZ: 1,
    aim: { x: 0, y: 0 },
    chatOpen: false,
    menu: false,
    notice: undefined as { text: string; until: number } | undefined,
    visibility: { visible: new Set<string>() },
    itemFeed: [] as DroppedEntry[],
    heldFeed: "pickaxe",
    mineFeed: { entries: [] as ReturnType<typeof miningEntries>, at: 0 },
    systemLine: (text: string) => lines.push(text),
  };
  for (let z = 0; z <= 2; z++) {
    for (let y = 4; y <= 6; y++) {
      for (let x = 4; x <= 6; x++) {
        scene.visibility.visible.add(`${x},${y},${z}`);
      }
    }
  }
  const ctx = {
    scene,
    isAdmin: guest,
    held: new Set<string>(["KeyL"]),
    cameraStick: { x: 0, y: 0 },
    gamepadCamera: { x: 0, y: 0 },
    gamepadDpad: { x: 0, y: 0 },
    pickupGrid: createPickupGrid(),
    gridKeysAtOpen: new Set<string>(),
    bag: { isOpen: false, confirm: () => panels.push("bag") },
    shop: {
      isOpen: () => shopOpen,
      confirm: () => panels.push("shop"),
      open: (direction: number) => {
        shopOpen = true;
        panels.push(`open:${direction}`);
      },
    },
    guest: {
      send: (message: Record<string, unknown>) => messages.push(message),
    },
    sounds: {
      own: (tags: string[], tile: Tile) => sounds.push({ tags, tile }),
    },
  };
  // The cast is confined to the boundary. Missing context fields fail if read.
  const act = () => interact(ctx as unknown as Context);
  const aim = (code?: string) => {
    ctx.held.clear();
    if (code) ctx.held.add(code);
  };
  const finish = (material: number) => {
    advanceTicks(world, miningTicks(material)!);
    stepMining(
      world,
      () => (tile) =>
        scene.visibility.visible.has(`${tile.x},${tile.y},${tile.z}`),
    );
  };
  return {
    ctx,
    scene,
    world,
    player,
    messages,
    lines,
    sounds,
    panels,
    act,
    aim,
    finish,
  };
}

Deno.test("interact refuses solid terrain while stone is held, on host and guest", () => {
  for (const guest of [false, true]) {
    const f = fixture(guest);
    writeTile(f.world, 6, 5, 1, STONE);
    addStack(inventoryOf(f.player), "stone", 2);
    assert(setHeldItem(f.world, "self", "stone").ok);
    f.scene.heldFeed = "stone";
    f.act();
    assertEquals(f.scene.notice?.text, "Hold the pickaxe to mine");
    assertEquals(readTile(f.world, 6, 5, 1), STONE);
    assertEquals(inventoryOf(f.player), [
      { kind: "pickaxe", count: 1 },
      { kind: "stone", count: 2 },
    ]);
    assertEquals(miningActions(f.world).size, 0);
    assertEquals(f.messages, guest ? [{ type: "mine-cancel" }] : []);
    assertEquals(f.sounds, []);
  }
});

Deno.test("interact mines, picks up, places a wall, and mines the placed stone", () => {
  const f = fixture();
  writeTile(f.world, 6, 5, 1, STONE);
  f.act();
  assertEquals(miningActions(f.world).size, 1);
  f.finish(STONE);
  assertEquals(readTile(f.world, 6, 5, 1), OPEN);
  assertEquals(droppedAt(f.world, EAST), [{ kind: "stone", count: 1 }]);
  f.act();
  assertEquals(droppedAt(f.world, EAST), []);
  assertEquals(f.lines, ["Picked up stone ×1"]);
  assert(setHeldItem(f.world, "self", "stone").ok);
  f.act();
  assertEquals(readTile(f.world, 6, 5, 1), STONE);
  assertEquals(heldItem(f.player), "pickaxe", "last stone spent");
  addStack(inventoryOf(f.player), "stone", 3);
  assert(setHeldItem(f.world, "self", "stone").ok);
  for (const [key, x, y] of [["KeyJ", 4, 5], ["KeyI", 5, 4]] as const) {
    f.aim(key);
    f.act();
    assertEquals(readTile(f.world, x, y, 1), STONE);
  }
  f.aim();
  f.act();
  assertEquals(f.scene.notice?.text, "Something is in the way");
  assertEquals(inventoryOf(f.player).find((s) => s.kind === "stone")?.count, 1);
  f.aim("KeyL");
  assert(setHeldItem(f.world, "self", "pickaxe").ok);
  f.act();
  f.finish(STONE);
  f.act();
  assertEquals(readTile(f.world, 6, 5, 1), OPEN);
  assertEquals(inventoryOf(f.player).find((s) => s.kind === "stone")?.count, 2);
  assertEquals(f.sounds.map((s) => s.tags), [
    ["pickup"],
    ["place", "stone"],
    ["place", "stone"],
    ["place", "stone"],
    ["pickup"],
  ]);
});

Deno.test("interact reads current aim and cancels on the mined tile after the cursor moves", () => {
  const f = fixture();
  writeTile(f.world, 6, 5, 1, DIAMOND);
  f.act();
  const action = miningActions(f.world).get("self")!;
  assertEquals({ x: action.x, y: action.y, z: action.z }, EAST);
  f.aim("KeyI");
  advanceTicks(f.world, 10);
  stepMining(f.world);
  assertEquals(miningActions(f.world).get("self"), action);
  f.aim("KeyL");
  f.act();
  assertEquals(miningActions(f.world).size, 0);
  f.finish(DIAMOND);
  assertEquals(readTile(f.world, 6, 5, 1), DIAMOND);
  f.aim();
  f.act();
  assertEquals(f.scene.notice?.text, "Cannot mine: aim at a neighboring tile");
  assertEquals(miningActions(f.world).size, 0);
});

Deno.test("interact on another tile cancels the old mining before starting the new action", () => {
  const f = fixture();
  writeTile(f.world, 6, 5, 1, DIAMOND);
  writeTile(f.world, 5, 4, 1, COAL);
  f.act();
  advanceTicks(f.world, 5);
  f.aim("KeyI");
  f.act();
  assertEquals(miningActions(f.world).size, 1);
  const action = miningActions(f.world).get("self")!;
  assertEquals([action.x, action.y, action.z, action.startTick], [5, 4, 1, 5]);
  f.finish(COAL);
  assertEquals(readTile(f.world, 6, 5, 1), DIAMOND);
  assertEquals(droppedAt(f.world, { x: 5, y: 4, z: 1 }), [{
    kind: "coal",
    count: 1,
  }]);
});

Deno.test("interact targets the view level above and below and keeps mining with a free cursor", () => {
  for (const z of [0, 2]) {
    const f = fixture();
    writeTile(f.world, 6, 5, z, DIAMOND);
    f.scene.viewZ = z;
    f.act();
    const action = miningActions(f.world).get("self")!;
    assert(action);
    assertEquals([action.x, action.y, action.z], [6, 5, z]);
    f.aim("KeyI");
    advanceTicks(f.world, 14);
    stepMining(f.world);
    assertEquals(miningActions(f.world).get("self"), action);
    f.aim("KeyL");
    f.act();
    assertEquals(miningActions(f.world).size, 0);
  }
});

Deno.test("interact passes local sight to mining and placing", () => {
  for (const held of ["pickaxe", "stone"]) {
    const f = fixture();
    if (held === "stone") {
      addStack(inventoryOf(f.player), "stone", 1);
      assert(setHeldItem(f.world, "self", "stone").ok);
    } else writeTile(f.world, 6, 5, 1, STONE);
    f.scene.visibility.visible.delete("6,5,1");
    f.act();
    assertEquals(
      f.scene.notice?.text,
      held === "stone" ? "out of reach" : "Cannot mine: out of reach",
    );
    assertEquals(miningActions(f.world).size, 0);
    assertEquals(readTile(f.world, 6, 5, 1), held === "stone" ? OPEN : STONE);
    assertEquals(f.sounds, []);
  }
});

Deno.test("interact picks up a single stack before placing or mining, without a grid", () => {
  for (const held of ["pickaxe", "stone"]) {
    const f = fixture();
    if (held === "stone") {
      addStack(inventoryOf(f.player), "stone", 2);
      assert(setHeldItem(f.world, "self", "stone").ok);
    }
    dropItem(f.world, EAST, "diamond", 3);
    f.act();
    assertEquals(droppedAt(f.world, EAST), []);
    assertEquals(inventoryOf(f.player).find((s) => s.kind === "diamond"), {
      kind: "diamond",
      count: 3,
    });
    assertEquals(f.ctx.pickupGrid.tile, null);
    assertEquals(miningActions(f.world).size, 0);
    assertEquals(readTile(f.world, 6, 5, 1), OPEN);
    assertEquals(f.lines, ["Picked up diamond ×3"]);
    assertEquals(f.sounds, [{ tags: ["pickup"], tile: EAST }]);
  }
});

Deno.test("interact opens multiple stacks and confirms the selected kind", () => {
  const f = fixture();
  dropItem(f.world, EAST, "stone", 1);
  dropItem(f.world, EAST, "coal", 2);
  f.act();
  assertEquals(f.ctx.pickupGrid.tile, EAST);
  assertEquals([...f.ctx.gridKeysAtOpen], ["KeyL"]);
  assertEquals(f.ctx.pickupGrid.waitForRelease, true);
  assertEquals(f.lines, []);
  f.ctx.pickupGrid.selected = 1;
  f.aim("KeyI");
  f.act();
  assertEquals(inventoryOf(f.player), [
    { kind: "pickaxe", count: 1 },
    { kind: "coal", count: 2 },
  ]);
  assertEquals(droppedAt(f.world, EAST), [{ kind: "stone", count: 1 }]);
  assertEquals(f.lines, ["Picked up coal ×2"]);
});

Deno.test("interact sends guest mining, cancellation, placing, and single pickup intents", () => {
  const f = fixture(true);
  writeTile(f.world, 6, 5, 1, STONE);
  f.act();
  assertEquals(f.messages.splice(0), [{ type: "mine-cancel" }, {
    type: "mine",
    ...EAST,
  }]);
  f.scene.mineFeed.entries = [{
    id: "self",
    ...EAST,
    elapsedMs: 0,
    totalMs: 1000,
  }];
  f.act();
  assertEquals(f.messages.splice(0), [{ type: "mine-cancel" }]);
  f.scene.mineFeed.entries = [];
  writeTile(f.world, 6, 5, 1, OPEN);
  f.scene.heldFeed = "stone";
  f.act();
  assertEquals(f.messages.splice(0), [{ type: "mine-cancel" }, {
    type: "place",
    ...EAST,
  }]);
  f.scene.itemFeed = [{ ...EAST, stacks: [{ kind: "coal", count: 2 }] }];
  f.act();
  assertEquals(f.messages, [{ type: "mine-cancel" }, {
    type: "pickup",
    ...EAST,
    kind: "coal",
  }]);
  assertEquals(readTile(f.world, 6, 5, 1), OPEN);
  assertEquals(inventoryOf(f.player), [{ kind: "pickaxe", count: 1 }]);
  assertEquals(f.lines, []);
  assertEquals(f.ctx.pickupGrid.tile, null);
});

Deno.test("interact sends the guest's selected grid kind and hides the request", () => {
  const f = fixture(true);
  f.scene.itemFeed = [{
    ...EAST,
    stacks: [{ kind: "stone", count: 1 }, { kind: "coal", count: 2 }],
  }];
  f.act();
  f.messages.length = 0;
  f.ctx.pickupGrid.selected = 1;
  f.act();
  assertEquals(f.messages, [{ type: "pickup", ...EAST, kind: "coal" }]);
  assert(f.ctx.pickupGrid.requested.has("coal"));
});

Deno.test("interact confirms the bag and shop before acting on terrain", () => {
  const f = fixture();
  f.ctx.bag.isOpen = true;
  f.act();
  f.ctx.bag.isOpen = false;
  f.ctx.shop.open(0);
  f.act();
  assertEquals(f.panels, ["bag", "open:0", "shop"]);
  assertEquals(miningActions(f.world).size, 0);
});

Deno.test("interact opens the room shop before picking up on its tile", () => {
  const f = fixture();
  f.scene.layout = "room";
  f.world.shops = [SHOP_TILE];
  Object.assign(f.player, {
    x: SHOP_TILE.x - 1,
    y: SHOP_TILE.y,
    z: SHOP_TILE.z,
  });
  f.scene.viewZ = SHOP_TILE.z;
  ensureChunk(
    f.world,
    Math.floor(SHOP_TILE.x / 16),
    Math.floor(SHOP_TILE.y / 16),
  ).fill(OPEN);
  dropItem(f.world, SHOP_TILE, "coal", 1);
  f.act();
  assertEquals(f.panels, ["open:0"]);
  assertEquals(droppedAt(f.world, SHOP_TILE), [{ kind: "coal", count: 1 }]);
});

Deno.test("interact does nothing without a player, during chat, or in the menu", () => {
  for (const blocked of ["player", "chat", "menu"]) {
    const f = fixture(true);
    if (blocked === "player") delete f.world.players.self;
    if (blocked === "chat") f.scene.chatOpen = true;
    if (blocked === "menu") f.scene.menu = true;
    f.act();
    assertEquals(f.messages, []);
    assertEquals(f.scene.notice, undefined);
  }
});

Deno.test("interact reports master view and an invalid view level without acting", () => {
  const f = fixture(true);
  f.scene.viewMode = "master";
  f.act();
  assertEquals(f.scene.notice?.text, "Switch to entity view to interact");
  f.scene.viewMode = "entity";
  f.scene.viewZ = 4;
  f.act();
  assertEquals(f.scene.notice?.text, "Nothing to mine there");
  assertEquals(f.messages, []);
});
