// @ts-check

import { ITEM_FRAMES, itemInfo } from "../shared/items.js";

/**
 * The inventory panel and the held item HUD icon. B, the bag button, or a
 * gamepad button opens the panel. IJKL, the look stick, or the D-pad moves the
 * selection, and interact or a tap makes the selected stack the held item.
 * The panel is plain DOM; `app.js` owns the input and the held item, this
 * module owns the panel's state and drawing.
 */

/** @typedef {import('../shared/items.js').Stack} Stack */

/** Slots per row. */
export const COLUMNS = 4;
/** Milliseconds between selection steps while a direction stays held. */
const REPEAT_MS = 180;
const ICON = 16;

/**
 * Move a selection one step on the slot grid. Stepping off an edge stays put. A
 * diagonal that cannot go falls back to its horizontal, then vertical, part, so
 * a held aim key does not stop the other key.
 * @param {number} index @param {number} count @param {number} dx @param {number} dy
 * @returns {number}
 */
export function stepSelection(index, count, dx, dy) {
  if (count <= 0) return 0;
  const column = index % COLUMNS + Math.sign(dx);
  const row = Math.floor(index / COLUMNS) + Math.sign(dy);
  const next = row * COLUMNS + column;
  if (column >= 0 && column < COLUMNS && row >= 0 && next < count) return next;
  if (dx && dy) {
    const sideways = stepSelection(index, count, dx, 0);
    return sideways !== index ? sideways : stepSelection(index, count, 0, dy);
  }
  return index;
}

/**
 * Show an item icon from the item sprite sheet in an element.
 * @param {HTMLElement} element @param {string} kind @param {number} scale
 */
export function paintIcon(element, kind, scale) {
  const frame = itemInfo(kind)?.frame ?? 0;
  const size = ICON * scale;
  element.style.width = element.style.height = `${size}px`;
  element.style.backgroundSize = `${size}px ${size * ITEM_FRAMES}px`;
  element.style.backgroundPosition = `0 ${-frame * size}px`;
}

/**
 * @param {object} options
 * @param {HTMLElement} options.parent where the panel and the HUD icon go
 * @param {(kind:string)=>void} options.onHold called when the player chooses an item to hold
 * @param {()=>void} options.onOpenChange called after the panel opens or closes
 */
export function createInventoryPanel({ parent, onHold, onOpenChange }) {
  const hud = document.createElement("div");
  hud.id = "held-hud";
  hud.setAttribute("role", "img");
  const hudIcon = document.createElement("span");
  hudIcon.className = "item-icon";
  hud.append(hudIcon);

  const panel = document.createElement("aside");
  panel.id = "inventory-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Inventory");
  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.textContent = "Inventory";
  const close = document.createElement("button");
  close.id = "inventory-close";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close inventory");
  header.append(title, close);
  const grid = document.createElement("ul");
  grid.id = "inventory-grid";
  const name = document.createElement("p");
  name.id = "inventory-name";
  panel.append(header, grid, name);
  parent.append(hud, panel);

  /** @type {Stack[]} */
  let stacks = [];
  let heldKind = "";
  let selected = 0;
  let isOpen = false;
  let drawn = "";
  /** The last direction the stick pointed, and when it last stepped. */
  let lastDirection = { x: 0, y: 0 };
  let lastStep = 0;

  function draw() {
    const signature = `${JSON.stringify(stacks)}|${heldKind}|${selected}`;
    if (signature === drawn) return;
    drawn = signature;
    const label = itemInfo(heldKind)?.name ?? "nothing";
    hud.title = `Held: ${label}`;
    hud.setAttribute("aria-label", `Held item: ${label}`);
    hud.hidden = !heldKind;
    hudIcon.className = "item-icon";
    paintIcon(hudIcon, heldKind, 2);
    grid.replaceChildren(...stacks.map((stack, index) => {
      const slot = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "slot";
      button.dataset.kind = stack.kind;
      button.classList.toggle("is-selected", index === selected);
      button.classList.toggle("is-held", stack.kind === heldKind);
      button.setAttribute("aria-pressed", String(stack.kind === heldKind));
      const info = itemInfo(stack.kind);
      button.setAttribute(
        "aria-label",
        `${info?.name ?? stack.kind} ×${stack.count}`,
      );
      const icon = document.createElement("span");
      icon.className = "item-icon";
      paintIcon(icon, stack.kind, 3);
      const count = document.createElement("b");
      count.textContent = stack.count > 1 ? String(stack.count) : "";
      button.append(icon, count);
      // A tap selects the stack and holds it.
      button.addEventListener("click", () => {
        selected = index;
        confirm();
      });
      slot.append(button);
      return slot;
    }));
    const current = stacks[selected];
    name.textContent = current
      ? `${itemInfo(current.kind)?.name ?? current.kind}${
        current.kind === heldKind ? " (held)" : ""
      }`
      : "";
  }

  /** @param {boolean} [next] */
  function toggle(next = !isOpen) {
    if (next === isOpen) return;
    isOpen = next;
    panel.hidden = !isOpen;
    lastDirection = { x: 0, y: 0 };
    if (isOpen) {
      // Start on the held item.
      selected = Math.max(0, stacks.findIndex((s) => s.kind === heldKind));
      drawn = "";
      draw();
    }
    onOpenChange();
  }

  /** Make the selected stack the held item. */
  function confirm() {
    const stack = stacks[selected];
    if (stack) onHold(stack.kind);
  }

  close.addEventListener("click", () => toggle(false));

  return {
    get isOpen() {
      return isOpen;
    },
    toggle,
    confirm,
    /**
     * Take the current stacks and held item. Cheap to call every frame.
     * @param {Stack[]} nextStacks @param {string} nextHeld
     */
    update(nextStacks, nextHeld) {
      stacks = nextStacks;
      heldKind = nextHeld;
      if (selected >= stacks.length) selected = Math.max(0, stacks.length - 1);
      draw();
    },
    /**
     * Step the selection from a look or D-pad direction. A direction steps when
     * it first points and again every `REPEAT_MS` while it stays.
     * @param {{x:number,y:number}} direction @param {number} nowMs
     */
    steer(direction, nowMs) {
      if (!isOpen) return;
      if (!direction.x && !direction.y) {
        lastDirection = direction;
        return;
      }
      const same = direction.x === lastDirection.x &&
        direction.y === lastDirection.y;
      if (same && nowMs - lastStep < REPEAT_MS) return;
      lastDirection = direction;
      lastStep = nowMs;
      selected = stepSelection(
        selected,
        stacks.length,
        direction.x,
        direction.y,
      );
      draw();
    },
    get selected() {
      return selected;
    },
  };
}
