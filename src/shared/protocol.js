// @ts-check

import { startMove } from "./world.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {{dx:number,dy:number,sequence:number}} MoveIntent */

/**
 * Apply an ordered player's intent once. A duplicate or delayed packet cannot start a later move.
 * @param {World} world
 * @param {string} playerId
 * @param {MoveIntent} intent
 * @param {number} lastSequence
 */
export function acceptMoveIntent(world, playerId, intent, lastSequence) {
  if (
    !Number.isSafeInteger(intent.sequence) || intent.sequence <= lastSequence
  ) {
    return { sequence: lastSequence, ok: false, reason: "stale input" };
  }
  const result = startMove(
    world,
    playerId,
    intent.dx,
    intent.dy,
    intent.sequence,
  );
  return { sequence: intent.sequence, ...result };
}
