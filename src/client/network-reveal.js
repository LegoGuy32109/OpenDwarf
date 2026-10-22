// @ts-check

import { revealChanges } from "../shared/reveal.js";
import { tileKey } from "../shared/visibility.js";

/**
 * Update a peer's reveal and invalidate sight after visible geometry changes.
 * An earlier snapshot may already have copied the material into memory, so
 * material equality cannot decide whether the cached sight is still valid.
 * @param {Parameters<typeof revealChanges>[0]} guest
 * @param {import('../shared/terrain.js').TileChange[]} changes
 */
export function revealPeerChanges(guest, changes) {
  const revealed = revealChanges(guest, changes);
  const sightChanged = guest.mode === "entity" &&
    changes.some((change) =>
      guest.sight.visible.has(tileKey(change.x, change.y, change.z))
    );
  if (sightChanged) guest.sight.sample = "";
  return revealed || sightChanged;
}
