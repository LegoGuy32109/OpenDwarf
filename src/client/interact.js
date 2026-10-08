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
import { cancelMining, miningActions, startMining } from "../shared/mining.js";
import { seesFrom } from "../shared/reach.js";
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
    ctx.sounds.own(["pickup"], target);
    return;
  }
  const result = pickUp(scene.world, scene.localId, target, kind);
  if (result.ok) {
    scene.systemLine(pickupLine(result.kind, result.count));
    ctx.sounds.own(["pickup"], target);
  } else flash(ctx, `Cannot pick up: ${result.reason}`);
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
  // The cursor is free: interact on the tile being mined stops it, and on any
  // other tile stops it before the new action.
  if (isMining(ctx, target)) {
    stopMining(ctx);
    return;
  }
  stopMining(ctx);
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
    if (ctx.isAdmin) {
      ctx.guest?.send({ type: "place", ...target });
      ctx.sounds.own(["place", "stone"], target);
    } else {
      const result = placeStone(
        scene.world,
        scene.localId,
        target,
        reservedTiles(scene.layout),
        ownSees(ctx),
      );
      if (result.ok) ctx.sounds.own(["place", "stone"], target);
      else flash(ctx, result.reason);
    }
    return;
  }
  if (ctx.isAdmin) ctx.guest?.send({ type: "mine", ...target });
  else {
    const result = startMining(
      scene.world,
      scene.localId,
      target,
      ownSees(ctx),
    );
    if (!result.ok) flash(ctx, `Cannot mine: ${result.reason}`);
  }
}

/** The local player's sight as the reach checks take it. @param {Context} ctx */
function ownSees(ctx) {
  const { scene } = ctx;
  return seesFrom(scene.visibility.visible, scene.viewMode === "master");
}

/** Whether the local player is mining `tile`, as this client knows it. @param {Context} ctx @param {{x:number,y:number,z:number}} tile */
function isMining(ctx, tile) {
  const { scene } = ctx;
  const same = (/** @type {{x:number,y:number,z:number}|undefined} */ at) =>
    !!at && at.x === tile.x && at.y === tile.y && at.z === tile.z;
  if (ctx.isAdmin) {
    return same(scene.mineFeed?.entries.find((e) => e.id === scene.localId));
  }
  return same(miningActions(scene.world).get(scene.localId));
}

/** Stop the local player's mining. The host also cancels it on its own checks. @param {Context} ctx */
function stopMining(ctx) {
  if (ctx.isAdmin) ctx.guest?.send({ type: "mine-cancel" });
  else cancelMining(ctx.scene.world, ctx.scene.localId);
}
