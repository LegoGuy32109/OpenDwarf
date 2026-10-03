// @ts-check

import { rowRequest, shopRows } from "../shared/shop.js";

/** @typedef {import('../shared/items.js').Stack} Stack */
/** @typedef {import('../shared/shop.js').ShopRow} ShopRow */
/** @typedef {import('../shared/shop.js').SaleRequest} SaleRequest */

/** Milliseconds before a held direction moves the selection again. */
const REPEAT_FIRST_MS = 350;
const REPEAT_MS = 150;

/**
 * The shop panel's state: sellable stacks with unit price and count, and a
 * "Sell all ore" row. Stacks the shopkeeper does not buy show dimmed and the
 * selection skips them. IJKL, the look stick, or the D-pad move the selection
 * through `steer`; interact confirms through `confirm`; a tap on a row sells
 * it. The panel only asks: the world host decides every sale. The UI layer
 * (`ui.js`) lays the rows out and draws them.
 * @param {object} options
 * @param {(request:SaleRequest)=>void} options.sell asks the world host for a sale
 * @param {(text:string)=>void} options.flash
 */
export function createShopPanel({ sell, flash }) {
  /** @type {ShopRow[]} */
  let rows = [];
  /** The selected row's identity, so a changed inventory keeps the selection. */
  let selectedKey = "";
  let open = false;
  let heldDirection = 0;
  let nextRepeat = 0;
  /** The first row shown, and how many rows fit. The UI layer reports the capacity. */
  let scroll = 0;
  let capacity = 1;

  /** @param {ShopRow} row */
  const keyOf = (row) => row.type === "all" ? "all" : row.kind;

  function selectedIndex() {
    return rows.findIndex((row) => keyOf(row) === selectedKey && row.enabled);
  }

  /** Keep the selection on a row that can be sold, the first one when it is gone. */
  function settleSelection() {
    if (selectedIndex() >= 0) return;
    const first = rows.find((row) => row.enabled);
    selectedKey = first ? keyOf(first) : "";
  }

  /** Scroll so the selected row shows. */
  function reveal() {
    const at = rows.findIndex((row) => keyOf(row) === selectedKey);
    if (at < 0) return;
    if (at < scroll) scroll = at;
    else if (at >= scroll + capacity) scroll = at - capacity + 1;
    scroll = Math.max(0, Math.min(scroll, Math.max(0, rows.length - capacity)));
  }

  /** @param {number} step -1 for up, 1 for down */
  function move(step) {
    const enabled = rows.filter((row) => row.enabled);
    if (!enabled.length) return;
    const at = enabled.findIndex((row) => keyOf(row) === selectedKey);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    selectedKey = keyOf(next);
    reveal();
  }

  function confirm() {
    const row = rows[selectedIndex()];
    if (!row) {
      flash("Nothing to sell");
      return;
    }
    sell(rowRequest(row));
  }

  return {
    isOpen: () => open,
    /**
     * Show the panel. A direction already held (an aim that opened it) does
     * not move the selection until it is released.
     * @param {number} [direction]
     */
    open(direction = 0) {
      open = true;
      heldDirection = direction;
      nextRepeat = Infinity;
      selectedKey = "";
      scroll = 0;
      settleSelection();
    },
    close() {
      open = false;
    },
    /** Take the player's current inventory. @param {readonly Stack[]} inventory */
    update(inventory) {
      rows = shopRows(inventory.map(({ kind, count }) => ({ kind, count })));
      if (!open) return;
      settleSelection();
      reveal();
    },
    move,
    confirm,
    /**
     * A tap on a row: sell it when the shopkeeper buys it. @param {string} name
     */
    tapRow(name) {
      const row = rows.find((candidate) => keyOf(candidate) === name);
      if (!row) return;
      if (!row.enabled) {
        flash("The shopkeeper does not buy that");
        return;
      }
      selectedKey = keyOf(row);
      confirm();
    },
    /** The UI layer's row capacity, so the selection can scroll into view. @param {number} rowsShown */
    fit(rowsShown) {
      capacity = Math.max(1, rowsShown);
      reveal();
    },
    /** Scroll by whole rows from a drag or the wheel. @param {number} step */
    scrollBy(step) {
      scroll = Math.max(
        0,
        Math.min(scroll + step, Math.max(0, rows.length - capacity)),
      );
    },
    get rows() {
      return rows;
    },
    get selected() {
      return selectedIndex() >= 0 ? selectedKey : "";
    },
    get scroll() {
      return scroll;
    },
    /**
     * Feed the combined up/down input every frame: -1 up, 1 down, 0 none. A
     * new direction moves at once, and a held one repeats.
     * @param {number} direction @param {number} now
     */
    steer(direction, now) {
      if (!open || !direction) {
        heldDirection = 0;
        return;
      }
      if (direction !== heldDirection) {
        heldDirection = direction;
        nextRepeat = now + REPEAT_FIRST_MS;
        move(direction);
      } else if (now >= nextRepeat) {
        nextRepeat = now + REPEAT_MS;
        move(direction);
      }
    },
  };
}
