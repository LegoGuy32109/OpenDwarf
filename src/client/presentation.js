// @ts-check

import { renderPosition } from "../shared/world.js";

/** @typedef {import('../shared/world.js').Player} Player */
/** @typedef {import('../shared/world.js').Tile} Tile */

/** Follow the newest simulation position without replaying a backlog of old moves. */
export function createPresentation() {
  /** @type {Map<string,{position:Tile,tick:number}>} */
  const entries = new Map();

  /** @param {Player} player @param {number} tick @param {boolean} local */
  function positionAt(player, tick, local) {
    const target = renderPosition(player, tick);
    if (local) return target;
    let entry = entries.get(player.id);
    if (!entry || tick < entry.tick) {
      entry = { position: target, tick };
      entries.set(player.id, entry);
      return target;
    }
    const elapsed = Math.max(0, tick - entry.tick);
    const difference = {
      x: target.x - entry.position.x,
      y: target.y - entry.position.y,
      z: target.z - entry.position.z,
    };
    const distance = Math.hypot(difference.x, difference.y, difference.z);
    if (distance > 0 && elapsed > 0) {
      const fraction = 1 - Math.exp(-elapsed / 1.5);
      const step = Math.min(distance * fraction, elapsed * 0.125);
      entry.position = {
        x: entry.position.x + difference.x / distance * step,
        y: entry.position.y + difference.y / distance * step,
        z: entry.position.z + difference.z / distance * step,
      };
    }
    // An unseen turn or a delayed snapshot must not leave the sprite on
    // another part of the map while the simulation has already moved on.
    const remaining = Math.hypot(
      target.x - entry.position.x,
      target.y - entry.position.y,
      target.z - entry.position.z,
    );
    if (remaining > 0.75) {
      const fraction = 0.75 / remaining;
      entry.position = {
        x: target.x + (entry.position.x - target.x) * fraction,
        y: target.y + (entry.position.y - target.y) * fraction,
        z: target.z + (entry.position.z - target.z) * fraction,
      };
    }
    entry.tick = tick;
    return entry.position;
  }

  return { positionAt, reset: () => entries.clear() };
}
