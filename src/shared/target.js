// @ts-check

import { centerTile } from "./locomotion.js";

/** @typedef {import('./world.js').Player} Player */

/** Return the adjacent tile selected for an entity action. */
/** @param {Player} player @param {{x:number,y:number}} aim @param {number} z @param {number} edge */
export function adjacentTarget(player, aim, z, edge) {
  if (
    !Number.isInteger(z) || Math.abs(z - player.z) > 1 ||
    !Number.isInteger(aim.x) || !Number.isInteger(aim.y) ||
    Math.abs(aim.x) > 1 || Math.abs(aim.y) > 1 ||
    (!aim.x && !aim.y)
  ) return null;
  const x = centerTile(player.x) + aim.x;
  const y = centerTile(player.y) + aim.y;
  if (x < 0 || x >= edge || y < 0 || y >= edge) return null;
  return { x, y, z };
}
