// @ts-check
// The local sounds of the panels (ADR 0008): `ui open` when the bag, shop or
// pickup grid opens and `ui click` when their selection moves. They are never
// sound events, so a frame watcher plays them and the panels stay as they are.

import { isPickupGridOpen } from "./pickup-grid.js";

/** @typedef {import('./context.js').Context} Context */

/** @typedef {{open:boolean,at:number|string}} PanelSeen */

/** What the panels showed last frame. @type {Record<"bag"|"shop"|"grid",PanelSeen>} */
const seen = {
  bag: { open: false, at: 0 },
  shop: { open: false, at: "" },
  grid: { open: false, at: 0 },
};

/**
 * Play the panel sounds for what changed since the last call. Call it once a frame.
 * @param {Context} ctx
 */
export function playPanelSounds(ctx) {
  const panels = /** @type {const} */ ([
    ["bag", ctx.bag.isOpen, ctx.bag.selected],
    ["shop", ctx.shop.isOpen(), ctx.shop.selected],
    ["grid", isPickupGridOpen(ctx.pickupGrid), ctx.pickupGrid.selected],
  ]);
  for (const [name, open, at] of panels) {
    const before = seen[name];
    if (open && !before.open) ctx.sfx.play(["ui", "open"]);
    else if (open && at !== before.at) ctx.sfx.play(["ui", "click"]);
    before.open = open;
    before.at = at;
  }
}
