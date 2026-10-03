// @ts-check

import {
  addStack,
  COIN,
  inPickupReach,
  inventoryOf,
  itemInfo,
  MAX_STACK_COUNT,
} from "./items.js";
import { SHOPKEEPER_TILE } from "./spawn-room.js";

/**
 * The shop. The shopkeeper buys ore at fixed prices and pays in coins, which
 * are an item kind and the player's score. It sells nothing yet. The world
 * host checks every sale: a guest only names an item kind and a count.
 */

/** @typedef {import('./items.js').Stack} Stack */
/** @typedef {import('./world.js').World} World */

/**
 * Coins paid for one item of each sellable kind. Every other kind (stone, the
 * pickaxe, coins) cannot be sold.
 * @type {Readonly<Record<string,number>>}
 */
export const PRICES = Object.freeze({
  "coal": 1,
  "iron ore": 3,
  "lapis": 4,
  "redstone": 4,
  "gold ore": 8,
  "emerald": 15,
  "diamond": 20,
});

/** The tile the shopkeeper stands on, in the spawn room layout only. */
export const SHOP_TILE = SHOPKEEPER_TILE;

/** The most one sale request may name, so a message stays small. */
export const MAX_SALE_COUNT = MAX_STACK_COUNT;

/** @param {unknown} kind @returns {number} the unit price, or 0 when the kind cannot be sold */
export function priceOf(kind) {
  return typeof kind === "string" && Object.hasOwn(PRICES, kind)
    ? PRICES[kind]
    : 0;
}

/** @param {unknown} kind */
export function isSellable(kind) {
  return priceOf(kind) > 0;
}

/** The coins in an inventory, which is the score. @param {readonly Stack[]} stacks */
export function coinsIn(stacks) {
  return stacks.find((stack) => stack.kind === COIN)?.count ?? 0;
}

/** @param {number} count */
function coinsText(count) {
  return `${count} coin${count === 1 ? "" : "s"}`;
}

/**
 * The system line for a sale, such as "Sold coal ×3 for 3 coins".
 * @param {{kind:string,count:number}[]} sold @param {number} coins
 */
export function saleLine(sold, coins) {
  if (sold.length === 1) {
    const [{ kind, count }] = sold;
    return `Sold ${itemInfo(kind)?.name ?? kind} ×${count} for ${
      coinsText(coins)
    }`;
  }
  return `Sold ${sold.reduce((sum, entry) => sum + entry.count, 0)} ore for ${
    coinsText(coins)
  }`;
}

/**
 * @typedef {{kind:string,count:number}|{all:true}} SaleRequest
 * A sale of `count` items of one kind, or of every sellable item.
 */
/**
 * @typedef {{ok:true,sold:{kind:string,count:number}[],coins:number,line:string}|{ok:false,reason:string}} SaleResult
 */

/**
 * Sell items from an entity's inventory to the shopkeeper, on the world host.
 * The host checks the entity, its reach to the shopkeeper's tile, the kind's
 * price, and that the inventory holds the count. A sale changes nothing unless
 * it passes every check. Coins join the inventory's coin stack.
 * @param {World} world @param {string} playerId @param {unknown} request @returns {SaleResult}
 */
export function sellItems(world, playerId, request) {
  const player = world.players[playerId];
  if (!player) return { ok: false, reason: "unknown player" };
  if (!inPickupReach(player, SHOP_TILE)) {
    return { ok: false, reason: "too far from the shopkeeper" };
  }
  const inventory = inventoryOf(player);
  /** @type {{kind:string,count:number}[]} */
  let lots;
  const asked = /** @type {{all?:unknown,kind?:unknown,count?:unknown}} */ (
    request ?? {}
  );
  if (asked.all === true) {
    lots = inventory.filter((stack) => isSellable(stack.kind)).map((
      { kind, count },
    ) => ({ kind, count }));
    if (!lots.length) return { ok: false, reason: "nothing to sell" };
  } else {
    const { kind, count } = asked;
    if (typeof kind !== "string" || !itemInfo(kind)) {
      return { ok: false, reason: "unknown item" };
    }
    if (!isSellable(kind)) {
      return { ok: false, reason: `the shopkeeper does not buy ${kind}` };
    }
    if (!Number.isInteger(count) || /** @type {number} */ (count) < 1) {
      return { ok: false, reason: "invalid count" };
    }
    const have = inventory.find((stack) => stack.kind === kind)?.count ?? 0;
    if (have < /** @type {number} */ (count)) {
      return { ok: false, reason: `you do not have ${count} ${kind}` };
    }
    lots = [{ kind, count: /** @type {number} */ (count) }];
  }
  const coins = lots.reduce(
    (sum, lot) => sum + priceOf(lot.kind) * lot.count,
    0,
  );
  // Check room first so a full coin stack leaves the inventory unchanged.
  if (coinsIn(inventory) + coins > MAX_STACK_COUNT) {
    return { ok: false, reason: "too many coins" };
  }
  for (const { kind, count } of lots) {
    const index = inventory.findIndex((stack) => stack.kind === kind);
    inventory[index].count -= count;
    if (inventory[index].count < 1) inventory.splice(index, 1);
  }
  addStack(inventory, COIN, coins);
  return { ok: true, sold: lots, coins, line: saleLine(lots, coins) };
}

/**
 * A row of the shop panel: a stack with its unit price, or the sell all row.
 * @typedef {{type:"all",coins:number,count:number,enabled:boolean}|{type:"stack",kind:string,count:number,price:number,enabled:boolean}} ShopRow
 */

/**
 * The panel's rows for an inventory: "Sell all ore" first, then every stack in
 * inventory order. Stacks the shopkeeper does not buy are present but disabled
 * (shown dimmed, skipped by the selection).
 * @param {readonly Stack[]} stacks @returns {ShopRow[]}
 */
export function shopRows(stacks) {
  const sellable = stacks.filter((stack) => isSellable(stack.kind));
  return [
    {
      type: "all",
      count: sellable.reduce((sum, stack) => sum + stack.count, 0),
      coins: sellable.reduce(
        (sum, stack) => sum + stack.count * priceOf(stack.kind),
        0,
      ),
      enabled: sellable.length > 0,
    },
    ...stacks.map((stack) => /** @type {ShopRow} */ ({
      type: "stack",
      kind: stack.kind,
      count: stack.count,
      price: priceOf(stack.kind),
      enabled: isSellable(stack.kind),
    })),
  ];
}

/** The sale request a row makes. @param {ShopRow} row @returns {SaleRequest} */
export function rowRequest(row) {
  return row.type === "all"
    ? { all: true }
    : { kind: row.kind, count: row.count };
}
