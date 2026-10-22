// @ts-check

import { rowRequest, shopRows } from "../shared/shop.js";
import { TRADER_CHOICES } from "../shared/npc-conversation.js";
import { createStickStepper } from "./stick-step.js";

/** @typedef {import('../shared/items.js').Stack} Stack */
/** @typedef {import('../shared/shop.js').ShopRow} ShopRow */
/** @typedef {import('../shared/shop.js').SaleRequest} SaleRequest */

/** Milliseconds before a held direction moves the selection again. */
const REPEAT_FIRST_MS = 350;
const REPEAT_MS = 150;

/**
 * The trader's panel: a conversation with the NPC, and the item list one level
 * inside it. The conversation lists the lines the player can say; confirming
 * one asks the host to speak it (`talk`), and "I have ore to trade" also opens
 * the item list. Back from the list returns to the conversation with its
 * selection kept. The item list holds sellable stacks with unit price and count, and a
 * "Sell all ore" row. Stacks the shopkeeper does not buy show dimmed and the
 * selection skips them. IJKL, the look stick, or the D-pad move the selection
 * through `steer`; interact confirms through `confirm`; a tap on a row sells
 * it. The panel only asks: the world host decides every sale. The UI layer
 * (`ui.js`) lays the rows out and draws them.
 * @param {object} options
 * @param {(request:SaleRequest)=>void} options.sell asks the world host for a sale
 * @param {(npcId:string,choice:string)=>void} options.talk asks the world host to speak a line
 * @param {(text:string)=>void} options.flash
 * @param {()=>void} [options.onOpenChange] called when the panel opens or closes
 */
export function createShopPanel({ sell, talk, flash, onOpenChange }) {
  /** @type {"conversation"|"items"} */
  let level = "conversation";
  /** The NPC the conversation is with. @type {{id:string,name:string}|null} */
  let npc = null;
  /** The selected conversation choice, kept while the item list is open. */
  let choiceIndex = 0;
  /** @type {ShopRow[]} */
  let rows = [];
  /** The selected row's identity, so a changed inventory keeps the selection. */
  let selectedKey = "";
  let open = false;
  let heldDirection = 0;
  let nextRepeat = 0;
  const stick = createStickStepper();
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
    const talking = level === "conversation";
    const count = talking ? TRADER_CHOICES.length : rows.length;
    const at = talking
      ? choiceIndex
      : rows.findIndex((row) => keyOf(row) === selectedKey);
    if (at < 0) return;
    if (at < scroll) scroll = at;
    else if (at >= scroll + capacity) scroll = at - capacity + 1;
    scroll = Math.max(0, Math.min(scroll, Math.max(0, count - capacity)));
  }

  /** @param {number} step -1 for up, 1 for down */
  function move(step) {
    if (level === "conversation") {
      choiceIndex = (choiceIndex + step + TRADER_CHOICES.length) %
        TRADER_CHOICES.length;
      reveal();
      return;
    }
    const enabled = rows.filter((row) => row.enabled);
    if (!enabled.length) return;
    const at = enabled.findIndex((row) => keyOf(row) === selectedKey);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    selectedKey = keyOf(next);
    reveal();
  }

  /** Open the item list from the conversation, starting at its first row. */
  function openItems() {
    level = "items";
    selectedKey = "";
    scroll = 0;
    settleSelection();
  }

  function close() {
    const wasOpen = open;
    open = false;
    if (wasOpen) onOpenChange?.();
  }

  function confirm() {
    if (level === "conversation") {
      const choice = TRADER_CHOICES[choiceIndex];
      if (npc) talk(npc.id, choice.id);
      if (choice.id === "sell") openItems();
      return;
    }
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
     * Start a conversation with a trader NPC. A direction already held (an aim
     * that opened it) does not move the selection until it is released.
     * @param {number} [direction] @param {{id:string,name:string}} [trader]
     */
    open(direction = 0, trader) {
      const wasOpen = open;
      open = true;
      level = "conversation";
      choiceIndex = 0;
      npc = trader ?? null;
      heldDirection = direction;
      nextRepeat = Infinity;
      stick.releaseFirst();
      selectedKey = "";
      scroll = 0;
      settleSelection();
      if (!wasOpen) onOpenChange?.();
    },
    close,
    /** Back: the item list returns to the conversation, which closes. */
    back() {
      if (level === "items") level = "conversation";
      else close();
    },
    get level() {
      return level;
    },
    /** The NPC being talked to, or null. */
    get npc() {
      return npc;
    },
    /** The conversation's choices, with the selected one marked. */
    get choices() {
      return TRADER_CHOICES.map((choice, index) => ({
        name: `talk:${choice.id}`,
        text: choice.line,
        on: index === choiceIndex,
      }));
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
     * Feed a gamepad stick's up/down input every frame by the shared stick step
     * rule: -1 up, 1 down, 0 none. @param {number} direction @param {number} now
     */
    steerStick(direction, now) {
      const step = stick.update({ x: 0, y: direction }, now);
      if (open && step) move(step.y);
    },
    /**
     * A tap on a row: sell it when the shopkeeper buys it. @param {string} name
     */
    tapRow(name) {
      if (level === "conversation") {
        const index = TRADER_CHOICES.findIndex((choice) =>
          `talk:${choice.id}` === name
        );
        if (index < 0) return;
        choiceIndex = index;
        confirm();
        return;
      }
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
      const count = level === "conversation"
        ? TRADER_CHOICES.length
        : rows.length;
      scroll = Math.max(
        0,
        Math.min(scroll + step, Math.max(0, count - capacity)),
      );
    },
    get rows() {
      return rows;
    },
    get selected() {
      if (level === "conversation") {
        return `talk:${TRADER_CHOICES[choiceIndex].id}`;
      }
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
