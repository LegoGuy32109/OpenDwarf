// @ts-check
// The world cursor's draw parameters (ADR 0009, Cursor): a 2 px outline with
// the held item's icon in its center.

import {
  CURSOR_COLOR,
  CURSOR_ICON_DIM,
  CURSOR_OPACITY,
  interactPreview,
} from "../shared/reach.js";
import { itemInfo } from "../shared/items.js";
import { heldItem } from "../shared/mining.js";
import { highlightedTile } from "../shared/target.js";
import { tileVisibility } from "../shared/visibility.js";

/** @typedef {import('./render.js').Scene} Scene */

/** Outline width in CSS pixels at the world's tile scale, and the icon's share of a tile. */
export const CURSOR_OUTLINE = 2;
export const CURSOR_ICON_SIZE = 0.5;

/**
 * What to draw for the cursor: the outline color and opacity, the held item's
 * sheet frame, and the icon's opacity (full when interact would act on the
 * tile, `CURSOR_ICON_DIM` when `preview` is null).
 * @param {string} held the held item kind
 * @param {import('../shared/reach.js').InteractAction} preview
 */
export function cursorParams(held, preview) {
  return {
    color: CURSOR_COLOR,
    opacity: CURSOR_OPACITY,
    iconFrame: itemInfo(held)?.frame ?? null,
    iconOpacity: preview === null ? CURSOR_ICON_DIM : 1,
  };
}

/**
 * The local cursor for this frame, or null when none shows: the aimed tile
 * (or the tile being mined at rest) with its draw parameters.
 * @param {Scene} scene
 */
export function localCursor(scene) {
  const player = scene.world.players[scene.localId];
  if (scene.viewMode !== "entity" || !player || scene.pickupCells?.length) {
    return null;
  }
  // At rest the aim is the player's own tile: interact still works there, but the
  // cursor only shows for an aimed tile or the tile being mined.
  const resting = scene.aim.x === 0 && scene.aim.y === 0;
  const tile = resting
    ? (scene.mining ?? []).find((entry) =>
      entry.id === scene.localId && entry.z === scene.viewZ
    )
    : highlightedTile(player, scene.aim, scene.viewZ, scene.world);
  if (!tile) return null;
  const at = { x: tile.x, y: tile.y, z: scene.viewZ };
  const held = heldItem(player);
  const preview = interactPreview(
    scene.world,
    player,
    at,
    (t) => tileVisibility(scene.visibility, t.x, t.y, t.z) === "visible",
  );
  return { tile: at, held, preview, ...cursorParams(held, preview) };
}
