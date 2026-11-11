import { assertEquals } from "@std/assert";
import type { Context } from "../../src/client/client-context.js";
import {
  actionPointer,
  cancelAction,
  pressAction,
  releaseAction,
  updateAction,
} from "../../src/client/action-input.js";
import { actionDirection } from "../../src/client/input-values.js";
import { createActionGesture } from "../../src/shared/single-plane.js";
import { createFixtureWorld } from "../../src/shared/world-builder.js";
import { addPlayer } from "../../src/shared/world.js";
import {
  ensureChunk,
  OPEN,
  STONE,
  writeTile,
} from "../../src/shared/terrain.js";
import { createPickupGrid } from "../../src/client/pickup-grid.js";

function fixture(item = "stone", guest = true) {
  const world = createFixtureWorld();
  ensureChunk(world, 0, 0).fill(OPEN);
  const player = addPlayer(world, "self", { x: 5, y: 5, z: 1 });
  player.facing = { x: 1, y: 0 };
  const messages: Record<string, unknown>[] = [];
  const scene = {
    world,
    localId: "self",
    viewZ: 1,
    viewMode: "entity",
    chatOpen: false,
    menu: false,
    aim: { x: 1, y: 0 },
    actionGesture: createActionGesture(),
    heldFeed: item,
    itemFeed: [],
    visibility: { visible: new Set<string>() },
    systemLine: () => {},
  };
  for (let y = 3; y <= 8; y++) {
    for (let x = 3; x <= 8; x++) scene.visibility.visible.add(`${x},${y},1`);
  }
  const input = {
    scene,
    isAdmin: guest,
    held: new Set<string>(),
    pressed: new Set<string>(),
    joystick: { x: 0, y: 0 },
    gamepadDirection: { x: 0, y: 0 },
    gamepadCamera: { x: 0, y: 0 },
    cameraStick: { x: 0, y: 0 },
    gamepadDpad: { x: 0, y: 0 },
    bag: { isOpen: false },
    shop: { isOpen: () => false },
    pickupGrid: createPickupGrid(),
    gridKeysAtOpen: new Set<string>(),
    guest: {
      send: (message: Record<string, unknown>) => {
        messages.push(message);
        return true;
      },
    },
    simulation: guest ? null : {
      enqueue: (_id: string, message: Record<string, unknown>) =>
        messages.push(message),
    },
  };
  return {
    input,
    ctx: input as unknown as Context,
    scene,
    player,
    world,
    messages,
  };
}
const point = (
  phase: "press" | "move" | "release" | "cancel",
  x = 100,
  y = 100,
) => ({ phase, x, y, originX: 100, originY: 100 });

Deno.test("placement is one release at the current movement-facing target, never on hold", () => {
  const f = fixture();
  pressAction(f.ctx, "keyboard");
  updateAction(f.ctx);
  f.world.tick += 20;
  updateAction(f.ctx);
  assertEquals(f.messages, []);
  f.ctx.held.add("KeyD");
  releaseAction(f.ctx, "keyboard");
  releaseAction(f.ctx, "keyboard");
  assertEquals(f.messages, [{ type: "place", x: 5, y: 6, z: 1 }]);
});

Deno.test("keyboard and gamepad aim throw once, center cancels, and movement stays independent", () => {
  for (const source of ["keyboard", "gamepad"]) {
    for (const neutral of [false, true]) {
      const f = fixture("coin");
      f.ctx.held.add("KeyD");
      pressAction(f.ctx, source);
      if (source === "keyboard") {
        f.ctx.held.add("KeyI");
      } else f.ctx.gamepadCamera = { x: 0, y: -1 };
      updateAction(f.ctx);
      assertEquals(actionDirection(f.ctx), { x: 0, y: -1 });
      if (neutral) {
        f.ctx.held.delete("KeyI");
        f.ctx.gamepadCamera = { x: 0, y: 0 };
      }
      releaseAction(f.ctx, source);
      assertEquals(
        f.messages,
        neutral ? [] : [{ type: "throw", dx: 0, dy: -1 }],
      );
      assertEquals(actionDirection(f.ctx), { x: 0, y: 1 });
      assertEquals(f.ctx.held.has("KeyD"), true);
    }
  }
});

Deno.test("coin taps are no-op; pointer vector aims, cancels at origin, and may re-enter", () => {
  for (const action of ["tap", "throw", "center", "reenter"]) {
    const f = fixture("coin");
    const pointer = (event: ReturnType<typeof point>) =>
      actionPointer(f.ctx, event, () => {});
    pointer(point("press"));
    if (action !== "tap") pointer(point("move", 60, 100));
    if (action === "center" || action === "reenter") pointer(point("move"));
    if (action === "reenter") pointer(point("move", 100, 140));
    pointer(
      point(
        "release",
        action === "throw" ? 60 : 100,
        action === "reenter" ? 140 : 100,
      ),
    );
    assertEquals(
      f.messages,
      action === "throw"
        ? [{ type: "throw", dx: -1, dy: 0 }]
        : action === "reenter"
        ? [{ type: "throw", dx: 0, dy: 1 }]
        : [],
    );
    assertEquals(f.scene.actionGesture.down, false);
  }
});

Deno.test("mining starts on press, refreshes every four ticks, pins forward, turns and releases", () => {
  const f = fixture("pickaxe");
  writeTile(f.world, 6, 5, 1, STONE);
  writeTile(f.world, 5, 4, 1, STONE);
  pressAction(f.ctx, "keyboard");
  const east = { type: "mine-hold", x: 6, y: 5, z: 1 };
  assertEquals(f.messages, [east]);
  f.world.tick += 3;
  updateAction(f.ctx);
  assertEquals(f.messages, [east]);
  f.world.tick++;
  f.player.x = 5.4;
  updateAction(f.ctx);
  assertEquals(f.messages, [east, east]);
  f.ctx.held.add("KeyE");
  updateAction(f.ctx);
  assertEquals(f.messages.slice(-2), [{ type: "mine-cancel" }, {
    type: "mine-hold",
    x: 5,
    y: 4,
    z: 1,
  }]);
  releaseAction(f.ctx, "keyboard");
  assertEquals(f.messages.at(-1), { type: "mine-cancel" });
  f.world.tick += 8;
  updateAction(f.ctx);
  assertEquals(f.messages.length, 5);
});

Deno.test("held mining acquires the next adjacent solid after advancing and never auto-picks up", () => {
  const f = fixture("pickaxe");
  writeTile(f.world, 6, 5, 1, STONE);
  writeTile(f.world, 7, 5, 1, STONE);
  pressAction(f.ctx, "keyboard");
  writeTile(f.world, 6, 5, 1, OPEN);
  f.world.tick++;
  updateAction(f.ctx);
  assertEquals(f.messages.at(-1), { type: "mine-cancel" });
  f.player.x = 6;
  f.world.tick++;
  updateAction(f.ctx);
  assertEquals(f.messages.at(-1), { type: "mine-hold", x: 7, y: 5, z: 1 });
  assertEquals(f.messages.some((m) => m.type === "pickup"), false);
});

Deno.test("pickaxe drag ignores aim, remote blocks and closed corners cannot start mining", () => {
  const f = fixture("pickaxe");
  writeTile(f.world, 6, 5, 1, STONE);
  actionPointer(f.ctx, point("press"), () => {});
  actionPointer(f.ctx, point("move", 100, 40), () => {});
  assertEquals(f.scene.actionGesture.aiming, false);
  actionPointer(f.ctx, point("release", 100, 40), () => {});
  assertEquals(f.messages, [{ type: "mine-hold", x: 6, y: 5, z: 1 }, {
    type: "mine-cancel",
  }]);
  f.messages.length = 0;
  f.player.facing = { x: 1, y: 1 };
  writeTile(f.world, 5, 6, 1, STONE);
  writeTile(f.world, 6, 6, 1, STONE);
  pressAction(f.ctx, "keyboard");
  assertEquals(f.messages, []);
});

Deno.test("pointer cancellation, item changes, panels, missing player, and explicit interruption never release", () => {
  for (
    const reason of [
      "pointer",
      "item",
      "chat",
      "menu",
      "bag",
      "player",
      "interrupt",
    ]
  ) {
    const f = fixture();
    actionPointer(f.ctx, point("press"), () => {});
    actionPointer(f.ctx, point("move", 140, 100), () => {});
    if (reason === "pointer") {
      actionPointer(f.ctx, point("cancel", 140, 100), () => {});
    }
    if (reason === "item") f.scene.heldFeed = "coin";
    if (reason === "chat") f.scene.chatOpen = true;
    if (reason === "menu") f.scene.menu = true;
    if (reason === "bag") f.input.bag.isOpen = true;
    if (reason === "player") delete f.world.players.self;
    if (reason === "interrupt") cancelAction(f.ctx);
    releaseAction(f.ctx, "pointer");
    assertEquals(f.messages, [], reason);
    assertEquals(f.scene.actionGesture.down, false, reason);
  }
});

Deno.test("a consumed pickup press cannot arm or repeat a terrain action", () => {
  const f = fixture();
  f.ctx.scene.itemFeed = [{
    x: 6,
    y: 5,
    z: 1,
    stacks: [{ kind: "coal", count: 1 }],
  }];
  pressAction(f.ctx, "keyboard");
  f.world.tick += 10;
  updateAction(f.ctx);
  releaseAction(f.ctx, "keyboard");
  assertEquals(f.messages, [{
    type: "pickup",
    x: 6,
    y: 5,
    z: 1,
    kind: "coal",
  }]);
});

Deno.test("a failed transport cancels held mining and does not retry on reconnect", () => {
  const f = fixture("pickaxe");
  writeTile(f.world, 6, 5, 1, STONE);
  f.ctx.guest!.send = () => false;
  pressAction(f.ctx, "gamepad");
  assertEquals(f.scene.actionGesture.down, false);
  f.ctx.guest!.send = (message) => {
    f.messages.push(message);
    return true;
  };
  f.world.tick += 10;
  updateAction(f.ctx);
  assertEquals(f.messages, []);
});

Deno.test("feature interruptions cancel mining once and require a new press", async () => {
  const { cancelPendingAction } = await import(
    "../../src/client/action-cancellation.js"
  );
  const f = fixture("pickaxe");
  writeTile(f.world, 6, 5, 1, STONE);
  pressAction(f.ctx, "keyboard");
  cancelPendingAction(f.ctx);
  cancelPendingAction(f.ctx);
  releaseAction(f.ctx, "keyboard");
  assertEquals(f.messages, [{ type: "mine-hold", x: 6, y: 5, z: 1 }, {
    type: "mine-cancel",
  }]);
  pressAction(f.ctx, "keyboard");
  assertEquals(f.messages.at(-1), { type: "mine-hold", x: 6, y: 5, z: 1 });
});

Deno.test("host input uses the same action intents as guest input", () => {
  const f = fixture("pickaxe", false);
  writeTile(f.world, 6, 5, 1, STONE);
  pressAction(f.ctx, "keyboard");
  f.world.tick += 4;
  updateAction(f.ctx);
  releaseAction(f.ctx, "keyboard");
  assertEquals(f.messages, [{ type: "mine-hold", x: 6, y: 5, z: 1 }, {
    type: "mine-hold",
    x: 6,
    y: 5,
    z: 1,
  }, { type: "mine-cancel" }]);
});
