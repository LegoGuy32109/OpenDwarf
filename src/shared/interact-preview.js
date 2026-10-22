// @ts-check
// What interact would do on a tile (ADR 0009). It sits apart from `reach.js`
// because it calls the mining and placing checks, and those call `inReach`.

import { droppedAt, inPickupReach } from "./items.js";
import { miningRefusal } from "./mining.js";
import { placeRefusal } from "./placing.js";
import { traderAt } from "./shop.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {{x:number,y:number,z:number}} Tile */
/** @typedef {"mine"|"place"|"pickup"|"shop"|null} InteractAction */

/**
 * What interact would do on `tile` for this entity now, or null when it would
 * do nothing: the order is pickup, shop, place, mine, as in placing.md. It runs
 * the checks the host runs, so a null answer means the host would refuse. A
 * trader NPC on the tile, in reach, opens the shop.
 * @param {World} world @param {Player} player @param {Tile} tile
 * @param {(tile:Tile) => boolean} sees
 * @returns {InteractAction}
 */
export function interactPreview(world, player, tile, sees) {
  if (droppedAt(world, tile).length && inPickupReach(player, tile)) {
    return "pickup";
  }
  if (traderAt(world, tile) && inPickupReach(player, tile)) return "shop";
  if (!placeRefusal(world, player, tile, sees)) return "place";
  if (!miningRefusal(world, player, tile, sees)) return "mine";
  return null;
}
