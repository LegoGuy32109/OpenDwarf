// @ts-check
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
  const rowY = bottom - gutter - small;
  // The world pickup grid reaches below the entity. Keep its cells above a
  // compact action footer instead of covering them with the broad action zone.
  const regionHeight = view.pickupOpen
    ? Math.max(small, Math.min(72, H * 0.12))
    : Math.min(240 * s, H * (view.bag?.open || view.shop?.open ? 0.28 : 0.48));
  const regionY = Math.max(
    top + small + 2 * gutter,
    bottom - gutter - regionHeight,
  );
  const regionH = bottom - gutter - regionY;
  const usable = width - 2 * gutter - Math.min(56, width * 0.15) - gap;
  const moveW = (usable - gap) * (W > H ? 0.46 : 0.40);
  const actionX = left + gutter + moveW + gap;
  const actionW = usable - moveW - gap;
  const radius = Math.min(64 * s, moveW * 0.48, H * 0.16);
  const moveRect = box(left + gutter, regionY, moveW, regionH);
  const actionRect = box(actionX, regionY, actionW, regionH);
  controlRects.push(moveRect, actionRect);
  add({
    id: "stick:move",
    kind: "stick",
    rect: moveRect,
    hit: true,
    round: false,
    floating: true,
    act: "stick",
    cx: moveRect.x + moveW / 2,
    cy: regionY + regionH / 2,
    r: radius,
  });
  add({
    id: "btn:interact",
    kind: "action",
    rect: actionRect,
    hit: true,
    round: false,
    act: "down",
    cx: actionX + actionW / 2,
    cy: regionY + regionH / 2,
    r: Math.min(actionW, regionH) / 2,
    glyph: "item",
    item: view.held ?? PICKAXE,
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
  controlsTop = regionY;
  return { controlsTop, controlRects };
}
