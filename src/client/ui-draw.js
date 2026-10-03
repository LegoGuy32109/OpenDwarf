// @ts-check

import { CHAT_LIMIT } from "./ui.js";

/**
 * Draws a UI layout through a painter. The painter works in CSS pixels and
 * hands the drawing to `render.js`, so the UI uses the one draw path: the same
 * textured quads and bitmap font as the world.
 */

/** @typedef {[number,number,number,number]} Color */
/** @typedef {import('./ui.js').UiLayout} UiLayout */
/** @typedef {import('./ui.js').UiElement} UiElement */

/**
 * What `render.js` gives the UI. Sizes are CSS pixels; `scale` is CSS pixels
 * per font pixel.
 * @typedef {object} Painter
 * @property {(x:number,y:number,w:number,h:number,color:Color)=>void} rect
 * @property {(text:string,x:number,y:number,scale:number,color:Color)=>void} text
 * @property {(kind:string,x:number,y:number,size:number,alpha:number)=>void} item
 * @property {(x:number,y:number,size:number)=>void} qr
 */

/**
 * @typedef {object} DrawState
 * @property {ReadonlySet<string>} pressed ids held down now
 * @property {{move:{active:boolean,x:number,y:number},look:{active:boolean,x:number,y:number}}} sticks
 * @property {number} now milliseconds, for the blinking caret
 */

/** @param {number} hex @param {number} [alpha] @returns {Color} */
const rgb = (hex, alpha = 1) => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
  alpha,
];

/** Named colors, as the CSS had them. @type {Record<string,Color>} */
export const PALETTE = {
  cream: rgb(0xf3e7c9),
  gold: rgb(0xffdb8f),
  amber: rgb(0xe4a34a),
  dim: rgb(0x9b9486),
  blue: rgb(0x9ec7e8),
  price: rgb(0xf2c14e),
  orange: rgb(0xff610a),
  white: rgb(0xffffff),
  ink: rgb(0x282b2f),
  panel: rgb(0x1e2024, 0.95),
  panelEdge: rgb(0x706958),
  button: rgb(0x333438),
  buttonOn: rgb(0x3a3426),
  slot: rgb(0x2a2d31),
  slotEdge: rgb(0x4a4d52),
  held: rgb(0x3a3426),
  heldEdge: rgb(0x8f8466),
  shadow: rgb(0x111315),
  backdrop: rgb(0x0d0d0d, 0.75),
  night: rgb(0x17191c),
};

/** Pixel icons: rows of a square grid, "#" is set. @type {Record<string,readonly string[]>} */
const BITMAPS = {
  x: [
    "##.....##",
    ".##...##.",
    "..##.##..",
    "...###...",
    "..##.##..",
    ".##...##.",
    "##.....##",
  ],
  fullscreen: [
    "####....####",
    "#..........#",
    "#..........#",
    "#..........#",
    "............",
    "............",
    "............",
    "............",
    "#..........#",
    "#..........#",
    "#..........#",
    "####....####",
  ],
  bag: [
    "...######...",
    "...#....#...",
    "...#....#...",
    "..########..",
    ".##########.",
    ".##########.",
    ".##########.",
    ".##########.",
    ".##########.",
    ".##########.",
    ".##########.",
    "..########..",
  ],
  sprint: [
    "#.....#.....",
    "##....##....",
    ".##....##...",
    "..##....##..",
    "...##....##.",
    "....##....##",
    "...##....##.",
    "..##....##..",
    ".##....##...",
    "##....##....",
    "#.....#.....",
  ],
};

/**
 * A pixel icon centered in a box, drawn with runs of rectangles.
 * @param {Painter} paint @param {string} name @param {number} cx @param {number} cy
 * @param {number} size the icon's width in CSS pixels @param {Color} color
 */
function bitmap(paint, name, cx, cy, size, color) {
  const rows = BITMAPS[name];
  if (!rows) return;
  const width = rows[0].length;
  const cell = size / width;
  const x0 = cx - size / 2;
  const y0 = cy - (rows.length * cell) / 2;
  for (const [row, bits] of rows.entries()) {
    let start = -1;
    for (let col = 0; col <= width; col++) {
      const set = col < width && bits[col] === "#";
      if (set && start < 0) start = col;
      if (!set && start >= 0) {
        paint.rect(
          x0 + start * cell,
          y0 + row * cell,
          (col - start) * cell,
          cell,
          color,
        );
        start = -1;
      }
    }
  }
}

/**
 * A pixel-art disc: rows of whole cells.
 * @param {Painter} paint @param {number} cx @param {number} cy @param {number} r
 * @param {Color} color @param {number} cell
 */
function disc(paint, cx, cy, r, color, cell) {
  for (let dy = -r; dy < r; dy += cell) {
    const mid = Math.abs(dy + cell / 2);
    const half = Math.round(Math.sqrt(Math.max(0, r * r - mid * mid)) / cell) *
      cell;
    if (half > 0) paint.rect(cx - half, cy + dy, 2 * half, cell, color);
  }
}

/** A square outline. @param {Painter} paint @param {import('./ui.js').Rect} rect @param {number} width @param {Color} color */
function outline(paint, rect, width, color) {
  const { x, y, w, h } = rect;
  paint.rect(x, y, w, width, color);
  paint.rect(x, y + h - width, w, width, color);
  paint.rect(x, y + width, width, h - 2 * width, color);
  paint.rect(x + w - width, y + width, width, h - 2 * width, color);
}

/**
 * A framed box.
 * @param {Painter} paint @param {import('./ui.js').Rect} rect @param {number} width
 * @param {Color} edge @param {Color} fill
 */
function framed(paint, rect, width, edge, fill) {
  paint.rect(rect.x, rect.y, rect.w, rect.h, fill);
  outline(paint, rect, width, edge);
}

/** The width of a text in CSS pixels. @param {string} text @param {number} scale */
const textWidth = (text, scale) => text.length * 8 * scale;

/**
 * Text placed by alignment in a box, one line per "\n".
 * @param {Painter} paint @param {UiElement} element @param {number} ts @param {Color} color
 */
function lines(paint, element, ts, color) {
  const scale = element.scale ?? ts;
  const pitch = 20 * ts;
  const { rect } = element;
  for (const [index, line] of (element.text ?? "").split("\n").entries()) {
    const w = textWidth(line, scale);
    const x = element.align === "center"
      ? rect.x + (rect.w - w) / 2
      : element.align === "right"
      ? rect.x + rect.w - w
      : rect.x + (element.on ? 6 * ts : 0);
    paint.text(
      line,
      x,
      rect.y + index * pitch + (element.on ? ts : 0),
      scale,
      color,
    );
  }
}

/**
 * Draw the whole layout.
 * @param {Painter} paint @param {UiLayout} layout @param {DrawState} state
 */
export function drawUi(paint, layout, state) {
  const { ts } = layout;
  const bw = Math.max(1, ts);
  for (const element of layout.elements) {
    const { rect } = element;
    const color = PALETTE[element.color ?? "cream"] ?? PALETTE.cream;
    const down = state.pressed.has(element.id);
    switch (element.kind) {
      case "scrim":
        if (element.id === "loading") {
          paint.rect(rect.x, rect.y, rect.w, rect.h, PALETTE.night);
          const text = element.text ?? "";
          paint.text(
            text,
            rect.x + (rect.w - textWidth(text, 2 * ts)) / 2,
            rect.y + rect.h / 2 - 16 * ts,
            2 * ts,
            PALETTE.cream,
          );
        } else paint.rect(rect.x, rect.y, rect.w, rect.h, rgb(0, 0.55));
        break;
      case "panel":
        framed(
          paint,
          rect,
          bw,
          PALETTE.panelEdge,
          element.color === "white" ? PALETTE.white : PALETTE.panel,
        );
        break;
      case "text":
        if (element.on) {
          framed(
            paint,
            rect,
            bw,
            element.id === "panel:diagnostics"
              ? PALETTE.panelEdge
              : PALETTE.backdrop,
            PALETTE.backdrop,
          );
        }
        lines(paint, element, ts, color);
        break;
      case "line": {
        const text = element.text ?? "";
        const speaker = Math.min(element.speaker ?? 0, text.length);
        if (speaker) {
          paint.text(text.slice(0, speaker), rect.x, rect.y, ts, PALETTE.blue);
        }
        paint.text(
          text.slice(speaker),
          rect.x + speaker * 8 * ts,
          rect.y,
          ts,
          color,
        );
        break;
      }
      case "button": {
        const edge = element.on ? PALETTE.orange : PALETTE.panelEdge;
        const fill = down
          ? rgb(0x4a4d54)
          : element.on
          ? PALETTE.buttonOn
          : PALETTE.button;
        framed(paint, rect, bw, edge, fill);
        if (element.glyph) {
          bitmap(
            paint,
            element.glyph,
            rect.x + rect.w / 2,
            rect.y + rect.h / 2,
            Math.min(rect.w, rect.h) * 0.4,
            PALETTE.cream,
          );
        } else if (element.text) {
          const w = textWidth(element.text, ts);
          const x = element.align === "left"
            ? rect.x + 10 * ts
            : rect.x + (rect.w - w) / 2;
          paint.text(
            element.text,
            x,
            rect.y + (rect.h - 16 * ts) / 2,
            ts,
            element.on ? PALETTE.amber : PALETTE.cream,
          );
        }
        break;
      }
      case "round":
        drawRound(paint, element, ts, down);
        break;
      case "stick":
        drawStick(
          paint,
          element,
          ts,
          element.id === "stick:move" ? state.sticks.move : state.sticks.look,
        );
        break;
      case "slot": {
        const edge = element.on
          ? rgb(0xf08a24)
          : element.held
          ? PALETTE.heldEdge
          : PALETTE.slotEdge;
        framed(
          paint,
          rect,
          2 * bw,
          edge,
          element.held ? PALETTE.held : PALETTE.slot,
        );
        if (element.on) outline(paint, rect, 3 * bw, rgb(0xf08a24));
        const unit = 16 * ts;
        const size = Math.max(
          unit,
          Math.min(3 * unit, Math.floor((rect.w - 8 * ts) / unit) * unit),
        );
        if (element.item) {
          paint.item(
            element.item,
            rect.x + (rect.w - size) / 2,
            rect.y + (rect.h - size) / 2,
            size,
            1,
          );
        }
        if ((element.count ?? 0) > 1) {
          const text = String(element.count);
          paint.text(
            text,
            rect.x + rect.w - textWidth(text, ts) - 4 * ts,
            rect.y + rect.h - 16 * ts - 2 * ts,
            ts,
            PALETTE.cream,
          );
        }
        break;
      }
      case "row": {
        const edge = element.on ? PALETTE.orange : PALETTE.slotEdge;
        const alpha = element.dim ? 0.4 : 1;
        framed(
          paint,
          rect,
          bw,
          [edge[0], edge[1], edge[2], alpha],
          element.on ? rgb(0x3a2f26) : rgb(0x2a2c30, alpha),
        );
        if (element.on) {
          outline(
            paint,
            {
              x: rect.x + bw,
              y: rect.y + bw,
              w: rect.w - 2 * bw,
              h: rect.h - 2 * bw,
            },
            bw,
            PALETTE.orange,
          );
        }
        let x = rect.x + 8 * ts;
        const textY = rect.y + (rect.h - 16 * ts) / 2;
        if (element.item) {
          const size = 32 * ts;
          paint.item(
            element.item,
            x,
            rect.y + (rect.h - size) / 2,
            size,
            alpha,
          );
          x += size + 8 * ts;
        }
        const dim = (
          /** @type {Color} */ c,
        ) => /** @type {Color} */ ([c[0], c[1], c[2], alpha]);
        paint.text(element.text ?? "", x, textY, ts, dim(PALETTE.cream));
        const price = element.sub ?? "";
        const priceX = rect.x + rect.w - 8 * ts - textWidth(price, ts);
        paint.text(price, priceX, textY, ts, dim(PALETTE.price));
        const count = element.sub2 ?? "";
        paint.text(
          count,
          rect.x + rect.w - 8 * ts - 10 * 8 * ts - 8 * ts -
            textWidth(count, ts),
          textY,
          ts,
          dim(PALETTE.blue),
        );
        break;
      }
      case "icon": {
        framed(paint, rect, bw, PALETTE.panelEdge, rgb(0x1e2024, 0.8));
        const size = 32 * ts;
        if (element.item) {
          paint.item(
            element.item,
            rect.x + (rect.w - size) / 2,
            rect.y + (rect.h - size) / 2,
            size,
            1,
          );
        }
        break;
      }
      case "key": {
        const edge = element.on ? PALETTE.orange : PALETTE.panelEdge;
        const fill = down
          ? rgb(0xa8641c)
          : element.on
          ? PALETTE.buttonOn
          : element.text && element.text.length > 1
          ? rgb(0x2c2f33)
          : PALETTE.button;
        framed(paint, rect, bw, down ? PALETTE.amber : edge, fill);
        const label = element.text ?? "";
        const big = label.length === 1 && rect.h >= 34 * ts;
        const scale = big ? 2 * ts : ts;
        paint.text(
          label,
          rect.x + (rect.w - textWidth(label, scale)) / 2,
          rect.y + (rect.h - 16 * scale) / 2,
          scale,
          down ? PALETTE.white : element.on ? PALETTE.amber : PALETTE.cream,
        );
        break;
      }
      case "chatbar": {
        framed(paint, rect, bw, PALETTE.panelEdge, rgb(0x101010, 0.92));
        const draft = element.text ?? "";
        const caret = Math.floor(state.now / 500) % 2 === 0 ? "_" : " ";
        const columns = Math.max(
          4,
          Math.floor((rect.w - 16 * ts) / (8 * ts)) - 8,
        );
        const shown = draft.length > columns
          ? `...${draft.slice(-(columns - 3))}`
          : draft;
        const y = rect.y + (rect.h - 16 * ts) / 2;
        paint.text(`> ${shown}${caret}`, rect.x + 8 * ts, y, ts, PALETTE.cream);
        const count = `${element.count ?? 0}/${CHAT_LIMIT}`;
        paint.text(
          count,
          rect.x + rect.w - 8 * ts - textWidth(count, ts),
          y,
          ts,
          (element.count ?? 0) >= CHAT_LIMIT ? PALETTE.orange : PALETTE.dim,
        );
        break;
      }
      case "image":
        paint.qr(rect.x, rect.y, rect.w);
        break;
      default:
        break;
    }
  }
}

/**
 * A round button: the movement buttons beside the sticks and the A, L, B, and bag row.
 * @param {Painter} paint @param {UiElement} element @param {number} ts
 * @param {boolean} down
 */
function drawRound(paint, element, ts, down) {
  const cx = element.cx ?? 0;
  const cy = element.cy ?? 0;
  const r = element.r ?? 0;
  const cell = Math.max(1, ts);
  const lift = down ? 0 : 3 * ts;
  const locked = Boolean(element.locked);
  const on = Boolean(element.on);
  const face = locked
    ? rgb(0x6b7076)
    : on
    ? rgb(0xb8742a)
    : down
    ? rgb(0xe3e5e7)
    : rgb(0xc5c8cb);
  const edge = locked ? rgb(0x5a5f65) : on ? rgb(0xe4a34a) : rgb(0x8b9095);
  const ink = locked ? rgb(0x8d9195) : on ? PALETTE.white : PALETTE.ink;
  disc(paint, cx, cy + lift, r, PALETTE.shadow, cell);
  disc(paint, cx, cy + (down ? 2 * ts : 0), r, edge, cell);
  disc(paint, cx, cy + (down ? 2 * ts : 0), r - cell, face, cell);
  const oy = down ? 2 * ts : 0;
  if (element.glyph === "pickaxe") {
    const size = 16 * Math.max(1, Math.round(r * 1.1 / (16 * ts))) * ts;
    paint.item(
      "pickaxe",
      cx - size / 2,
      cy - size / 2 + oy,
      size,
      locked ? 0.6 : 1,
    );
  } else if (element.glyph === "sprint") {
    bitmap(paint, "sprint", cx, cy - 4 * ts + oy, r * 0.9, ink);
    const w = r * 1.2;
    const y = cy + r * 0.45 + oy;
    paint.rect(cx - w / 2, y, w, 4 * ts, rgb(0x282b2f, 0.2));
    const fill = Math.max(0, Math.min(1, element.fill ?? 0));
    paint.rect(
      cx - w / 2,
      y,
      w * fill,
      4 * ts,
      on ? PALETTE.white : locked ? rgb(0xe4a34a) : rgb(0x2f8f4e),
    );
  } else if (element.glyph) {
    bitmap(paint, element.glyph, cx, cy + oy, r * 0.9, ink);
  } else if (element.text) {
    const scale = element.scale ?? 2 * ts;
    paint.text(
      element.text,
      cx - textWidth(element.text, scale) / 2,
      cy - 8 * scale + oy,
      scale,
      ink,
    );
  }
}

/**
 * A stick: the base, eight octant guides, the dead zone ring, and the knob.
 * @param {Painter} paint @param {UiElement} element @param {number} ts
 * @param {{active:boolean,x:number,y:number}} knob
 */
function drawStick(paint, element, ts, knob) {
  const cx = element.cx ?? 0;
  const cy = element.cy ?? 0;
  const r = element.r ?? 0;
  const cell = Math.max(1, 2 * ts);
  disc(paint, cx, cy, r, rgb(0x484d53), cell);
  disc(paint, cx, cy, r - cell, rgb(0x292c30), cell);
  const dead = Math.max(20, r * 0.24);
  const dot = Math.max(1, 2 * ts);
  const guide = rgb(0x9198a0, 0.55);
  // Guides run along the borders between octants.
  for (let n = 0; n < 8; n++) {
    const angle = Math.PI / 8 + n * Math.PI / 4;
    for (let d = dead + 8 * ts; d < r - 4 * ts; d += 7 * ts) {
      paint.rect(
        cx + Math.cos(angle) * d - dot / 2,
        cy + Math.sin(angle) * d - dot / 2,
        dot,
        dot,
        guide,
      );
    }
  }
  const dash = rgb(0xa0a6ad);
  for (let n = 0; n < 24; n++) {
    const angle = n * Math.PI / 12;
    paint.rect(
      cx + Math.cos(angle) * dead - dot / 2,
      cy + Math.sin(angle) * dead - dot / 2,
      dot,
      dot,
      dash,
    );
  }
  const kx = cx + knob.x;
  const ky = cy + knob.y;
  const kr = r * 0.24;
  const ring = knob.active ? PALETTE.white : rgb(0xf4f5f6);
  if (knob.active) disc(paint, kx, ky, kr, rgb(0xffffff, 0.14), cell);
  for (let n = 0; n < 20; n++) {
    const angle = n * Math.PI / 10;
    paint.rect(
      kx + Math.cos(angle) * kr - dot,
      ky + Math.sin(angle) * kr - dot,
      2 * dot,
      2 * dot,
      ring,
    );
  }
  const red = rgb(0xe34d52);
  paint.rect(kx - 5 * ts, ky - ts, 10 * ts, 2 * ts, red);
  paint.rect(kx - ts, ky - 5 * ts, 2 * ts, 10 * ts, red);
}
