// @ts-check
// What interact would do on a tile (ADR 0009). It sits apart from `reach.js`
// because it calls the mining and placing checks, and those call `inReach`.

import { droppedAt, inPickupReach } from "./items.js";
import { miningRefusal } from "./mining.js";
import { placeRefusal, reservedTiles } from "./placing.js";
import { SHOP_TILE } from "./shop.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {{x:number,y:number,z:number}} Tile */
/** @typedef {"mine"|"place"|"pickup"|"shop"|null} InteractAction */

/**
 * What interact would do on `tile` for this entity now, or null when it would
 * do nothing: the order is pickup, shop, place, mine, as in placing.md. It runs
 * the checks the host runs, so a null answer means the host would refuse. The
 * shopkeeper stands in every layout but `"test"`.
 * @param {World} world @param {Player} player @param {Tile} tile
 * @param {(tile:Tile) => boolean} sees
 * @param {string} [layout]
 * @returns {InteractAction}
 */
export function interactPreview(world, player, tile, sees, layout) {
  if (droppedAt(world, tile).length && inPickupReach(player, tile)) {
    return "pickup";
  }
  const shops = world.shops ?? (layout !== "test" ? [SHOP_TILE] : []);
  if (
    shops.some((at) =>
      tile.x === at.x && tile.y === at.y && tile.z === at.z &&
      inPickupReach(player, at)
    )
  ) return "shop";
  if (
    !placeRefusal(
      world,
      player,
      tile,
      sees,
      world.shops ? reservedTiles(world) : reservedTiles(layout),
    )
  ) {
    return "place";
  }
  if (!miningRefusal(world, player, tile, sees)) return "mine";
  return null;
}
