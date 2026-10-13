// @ts-check
import { shownStacks } from "./pickup-grid.js";
import { droppedHere } from "./display.js";
/** @typedef {import("./client-context.js").Context} Context */

/** The stacks the open pickup grid shows. @param {Context} ctx */
export function pickupGridStacks(ctx) {
  const tile = ctx.pickupGrid.tile;
  return tile
    ? shownStacks(ctx.pickupGrid, droppedHere(ctx, tile), performance.now())
    : [];
}
