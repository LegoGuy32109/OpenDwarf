// @ts-check
import { centerTile } from "../shared/locomotion.js";
import { itemSeen } from "../shared/reach.js";

/** Recipient-specific flight; never include a hidden item's origin or path.
 * @param {import('../shared/world.js').World} world @param {Set<string>} visible @param {boolean} master
 */
export function visibleThrows(world, visible, master = false) {
  return (world.throws ?? []).filter((entry) =>
    master || itemSeen(visible, {
      x: centerTile(entry.x),
      y: centerTile(entry.y),
      z: entry.z,
    })
  );
}
