// @ts-check
// The chat line, the in-game keyboard and the join QR code. Each function adds its elements to `ctx`.

import { ascii, clamp } from "./ui-kit.js";

/** @typedef {import('./ui-types.js').UiElement} UiElement */
/** @typedef {import('./ui-layout-context.js').LayoutContext} LayoutContext */

/** Keyboard pages: rows of keys. The letter pages share one shape. */
const LETTER_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const SYMBOL_ROWS = ["1234567890", '-/:;()$&@"', ".,?!'_="];
const SYMBOL_LEFT = "#";

/**
 * Chat: the typed line, and on touch the keyboard under it.
 * @param {LayoutContext} ctx
 */
export function layoutChat(ctx) {
  const {
    W,
    H,
    safe,
    s,
    edge,
    portrait,
    safeRect,
    left,
    right,
    bottom,
    add,
    box,
    chat,
    keyboard,
  } = ctx;
  /** @type {number|null} */
  let chatTop = null;
  if (chat?.open) {
    const barH = 30 * s;
    if (keyboard) {
      const gapKey = Math.max(3, 4 * s);
      const rowH = Math.min(
        (portrait ? clamp(0.055 * H, 40, 52) : H <= 430 ? 36 : 40) * s,
        (0.5 * H - barH) / 4 - gapKey,
      );
      const padY = 6 * s;
      const kbH = 4 * rowH + 3 * gapKey + 2 * padY;
      const kbBottom = H;
      const keyboardTop = kbBottom - safe.bottom - kbH;
      chatTop = keyboardTop - barH - 12 * s;
      add({
        id: "panel:keyboard",
        kind: "panel",
        rect: box(0, chatTop, W, H - chatTop),
        blocks: true,
      });
      const kx = left + 4 * s;
      const kw = right - 4 * s - kx;
      const unit = (kw - 9 * gapKey) / 10;
      const pageRows = chat.page === "letters" ? LETTER_ROWS : SYMBOL_ROWS;
      /**
       * @param {string} id @param {string} keyName @param {number} x @param {number} y
       * @param {number} units @param {string} label @param {Partial<UiElement>} [extra]
       */
      const key = (id, keyName, x, y, units, label, extra = {}) => {
        const w = units * unit + (units - 1) * gapKey;
        add({
          id: `key:${id}`,
          kind: "key",
          rect: box(x, y, w, rowH),
          hit: true,
          act: "down",
          key: keyName,
          text: label,
          ...extra,
        });
        return x + w + gapKey;
      };
      for (const [rowIndex, letters] of pageRows.entries()) {
        const y = keyboardTop + padY + rowIndex * (rowH + gapKey);
        const keys = [...letters];
        const special = rowIndex === 2;
        const rowUnits = keys.length + (special ? 3 : 0);
        let x = kx + (10 - rowUnits) * (unit + gapKey) / 2;
        if (special) {
          x = key(
            chat.page === "letters" ? "shift" : "hash",
            chat.page === "letters" ? "shift" : SYMBOL_LEFT,
            x,
            y,
            1.5,
            chat.page === "letters" ? "Shift" : SYMBOL_LEFT,
            { on: chat.page === "letters" && chat.shift },
          );
        }
        for (const letter of keys) {
          const label = chat.page === "letters" && chat.shift
            ? letter.toUpperCase()
            : letter;
          x = key(letter, letter, x, y, 1, label);
        }
        if (special) key("backspace", "backspace", x, y, 1.5, "Del");
      }
      const y4 = keyboardTop + padY + 3 * (rowH + gapKey);
      let x = kx;
      x = key("close", "close", x, y4, 1.5, "Close");
      x = key(
        "page",
        "page",
        x,
        y4,
        1.5,
        chat.page === "letters" ? "123" : "ABC",
      );
      x = key("space", "space", x, y4, 5, "");
      key("send", "send", x, y4, 2, "Send", { on: true });
      const barY = keyboardTop - barH - 6 * s;
      add({
        id: "chatbar",
        kind: "chatbar",
        rect: box(left + edge, barY, safeRect.w - 2 * edge, barH),
        text: ascii(chat.draft),
        count: chat.draft.length,
      });
    } else {
      const barY = bottom - 24 * s - barH;
      add({
        id: "chatbar",
        kind: "chatbar",
        rect: box(left + edge, barY, safeRect.w - 2 * edge, barH),
        text: ascii(chat.draft),
        count: chat.draft.length,
      });
    }
  }
  return { chatTop };
}

/**
 * The join QR code, over the panels.
 * @param {LayoutContext} ctx
 * @param {Pick<ReturnType<typeof import('./ui-layout-hud.js').layoutStatus>, "fullscreenSize" | "host">} input
 */
export function layoutQr(ctx, input) {
  const { W, H, s, edge, left, right, top, add, box } = ctx;
  const { fullscreenSize, host } = input;
  if (host?.joinOpen) {
    const size = clamp(0.22 * Math.min(W, H), 120, 168);
    const pad = 6 * s;
    const x = Math.max(
      left + edge,
      right - edge - fullscreenSize - 8 * s - size - 2 * pad,
    );
    add({
      id: "panel:join",
      kind: "panel",
      rect: box(x, top + 62 * s, size + 2 * pad, size + 2 * pad),
      blocks: true,
      color: "white",
    });
    if (host.qr) {
      add({
        id: "image:qr",
        kind: "image",
        rect: box(x + pad, top + 62 * s + pad, size, size),
      });
    }
  }
}
