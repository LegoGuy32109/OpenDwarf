// @ts-check
// The world cursor's draw parameters (ADR 0009, Cursor): a 2 px outline with
// the held item's icon in its center.

import { CURSOR_ICON_DIM } from "../shared/reach.js";
import { facingOf } from "../shared/single-plane.js";
import { interactPreview } from "../shared/interact-preview.js";
import { itemInfo } from "../shared/items.js";
import { heldItem } from "../shared/mining.js";
import { highlightedTile } from "../shared/target.js";
import { tileVisibility } from "../shared/visibility.js";

/** @typedef {import('./scene-types.js').Scene} Scene */

/** Outline width in CSS pixels at the world's tile scale, and the icon's share of a tile. */
export const CURSOR_OUTLINE = 2;
export const CURSOR_ICON_SIZE = 0.5;

/**
 * What to draw for the cursor: the outline color and opacity, the held item's
 * sheet frame, and the icon's opacity (full when interact would act on the
 * tile, `CURSOR_ICON_DIM` when `preview` is null).
 * @param {string} held the held item kind
 * @param {import('../shared/interact-preview.js').InteractAction} preview
 */
export function cursorParams(held, preview) {
  return {
    color: "#ffffff",
    opacity: 0.5,
    iconFrame: itemInfo(held)?.frame ?? null,
    iconOpacity: preview === null ? CURSOR_ICON_DIM : 1,
  };
}

/**
 * The local cursor for this frame, or null when none shows: the aimed tile
 * (or the tile being mined at rest) with its draw parameters.
 * @param {Pick<Scene,"world"|"localId"|"viewMode"|"pickupCells"|"aim"|"mining"|"viewZ"|"visibility"|"actionGesture">} scene
 */
export function localCursor(scene) {
  const player = scene.world.players[scene.localId];
  if (scene.viewMode !== "entity" || !player || scene.pickupCells?.length) {
    return null;
  }
  const aiming = scene.actionGesture?.aiming;
  const aim = aiming
    ? scene.actionGesture
    : scene.aim.x || scene.aim.y
    ? scene.aim
    : facingOf(player);
  const mining = (scene.mining ?? []).find((entry) =>
    entry.id === scene.localId && entry.z === scene.viewZ
  );
  const tile = mining ??
    highlightedTile(player, aim ?? facingOf(player), scene.viewZ, scene.world);
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

/** Visible entities carry movement direction; the local entity retains facing at rest. @param {Pick<Scene,"localId"|"actionGesture">} scene @param {import('../shared/world.js').Player} player */
export function directionMarker(scene, player) {
  const local = player.id === scene.localId;
  if (local && scene.actionGesture?.aiming) {
    return { ...scene.actionGesture, aiming: true };
  }
  const moving = Boolean(player.move || player.vx || player.vy);
  if (!local && !moving) return null;
  const direction = player.facing ??
    (player.move
      ? {
        x: Math.sign(player.move.target.x - player.move.origin.x),
        y: Math.sign(player.move.target.y - player.move.origin.y),
      }
      : moving
      ? { x: Math.sign(player.vx ?? 0), y: Math.sign(player.vy ?? 0) }
      : facingOf(player));
  return { ...direction, aiming: false };
}
