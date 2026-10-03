// @ts-check

/**
 * The inventory panel's state. B, the bag button, or a gamepad button opens
 * the panel. IJKL, the look stick, or the D-pad moves the selection, and
 * interact or a tap makes the selected stack the held item. The UI layer
 * (`ui.js`) lays the panel out and draws it; `app.js` owns the input and the
 * held item, and this module owns the selection.
 */

/** @typedef {import('../shared/items.js').Stack} Stack */

/** Slots per row. */
export const COLUMNS = 4;
/** Milliseconds between selection steps while a direction stays held. */
const REPEAT_MS = 180;

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
 * @param {object} options
 * @param {(kind:string)=>void} options.onHold called when the player chooses an item to hold
 * @param {()=>void} options.onOpenChange called after the panel opens or closes
 */
export function createInventoryPanel({ onHold, onOpenChange }) {
  /** @type {Stack[]} */
  let stacks = [];
  let heldKind = "";
  let selected = 0;
  let isOpen = false;
  /** The last direction the stick pointed, and when it last stepped. */
  let lastDirection = { x: 0, y: 0 };
  let lastStep = 0;

  /** @param {boolean} [next] */
  function toggle(next = !isOpen) {
    if (next === isOpen) return;
    isOpen = next;
    lastDirection = { x: 0, y: 0 };
    // Start on the held item.
    if (isOpen) {
      selected = Math.max(
        0,
        stacks.findIndex((s) => s.kind === heldKind),
      );
    }
    onOpenChange();
  }

  /** Make the selected stack the held item. */
  function confirm() {
    const stack = stacks[selected];
    if (stack) onHold(stack.kind);
  }

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
    },
    /** A tap on a slot selects the stack and holds it. @param {string} kind */
    tap(kind) {
      const index = stacks.findIndex((stack) => stack.kind === kind);
      if (index < 0) return;
      selected = index;
      confirm();
    },
    get selected() {
      return selected;
    },
    get stacks() {
      return stacks;
    },
    get held() {
      return heldKind;
    },
  };
}
