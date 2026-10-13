// @ts-check
// Host to guest: dropped items, the inventory and the held item. Each decoder returns null for anything malformed.

import { counter, finite, MAX_COORD, record } from "./wire-parse.js";
import { WORLD_TOP } from "./terrain.js";
import { isItemKind, MAX_STACK_COUNT } from "./items.js";

/** Most stacks one tile or one inventory may carry in a message: one per item kind. */
const MAX_STACKS = 16;
/** Most tiles one dropped item message may carry. */
const MAX_ITEM_ENTRIES = 1024;

/** @param {unknown} value @returns {import('./items.js').Stack[]|null} */
function decodeStacks(value) {
  if (!Array.isArray(value) || value.length > MAX_STACKS) return null;
  /** @type {import('./items.js').Stack[]} */
  const stacks = [];
  for (const stack of value) {
    if (
      !record(stack) || !isItemKind(stack.kind) ||
      !counter(stack.count, MAX_STACK_COUNT) || stack.count < 1 ||
      stacks.some((other) => other.kind === stack.kind)
    ) return null;
    stacks.push({
      kind: /** @type {string} */ (stack.kind),
      count: stack.count,
    });
  }
  return stacks;
}

/**
 * Host to guest: the dropped items on the tiles the guest can see, replacing
 * the earlier list. Returns null for anything malformed.
 * @param {unknown} value @returns {import('./items.js').DroppedEntry[]|null}
 */
export function decodeItems(value) {
  if (
    !record(value) || value.type !== "items" || !Array.isArray(value.entries) ||
    value.entries.length > MAX_ITEM_ENTRIES
  ) return null;
  /** @type {import('./items.js').DroppedEntry[]} */
  const entries = [];
  for (const entry of value.entries) {
    if (
      !record(entry) || !Number.isInteger(entry.x) ||
      !finite(entry.x, -MAX_COORD, MAX_COORD) || !Number.isInteger(entry.y) ||
      !finite(entry.y, -MAX_COORD, MAX_COORD) || !Number.isInteger(entry.z) ||
      !finite(entry.z, 0, WORLD_TOP)
    ) return null;
    const stacks = decodeStacks(entry.stacks);
    if (!stacks || !stacks.length) return null;
    entries.push({ x: entry.x, y: entry.y, z: entry.z, stacks });
  }
  return entries;
}

/**
 * Host to its owner only: an entity's inventory. Returns null for anything
 * malformed.
 * @param {unknown} value @returns {import('./items.js').Stack[]|null}
 */
export function decodeInventory(value) {
  if (!record(value) || value.type !== "inventory") return null;
  return decodeStacks(value.stacks);
}

/**
 * Host to its owner only: the item kind the entity holds. Returns null for
 * anything malformed.
 * @param {unknown} value @returns {string|null}
 */
export function decodeHeld(value) {
  if (!record(value) || value.type !== "held") return null;
  return isItemKind(value.kind) ? /** @type {string} */ (value.kind) : null;
}
