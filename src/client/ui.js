// @ts-check

/**
 * The UI layer: one place that lays out every UI element in CSS pixels inside
 * the safe area, scales them with the UI scale setting, and finds the element
 * under a pointer. It holds no DOM and no drawing: `ui-draw.js` draws the
 * layout through `render.js`, and `ui-pointer.js` routes pointer events over it.
 *
 * `layoutUi(view)` is pure. `view` is a plain description of what the game
 * shows right now (which panels are open, the inventory, the log lines), and
 * the result lists elements in draw order. Pointers hit the last element that
 * covers them, so a panel hides what is under it.
 */

import { ascii, CHAT_LIMIT, wrapText } from "./ui-kit.js";
import { createLayoutContext } from "./ui-layout-context.js";
import { layoutControls } from "./ui-layout-controls.js";
import { layoutHeld, layoutStatus } from "./ui-layout-hud.js";
import {
  layoutArea,
  layoutHostList,
  layoutInventory,
  layoutShop,
} from "./ui-layout-panels.js";
import { layoutChat, layoutQr } from "./ui-layout-chat.js";
import { layoutLoading, layoutMenu } from "./ui-layout-menu.js";

export { ascii, CHAT_LIMIT, wrapText };

/** @typedef {import('./ui-types.js').Rect} Rect */
/** @typedef {import('./ui-types.js').Insets} Insets */
/** @typedef {import('./ui-types.js').UiElement} UiElement */
/** @typedef {import('./ui-types.js').UiView} UiView */
/** @typedef {import('./ui-types.js').UiLayout} UiLayout */
/** @typedef {import('./ui-types.js').Knob} Knob */

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
 * Every element of the UI for a view, in draw order.
 * @param {UiView} view
 * @returns {UiLayout}
 */
export function layoutUi(view) {
  const ctx = createLayoutContext(view);
  const controls = layoutControls(ctx);
  const status = layoutStatus(ctx);
  layoutHeld(ctx, status);
  const area = layoutArea(ctx, { ...controls, ...status });
  layoutHostList(ctx);
  layoutInventory(ctx, area);
  const shop = layoutShop(ctx, area);
  const chat = layoutChat(ctx);
  layoutQr(ctx, status);
  layoutMenu(ctx, area);
  layoutLoading(ctx);
  /** @type {Map<string,UiElement>} */
  const byId = new Map();
  for (const element of ctx.elements) byId.set(element.id, element);
  return {
    width: ctx.W,
    height: ctx.H,
    ts: ctx.ts,
    k: ctx.k,
    elements: ctx.elements,
    byId,
    safeRect: ctx.safeRect,
    shopList: shop.shopList,
    logList: area.logList,
    controlsTop: controls.controlsTop,
    chatTop: chat.chatTop,
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
