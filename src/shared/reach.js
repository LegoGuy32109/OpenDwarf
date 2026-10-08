// @ts-check
// Reach for mining and placing: the 3x3x3 around an entity, open path and
// sight (ADR 0009). The world host checks it for its own player and every guest.

import { droppedAt, inPickupReach } from "./items.js";
import { centerTile } from "./locomotion.js";
import { miningRefusal } from "./mining.js";
import { placeRefusal, reservedTiles } from "./placing.js";
import { SHOP_TILE } from "./shop.js";
import { OPEN, readTile } from "./terrain.js";
import { tileKey } from "./visibility.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {{x:number,y:number,z:number}} Tile */
/** @typedef {"mine"|"place"|"pickup"|"shop"|null} InteractAction */

/** The cursor outline color and opacity, and the dimmed icon's opacity. */
export const CURSOR_COLOR = "#ffb833";
export const CURSOR_OPACITY = 0.6;
export const CURSOR_ICON_DIM = 0.35;

/**
 * The path rule alone: `tile` lies in the 3x3x3 around the entity's center
 * tile and an open path leads to it (ADR 0009). No sight check.
 * @param {World} world @param {Player} player @param {Tile} tile
 * @returns {boolean}
 */
export function pathReach(world, player, tile) {
  const cx = centerTile(player.x);
  const cy = centerTile(player.y);
  const dx = tile.x - cx;
  const dy = tile.y - cy;
  const dz = tile.z - player.z;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || Math.abs(dz) > 1) return false;
  /** @param {number} x @param {number} y @param {number} z */
  const open = (x, y, z) => readTile(world, x, y, z) === OPEN;
  /** On one level: an orthogonal neighbor, or a diagonal with an open side. @param {number} z */
  const sameLevel = (z) =>
    dx === 0 || dy === 0 || open(cx + dx, cy, z) || open(cx, cy + dy, z);
  const above = dx === 0 && dy === 0;
  if (dz === 0) return sameLevel(player.z);
  if (dz > 0) {
    return above || (open(cx, cy, tile.z) && sameLevel(tile.z));
  }
  return !above && open(tile.x, tile.y, player.z);
}

/**
 * The full rule: in the path rule and seen now. `sees` answers for the
 * entity's current sight (the host's per-peer visible set, or the host's own
 * `scene.visibility`).
 * @param {World} world @param {Player} player @param {Tile} tile
 * @param {(tile:Tile) => boolean} sees
 * @returns {boolean}
 */
export function inReach(world, player, tile, sees) {
  return pathReach(world, player, tile) && sees(tile);
}

/**
 * An entity's sight as the `sees` function the checks take: a tile is seen when
 * it is in the visible set, or always when `all` is set (a master view).
 * @param {Set<string>} visible @param {boolean} [all]
 * @returns {(tile:Tile) => boolean}
 */
export function seesFrom(visible, all = false) {
  return (tile) => all || visible.has(tileKey(tile.x, tile.y, tile.z));
}

/**
 * Whether a peer sees a dropped item: the item's tile or the floor under it is
 * in its visible set, so mining around a corner shows the floor first.
 * @param {Set<string>} visible @param {Tile} tile
 */
export function itemSeen(visible, tile) {
  return visible.has(tileKey(tile.x, tile.y, tile.z)) ||
    visible.has(tileKey(tile.x, tile.y, tile.z - 1));
}

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
  if (
    layout !== "test" && tile.x === SHOP_TILE.x && tile.y === SHOP_TILE.y &&
    tile.z === SHOP_TILE.z && inPickupReach(player, SHOP_TILE)
  ) return "shop";
  if (!placeRefusal(world, player, tile, sees, reservedTiles(layout))) {
    return "place";
  }
  if (!miningRefusal(world, player, tile, sees)) return "mine";
  return null;
}
