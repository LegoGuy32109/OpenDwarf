import { assertEquals, assertNotEquals } from "@std/assert";
import { cursorParams } from "../../src/client/cursor.js";
import { CURSOR_ICON_DIM } from "../../src/shared/reach.js";
import { ITEM_KINDS } from "../../src/shared/items.js";

Deno.test("the cursor outline uses the shared color and opacity", () => {
  const params = cursorParams("pickaxe", "mine");
  assertEquals(params.color, "#ffffff");
  assertEquals(params.opacity, 0.25);
});

Deno.test("the icon is the held item's sheet frame", () => {
  for (const { kind, frame } of ITEM_KINDS) {
    assertEquals(cursorParams(kind, "place").iconFrame, frame);
  }
  assertNotEquals(
    cursorParams("pickaxe", "mine").iconFrame,
    cursorParams("stone", "mine").iconFrame,
  );
});

Deno.test("the icon is full when interact would act and dim when it would not", () => {
  for (const action of ["mine", "place", "pickup", "shop"] as const) {
    assertEquals(cursorParams("stone", action).iconOpacity, 1);
  }
  assertEquals(cursorParams("stone", null).iconOpacity, CURSOR_ICON_DIM);
});

Deno.test("an unknown held kind has no icon", () => {
  assertEquals(cursorParams("nothing", null).iconFrame, null);
});

import { directionMarkers, localCursor } from "../../src/client/cursor.js";
import { createFixtureWorld } from "../../src/shared/world-builder.js";
import { addPlayer } from "../../src/shared/world.js";
import { createActionGesture } from "../../src/shared/single-plane.js";
import { createVisibility } from "../../src/shared/visibility.js";
import { throwVisible } from "../../src/client/render-items.js";

Deno.test("local facing persists at rest while active movement and aim have independent ordered markers", () => {
  const world = createFixtureWorld();
  const player = addPlayer(world, "local", { x: 5, y: 5, z: 1 });
  player.facing = { x: 0, y: 1 };
  const scene = {
    world,
    localId: "local",
    viewMode: "entity" as const,
    viewZ: 1,
    aim: { x: 0, y: 0 },
    visibility: createVisibility(),
    movementInput: { x: 0, y: 0 },
    actionGesture: createActionGesture(),
  };
  assertEquals(localCursor(scene)?.tile, { x: 5, y: 6, z: 1 });
  assertEquals(directionMarkers(scene, player), []);
  scene.actionGesture = {
    ...createActionGesture(),
    down: true,
    aiming: true,
    x: 0,
    y: -1,
  };
  assertEquals(localCursor(scene)?.tile, { x: 5, y: 4, z: 1 });
  assertEquals(directionMarkers(scene, player), [{
    x: 0,
    y: -1,
    aiming: true,
  }]);
  // Held intent remains visible when collision leaves velocity at zero.
  scene.movementInput = { x: 0, y: 1 };
  assertEquals(directionMarkers(scene, player), [
    { x: 0, y: 1, aiming: false },
    { x: 0, y: -1, aiming: true },
  ]);
  scene.movementInput = { x: 0, y: -1 };
  assertEquals(directionMarkers(scene, player), [
    { x: 0, y: -1, aiming: false },
    { x: 0, y: -1, aiming: true },
  ]);
  scene.actionGesture = createActionGesture();
  assertEquals(localCursor(scene)?.tile, { x: 5, y: 6, z: 1 });
  const other = addPlayer(world, "other", { x: 7, y: 5, z: 1 });
  assertEquals(directionMarkers(scene, other), []);
  other.vx = 0.1;
  other.facing = { x: 1, y: 0 };
  assertEquals(directionMarkers(scene, other), [{ x: 1, y: 0, aiming: false }]);
});

Deno.test("flight rendering hides unseen, remembered, and other-level throws", () => {
  const visibility = createVisibility();
  const scene = {
    viewZ: 1,
    viewMode: "entity" as "entity" | "master",
    visibility,
  };
  const entry = {
    id: "throw",
    owner: "local",
    kind: "stone",
    x: 5,
    y: 6,
    z: 1,
    dx: 1,
    dy: 0,
    remaining: 3,
  };
  assertEquals(throwVisible(scene, entry), false);
  visibility.memory.add("5,6,1");
  assertEquals(throwVisible(scene, entry), false);
  visibility.visible.add("5,6,1");
  assertEquals(throwVisible(scene, entry), true);
  assertEquals(throwVisible(scene, { ...entry, z: 2 }), false);
  scene.viewMode = "master";
  visibility.visible.clear();
  assertEquals(throwVisible(scene, entry), true);
});

import {
  createChunkData,
  OPEN,
  setChunk,
  STONE,
  writeTile,
} from "../../src/shared/terrain.js";
Deno.test("guest cursor uses private held and inventory feeds without changing the snapshot player", () => {
  const world = createFixtureWorld();
  setChunk(world, 0, 0, createChunkData(OPEN));
  const player = addPlayer(world, "guest", { x: 5, y: 5, z: 1 });
  const visibility = createVisibility();
  visibility.visible.add("5,6,1");
  const scene = {
    world,
    localId: "guest",
    viewMode: "entity" as const,
    viewZ: 1,
    aim: { x: 0, y: 1 },
    visibility,
    heldFeed: "stone",
    inventoryFeed: [{ kind: "stone", count: 2 }],
  };
  assertEquals(localCursor(scene)?.held, "stone");
  assertEquals(localCursor(scene)?.iconFrame, 0);
  assertEquals(localCursor(scene)?.preview, "place");
  writeTile(world, 5, 6, 1, STONE);
  assertEquals(localCursor(scene)?.preview, null);
  assertEquals(player.held, undefined);
  assertEquals("inventory" in player, false);
});
