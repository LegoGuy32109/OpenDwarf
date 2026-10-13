// @ts-check
// Touch controls: sticks and buttons. Each function adds its elements to `ctx`.

import { clamp } from "./ui-kit.js";
import { PICKAXE, STONE_ITEM } from "../shared/items.js";

/** @typedef {import('./ui-types.js').Rect} Rect */
/** @typedef {import('./ui-types.js').UiElement} UiElement */
/** @typedef {import('./ui-layout-context.js').LayoutContext} LayoutContext */

/**
 * Touch controls: two sticks, interact and sprint beside them, and the A, L, B, and bag buttons in a row.
 * @param {LayoutContext} ctx
 */
export function layoutControls(ctx) {
  const {
    view,
    W,
    H,
    safe,
    s,
    ts,
    edge,
    portrait,
    touch,
    left,
    right,
    bottom,
    add,
    box,
    keyboard,
  } = ctx;
  let controlsTop = bottom - edge;
  /** @type {Rect[]} */
  const controlRects = [];
  if (touch && !keyboard) {
    const stickBase = portrait
      ? clamp(0.32 * W, 120, 190)
      : H <= 420
      ? Math.min(0.34 * H, 160)
      : clamp(0.3 * H, 148, 220);
    const availW = W - safe.left - safe.right;
    const gutter = portrait ? 12 : clamp(0.07 * W, 18, 66);
    const round = portrait ? clamp(0.115 * W, 44, 56) : clamp(0.12 * H, 52, 64);
    const action = portrait ? clamp(0.1 * W, 44, 54) : clamp(0.08 * H, 38, 46);
    /**
     * The sizes of the controls at a control scale. The sticks give way before
     * the buttons between them shrink below their base size.
     * @param {number} scale
     */
    const geometry = (scale) => {
      const room = (availW - 2 * gutter - 2 * (round + 6) - 8) / 2;
      const stick = Math.min(
        stickBase * scale,
        0.4 * W,
        0.46 * H,
        Math.max(100, room),
      );
      const sideRoom = (availW - 2 * gutter - 2 * stick) / 2;
      const roundSize = Math.min(
        round * scale,
        Math.max(round, sideRoom - 10),
        0.6 * stick,
      );
      const actionSize = Math.min(action * scale, 0.2 * W);
      const gap = 8 * scale;
      // In landscape the A, L, B, and bag row sits between the two buttons beside the sticks.
      const between = availW - 2 * (gutter + stick + 6 + roundSize);
      return {
        stick,
        roundSize,
        actionSize,
        gap,
        scale,
        fits: portrait || 4 * actionSize + 3 * gap + 16 <= between,
      };
    };
    // Controls scale with the UI scale as far as the screen has room for them.
    let sized = geometry(s);
    for (let scale = s; !sized.fits && scale > 1;) {
      scale = Math.max(1, scale - 0.25);
      sized = geometry(scale);
    }
    const { stick, roundSize, actionSize } = sized;
    const cs = sized.scale;
    const strip = portrait
      ? Math.max(clamp(0.1 * H, 54, 94), actionSize + 20 * cs)
      : 14 * cs;
    const stickBottom = bottom - strip;
    const stickTop = stickBottom - stick;
    const moveX = left + gutter;
    const lookX = right - gutter - stick;
    add({
      id: "stick:move",
      kind: "stick",
      rect: box(moveX, stickTop, stick, stick),
      hit: true,
      round: true,
      act: "stick",
      cx: moveX + stick / 2,
      cy: stickTop + stick / 2,
      r: stick / 2,
    });
    add({
      id: "stick:look",
      kind: "stick",
      rect: box(lookX, stickTop, stick, stick),
      hit: true,
      round: true,
      act: "stick",
      cx: lookX + stick / 2,
      cy: stickTop + stick / 2,
      r: stick / 2,
    });
    const stamina = view.stamina ?? { value: 1, on: false, locked: false };
    /**
     * @param {string} id @param {number} x @param {number} y @param {number} size
     * @param {Partial<UiElement>} extra
     */
    const roundButton = (id, x, y, size, extra) => {
      controlRects.push(box(x, y, size, size));
      return add({
        id,
        kind: "round",
        rect: box(x, y, size, size),
        hit: true,
        round: true,
        act: "down",
        cx: x + size / 2,
        cy: y + size / 2,
        r: size / 2,
        ...extra,
      });
    };
    // Interact: 0.6 of a stick, right of the move stick and level with its
    // center, as far as the gap to the look stick allows.
    const middle = lookX - (moveX + stick);
    const interactSize = Math.max(
      roundSize,
      Math.min(stick * 0.6, middle - 12),
    );
    const interactX = moveX + stick + 6;
    // In landscape the chat, log, menu and bag row sits between the sticks at
    // the bottom; interact rises above it where the two would meet.
    const actionRowTop = bottom - (portrait ? 10 : 14) * sized.scale -
      actionSize;
    const rowLeft = (left + right) / 2 -
      (4 * actionSize + 3 * sized.gap) / 2;
    const centered = stickTop + stick / 2 - interactSize / 2;
    const interactY = !portrait && interactX + interactSize > rowLeft &&
        centered + interactSize > actionRowTop - sized.gap
      ? actionRowTop - sized.gap - interactSize
      : centered;
    roundButton(
      "btn:interact",
      interactX,
      interactY,
      interactSize,
      { glyph: "item", item: view.held === STONE_ITEM ? STONE_ITEM : PICKAXE },
    );
    // Sprint at the look stick's bottom right. It overlaps only the stick's
    // outer edge, and it is drawn after the stick, so it takes those touches.
    const sprintSize = Math.max(roundSize, stick * 0.34);
    roundButton(
      "btn:sprint",
      Math.min(lookX + stick - sprintSize * 0.55, right - sprintSize - 4),
      Math.min(stickBottom - sprintSize * 0.55, bottom - sprintSize - 4),
      sprintSize,
      {
        glyph: "sprint",
        on: stamina.on,
        locked: stamina.locked,
        fill: stamina.value,
      },
    );
    const gap = sized.gap;
    const rowWidth = 4 * actionSize + 3 * gap;
    const rowY = bottom - (portrait ? 10 * cs : 14 * cs) - actionSize;
    const rowX = (left + right) / 2 - rowWidth / 2;
    /** @type {[string,string,Partial<UiElement>][]} */
    const buttons = [
      ["btn:chat", "chat", { glyph: "chat" }],
      ["btn:log", "log", { text: "L", on: Boolean(view.logButton?.open) }],
      ["btn:menu", "menu", { text: "ESC", scale: ts }],
      ["btn:bag", "bag", { glyph: "bag", on: Boolean(view.bagOpenButton) }],
    ];
    for (const [index, [id, , extra]] of buttons.entries()) {
      roundButton(id, rowX + index * (actionSize + gap), rowY, actionSize, {
        scale: 2 * ts,
        ...extra,
      });
    }
    controlsTop = Math.min(stickTop, rowY, interactY);
  }
  return { controlsTop, controlRects };
}
