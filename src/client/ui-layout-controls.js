// @ts-check
import { clamp } from "./ui-kit.js";
import { PICKAXE } from "../shared/items.js";

/** @typedef {import('./ui-layout-context.js').LayoutContext} LayoutContext */
/** @typedef {import('./ui-types.js').UiElement} UiElement */

/** One low movement stick and an independent equipped-item control. @param {LayoutContext} ctx */
export function layoutControls(ctx) {
  const {
    view,
    W,
    H,
    s,
    ts,
    left,
    right,
    top,
    bottom,
    touch,
    keyboard,
    box,
    add,
  } = ctx;
  /** @type {import('./ui-types.js').Rect[]} */
  const controlRects = [];
  let controlsTop = bottom - ctx.edge;
  if (!touch || keyboard) return { controlsTop, controlRects };
  const width = right - left;
  const gap = 8;
  const gutter = 12;
  const small = Math.min(56, 44 * s, width * 0.15);
  const stick = Math.min(clamp(W * 0.29, 104, 140) * s, width * 0.34, H * 0.32);
  const action = Math.min(
    90 * s,
    width - stick - small - 4 * gap - 2 * gutter,
    H * 0.28,
  );
  const rowY = bottom - gutter - small;
  const stickY = rowY - gap - stick;
  const actionX = right - gutter - small - gap - action;
  const actionY = rowY - gap - action;
  add({
    id: "stick:move",
    kind: "stick",
    rect: box(left + gutter, stickY, stick, stick),
    hit: true,
    round: true,
    act: "stick",
    cx: left + gutter + stick / 2,
    cy: stickY + stick / 2,
    r: stick / 2,
  });
  /** @param {string} id @param {number} x @param {number} y @param {number} size @param {Partial<UiElement>} extra */
  function button(id, x, y, size, extra) {
    const rect = box(x, y, size, size);
    if (id !== "btn:menu") controlRects.push(rect);
    return add({
      id,
      kind: "round",
      rect,
      hit: true,
      round: true,
      act: "down",
      cx: x + size / 2,
      cy: y + size / 2,
      r: size / 2,
      ...extra,
    });
  }
  button("btn:chat", left + gutter, rowY, small, { glyph: "chat" });
  button("btn:bag", right - gutter - small, rowY, small, {
    glyph: "bag",
    on: Boolean(view.bagOpenButton),
  });
  const stamina = view.stamina ?? { value: 1, on: false, locked: false };
  button("btn:sprint", right - gutter - small, rowY - gap - small, small, {
    glyph: "sprint",
    on: stamina.on,
    locked: stamina.locked,
    fill: stamina.value,
  });
  button("btn:menu", (left + right - small) / 2, top + gutter, small, {
    text: "ESC",
    scale: ts,
  });
  button("btn:interact", actionX, actionY, action, {
    kind: "action",
    round: false,
    glyph: "item",
    item: view.held ?? PICKAXE,
  });
  const gesture = view.actionGesture;
  if (gesture?.down && gesture.aiming) {
    const size = 64;
    add({
      id: "action:well",
      kind: "aimwell",
      rect: box(
        actionX + (action - size) / 2,
        actionY - size - gap,
        size,
        size,
      ),
      cx: actionX + action / 2,
      cy: actionY - gap - size / 2,
      r: size / 2,
      dx: gesture.x,
      dy: gesture.y,
    });
  }
  controlsTop = Math.min(stickY, actionY, rowY - gap - small);
  return { controlsTop, controlRects };
}
