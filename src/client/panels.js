// @ts-check

/**
 * The glue for the panels over the world: the bag, the menu, the hearing log,
 * the join QR panel, and the pickup grid. `inventory-panel.js`, `shop-panel.js`,
 * and `pickup-grid.js` own each panel's selection; this file opens and closes
 * them and keeps them in step with the scene each frame.
 */

import {
  cellAtPoint,
  clampSelection,
  closePickupGrid,
  closeReason,
  gridCenter,
  isPickupGridOpen,
  moveSelection,
  pickupGridCells,
  selectStack,
  shownStacks,
  stepSelection,
} from "./pickup-grid.js";
import { droppedHere } from "./display.js";
import { stickDirection } from "./input-read.js";

/** @typedef {import('./context.js').Context} Context */

/** Open or close the inventory panel. Menu, chat, and master view keep it shut. @param {Context} ctx @param {boolean} [open] */
export function toggleBag(ctx, open = !ctx.bag.isOpen) {
  if (open && (ctx.scene.chatOpen || ctx.scene.menu || ctx.shop.isOpen())) {
    return;
  }
  ctx.bag.toggle(open);
}

/** Opens or closes the menu. It shuts the panels, which would sit under it. @param {Context} ctx */
export function toggleMenu(ctx) {
  toggleBag(ctx, false);
  ctx.shop.close();
  ctx.scene.menu = !ctx.scene.menu;
  ctx.scene.menuPage = "root";
}

/** @param {Context} ctx @param {boolean} [open] */
export function toggleLog(ctx, open = !ctx.ui.logOpen) {
  ctx.ui.logOpen = open;
  if (open) ctx.ui.logScroll = 0;
}

/** Shows or hides the small join QR below the host tools. @param {Context} ctx */
export function toggleJoinPanel(ctx) {
  ctx.ui.joinOpen = !ctx.ui.joinOpen;
}

/** The stacks the open pickup grid shows. @param {Context} ctx */
export function pickupGridStacks(ctx) {
  const tile = ctx.pickupGrid.tile;
  return tile
    ? shownStacks(ctx.pickupGrid, droppedHere(ctx, tile), performance.now())
    : [];
}

/**
 * Each frame: close the grid when the entity leaves reach or the tile empties,
 * move the selector with IJKL, the look stick, or the D-pad, and compute the
 * squares to draw.
 * @param {Context} ctx
 */
export function updatePickupGrid(ctx) {
  const { scene, pickupGrid } = ctx;
  const player = scene.world.players[scene.localId];
  if (!isPickupGridOpen(pickupGrid)) {
    scene.pickupCells = [];
    return;
  }
  const now = performance.now();
  const stacks = pickupGridStacks(ctx);
  if (
    scene.viewMode !== "entity" || scene.chatOpen ||
    closeReason(pickupGrid, player, stacks.length)
  ) {
    closePickupGrid(pickupGrid);
    scene.pickupCells = [];
    return;
  }
  clampSelection(pickupGrid, stacks.length);
  // IJKL moves the selector on key press (`gridKey`); the sticks and D-pad here.
  const direction = ctx.gamepadDpad.x || ctx.gamepadDpad.y
    ? ctx.gamepadDpad
    : stickDirection(
      ctx.cameraStick.x + ctx.gamepadCamera.x,
      ctx.cameraStick.y + ctx.gamepadCamera.y,
      0.5,
    );
  if (!scene.menu) stepSelection(pickupGrid, stacks.length, direction, now);
  scene.pickupCells = scene.viewZ === pickupGrid.tile?.z && player
    ? pickupGridCells(pickupGrid, stacks, gridCenter(player), now)
    : [];
}

/** @type {Record<string,[number,number]>} */
const GRID_KEYS = { KeyI: [0, -1], KeyK: [0, 1], KeyJ: [-1, 0], KeyL: [1, 0] };

/** IJKL moves the selector, with the browser's key repeat for a held key. @param {Context} ctx @param {string} code @param {boolean} repeat */
export function gridKey(ctx, code, repeat) {
  const step = GRID_KEYS[code];
  if (!step || !isPickupGridOpen(ctx.pickupGrid) || ctx.scene.menu) return;
  if (repeat && ctx.gridKeysAtOpen.has(code)) return;
  moveSelection(ctx.pickupGrid, pickupGridStacks(ctx).length, step[0], step[1]);
}

/** A tap on a square selects it. @param {Context} ctx @param {number} clientX @param {number} clientY */
export function tapPickupGrid(ctx, clientX, clientY) {
  const { scene } = ctx;
  if (!isPickupGridOpen(ctx.pickupGrid) || scene.menu) return;
  const rect = ctx.canvas.getBoundingClientRect();
  const cell = cellAtPoint(
    scene.pickupCells,
    (clientX - rect.left - rect.width / 2) / scene.zoom + scene.camera.x,
    (clientY - rect.top - rect.height / 2) / scene.zoom + scene.camera.y,
  );
  if (cell) {
    selectStack(ctx.pickupGrid, pickupGridStacks(ctx).length, cell.index);
  }
}
