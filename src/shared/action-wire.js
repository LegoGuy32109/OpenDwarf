// @ts-check

import { finite, identifier, MAX_COORD, record } from "./wire-parse.js";
import { WORLD_TOP } from "./terrain.js";

/** @typedef {{type:"action-result",attempt:string,action:"pickup"|"place"|"sell",x:number,y:number,z:number}} ActionResult */

/** A success notice belongs to one connection attempt and has no peer-selected sound tags.
 * @param {unknown} value @param {string} attempt @returns {ActionResult|null}
 */
export function decodeActionResult(value, attempt) {
  if (
    !record(value) || value.type !== "action-result" ||
    !identifier(value.attempt) || value.attempt !== attempt ||
    (value.action !== "pickup" && value.action !== "place" &&
      value.action !== "sell") ||
    !Number.isInteger(value.x) || !finite(value.x, -MAX_COORD, MAX_COORD) ||
    !Number.isInteger(value.y) || !finite(value.y, -MAX_COORD, MAX_COORD) ||
    !Number.isInteger(value.z) || !finite(value.z, 0, WORLD_TOP)
  ) return null;
  return {
    type: "action-result",
    attempt: value.attempt,
    action: /** @type {ActionResult['action']} */ (value.action),
    x: value.x,
    y: value.y,
    z: value.z,
  };
}
