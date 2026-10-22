// @ts-check

import { decodeActionResult } from "../shared/action-wire.js";
import { centerTile } from "../shared/locomotion.js";

/**
 * Confirm accepted actions only to the connection that requested them.
 * @param {{attempt:()=>string,player:()=>import('../shared/world.js').Player|undefined,reply:(message:import('../shared/action-wire.js').ActionResult)=>void}} deps
 */
export function createActionConfirmer({ attempt, player, reply }) {
  /** @param {Record<string,unknown>} message @param {Record<string,unknown>} result @param {string} [requestAttempt] */
  return (message, result, requestAttempt = attempt()) => {
    if (result.ok !== true || requestAttempt !== attempt()) return;
    const source = player();
    if (!source) return;
    // A spoken sale confirms as a sale; its accepted result carries the line.
    const spoken = message.type === "talk" && typeof result.line === "string";
    if (message.type === "talk" && !spoken) return;
    const at = spoken
      ? { x: centerTile(source.x), y: centerTile(source.y), z: source.z }
      : { x: message.x, y: message.y, z: message.z };
    const packet = decodeActionResult({
      type: "action-result",
      attempt: requestAttempt,
      action: spoken ? "sell" : message.type,
      ...at,
    }, requestAttempt);
    if (packet) reply(packet);
  };
}
