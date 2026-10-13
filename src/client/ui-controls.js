// @ts-check
// Pointer geometry and chat draft editing, independent of layout composition.
import { CHAT_LIMIT } from "./ui-kit.js";
/** @typedef {import("./ui-types.js").Rect} Rect */
/** @typedef {import("./ui-types.js").UiLayout} UiLayout */
/** @typedef {import("./ui-types.js").UiElement} UiElement */

/** @param {Rect} rect @param {number} x @param {number} y */
function rectContains(rect, x, y) {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y &&
    y < rect.y + rect.h;
}

/**
 * Where a stick touch lands: the octant direction after the dead zone, and
 * where the knob draws. Offsets are from the stick's center in CSS pixels.
 * @param {number} dx @param {number} dy @param {number} size the stick's diameter
 * @returns {{x:number,y:number,knobX:number,knobY:number}}
 */
export function stickVector(dx, dy, size) {
  const length = Math.hypot(dx, dy);
  const reach = size * 0.3;
  const scale = Math.min(1, reach / Math.max(1, length));
  const deadzone = Math.max(20, size * 0.12);
  const knobX = dx * scale;
  const knobY = dy * scale;
  if (length < deadzone) return { x: 0, y: 0, knobX, knobY };
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const [x, y] = OCTANTS[(octant + 8) % 8];
  return { x, y, knobX, knobY };
}

/** The eight stick directions, clockwise from east, with y down. @type {readonly (readonly [number,number])[]} */
const OCTANTS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/**
 * Change a chat draft with a keyboard key. Characters stop at the chat limit.
 * Shift is one-shot: it capitalizes the next letter.
 * @param {string} draft @param {string} key a character, or "space", "backspace"
 * @param {boolean} shift
 * @returns {{draft:string,shift:boolean}}
 */
export function typeKey(draft, key, shift) {
  if (key === "backspace") {
    return { draft: Array.from(draft).slice(0, -1).join(""), shift };
  }
  const char = key === "space" ? " " : key;
  if (char.length !== 1 || draft.length >= CHAT_LIMIT) return { draft, shift };
  const letter = /[a-z]/i.test(char);
  return {
    draft: draft + (shift && letter ? char.toUpperCase() : char),
    shift: letter ? false : shift,
  };
}

/**
 * The element under a point: the last one in draw order that takes pointers
 * there. A round element takes only the circle inside its box.
 * @param {UiLayout} layout @param {number} x @param {number} y
 * @returns {UiElement|null}
 */
export function hitTest(layout, x, y) {
  for (let index = layout.elements.length - 1; index >= 0; index--) {
    const element = layout.elements[index];
    if (!element.hit && !element.blocks) continue;
    if (!rectContains(element.rect, x, y)) continue;
    if (element.round) {
      const dx = x - (element.cx ?? 0);
      const dy = y - (element.cy ?? 0);
      if (Math.hypot(dx, dy) > (element.r ?? 0)) continue;
    }
    return element;
  }
  return null;
}
