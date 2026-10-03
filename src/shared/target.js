// @ts-check

import { centerTile } from "./locomotion.js";
import { chunkCoord, hasChunk } from "./terrain.js";

/** @typedef {import('./world.js').Player} Player */

/** Return the adjacent tile selected for an entity action, or null outside the loaded chunks. */
/** @param {Player} player @param {{x:number,y:number}} aim @param {number} z @param {import('./world.js').World} world */
export function adjacentTarget(player, aim, z, world) {
  if (
    !Number.isInteger(z) || Math.abs(z - player.z) > 1 ||
    !Number.isInteger(aim.x) || !Number.isInteger(aim.y) ||
    Math.abs(aim.x) > 1 || Math.abs(aim.y) > 1 ||
    (!aim.x && !aim.y)
  ) return null;
  const x = centerTile(player.x) + aim.x;
  const y = centerTile(player.y) + aim.y;
  if (!hasChunk(world, chunkCoord(x), chunkCoord(y))) return null;
  return { x, y, z };
}

/**
 * The tile the interact control acts on: the aimed neighbor, or the entity's
 * own tile with no aim. Null when the aim points outside the loaded chunks.
 */
/** @param {Player} player @param {{x:number,y:number}} aim @param {number} z @param {import('./world.js').World} world */
export function highlightedTile(player, aim, z, world) {
  if (aim.x || aim.y) return adjacentTarget(player, aim, z, world);
  if (!Number.isInteger(z) || Math.abs(z - player.z) > 1) return null;
  return { x: centerTile(player.x), y: centerTile(player.y), z };
}
