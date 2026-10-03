// @ts-check

import { centerTile } from "./locomotion.js";
import { WORLD_TOP } from "./terrain.js";

/**
 * Items. An item kind names a type of item. A stack holds items of one kind
 * with a count. Two places hold stacks:
 *
 * - A **dropped item** list lies on a whole tile. It holds one stack per kind,
 *   in the order the kinds first landed, and the world host keeps it in
 *   `droppedItems(world)`.
 * - An **inventory** belongs to one entity (`inventoryOf(player)`). It also
 *   holds one stack per kind, in the order the kinds were first picked up.
 *
 * Both are plain `Stack[]` lists that `addStack` and `takeStack` change, so a
 * pickup grid (#18), an inventory panel (#19), and a shop (#20) read and move
 * stacks without any new storage. Only the world host changes them.
 */

/**
 * @typedef {object} Stack
 * @property {string} kind an item kind from `ITEM_KINDS`
 * @property {number} count how many items, from 1 to `MAX_STACK_COUNT`
 */
/** @typedef {{x:number,y:number,z:number}} Tile */
/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {Tile & {stacks:Stack[]}} DroppedEntry the stacks that lie on one tile */

export const STONE_ITEM = "stone";
export const COIN = "coin";
/** The item kind that lets an entity mine while it is held. */
export const PICKAXE = "pickaxe";

/**
 * Every item kind with its row in the item sprite sheet `public/assets/items.png`.
 * The sheet is one column of 16×16 frames; `frame` counts down from the top
 * and `ITEM_FRAMES` is the frame count. `scripts/make-item-sheet.ts` draws it.
 * Add new kinds at the end, because the frames and the wire use them.
 * @typedef {{kind:string,name:string,frame:number}} ItemInfo
 * @type {readonly ItemInfo[]}
 */
export const ITEM_KINDS = Object.freeze([
  { kind: STONE_ITEM, name: "stone", frame: 0 },
  { kind: "coal", name: "coal", frame: 1 },
  { kind: "iron ore", name: "iron ore", frame: 2 },
  { kind: "gold ore", name: "gold ore", frame: 3 },
  { kind: "lapis", name: "lapis", frame: 4 },
  { kind: "redstone", name: "redstone", frame: 5 },
  { kind: "diamond", name: "diamond", frame: 6 },
  { kind: "emerald", name: "emerald", frame: 7 },
  { kind: COIN, name: "coin", frame: 8 },
  { kind: PICKAXE, name: "pickaxe", frame: 9 },
]);

/** Number of 16×16 frames in the item sprite sheet. */
export const ITEM_FRAMES = ITEM_KINDS.length;

/** The most items one stack holds. */
export const MAX_STACK_COUNT = 9999;

/** Milliseconds each kind shows while several kinds share a tile. */
export const ICON_CYCLE_MS = 1000;

/** @param {unknown} kind @returns {ItemInfo|null} */
export function itemInfo(kind) {
  return ITEM_KINDS.find((info) => info.kind === kind) ?? null;
}

/** @param {unknown} kind */
export function isItemKind(kind) {
  return itemInfo(kind) !== null;
}

/**
 * Add `count` items to a stack list, merging with the stack of the same kind.
 * Returns false and changes nothing for an unknown kind, a count that is not a
 * positive whole number, or a stack that would pass `MAX_STACK_COUNT`.
 * @param {Stack[]} stacks @param {string} kind @param {number} [count]
 */
export function addStack(stacks, kind, count = 1) {
  if (!isItemKind(kind) || !Number.isInteger(count) || count < 1) return false;
  const stack = stacks.find((entry) => entry.kind === kind);
  if (stack) {
    if (stack.count + count > MAX_STACK_COUNT) return false;
    stack.count += count;
  } else if (count > MAX_STACK_COUNT) return false;
  else stacks.push({ kind, count });
  return true;
}

/**
 * Remove a whole stack from a list and return it, or null when the index holds
 * none.
 * @param {Stack[]} stacks @param {number} index
 */
export function takeStack(stacks, index) {
  if (!Number.isInteger(index) || index < 0 || index >= stacks.length) {
    return null;
  }
  return stacks.splice(index, 1)[0];
}

/** @param {Stack[]} stacks @returns {Stack[]} */
export function copyStacks(stacks) {
  return stacks.map(({ kind, count }) => ({ kind, count }));
}

/**
 * The stack an interact picks up: the first one on the tile. #18 replaces this
 * with the pickup grid's choice.
 * @param {Stack[]} stacks
 */
export function firstStackIndex(stacks) {
  return stacks.length ? 0 : -1;
}

/**
 * The index into a tile's stacks that its icon shows at `nowMs`. Kinds take
 * turns, `ICON_CYCLE_MS` each; one kind always shows.
 * @param {number} stackCount @param {number} nowMs
 */
export function cycleIndex(stackCount, nowMs) {
  if (stackCount <= 1) return 0;
  return Math.floor(nowMs / ICON_CYCLE_MS) % stackCount;
}

/** @typedef {Player & {inventory?:Stack[]}} Carrier */

/**
 * An entity's inventory. A new one holds one pickaxe, which the entity holds
 * (`heldItem` in `mining.js`). It is made on first use, so every entity that
 * the world host adds has it.
 * @param {Player} player @returns {Stack[]}
 */
export function inventoryOf(player) {
  const carrier = /** @type {Carrier} */ (player);
  carrier.inventory ??= [{ kind: PICKAXE, count: 1 }];
  return carrier.inventory;
}

/** @param {Tile} tile */
function tileKey(tile) {
  return `${tile.x},${tile.y},${tile.z}`;
}

/**
 * @typedef {object} DroppedStore
 * @property {Map<string,DroppedEntry>} tiles
 * @property {number} version raised on every change, so a sender can skip unchanged lists
 */

/** @type {WeakMap<World,DroppedStore>} */
const stores = new WeakMap();

/** The host's dropped items, by tile. Items stay until picked up or the session ends. @param {World} world */
export function droppedItems(world) {
  let store = stores.get(world);
  if (!store) {
    store = { tiles: new Map(), version: 0 };
    stores.set(world, store);
  }
  return store;
}

/** The stacks on a tile, or an empty list. The list is the live one: copy it before keeping it. @param {World} world @param {Tile} tile @returns {Stack[]} */
export function droppedAt(world, tile) {
  return droppedItems(world).tiles.get(tileKey(tile))?.stacks ?? [];
}

/**
 * Drop items on a tile. Items of one kind on a tile merge into one stack.
 * @param {World} world @param {Tile} tile @param {string} kind @param {number} [count]
 */
export function dropItem(world, tile, kind, count = 1) {
  const store = droppedItems(world);
  const key = tileKey(tile);
  const entry = store.tiles.get(key) ??
    { x: tile.x, y: tile.y, z: tile.z, stacks: [] };
  if (!addStack(entry.stacks, kind, count)) return false;
  store.tiles.set(key, entry);
  store.version++;
  return true;
}

/**
 * Reach rule for a pickup: the tile lies on the entity's level, and is its own
 * tile or one of the eight around it.
 * @param {Player} player @param {Tile} tile
 */
export function inPickupReach(player, tile) {
  return tile.z === player.z &&
    Math.abs(tile.x - centerTile(player.x)) <= 1 &&
    Math.abs(tile.y - centerTile(player.y)) <= 1;
}

/** @typedef {{ok:true,kind:string,count:number}|{ok:false,reason:string}} PickupResult */

/**
 * Pick up a whole stack from a tile into an entity's inventory, on the world
 * host. The host checks the entity, the tile, and reach; a guest only names the
 * tile it aimed at. The host handles requests one at a time, so when two
 * entities ask for one stack, the first request gets it and the second one is
 * refused with "nothing to pick up".
 * @param {World} world @param {string} playerId @param {Tile} tile @returns {PickupResult}
 */
export function pickUp(world, playerId, tile) {
  const player = world.players[playerId];
  if (!player) return { ok: false, reason: "unknown player" };
  if (
    !Number.isInteger(tile.x) || !Number.isInteger(tile.y) ||
    !Number.isInteger(tile.z) || tile.z < 0 || tile.z > WORLD_TOP
  ) return { ok: false, reason: "invalid tile" };
  if (!inPickupReach(player, tile)) {
    return {
      ok: false,
      reason: tile.z !== player.z ? "not on your level" : "out of reach",
    };
  }
  const store = droppedItems(world);
  const key = tileKey(tile);
  const entry = store.tiles.get(key);
  const index = entry ? firstStackIndex(entry.stacks) : -1;
  if (!entry || index < 0) return { ok: false, reason: "nothing to pick up" };
  const stack = entry.stacks[index];
  // Check room first so a full inventory stack leaves the dropped stack in place.
  if (!addStack(inventoryOf(player), stack.kind, stack.count)) {
    return { ok: false, reason: "inventory is full" };
  }
  entry.stacks.splice(index, 1);
  if (!entry.stacks.length) store.tiles.delete(key);
  store.version++;
  return { ok: true, kind: stack.kind, count: stack.count };
}

/** The system line for a pickup, such as "Picked up coal ×1". @param {string} kind @param {number} count */
export function pickupLine(kind, count) {
  return `Picked up ${itemInfo(kind)?.name ?? kind} ×${count}`;
}

/** Every tile's stacks as wire entries. The lists are copies. @param {World} world @returns {DroppedEntry[]} */
export function droppedEntries(world) {
  return [...droppedItems(world).tiles.values()].map((entry) => ({
    x: entry.x,
    y: entry.y,
    z: entry.z,
    stacks: copyStacks(entry.stacks),
  }));
}
