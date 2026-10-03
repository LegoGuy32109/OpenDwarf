// @ts-check

/**
 * The interact order and what it starts: opening the shop, picking up dropped
 * items (one stack, or the pickup grid for several), placing held stone, and
 * mining with its lock. A guest sends each order to the world host, which
 * checks reach and ownership; the world host's own player goes through the same
 * shared rules.
 */

import { OPEN, readTile } from "../shared/terrain.js";
import { highlightedTile } from "../shared/target.js";
import { cancelMining, startMining } from "../shared/mining.js";
import { placeStone, reservedTiles } from "../shared/placing.js";
import { pickUp, pickupLine, STONE_ITEM } from "../shared/items.js";
import { SHOP_TILE } from "../shared/shop.js";
import {
  isPickupGridOpen,
  markRequested,
  openPickupGrid,
  selectedStack,
} from "./pickup-grid.js";
import { flash } from "./context.js";
import { droppedHere, heldDisplay } from "./display.js";
import { cameraInput, shopDirection, stickDirection } from "./input-read.js";
import { pickupGridStacks } from "./panels.js";

/** @typedef {import('./context.js').Context} Context */

/** Whether the highlighted tile holds the shopkeeper. @param {Context} ctx @param {{x:number,y:number,z:number}} target */
function isShopkeeper(ctx, target) {
  return ctx.scene.layout === "room" && target.x === SHOP_TILE.x &&
    target.y === SHOP_TILE.y && target.z === SHOP_TILE.z;
}

/** Pick up the stack of one kind from a tile. The host checks reach and who asked first. @param {Context} ctx @param {{x:number,y:number,z:number}} target @param {string} kind */
function pickUpAt(ctx, target, kind) {
  const { scene } = ctx;
  if (ctx.isAdmin) {
    ctx.guest?.send({ type: "pickup", ...target, kind });
    return;
  }
  const result = pickUp(scene.world, scene.localId, target, kind);
  if (result.ok) scene.systemLine(pickupLine(result.kind, result.count));
  else flash(ctx, `Cannot pick up: ${result.reason}`);
}

/** Interact with the grid open: pick up the selected stack. @param {Context} ctx */
function confirmPickupGrid(ctx) {
  const tile = ctx.pickupGrid.tile;
  const stack = selectedStack(ctx.pickupGrid, pickupGridStacks(ctx));
  if (!tile || !stack) return;
  if (ctx.isAdmin) {
    markRequested(ctx.pickupGrid, stack.kind, performance.now());
  }
  pickUpAt(ctx, tile, stack.kind);
}

/** Interact on the highlighted tile: pick up dropped items, place held stone on an open tile, or start mining it. The host checks everything. @param {Context} ctx */
export function interact(ctx) {
  const { scene, bag, shop } = ctx;
  if (bag.isOpen) {
    bag.confirm();
    return;
  }
  const player = scene.world.players[scene.localId];
  if (!player || scene.chatOpen || scene.menu) return;
  if (isPickupGridOpen(ctx.pickupGrid)) {
    confirmPickupGrid(ctx);
    return;
  }
  if (shop.isOpen()) {
    shop.confirm();
    return;
  }
  if (scene.viewMode !== "entity") {
    flash(ctx, "Switch to entity view to interact");
    return;
  }
  // Read the aim now: a frame may not have run since the key went down.
  const input = cameraInput(ctx);
  scene.aim = stickDirection(input.x, input.y, 0.18);
  const target = highlightedTile(
    player,
    scene.aim,
    scene.viewZ,
    scene.world,
  );
  if (!target) {
    flash(ctx, "Nothing to mine there");
    return;
  }
  if (isShopkeeper(ctx, target)) {
    shop.open(shopDirection(ctx));
    return;
  }
  const stacks = droppedHere(ctx, target);
  if (stacks.length === 1) {
    pickUpAt(ctx, target, stacks[0].kind);
    return;
  }
  if (stacks.length) {
    openPickupGrid(ctx.pickupGrid, target, performance.now());
    ctx.gridKeysAtOpen.clear();
    for (const code of ctx.held) ctx.gridKeysAtOpen.add(code);
    return;
  }
  const tileOpen = readTile(scene.world, target.x, target.y, target.z) === OPEN;
  if (heldDisplay(ctx) === STONE_ITEM) {
    if (!tileOpen) {
      flash(ctx, "Hold the pickaxe to mine");
      return;
    }
    if (ctx.isAdmin) ctx.guest?.send({ type: "place", ...target });
    else {
      const result = placeStone(
        scene.world,
        scene.localId,
        target,
        reservedTiles(scene.layout),
      );
      if (!result.ok) flash(ctx, result.reason);
    }
    return;
  }
  ctx.mineLock = { x: scene.aim.x, y: scene.aim.y, z: scene.viewZ };
  if (ctx.isAdmin) ctx.guest?.send({ type: "mine", ...target });
  else {
    const result = startMining(scene.world, scene.localId, target);
    if (!result.ok) flash(ctx, `Cannot mine: ${result.reason}`);
  }
}

/**
 * The target locks when mining starts, so walking does not cancel (the host
 * cancels when the target leaves reach), and neither does letting the aim go
 * back to rest: on a phone the thumb leaves the look stick to tap interact.
 * Aiming in another direction or changing the view level cancels.
 * @param {Context} ctx
 */
export function checkMineLock(ctx) {
  const { scene, mineLock } = ctx;
  if (!mineLock) return;
  const resting = scene.aim.x === 0 && scene.aim.y === 0;
  if (
    scene.viewMode === "entity" && scene.viewZ === mineLock.z &&
    (resting || (scene.aim.x === mineLock.x && scene.aim.y === mineLock.y))
  ) return;
  ctx.mineLock = null;
  if (ctx.isAdmin) ctx.guest?.send({ type: "mine-cancel" });
  else cancelMining(scene.world, scene.localId);
}
