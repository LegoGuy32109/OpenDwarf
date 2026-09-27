// @ts-check

import { renderPosition } from "../shared/world.js";

/** @typedef {import('../shared/world.js').Player} Player */
/** @typedef {import('../shared/world.js').Move} Move */
/** @typedef {import('../shared/world.js').Tile} Tile */

/** Delay every remote entity's visual move by two simulation ticks. */
export function createPresentation() {
  /** @type {Map<string,{key:string,move:Move|null,settled:Tile}>} */
  const entries = new Map();

  /** @param {Player} player @param {number} tick @param {boolean} local */
  function playerAt(player, tick, local) {
    if (local) return player;
    let entry = entries.get(player.id);
    if (!entry) {
      entry = {
        key: "",
        move: null,
        settled: { x: player.x, y: player.y, z: player.z },
      };
      entries.set(player.id, entry);
    }
    const incoming = player.move;
    const key = incoming ? `${incoming.sequence}:${incoming.startTick}` : "";
    if (incoming && key !== entry.key) {
      const startTick = tick + 2;
      const startPosition = entry.move
        ? renderPosition({ ...player, move: entry.move }, startTick)
        : entry.settled;
      entry.key = key;
      entry.move = { ...incoming, startPosition, startTick };
    }
    const move = entry.move;
    if (move && tick < move.startTick + move.durationTicks) {
      const progress = (tick - move.startTick) / move.durationTicks;
      const tile = progress >= 0.75 ? move.target : move.origin;
      return { ...player, ...tile, move };
    }
    if (move) {
      entry.settled = move.target;
      entry.move = null;
    } else if (!incoming) {
      entry.settled = { x: player.x, y: player.y, z: player.z };
    }
    return { ...player, ...entry.settled, move: null };
  }

  return { playerAt, reset: () => entries.clear() };
}
