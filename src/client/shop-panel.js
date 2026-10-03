// @ts-check

import { itemInfo } from "../shared/items.js";
import { rowRequest, shopRows } from "../shared/shop.js";

/** @typedef {import('../shared/items.js').Stack} Stack */
/** @typedef {import('../shared/shop.js').ShopRow} ShopRow */
/** @typedef {import('../shared/shop.js').SaleRequest} SaleRequest */

/** Milliseconds before a held direction moves the selection again. */
const REPEAT_FIRST_MS = 350;
const REPEAT_MS = 150;

/**
 * An element made from a tag, with a class and children.
 * @param {string} tag @param {string} className @param {(Node|string)[]} [children]
 */
function el(tag, className, children = []) {
  const node = document.createElement(tag);
  node.className = className;
  node.append(...children);
  return node;
}

/** The icon of an item kind, drawn from the item sprite sheet. @param {string} kind */
function icon(kind) {
  const node = el("span", "shop-icon");
  node.style.setProperty("--frame", String(itemInfo(kind)?.frame ?? 0));
  node.setAttribute("aria-hidden", "true");
  return node;
}

/**
 * The shop panel: sellable stacks with unit price and count, and a "Sell all
 * ore" row. Stacks the shopkeeper does not buy show dimmed and the selection
 * skips them. IJKL, the look stick, or the D-pad move the selection through
 * `steer`; interact confirms through `confirm`; a tap on a row sells it. The
 * panel only asks: the world host decides every sale.
 * @param {object} options
 * @param {HTMLElement} options.root where the panel goes
 * @param {(request:SaleRequest)=>void} options.sell asks the world host for a sale
 * @param {(text:string)=>void} options.flash
 */
export function createShopPanel({ root, sell, flash }) {
  const list = el("ul", "shop-rows");
  const close = el("button", "shop-close", ["×"]);
  close.setAttribute("type", "button");
  close.setAttribute("aria-label", "Close shop");
  const panel = el("aside", "", [
    el("header", "", [el("h2", "", ["Shopkeeper buys"]), close]),
    list,
    el("footer", "", ["IJKL or D-pad: choose · Interact: sell"]),
  ]);
  panel.id = "shop-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Shop");
  panel.hidden = true;
  root.append(panel);

  /** @type {Stack[]} */
  let stacks = [];
  /** @type {ShopRow[]} */
  let rows = [];
  /** The selected row's identity, so a changed inventory keeps the selection. */
  let selectedKey = "";
  let drawn = "";
  let open = false;
  let heldDirection = 0;
  let nextRepeat = 0;

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

  function draw() {
    const signature = JSON.stringify([rows, selectedKey]);
    if (signature === drawn) return;
    drawn = signature;
    list.replaceChildren(...rows.map((row) => {
      const button = el("button", "shop-row");
      button.setAttribute("type", "button");
      const selected = row.enabled && keyOf(row) === selectedKey;
      button.classList.toggle("selected", selected);
      button.classList.toggle("dimmed", !row.enabled);
      button.setAttribute("aria-disabled", String(!row.enabled));
      button.setAttribute("aria-current", String(selected));
      button.dataset.row = keyOf(row);
      if (row.type === "all") {
        button.append(
          el("span", "shop-name", ["Sell all ore"]),
          el("span", "shop-count", row.enabled ? [`×${row.count}`] : []),
          el("span", "shop-price", [
            row.enabled
              ? `${row.coins} coin${row.coins === 1 ? "" : "s"}`
              : "no ore",
          ]),
        );
      } else {
        button.append(
          icon(row.kind),
          el("span", "shop-name", [itemInfo(row.kind)?.name ?? row.kind]),
          el("span", "shop-count", [`×${row.count}`]),
          el("span", "shop-price", [
            row.enabled ? `${row.price} each` : "not bought",
          ]),
        );
      }
      button.addEventListener("click", () => {
        if (!row.enabled) {
          flash("The shopkeeper does not buy that");
          return;
        }
        selectedKey = keyOf(row);
        confirm();
      });
      const item = el("li", "", [button]);
      return item;
    }));
    list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  }

  /** @param {number} step -1 for up, 1 for down */
  function move(step) {
    const enabled = rows.filter((row) => row.enabled);
    if (!enabled.length) return;
    const at = enabled.findIndex((row) => keyOf(row) === selectedKey);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    selectedKey = keyOf(next);
    draw();
  }

  function confirm() {
    const row = rows[selectedIndex()];
    if (!row) {
      flash("Nothing to sell");
      return;
    }
    sell(rowRequest(row));
  }

  close.addEventListener("click", () => api.close());

  const api = {
    isOpen: () => open,
    /**
     * Show the panel. A direction already held (an aim that opened it) does
     * not move the selection until it is released.
     * @param {number} [direction]
     */
    open(direction = 0) {
      open = true;
      panel.hidden = false;
      heldDirection = direction;
      nextRepeat = Infinity;
      selectedKey = "";
      settleSelection();
      drawn = "";
      draw();
    },
    close() {
      open = false;
      panel.hidden = true;
    },
    /** Redraw for the player's current inventory. @param {readonly Stack[]} inventory */
    update(inventory) {
      stacks = inventory.map(({ kind, count }) => ({ kind, count }));
      rows = shopRows(stacks);
      if (!open) return;
      settleSelection();
      draw();
    },
    move,
    confirm,
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
  return api;
}
