// @ts-check

import { inventoryOf } from "./items.js";
import { cancelMining, heldItem } from "./mining.js";

/** @typedef {import('./world.js').World} World */

/**
 * Choose the held item on the world host. Any item in the entity's inventory
 * can be held. A guest only names the kind; the host checks the inventory.
 * Changing the held item cancels the entity's mining.
 * @param {World} world @param {string} playerId @param {string} kind
 * @returns {{ok:true,kind:string}|{ok:false,reason:string}}
 */
export function setHeldItem(world, playerId, kind) {
  const player = world.players[playerId];
  if (!player) return { ok: false, reason: "unknown player" };
  if (!inventoryOf(player).some((stack) => stack.kind === kind)) {
    return { ok: false, reason: "not in your inventory" };
  }
  if (heldItem(player) !== kind) cancelMining(world, playerId);
  /** @type {import('./world.js').Player & {held?:string}} */ (player).held =
    kind;
  return { ok: true, kind };
}
