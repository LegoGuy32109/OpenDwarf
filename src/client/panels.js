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
  stepPickupSelection,
} from "./pickup-grid.js";
import { pickupGridStacks } from "./pickup-grid-view.js";
import { reachesTrader } from "../shared/shop.js";
import { openLevel, stickDirection } from "./input-values.js";
import { VOICES_LEVELS } from "./chatter.js";
import { MUSIC_LEVELS } from "./music.js";
import { EFFECTS_LEVELS } from "./sfx.js";
import { TEXT_SIZES } from "../shared/chat.js";
import {
  MENU_ROWS,
  parentLevel,
  SETTINGS_ROWS,
  settingsChanges,
  stepRow,
} from "./menu-nav.js";

/** @typedef {import('./client-context.js').Context} Context */

/** Open or close the inventory panel. Menu, chat, and master view keep it shut. @param {Context} ctx @param {boolean} [open] */
export function toggleBag(ctx, open = !ctx.bag.isOpen) {
  if (open && (ctx.scene.chatOpen || ctx.scene.menu || ctx.shop.isOpen())) {
    return;
  }
  ctx.bag.toggle(open);
}

/** Close the bag, the pickup grid, and the shop panel. @param {Context} ctx */
function closePanels(ctx) {
  ctx.bag.toggle(false);
  closePickupGrid(ctx.pickupGrid);
  ctx.shop.close();
}

/** Show the Escape menu's first page. @param {Context} ctx */
function showMenu(ctx) {
  ctx.scene.menu = true;
  ctx.scene.menuPage = "root";
  ctx.nav.reset();
}

/** Close the Escape menu and return to the world. @param {Context} ctx */
export function closeMenu(ctx) {
  ctx.scene.menu = false;
  ctx.scene.menuPage = "root";
}

/**
 * Opens or closes the menu. It replaces an open panel, and a second press
 * closes it. @param {Context} ctx
 */
export function toggleMenu(ctx) {
  closePanels(ctx);
  if (ctx.scene.menu) closeMenu(ctx);
  else showMenu(ctx);
}

/** Y or the bag button: the bag replaces the open menu or panel, and a second press closes it. @param {Context} ctx */
export function replaceWithBag(ctx) {
  if (ctx.bag.isOpen) return ctx.bag.toggle(false);
  if (ctx.scene.chatOpen) return;
  closePanels(ctx);
  closeMenu(ctx);
  ctx.bag.toggle(true);
}

/**
 * Back: go up one level. Settings returns to the Escape menu with its row
 * still selected, and every outermost level returns to the world. With no menu
 * open, the hearing log closes before the Escape menu opens.
 * @param {Context} ctx
 */
export function goBack(ctx) {
  const level = openLevel(ctx);
  if (level === null) {
    if (ctx.ui.logOpen) toggleLog(ctx, false);
    else toggleMenu(ctx);
    return;
  }
  const parent = parentLevel(level);
  if (parent === "menu") ctx.scene.menuPage = "root";
  else if (parent === "shop") ctx.shop.back();
  else {
    closePanels(ctx);
    closeMenu(ctx);
  }
}

/** The row names of the open Escape menu page. @param {Context} ctx */
function menuRows(ctx) {
  return ctx.scene.menuPage === "settings" ? SETTINGS_ROWS : MENU_ROWS;
}

/** The selected row of the open Escape menu page. @param {Context} ctx */
export function menuRow(ctx) {
  const page = ctx.scene.menuPage === "settings" ? "settings" : "menu";
  return menuRows(ctx)[ctx.nav.rows[page]] ?? "";
}

/** Move the selection of the Escape menu: up and down pick a row; on Settings, left and right change its value. @param {Context} ctx @param {number} dx @param {number} dy @param {(id:string)=>void} press presses a menu button by id */
export function menuStep(ctx, dx, dy, press) {
  const page = ctx.scene.menuPage === "settings" ? "settings" : "menu";
  const rows = menuRows(ctx);
  if (dy) ctx.nav.rows[page] = stepRow(ctx.nav.rows[page], rows.length, dy);
  else if (dx && page === "settings") {
    const change = settingsChanges(
      {
        sizes: TEXT_SIZES,
        voices: VOICES_LEVELS,
        music: MUSIC_LEVELS,
        effects: EFFECTS_LEVELS,
      },
      {
        size: ctx.scene.textSize,
        voices: ctx.chatter.level,
        music: ctx.music.level,
        effects: ctx.sfx.level,
      },
    )[menuRow(ctx)];
    const id = change?.(dx);
    if (id) press(id);
  }
}

/** Confirm on the Escape menu: choose the selected row. Value rows change with left and right, so confirm only acts on buttons. @param {Context} ctx @param {(id:string)=>void} press */
export function menuConfirm(ctx, press) {
  const row = menuRow(ctx);
  if (["resume", "settings", "leave", "back"].includes(row)) {
    press(`btn:${row}`);
  }
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

/** Each frame: close the trader conversation when the player is out of range of the NPC being talked to, as the pickup grid closes out of reach. @param {Context} ctx */
export function updateShopReach(ctx) {
  if (!ctx.shop.isOpen()) return;
  const { scene } = ctx;
  const player = scene.world.players[scene.localId];
  const npc = ctx.shop.npc;
  if (!player || !npc || !reachesTrader(scene.world, player, npc.id)) {
    ctx.shop.close();
  }
}

/**
 * Each frame: close the grid when the entity leaves reach or the tile empties,
 * move the selector with IJKL, the look stick, or the D-pad (the gamepad stick by the stick step rule), and compute the
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
    : stickDirection(ctx.cameraStick.x, ctx.cameraStick.y, 0.5);
  stepPickupSelection(pickupGrid, stacks.length, direction, now);
  // The gamepad look stick follows the shared stick step rule.
  const step = pickupGrid.stick.update(
    stickDirection(ctx.gamepadCamera.x, ctx.gamepadCamera.y, 0.5),
    now,
  );
  if (step) {
    moveSelection(pickupGrid, stacks.length, step.x, step.y);
  }
  scene.pickupCells = scene.viewZ === pickupGrid.tile?.z && player
    ? pickupGridCells(pickupGrid, stacks, gridCenter(player), now)
    : [];
}

/** @type {Record<string,[number,number]>} */
const GRID_KEYS = { KeyI: [0, -1], KeyK: [0, 1], KeyJ: [-1, 0], KeyL: [1, 0] };

/** IJKL moves the selector, with the browser's key repeat for a held key. @param {Context} ctx @param {string} code @param {boolean} repeat */
export function gridKey(ctx, code, repeat) {
  const step = GRID_KEYS[code];
  if (!step || !isPickupGridOpen(ctx.pickupGrid)) return;
  if (repeat && ctx.gridKeysAtOpen.has(code)) return;
  moveSelection(ctx.pickupGrid, pickupGridStacks(ctx).length, step[0], step[1]);
}

/** A tap on a square selects it. @param {Context} ctx @param {number} clientX @param {number} clientY */
export function tapPickupGrid(ctx, clientX, clientY) {
  const { scene } = ctx;
  if (!isPickupGridOpen(ctx.pickupGrid)) return;
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
