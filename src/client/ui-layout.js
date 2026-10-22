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

import { createLayoutContext } from "./ui-layout-context.js";
import { layoutControls } from "./ui-layout-controls.js";
import { layoutBack, layoutHeld, layoutStatus } from "./ui-layout-hud.js";
import {
  layoutArea,
  layoutHostList,
  layoutInventory,
  layoutShop,
} from "./ui-layout-panels.js";
import { layoutChat, layoutQr } from "./ui-layout-chat.js";
import { layoutLoading, layoutMenu } from "./ui-layout-menu.js";

/** @typedef {import('./ui-types.js').Rect} Rect */
/** @typedef {import('./ui-types.js').Insets} Insets */
/** @typedef {import('./ui-types.js').UiElement} UiElement */
/** @typedef {import('./ui-types.js').UiView} UiView */
/** @typedef {import('./ui-types.js').UiLayout} UiLayout */
/** @typedef {import('./ui-types.js').Knob} Knob */

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
  layoutBack(ctx);
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
