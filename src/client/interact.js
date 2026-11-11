// @ts-check

/**
 * Explicit interactions open the trader conversation or pick up dropped items
 * (one stack, or the pickup grid for several). A guest sends each order to the world host, which
 * checks reach and ownership; the world host's own player goes through the same
 * shared rules.
 */

import { highlightedTile } from "../shared/target.js";
import { cancelMining } from "../shared/mining.js";
import { seesFrom } from "../shared/reach.js";
import { placeStone } from "../shared/placing.js";
import { pickUp, pickupLine } from "../shared/items.js";
import { traderAt } from "../shared/shop.js";
import {
  isPickupGridOpen,
  markRequested,
  openPickupGrid,
  selectedStack,
} from "./pickup-grid.js";
import { flash } from "./client-actions.js";
import { droppedHere } from "./display.js";
import { actionDirection, shopDirection } from "./input-values.js";
import { pickupGridStacks } from "./pickup-grid-view.js";

/** @typedef {import('./client-context.js').Context} Context */

/** Pick up the stack of one kind from a tile. The host checks reach and who asked first. @param {Context} ctx @param {{x:number,y:number,z:number}} target @param {string} kind */
function pickUpAt(ctx, target, kind) {
  const { scene } = ctx;
  if (ctx.isAdmin) {
    ctx.guest?.send({ type: "pickup", ...target, kind });
    return true;
  }
  if (ctx.simulation) {
    ctx.simulation.enqueue(
      scene.localId,
      { type: "pickup", ...target, kind },
      (result) => {
        if (result.ok) {
          scene.systemLine(String(result.line));
          ctx.sounds.own(["pickup"], target);
        } else flash(ctx, `Cannot pick up: ${result.reason}`);
      },
    );
    return true;
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

/** Resolve explicit panel, NPC, and pickup interactions on press. Return false for terrain actions. @param {Context} ctx */
export function interact(ctx) {
  const { scene, bag, shop } = ctx;
  if (bag.isOpen) {
    bag.confirm();
    return true;
  }
  const player = scene.world.players[scene.localId];
  if (!player || scene.chatOpen || scene.menu) return true;
  if (isPickupGridOpen(ctx.pickupGrid)) {
    confirmPickupGrid(ctx);
    return true;
  }
  if (shop.isOpen()) {
    shop.confirm();
    return true;
  }
  if (scene.viewMode !== "entity") {
    flash(ctx, "Switch to entity view to interact");
    return true;
  }
  // Read the aim now: a frame may not have run since the key went down.
  scene.aim = actionDirection(ctx);
  const target = highlightedTile(
    player,
    scene.aim,
    scene.viewZ,
    scene.world,
  );
  if (!target) {
    flash(ctx, "Nothing to mine there");
    return true;
  }
  const trader = traderAt(scene.world, target);
  if (trader) {
    shop.open(shopDirection(ctx), { id: trader.id, name: trader.name });
    return true;
  }
  const stacks = droppedHere(ctx, target);
  if (stacks.length === 1) {
    pickUpAt(ctx, target, stacks[0].kind);
    return true;
  }
  if (stacks.length) {
    openPickupGrid(ctx.pickupGrid, target, performance.now());
    ctx.gridKeysAtOpen.clear();
    for (const code of ctx.held) ctx.gridKeysAtOpen.add(code);
    return true;
  }
  return false;
}

/** @param {Context} ctx @param {import("../shared/world.js").Tile} target */
export function placeAt(ctx, target) {
  const { scene } = ctx;
  if (ctx.isAdmin) {
    ctx.guest?.send({ type: "place", ...target });
  } else {
    if (ctx.simulation) {
      ctx.simulation.enqueue(
        scene.localId,
        { type: "place", ...target },
        (result) => {
          if (result.ok) ctx.sounds.own(["place", "stone"], target);
          else flash(ctx, String(result.reason));
        },
      );
      return true;
    }
    const result = placeStone(
      scene.world,
      scene.localId,
      target,
      ownSees(ctx),
    );
    if (result.ok) ctx.sounds.own(["place", "stone"], target);
    else flash(ctx, result.reason);
  }
}

/** The local player's sight as the reach checks take it. @param {Context} ctx */
function ownSees(ctx) {
  const { scene } = ctx;
  return seesFrom(scene.visibility.visible, scene.viewMode === "master");
}

/** Stop the local player's mining. The host also cancels it on its own checks. @param {Context} ctx */
export function stopMining(ctx) {
  if (ctx.isAdmin) ctx.guest?.send({ type: "mine-cancel" });
  else if (ctx.simulation) {
    ctx.simulation.enqueue(ctx.scene.localId, { type: "mine-cancel" });
  } else cancelMining(ctx.scene.world, ctx.scene.localId);
}
