// @ts-check

import { centerTile } from "../shared/locomotion.js";
import { inPickupReach, itemInfo } from "../shared/items.js";

/**
 * The pickup grid: when an entity interacts with a tile that holds several
 * stacks, dark squares unfold from that tile into the 3×3 tiles around the
 * entity, one square per stack. The state lives here, and the drawing in
 * `render.js` reads the squares from `pickupGridCells`. The world host still
 * decides every pickup; the grid only chooses which stack to ask for.
 */

/** @typedef {import('../shared/items.js').Stack} Stack */
/** @typedef {{x:number,y:number,z:number}} Tile */
/** @typedef {import('../shared/world.js').Player} Player */

/** Tile size in world pixels, the same as the renderer's. */
const TILE = 64;
/** Squares per row and per column. */
export const GRID_SIDE = 3;
/** Squares one screen of the grid holds. */
export const GRID_CELLS = GRID_SIDE * GRID_SIDE;
/** How long the squares take to unfold from the tile. */
export const UNFOLD_MS = 240;
/** The first repeat of a held direction waits this long, then repeats at the second rate. */
const REPEAT_DELAY_MS = 350;
const REPEAT_MS = 130;
/** A guest hides a stack it asked for until the world host's list catches up. */
const REQUEST_HIDE_MS = 1500;

/**
 * @typedef {object} PickupGrid
 * @property {Tile|null} tile the tile whose stacks the grid shows; null when closed
 * @property {number} selected index of the selected stack
 * @property {number} top first visible row of squares
 * @property {number} openedAt when the grid opened, for the unfold animation
 * @property {string} heldDirection the selection direction currently held, as "dx,dy"
 * @property {boolean} waitForRelease true after opening, until the look control returns to neutral, so the aim that opened the grid does not move the selector
 * @property {number} nextRepeat when a held direction moves the selection again
 * @property {Map<string,number>} requested kinds a guest asked for, with the time
 */

/** @returns {PickupGrid} */
export function createPickupGrid() {
  return {
    tile: null,
    selected: 0,
    top: 0,
    openedAt: 0,
    heldDirection: "",
    waitForRelease: false,
    nextRepeat: 0,
    requested: new Map(),
  };
}

/** @param {PickupGrid} grid */
export function isPickupGridOpen(grid) {
  return grid.tile !== null;
}

/** @param {PickupGrid} grid @param {Tile} tile @param {number} now */
export function openPickupGrid(grid, tile, now) {
  grid.tile = { x: tile.x, y: tile.y, z: tile.z };
  grid.selected = 0;
  grid.top = 0;
  grid.openedAt = now;
  grid.heldDirection = "";
  grid.waitForRelease = true;
  grid.requested.clear();
}

/** @param {PickupGrid} grid */
export function closePickupGrid(grid) {
  grid.tile = null;
  grid.requested.clear();
}

/** @param {number} count */
function rowCount(count) {
  return Math.ceil(count / GRID_SIDE);
}

/** Move the scroll so the selected row shows. @param {PickupGrid} grid @param {number} count */
function scrollToSelection(grid, count) {
  const row = Math.floor(grid.selected / GRID_SIDE);
  if (row < grid.top) grid.top = row;
  else if (row >= grid.top + GRID_SIDE) grid.top = row - GRID_SIDE + 1;
  grid.top = Math.max(
    0,
    Math.min(grid.top, Math.max(0, rowCount(count) - GRID_SIDE)),
  );
}

/**
 * Keep the selection on a stack that exists, such as after another entity took
 * one. @param {PickupGrid} grid @param {number} count
 */
export function clampSelection(grid, count) {
  grid.selected = Math.max(0, Math.min(grid.selected, count - 1));
  scrollToSelection(grid, count);
}

/**
 * Move the selector by one square. Moving down past the third visible row
 * scrolls by a row, and a square in a missing last-row place moves to the last
 * stack. Returns whether the selection changed.
 * @param {PickupGrid} grid @param {number} count @param {number} dx @param {number} dy
 */
export function moveSelection(grid, count, dx, dy) {
  if (count < 1) return false;
  const before = grid.selected;
  const column = Math.max(
    0,
    Math.min(GRID_SIDE - 1, (grid.selected % GRID_SIDE) + Math.sign(dx)),
  );
  const row = Math.max(
    0,
    Math.min(
      rowCount(count) - 1,
      Math.floor(grid.selected / GRID_SIDE) +
        Math.sign(dy),
    ),
  );
  grid.selected = Math.min(count - 1, row * GRID_SIDE + column);
  scrollToSelection(grid, count);
  return grid.selected !== before;
}

/**
 * Move the selector when a direction starts, then again while it stays held.
 * `direction` is the combined IJKL, look stick, or D-pad direction.
 * @param {PickupGrid} grid @param {number} count @param {{x:number,y:number}} direction @param {number} now
 */
export function stepSelection(grid, count, direction, now) {
  const dx = Math.sign(direction.x);
  const dy = Math.sign(direction.y);
  const held = dx || dy ? `${dx},${dy}` : "";
  if (!held) grid.waitForRelease = false;
  if (grid.waitForRelease) return false;
  if (!held) {
    grid.heldDirection = "";
    return false;
  }
  if (held === grid.heldDirection) {
    if (now < grid.nextRepeat) return false;
    grid.nextRepeat = now + REPEAT_MS;
    return moveSelection(grid, count, dx, dy);
  }
  grid.heldDirection = held;
  grid.nextRepeat = now + REPEAT_DELAY_MS;
  return moveSelection(grid, count, dx, dy);
}

/** Select the stack at `index`, such as for a tap. @param {PickupGrid} grid @param {number} count @param {number} index */
export function selectStack(grid, count, index) {
  if (!Number.isInteger(index) || index < 0 || index >= count) return false;
  grid.selected = index;
  scrollToSelection(grid, count);
  return true;
}

/** Remember that a guest asked for a kind, so it hides until the host's list updates. @param {PickupGrid} grid @param {string} kind @param {number} now */
export function markRequested(grid, kind, now) {
  grid.requested.set(kind, now);
}

/**
 * The stacks the grid shows: the tile's stacks without kinds a guest just
 * asked for. @param {PickupGrid} grid @param {Stack[]} stacks @param {number} now
 */
export function shownStacks(grid, stacks, now) {
  if (!grid.requested.size) return stacks;
  for (const [kind, at] of grid.requested) {
    if (now - at > REQUEST_HIDE_MS) grid.requested.delete(kind);
  }
  return stacks.filter((stack) => !grid.requested.has(stack.kind));
}

/**
 * Why the grid must close, or null when it can stay open. The grid closes when
 * the tile no longer holds a stack, or the entity moves out of reach or to
 * another level.
 * @param {PickupGrid} grid @param {Player|undefined} player @param {number} stackCount
 */
export function closeReason(grid, player, stackCount) {
  if (!grid.tile) return null;
  if (!player) return "no entity";
  if (!inPickupReach(player, grid.tile)) return "out of reach";
  if (stackCount < 1) return "nothing left";
  return null;
}

/** The selected stack, or null. @param {PickupGrid} grid @param {Stack[]} stacks */
export function selectedStack(grid, stacks) {
  return stacks[grid.selected] ?? null;
}

/**
 * @typedef {object} GridCell
 * @property {number} index index of the stack in the list
 * @property {number} x left edge in world pixels
 * @property {number} y top edge in world pixels
 * @property {number} size side in world pixels
 * @property {number} alpha 0 to 1 while the square unfolds
 * @property {number} frame the stack's frame in the item sprite sheet
 * @property {number} count the stack's count
 * @property {boolean} selected whether the selector is on this square
 * @property {boolean} more whether more stacks lie below the visible rows (the gray plus)
 */

/** @param {number} t */
function easeOut(t) {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

/**
 * The squares to draw. Each unfolds from the target tile to its place in the
 * 3×3 tiles around the entity, and `index` maps a square back to its stack.
 * The plus marks the bottom-right square when more stacks lie below.
 * @param {PickupGrid} grid @param {Stack[]} stacks
 * @param {{x:number,y:number}} center the entity's tile @param {number} now
 * @returns {GridCell[]}
 */
export function pickupGridCells(grid, stacks, center, now) {
  const tile = grid.tile;
  if (!tile) return [];
  const progress = easeOut(
    Math.max(0, Math.min(1, (now - grid.openedAt) / UNFOLD_MS)),
  );
  const first = grid.top * GRID_SIDE;
  const more = first + GRID_CELLS < stacks.length;
  const full = TILE - 6;
  /** @type {GridCell[]} */
  const cells = [];
  for (let slot = 0; slot < GRID_CELLS; slot++) {
    const index = first + slot;
    const stack = stacks[index];
    const frame = itemInfo(stack?.kind)?.frame;
    if (!stack || frame === undefined) break;
    const column = slot % GRID_SIDE;
    const row = Math.floor(slot / GRID_SIDE);
    const finalX = (center.x - 1 + column) * TILE + 3;
    const finalY = (center.y - 1 + row) * TILE + 3;
    const fromX = tile.x * TILE + TILE / 2;
    const fromY = tile.y * TILE + TILE / 2;
    const size = full * (0.3 + 0.7 * progress);
    cells.push({
      index,
      x: fromX + (finalX + full / 2 - fromX) * progress - size / 2,
      y: fromY + (finalY + full / 2 - fromY) * progress - size / 2,
      size,
      alpha: progress,
      frame,
      count: stack.count,
      selected: index === grid.selected,
      more: more && slot === GRID_CELLS - 1,
    });
  }
  return cells;
}

/** The cell under a world point, or null. @param {GridCell[]} cells @param {number} x @param {number} y */
export function cellAtPoint(cells, x, y) {
  return cells.find((cell) =>
    x >= cell.x && x < cell.x + cell.size && y >= cell.y &&
    y < cell.y + cell.size
  ) ?? null;
}

/** The entity's own tile, where the grid centers. @param {Player} player */
export function gridCenter(player) {
  return { x: centerTile(player.x), y: centerTile(player.y) };
}
