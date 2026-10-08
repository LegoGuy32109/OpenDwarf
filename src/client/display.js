// @ts-check

/**
 * What the client draws from the world each frame: the dropped items, the local
 * inventory, the held item, the mining actions, and the stacks on a tile. A
 * world host reads them from its own world; a guest reads what the world host
 * sent (the `scene` feeds). It changes nothing.
 */

import { TICK_MS } from "../shared/world.js";
import { tileVisibility } from "../shared/visibility.js";
import { heldItem, miningEntries, PICKAXE } from "../shared/mining.js";
import { droppedAt, droppedItems, inventoryOf } from "../shared/items.js";
import { itemSeen } from "../shared/reach.js";
import { clamp } from "./context.js";

/** @typedef {import('./context.js').Context} Context */

/** The stacks of dropped items on a tile, as this client knows them. @param {Context} ctx @param {{x:number,y:number,z:number}} tile */
export function droppedHere(ctx, tile) {
  const { scene } = ctx;
  if (!ctx.isAdmin) return droppedAt(scene.world, tile);
  return scene.itemFeed?.find((entry) =>
    entry.x === tile.x && entry.y === tile.y && entry.z === tile.z
  )?.stacks ?? [];
}

/** The dropped items to draw this frame: tiles in sight (or the floor under them), or all in master view. @param {Context} ctx */
export function itemsDisplay(ctx) {
  const { scene } = ctx;
  if (ctx.isAdmin) return scene.itemFeed ?? [];
  const store = droppedItems(scene.world).tiles;
  if (!store.size) return [];
  return [...store.values()].filter((entry) =>
    scene.viewMode === "master" ||
    itemSeen(scene.visibility.visible, entry)
  );
}

/** The local player's inventory. @param {Context} ctx */
export function inventoryDisplay(ctx) {
  const { scene } = ctx;
  if (ctx.isAdmin) return scene.inventoryFeed ?? [];
  const player = scene.world.players[scene.localId];
  return player ? inventoryOf(player) : [];
}

/** The item kind the local player holds. @param {Context} ctx */
export function heldDisplay(ctx) {
  const { scene } = ctx;
  if (ctx.isAdmin) return scene.heldFeed ?? PICKAXE;
  const player = scene.world.players[scene.localId];
  return player ? heldItem(player) : PICKAXE;
}

/** The mining actions to draw this frame, with progress from 0 to 1. @param {Context} ctx @param {number} alpha */
export function miningDisplay(ctx, alpha) {
  const { scene } = ctx;
  if (ctx.isAdmin) {
    const feed = scene.mineFeed;
    if (!feed) return [];
    const now = performance.now();
    return feed.entries.map((entry) => ({
      id: entry.id,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      progress: clamp((entry.elapsedMs + now - feed.at) / entry.totalMs, 0, 1),
    }));
  }
  return miningEntries(scene.world).filter((entry) =>
    entry.id === scene.localId || scene.viewMode === "master" ||
    tileVisibility(scene.visibility, entry.x, entry.y, entry.z) === "visible"
  ).map((entry) => ({
    id: entry.id,
    x: entry.x,
    y: entry.y,
    z: entry.z,
    progress: clamp(
      (entry.elapsedMs + alpha * TICK_MS) / entry.totalMs,
      0,
      1,
    ),
  }));
}
