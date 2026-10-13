// @ts-check
// Small helpers the layout and the rest of the UI share.

/** @typedef {import('./ui-types.js').Insets} Insets */

/** The most characters a chat message holds. */
export const CHAT_LIMIT = 120;

/** @type {Insets} */
export const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

/** @param {number} value @param {number} min @param {number} max */
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Text the bitmap font can draw: it has the printable ASCII range only.
 * @param {string} text
 */
export function ascii(text) {
  return text
    .replace(/×/g, "x")
    .replace(/…/g, "...")
    .replace(/[·–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\n\x20-\x7e]/g, "?");
}

/**
 * Break text into lines of at most `columns` characters, on spaces where it
 * can and inside a word where it must. A newline starts a new line.
 * @param {string} text @param {number} columns
 * @returns {string[]}
 */
export function wrapText(text, columns) {
  const width = Math.max(1, Math.floor(columns));
  /** @type {string[]} */
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      let rest = word;
      if (line && line.length + 1 + rest.length <= width) {
        line += ` ${rest}`;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      while (rest.length > width) {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * The text scale that draws crisp pixels: a whole number of device pixels per
 * font pixel, shown in CSS pixels.
 * @param {number} scale the UI scale setting @param {number} dpr
 */
export function textScale(scale, dpr) {
  const k = Math.max(1, Math.round(scale * dpr));
  return { k, ts: k / dpr };
}
