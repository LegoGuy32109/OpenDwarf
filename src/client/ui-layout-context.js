// @ts-check
// What every layout section starts from: the view's size and scale, the safe
// area, the text metrics, and the list the sections add elements to.

import { clamp, NO_INSETS, textScale } from "./ui-kit.js";

/** @typedef {import('./ui-types.js').Rect} Rect */
/** @typedef {import('./ui-types.js').UiElement} UiElement */
/** @typedef {import('./ui-types.js').UiView} UiView */

/**
 * @param {UiView} view
 */
export function createLayoutContext(view) {
  const W = view.width;
  const H = view.height;
  const safe = view.safe ?? NO_INSETS;
  const s = clamp(view.scale ?? 1, 1, 2);
  const dpr = view.dpr ?? 1;
  const { k, ts } = textScale(s, dpr);
  const cw = 8 * ts;
  const lh = 16 * ts;
  const pitch = 20 * ts;
  const edge = 12 * s;
  const portrait = H >= W;
  const touch = Boolean(view.touch);
  const safeRect = {
    x: safe.left,
    y: safe.top,
    w: W - safe.left - safe.right,
    h: H - safe.top - safe.bottom,
  };
  const left = safeRect.x;
  const right = safeRect.x + safeRect.w;
  const top = safeRect.y;
  const bottom = safeRect.y + safeRect.h;
  /** @type {UiElement[]} */
  const elements = [];
  /** @param {UiElement} element */
  const add = (element) => {
    elements.push(element);
    return element;
  };
  /** @param {number} x @param {number} y @param {number} w @param {number} h @returns {Rect} */
  const box = (x, y, w, h) => ({ x, y, w, h });
  const chat = view.chat;
  const keyboard = touch && Boolean(chat?.open);
  const loading = view.loading ?? null;
  return {
    view,
    W,
    H,
    safe,
    s,
    dpr,
    k,
    ts,
    cw,
    lh,
    pitch,
    edge,
    portrait,
    touch,
    safeRect,
    left,
    right,
    top,
    bottom,
    elements,
    add,
    box,
    chat,
    keyboard,
    loading,
  };
}

/** @typedef {ReturnType<typeof createLayoutContext>} LayoutContext */
