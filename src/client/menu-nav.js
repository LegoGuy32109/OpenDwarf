// @ts-check

/**
 * The navigation rules every menu shares (Settings, the inventory panel, the
 * pickup grid, and the shop panel): which menu is the open level, where Back
 * goes, the Settings rows, and the fresh-press
 * rule for Confirm. The rules are pure; `panels.js` and `input.js` apply them.
 * See `docs/features/controls-and-ui.md`.
 */

import { createStickStepper } from "./stick-step.js";

/**
 * A menu level. The outermost menu is "menu" (the Escape menu), and "settings"
 * sits one level inside it. The bag, the pickup grid, and the shop panel are
 * outermost levels of their own.
 * @typedef {"menu"|"settings"|"bag"|"grid"|"shop"} MenuLevel
 */

/** The Escape menu's rows, in order. */
export const MENU_ROWS = ["resume", "settings", "leave"];
/** The Settings rows, in order. */
export const SETTINGS_ROWS = [
  "scale",
  "size",
  "voices",
  "music",
  "effects",
  "back",
];

/**
 * The menu one Back press goes to: the parent level, or null for the world.
 * @param {MenuLevel|null} level
 * @returns {MenuLevel|null}
 */
export function parentLevel(level) {
  return level === "settings" ? "menu" : null;
}

/**
 * Step a row selection, wrapping at both ends.
 * @param {number} index @param {number} count @param {number} step
 */
export function stepRow(index, count, step) {
  if (count <= 0) return 0;
  return ((index + Math.sign(step)) % count + count) % count;
}

/**
 * The choice one step from the current one, or null at the end of the list.
 * @param {readonly string[]} choices @param {string|undefined} current @param {number} step
 * @returns {string|null}
 */
export function stepChoice(choices, current, step) {
  const at = choices.indexOf(current ?? "");
  if (at < 0) return choices[0] ?? null;
  return choices[at + Math.sign(step)] ?? null;
}

/**
 * The Settings rows with the choice ids a value step selects. `current` names
 * each row's present value.
 * @param {{sizes:readonly string[],voices:readonly string[],music:readonly string[],effects:readonly string[]}} levels
 * @param {{size:string,voices:string|undefined,music:string|undefined,effects:string|undefined}} current
 * @returns {Record<string,(step:number)=>string|null>} the button id a step on each row presses
 */
export function settingsChanges(levels, current) {
  /** @param {string} prefix @param {readonly string[]} list @param {string|undefined} value */
  const choose = (prefix, list, value) => (/** @type {number} */ step) => {
    const next = stepChoice(list, value, step);
    return next === null ? null : `btn:${prefix}:${next}`;
  };
  return {
    scale: (step) => step < 0 ? "btn:scale-down" : "btn:scale-up",
    size: choose("size", levels.sizes, current.size),
    voices: choose("voices", levels.voices, current.voices),
    music: choose("music", levels.music, current.music),
    effects: choose("effects", levels.effects, current.effects),
  };
}

/**
 * The shared menu navigation state: the selected row of each Escape menu page
 * (kept while a child page is open, so Back restores it), the stick step rule
 * for the right stick and the D-pad, and the fresh-press gate.
 */
export function createMenuNav() {
  /** @type {Record<"menu"|"settings",number>} */
  const rows = { menu: 0, settings: 0 };
  /** The level seen last frame, and whether Confirm may act on it. */
  let seen = /** @type {MenuLevel|null} */ (null);
  let armed = true;
  return {
    rows,
    /** The right stick and D-pad direction steps, by the shared stick step rule. */
    stick: createStickStepper(),
    /** Whether the player's Back press that is still held should keep zoom out off. */
    zoomOutBlocked: false,
    /** Start a menu from its first row. */
    reset() {
      rows.menu = 0;
      rows.settings = 0;
    },
    /**
     * Call once a frame. A level that is newly open needs a fresh confirm press:
     * while the button that opened it is still held, Confirm does nothing.
     * @param {MenuLevel|null} level @param {boolean} confirmHeld
     */
    update(level, confirmHeld) {
      if (level !== seen) {
        seen = level;
        armed = !confirmHeld;
      } else if (!confirmHeld) armed = true;
    },
    /** Whether Confirm may choose now. */
    get armed() {
      return armed;
    },
  };
}
