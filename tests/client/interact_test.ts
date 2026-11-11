import { assert, assertEquals } from "@std/assert";
import type { Context } from "../../src/client/context.js";
import { interact } from "../../src/client/interact.js";
import { talkRequest } from "../../src/client/client-actions.js";
import { createShopPanel } from "../../src/client/shop-panel.js";
import { updateShopReach } from "../../src/client/panels.js";
import { createPickupGrid } from "../../src/client/pickup-grid.js";
import {
  addStack,
  dropItem,
  droppedAt,
  type DroppedEntry,
  inventoryOf,
} from "../../src/shared/items.js";
import { setHeldItem } from "../../src/shared/held-item.js";
import { miningActions, miningEntries } from "../../src/shared/mining.js";
import { SHOPKEEPER_TILE as SHOP_TILE } from "../../src/shared/spawn-room.js";
import { addTrader } from "../shared/fixtures.ts";
import {
  ensureChunk,
  OPEN,
  readTile,
  STONE,
} from "../../src/shared/terrain.js";
import { addPlayer } from "../../src/shared/world.js";
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
  player.facing = { x: 1, y: 0 };
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
    pressed: new Set<string>(),
    joystick: { x: 0, y: 0 },
    gamepadDirection: { x: 0, y: 0 },
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
  };
}

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

Deno.test("a guest spoken sale is silent until the host confirms it", () => {
  const f = fixture(true);
  const played: string[][] = [];
  talkRequest(
    {
      ...f.ctx,
      sfx: { play: (tags: string[]) => played.push(tags) },
    } as unknown as Context,
    "npc-ulgar",
    "sale",
    { kind: "coal" },
  );
  assertEquals(f.messages, [{
    type: "talk",
    npc: "npc-ulgar",
    choice: "sale",
    sale: { kind: "coal" },
  }]);
  assertEquals(played, []);
  assertEquals(f.sounds, []);
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

Deno.test("interact opens the shop from a neighbor of Ulgar before picking up on its tile", () => {
  const f = fixture();
  addTrader(f.world, SHOP_TILE);
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

Deno.test("the shop closes when the player leaves reach of the NPC it talks to, not any trader", () => {
  const f = fixture();
  const other = addTrader(f.world, { x: 9, y: 9, z: 1 }, "npc-other");
  const shop = createShopPanel({ talk: () => {}, flash: () => {} });
  const ctx = {
    scene: { world: f.world, localId: f.player.id },
    shop,
  } as unknown as Context;
  shop.open(0, { id: "npc-ulgar", name: "Ulgar" });
  // Beside another trader but far from Ulgar: the conversation ends.
  f.player.x = other.x;
  f.player.y = other.y + 1;
  f.player.z = other.z;
  updateShopReach(ctx);
  assertEquals(shop.isOpen(), false);
});
