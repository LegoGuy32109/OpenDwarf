// @ts-check

import { droppedAt, inventoryOf, STONE_ITEM, takeStack } from "./items.js";
import { centerTile, PLAYER_SIZE } from "./locomotion.js";
import { heldItem } from "./mining.js";
import { inReach } from "./reach.js";
import { SHOP_TILE } from "./shop.js";
import { recordSound } from "./sound.js";
import { OPEN, readTile, STONE, WORLD_TOP, writeTile } from "./terrain.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {{x:number,y:number,z:number}} Tile */
/** @typedef {{ok:true,tile:Tile}|{ok:false,reason:string}} PlaceResult */

const EPS = 0.001;
/** The notice for any occupied tile. */
export const IN_THE_WAY = "Something is in the way";

/**
 * Whether an entity's footprint overlaps a tile. A moving entity also counts at
 * the tile it is leaving and the tile it is walking into.
 * @param {Player} entity @param {Tile} tile
 */
function entityOverlaps(entity, tile) {
  const reach = ((entity.size ?? PLAYER_SIZE) + 1) / 2 - EPS;
  const spots = [entity, entity.move?.origin, entity.move?.target];
  return spots.some((spot) =>
    !!spot && tile.z >= Math.floor(spot.z) && tile.z < Math.floor(spot.z) + 1 &&
    Math.abs(tile.x - spot.x) < reach && Math.abs(tile.y - spot.y) < reach
  );
}

/** Tiles that hold an entity outside `world.players`: the shopkeeper, in the room layout. @param {string|undefined} layout @returns {readonly Tile[]} */
export function reservedTiles(layout) {
  return layout === "room" ? [SHOP_TILE] : [];
}

/**
 * Why `player` may not place a stone on `tile` now, or null when the host would
 * place it: a real tile, a stone held, the tile in reach (path and sight, ADR
 * 0009), open, and unoccupied (no entity footprint, no dropped items, none of
 * `reserved`).
 * @param {World} world @param {Player} player @param {Tile} tile
 * @param {(tile:Tile) => boolean} [sees] @param {readonly Tile[]} [reserved]
 * @returns {string|null}
 */
export function placeRefusal(
  world,
  player,
  tile,
  sees = () => true,
  reserved = [],
) {
  if (
    !Number.isInteger(tile.x) || !Number.isInteger(tile.y) ||
    !Number.isInteger(tile.z) || tile.z < 0 || tile.z > WORLD_TOP
  ) return "invalid tile";
  const stone = inventoryOf(player).find((stack) => stack.kind === STONE_ITEM);
  if (heldItem(player) !== STONE_ITEM || !stone) return "no stone held";
  if (stone.count < 1) return "no stone";
  if (
    tile.z === player.z && tile.x === centerTile(player.x) &&
    tile.y === centerTile(player.y)
  ) return IN_THE_WAY;
  if (!inReach(world, player, tile, sees)) return "out of reach";
  if (readTile(world, tile.x, tile.y, tile.z) !== OPEN) {
    return "tile is not open";
  }
  if (
    droppedAt(world, tile).length ||
    Object.values(world.players).some((entity) =>
      entityOverlaps(entity, tile)
    ) ||
    reserved.some((spot) =>
      spot.x === tile.x && spot.y === tile.y && spot.z === tile.z
    )
  ) return IN_THE_WAY;
  return null;
}

/**
 * Place one held stone on an empty tile, on the world host. `placeRefusal`
 * holds the checks; `sees` is the acting entity's current sight. The tile
 * becomes stone at once through `writeTile`, and one stone leaves the inventory.
 * @param {World} world @param {string} playerId @param {Tile} tile
 * @param {readonly Tile[]} [reserved] tiles that hold an entity outside `world.players`, such as the shopkeeper
 * @param {(tile:Tile) => boolean} [sees] @returns {PlaceResult}
 */
export function placeStone(
  world,
  playerId,
  tile,
  reserved = [],
  sees = () => true,
) {
  const player = world.players[playerId];
  if (!player) return { ok: false, reason: "unknown player" };
  const reason = placeRefusal(world, player, tile, sees, reserved);
  if (reason) return { ok: false, reason };
  const inventory = inventoryOf(player);
  const index = inventory.findIndex((stack) => stack.kind === STONE_ITEM);
  if (inventory[index].count > 1) inventory[index].count--;
  else takeStack(inventory, index);
  writeTile(world, tile.x, tile.y, tile.z, STONE);
  recordSound(world, {
    tags: ["place", "stone"],
    x: tile.x,
    y: tile.y,
    z: tile.z,
    source: playerId,
  });
  return { ok: true, tile: { x: tile.x, y: tile.y, z: tile.z } };
}
