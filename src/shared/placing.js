// @ts-check

import { droppedAt, inventoryOf, STONE_ITEM, takeStack } from "./items.js";
import { centerTile, PLAYER_SIZE } from "./locomotion.js";
import { heldItem, inMiningReach } from "./mining.js";
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
 * Place one held stone on an empty tile, on the world host. The host checks the
 * entity, the tile, the held item and its count, reach, that the tile is open,
 * and that it is unoccupied: no entity footprint (the entity's own included),
 * no dropped items, and none of `reserved` (tiles that hold an entity outside
 * `world.players`, such as the shopkeeper). The tile becomes stone at once
 * through `writeTile`, and one stone leaves the inventory.
 * @param {World} world @param {string} playerId @param {Tile} tile
 * @param {readonly Tile[]} [reserved] @returns {PlaceResult}
 */
export function placeStone(world, playerId, tile, reserved = []) {
  const player = world.players[playerId];
  if (!player) return { ok: false, reason: "unknown player" };
  if (
    !Number.isInteger(tile.x) || !Number.isInteger(tile.y) ||
    !Number.isInteger(tile.z) || tile.z < 0 || tile.z > WORLD_TOP
  ) return { ok: false, reason: "invalid tile" };
  const inventory = inventoryOf(player);
  const index = inventory.findIndex((stack) => stack.kind === STONE_ITEM);
  if (heldItem(player) !== STONE_ITEM || index < 0) {
    return { ok: false, reason: "no stone held" };
  }
  if (inventory[index].count < 1) return { ok: false, reason: "no stone" };
  if (
    tile.z === player.z && tile.x === centerTile(player.x) &&
    tile.y === centerTile(player.y)
  ) return { ok: false, reason: IN_THE_WAY };
  if (!inMiningReach(player, tile)) {
    return { ok: false, reason: "out of reach" };
  }
  if (readTile(world, tile.x, tile.y, tile.z) !== OPEN) {
    return { ok: false, reason: "tile is not open" };
  }
  if (
    droppedAt(world, tile).length ||
    Object.values(world.players).some((entity) =>
      entityOverlaps(entity, tile)
    ) ||
    reserved.some((spot) =>
      spot.x === tile.x && spot.y === tile.y && spot.z === tile.z
    )
  ) return { ok: false, reason: IN_THE_WAY };
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
