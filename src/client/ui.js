// @ts-check

import { itemInfo, PICKAXE, STONE_ITEM } from "../shared/items.js";

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

/** The most characters a chat message holds. */
export const CHAT_LIMIT = 120;

/** @typedef {{x:number,y:number,w:number,h:number}} Rect */
/** @typedef {{top:number,right:number,bottom:number,left:number}} Insets */
/** @typedef {import('../shared/hearing-log.js').HearingLine} HearingLine */
/** @typedef {import('../shared/shop.js').ShopRow} ShopRow */
/** @typedef {import('../shared/items.js').Stack} Stack */

/**
 * One UI element. `kind` says how it draws; `hit` makes it take pointers;
 * `blocks` makes it hide the world and elements below from pointers without
 * acting. `act` says when a hit acts: on pointer down (buttons), on release
 * without a drag (rows in a scrolling list), or on release (fullscreen, which
 * the browser lets start only from a release).
 * @typedef {object} UiElement
 * @property {string} id
 * @property {"scrim"|"panel"|"text"|"button"|"round"|"stick"|"slot"|"row"|"key"|"chatbar"|"line"|"image"|"icon"|"zone"} kind
 * @property {Rect} rect
 * @property {boolean} [hit]
 * @property {boolean} [blocks]
 * @property {boolean} [round] the hit area is the circle inside `rect`
 * @property {"down"|"tap"|"release"|"stick"} [act]
 * @property {string} [scroll] the scroll list a drag on this element moves
 * @property {string} [text]
 * @property {string} [color] a palette name
 * @property {"left"|"center"|"right"} [align]
 * @property {number} [scale] glyph scale in CSS pixels per font pixel
 * @property {string} [glyph] a drawn symbol: "x", "fullscreen", "bag", "sprint", "item"
 * @property {string} [item] an item kind to draw
 * @property {number} [count]
 * @property {boolean} [on] a toggled button, or the selected row or slot
 * @property {boolean} [held] the slot of the held item
 * @property {boolean} [dim]
 * @property {boolean} [locked]
 * @property {number} [fill] a 0 to 1 bar, such as stamina
 * @property {string} [key] the keyboard action: a character or a named key
 * @property {string} [name] the name of a row (its shop row key)
 * @property {number} [speaker] characters at the start of `text` that name a speaker
 * @property {string} [sub] a second text, such as a price
 * @property {string} [sub2] a third text, such as a count
 * @property {number} [cx] circle center
 * @property {number} [cy]
 * @property {number} [r]
 */

/**
 * What the layout needs to know. Everything is optional except the size.
 * @typedef {object} UiView
 * @property {number} width the canvas width in CSS pixels
 * @property {number} height
 * @property {Insets} [safe] safe-area insets in CSS pixels
 * @property {number} [scale] the UI scale setting, 1 to 2
 * @property {number} [dpr] device pixels per CSS pixel
 * @property {boolean} [touch] touch controls and the in-game keyboard apply
 * @property {string|null} [loading] the loading screen text, or null
 * @property {string} [status]
 * @property {string} [displayStatus]
 * @property {string} [update] the stale-build notice; a tap reloads the page
 * @property {string|null} [diagnostics] the F3 panel text, or null when closed
 * @property {string|null} [zoom] the level and zoom text, or null
 * @property {boolean} [fullscreen] show the fullscreen button
 * @property {boolean} [fullscreenOn]
 * @property {{tools:boolean,players:number,joinOpen:boolean,qr:boolean}} [host]
 * @property {string} [held] the held item kind
 * @property {{value:number,on:boolean,locked:boolean}} [stamina]
 * @property {{open:boolean,pressed?:boolean}} [logButton]
 * @property {boolean} [bagOpenButton]
 * @property {{move:Knob,look:Knob}} [sticks]
 * @property {{open:boolean,draft:string,page:"letters"|"symbols",shift:boolean}} [chat]
 * @property {{open:boolean,page:string,scale:number,textSize:string,sizes:readonly string[],voices?:string,voiceLevels?:readonly string[],music?:string,musicLevels?:readonly string[],mode:string,build?:string}} [menu]
 * @property {{open:boolean,lines:readonly HearingLine[],scroll:number}} [log]
 * @property {{open:boolean,stacks:readonly Stack[],selected:number,held:string}} [bag]
 * @property {{open:boolean,rows:readonly ShopRow[],selected:string,scroll:number}} [shop]
 * @property {{open:boolean,status:string,stats:string,items:readonly {id:string}[]}} [sessions]
 */
/** @typedef {{active:boolean,x:number,y:number}} Knob the knob offset from the stick center in CSS pixels */

/**
 * @typedef {object} UiLayout
 * @property {number} width
 * @property {number} height
 * @property {number} ts CSS pixels per font pixel
 * @property {number} k device pixels per font pixel
 * @property {UiElement[]} elements in draw order
 * @property {Map<string,UiElement>} byId
 * @property {Rect} safeRect
 * @property {{x:number,y:number,w:number,h:number,capacity:number}|null} shopList
 * @property {{capacity:number,total:number,scroll:number}|null} logList
 * @property {number} controlsTop
 * @property {number|null} chatTop the top of the in-game keyboard and chat line, or null while none shows
 */

/** @type {Insets} */
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

/** @param {number} value @param {number} min @param {number} max */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** @param {Rect} rect @param {number} x @param {number} y */
export function rectContains(rect, x, y) {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y &&
    y < rect.y + rect.h;
}

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

/** Keyboard pages: rows of keys. The letter pages share one shape. */
const LETTER_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const SYMBOL_ROWS = ["1234567890", '-/:;()$&@"', ".,?!'_="];
const SYMBOL_LEFT = "#";

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

  // Touch controls: two sticks, interact and sprint beside them, and the
  // A, L, B, and bag buttons in a row.
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
    roundButton(
      "btn:interact",
      moveX + stick + 6,
      stickBottom - roundSize,
      roundSize,
      { glyph: "item", item: view.held === STONE_ITEM ? STONE_ITEM : PICKAXE },
    );
    roundButton(
      "btn:sprint",
      lookX - 6 - roundSize,
      stickBottom - roundSize,
      roundSize,
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
      ["btn:chat", "chat", { text: "A" }],
      ["btn:log", "log", { text: "L", on: Boolean(view.logButton?.open) }],
      ["btn:menu", "menu", { text: "B" }],
      ["btn:bag", "bag", { glyph: "bag", on: Boolean(view.bagOpenButton) }],
    ];
    for (const [index, [id, , extra]] of buttons.entries()) {
      roundButton(id, rowX + index * (actionSize + gap), rowY, actionSize, {
        ...extra,
        scale: 2 * ts,
      });
    }
    controlsTop = Math.min(stickTop, rowY, stickBottom - roundSize);
  }

  // The top left column: status, then diagnostics. The log goes under both.
  const topRight = [];
  const fullscreenSize = 44 * s;
  let rightEdge = right - edge;
  if (view.fullscreen && touch) {
    const rect = box(
      rightEdge - fullscreenSize,
      top + edge,
      fullscreenSize,
      fullscreenSize,
    );
    topRight.push(rect);
    add({
      id: "btn:fullscreen",
      kind: "round",
      rect,
      hit: true,
      round: true,
      act: "release",
      glyph: view.fullscreenOn ? "x" : "fullscreen",
      cx: rect.x + rect.w / 2,
      cy: rect.y + rect.h / 2,
      r: rect.w / 2,
    });
    rightEdge -= fullscreenSize + 8 * s;
  }
  let hostLeft = rightEdge;
  const host = view.host;
  if (host?.tools) {
    const label = `${host.players} player${host.players === 1 ? "" : "s"}`;
    const countW = label.length * cw;
    const qrW = 2 * cw + 24 * s;
    const toolH = 30 * s;
    const toolY = top + edge + (fullscreenSize - toolH) / 2;
    const qrX = rightEdge - countW - 8 * s - qrW;
    add({
      id: "btn:qr",
      kind: "button",
      rect: box(qrX, toolY, qrW, toolH),
      hit: true,
      act: "down",
      text: "QR",
      on: host.joinOpen,
    });
    add({
      id: "text:players",
      kind: "text",
      rect: box(rightEdge - countW, toolY + (toolH - lh) / 2, countW, lh),
      text: label,
      color: "cream",
      scale: ts,
    });
    hostLeft = qrX;
    topRight.push(box(qrX, toolY, rightEdge - qrX, toolH));
  }
  const statusText = ascii(view.status ?? "");
  let leftY = top + edge;
  if (statusText) {
    const available = Math.max(
      cw * 8,
      (topRight.length ? hostLeft : right - edge) - 8 * s - (left + edge),
    );
    const columns = Math.floor((available - 12 * s) / cw);
    const lines = wrapText(statusText, columns).slice(0, 3);
    const longest = Math.max(...lines.map((line) => line.length));
    const w = longest * cw + 12 * s;
    const h = lines.length * pitch + 2 * s;
    add({
      id: "text:status",
      kind: "text",
      rect: box(left + edge, leftY, w, h),
      text: lines.join("\n"),
      color: "cream",
      scale: ts,
      align: "left",
      on: true,
    });
    leftY += h + 6 * s;
  }
  const updateText = ascii(view.update ?? "");
  if (updateText) {
    const available = Math.max(
      cw * 8,
      (topRight.length ? hostLeft : right - edge) - 8 * s - (left + edge),
    );
    const lines = wrapText(updateText, Math.floor((available - 12 * s) / cw))
      .slice(0, 3);
    const longest = Math.max(...lines.map((line) => line.length));
    const h = lines.length * pitch + 2 * s;
    add({
      id: "btn:update",
      kind: "text",
      rect: box(left + edge, leftY, longest * cw + 12 * s, h),
      text: lines.join("\n"),
      color: "amber",
      scale: ts,
      align: "left",
      on: true,
      hit: true,
      act: "down",
    });
    leftY += h + 6 * s;
  }
  if (view.diagnostics) {
    const lines = ascii(view.diagnostics).split("\n");
    const longest = Math.max(...lines.map((line) => line.length));
    const w = Math.min(safeRect.w - 2 * edge, longest * cw + 20 * s);
    const h = lines.length * pitch + 12 * s;
    add({
      id: "panel:diagnostics",
      kind: "text",
      rect: box(left + edge, leftY, w, h),
      text: lines.join("\n"),
      color: "cream",
      scale: ts,
      align: "left",
      on: true,
    });
    leftY += h + 6 * s;
  }
  // Top right, below the buttons: the held item, then the display status.
  let rightY = top + edge + fullscreenSize + 6 * s;
  if (view.held) {
    const size = 44 * s;
    add({
      id: "icon:held",
      kind: "icon",
      rect: box(right - edge - size, rightY, size, size),
      item: view.held,
    });
    rightY += size + 6 * s;
  }
  const displayText = ascii(view.displayStatus ?? "");
  if (displayText) {
    const columns = Math.floor(
      Math.min(240 * s, 0.6 * safeRect.w) / cw,
    );
    const lines = displayText.split("\n").flatMap((line) =>
      wrapText(line, columns)
    );
    const longest = Math.max(...lines.map((line) => line.length));
    const w = longest * cw;
    add({
      id: "text:display",
      kind: "text",
      rect: box(right - edge - w, rightY, w, lines.length * pitch),
      text: lines.join("\n"),
      color: "cream",
      scale: ts,
      align: "right",
    });
  }
  if (view.zoom) {
    const w = view.zoom.length * cw + 16 * s;
    add({
      id: "text:zoom",
      kind: "text",
      rect: box(
        (left + right) / 2 - w / 2,
        top + edge + 6 * s,
        w,
        pitch + 4 * s,
      ),
      text: view.zoom,
      color: "gold",
      scale: ts,
      align: "center",
      on: true,
    });
  }

  // The area panels may use: the middle of the screen, above the controls.
  const panelTop = touch ? top + 64 * s : top + edge;
  /**
   * The lowest edge a panel centered at `x` with width `w` may reach.
   * @param {number} x @param {number} w
   */
  const panelLimit = (x, w) => {
    let limit = bottom - edge;
    for (const rect of controlRects) {
      if (rect.x < x + w / 2 && rect.x + rect.w > x - w / 2) {
        limit = Math.min(limit, rect.y - 8 * s);
      }
    }
    for (const element of elements) {
      if (element.kind !== "stick") continue;
      if (
        element.rect.x < x + w / 2 &&
        element.rect.x + element.rect.w > x - w / 2
      ) {
        limit = Math.min(limit, element.rect.y - 8 * s);
      }
    }
    return limit;
  };
  const middle = (left + right) / 2;
  const headerH = 32 * s;
  /**
   * A panel frame with a title bar and a close button.
   * @param {string} id @param {Rect} rect @param {string} title @param {string} color
   */
  const frame = (id, rect, title, color) => {
    add({ id: `panel:${id}`, kind: "panel", rect, blocks: true });
    add({
      id: `text:${id}-title`,
      kind: "text",
      rect: box(
        rect.x + 10 * s,
        rect.y + (headerH - lh) / 2,
        title.length * cw,
        lh,
      ),
      text: title,
      color,
      scale: ts,
      align: "left",
    });
    const closeSize = headerH - 4 * s;
    add({
      id: `btn:${id}-close`,
      kind: "button",
      rect: box(
        rect.x + rect.w - closeSize - 4 * s,
        rect.y + 2 * s,
        closeSize,
        closeSize,
      ),
      hit: true,
      act: "down",
      glyph: "x",
    });
  };

  /** @type {UiLayout["logList"]} */
  let logList = null;
  const log = view.log;
  if (log?.open) {
    const w = Math.min(420 * s, safeRect.w - 2 * edge);
    const maxH = Math.min(0.38 * H, 300 * s);
    const y = Math.max(top + 62 * s, leftY);
    const columns = Math.max(4, Math.floor((w - 20 * s) / cw));
    /** @type {{text:string,kind:string,speaker:number}[]} */
    const wrapped = [];
    for (const line of log.lines) {
      const prefix = line.kind === "chat"
        ? `${ascii(line.speaker ?? "")}: `
        : "";
      const lines = wrapText(`${prefix}${ascii(line.text ?? "")}`, columns);
      for (const [index, text] of lines.entries()) {
        wrapped.push({
          text,
          kind: line.kind,
          speaker: index === 0 ? prefix.length : 0,
        });
      }
    }
    const capacity = Math.max(1, Math.floor((maxH - headerH - 8 * s) / pitch));
    if (!wrapped.length) {
      wrapped.push({ text: "Nothing heard yet.", kind: "empty", speaker: 0 });
    }
    const shown = Math.min(capacity, wrapped.length);
    const h = headerH + 8 * s + Math.max(1, shown) * pitch;
    const maxScroll = Math.max(0, wrapped.length - capacity);
    const scroll = clamp(Math.round(log.scroll), 0, maxScroll);
    frame("log", box(left + edge, y, w, h), "HEARING LOG", "cream");
    const listRect = box(left + edge, y + headerH, w, h - headerH);
    add({
      id: "list:log",
      kind: "zone",
      rect: listRect,
      blocks: true,
      hit: true,
      act: "tap",
      scroll: "log",
    });
    const end = wrapped.length - scroll;
    const start = Math.max(0, end - capacity);
    for (let index = start; index < end; index++) {
      const line = wrapped[index];
      add({
        id: `line:log:${index}`,
        kind: "line",
        rect: box(
          listRect.x + 10 * s,
          listRect.y + 4 * s + (index - start) * pitch,
          line.text.length * cw,
          lh,
        ),
        text: line.text,
        color: line.kind === "system"
          ? "amber"
          : line.kind === "empty"
          ? "dim"
          : "cream",
        speaker: line.speaker,
      });
    }
    logList = { capacity, total: wrapped.length, scroll };
  }

  // The /host world list.
  const sessions = view.sessions;
  if (sessions?.open) {
    const w = Math.min(300 * s, 0.75 * safeRect.w);
    const columns = Math.floor((w - 20 * s) / cw);
    const stats = sessions.stats
      ? wrapText(ascii(sessions.stats), columns)
      : [];
    const rowH = 36 * s;
    const maxRows = Math.max(
      1,
      Math.floor((0.5 * H - 3 * pitch - stats.length * pitch) / (rowH + 6 * s)),
    );
    const items = sessions.items.slice(0, maxRows);
    const h = 12 * s + pitch * 1.5 + stats.length * pitch + 8 * s +
      items.length * (rowH + 6 * s) + 8 * s;
    const x = right - edge - w;
    const y = top + 72 * s;
    add({
      id: "panel:sessions",
      kind: "panel",
      rect: box(x, y, w, h),
      blocks: true,
    });
    let cursor = y + 10 * s;
    add({
      id: "text:sessions-title",
      kind: "text",
      rect: box(x + 10 * s, cursor, 14 * cw, lh),
      text: "ACTIVE WORLDS",
      color: "amber",
      scale: ts,
      align: "left",
    });
    cursor += pitch * 1.5;
    add({
      id: "text:sessions-status",
      kind: "text",
      rect: box(x + 10 * s, cursor - 4 * s, w - 20 * s, pitch),
      text: ascii(sessions.status).slice(0, columns),
      color: "cream",
      scale: ts,
      align: "left",
    });
    cursor += pitch;
    if (stats.length) {
      add({
        id: "text:sessions-stats",
        kind: "text",
        rect: box(x + 10 * s, cursor, w - 20 * s, stats.length * pitch),
        text: stats.join("\n"),
        color: "dim",
        scale: ts,
        align: "left",
      });
      cursor += stats.length * pitch;
    }
    cursor += 8 * s;
    for (const item of items) {
      add({
        id: `btn:session:${item.id}`,
        kind: "button",
        rect: box(x + 10 * s, cursor, w - 20 * s, rowH),
        hit: true,
        act: "down",
        text: `Join ${item.id.slice(0, 8)} - WebRTC`.slice(0, columns),
        align: "left",
      });
      cursor += rowH + 6 * s;
    }
  }

  // The inventory panel, centered.
  const bag = view.bag;
  if (bag?.open) {
    const w = Math.min(300 * s, safeRect.w - 2 * edge);
    const columns = 4;
    const gap = 6 * s;
    const pad = 10 * s;
    const rows = Math.max(1, Math.ceil(bag.stacks.length / columns));
    const limit = panelLimit(middle, w);
    const slotFit = Math.floor((w - 2 * pad - (columns - 1) * gap) / columns);
    const nameH = pitch + 10 * s;
    const verticalRoom = limit - panelTop - headerH - nameH - 2 * pad;
    const slot = Math.max(
      24,
      Math.min(slotFit, Math.floor((verticalRoom - (rows - 1) * gap) / rows)),
    );
    const gridW = columns * slot + (columns - 1) * gap;
    const h = headerH + 2 * pad + rows * slot + (rows - 1) * gap + nameH;
    const x = middle - w / 2;
    const area = limit - panelTop;
    const y = touch
      ? panelTop + Math.max(0, (area - h) / 2)
      : top + Math.max(edge, (safeRect.h - h) / 2);
    frame("bag", box(x, y, w, h), "INVENTORY", "cream");
    const gx = x + (w - gridW) / 2;
    const gy = y + headerH + pad;
    for (const [index, stack] of bag.stacks.entries()) {
      add({
        id: `slot:${stack.kind}`,
        kind: "slot",
        rect: box(
          gx + (index % columns) * (slot + gap),
          gy + Math.floor(index / columns) * (slot + gap),
          slot,
          slot,
        ),
        hit: true,
        act: "down",
        item: stack.kind,
        count: stack.count,
        on: index === bag.selected,
        held: stack.kind === bag.held,
      });
    }
    const current = bag.stacks[bag.selected];
    const name = current
      ? `${itemInfo(current.kind)?.name ?? current.kind}${
        current.kind === bag.held ? " (held)" : ""
      }`
      : "";
    add({
      id: "text:bag-name",
      kind: "text",
      rect: box(x + pad, y + h - nameH, w - 2 * pad, pitch),
      text: ascii(name),
      color: "cream",
      scale: ts,
      align: "left",
    });
  }

  // The shop panel.
  /** @type {UiLayout["shopList"]} */
  let shopList = null;
  const shop = view.shop;
  if (shop?.open) {
    const w = Math.min(380 * s, safeRect.w - 2 * edge);
    const limit = panelLimit(middle, w);
    const rowH = Math.max(40 * s, lh + 12 * s);
    const footH = pitch + 10 * s;
    const maxH = Math.max(headerH + footH + rowH + 16 * s, limit - panelTop);
    const capacity = Math.max(
      1,
      Math.floor((maxH - headerH - footH - 12 * s) / (rowH + 4 * s)),
    );
    const shown = Math.min(capacity, shop.rows.length);
    const listH = shown * (rowH + 4 * s) + 12 * s;
    const h = headerH + listH + footH;
    const x = middle - w / 2;
    frame("shop", box(x, panelTop, w, h), "SHOPKEEPER BUYS", "amber");
    const maxScroll = Math.max(0, shop.rows.length - capacity);
    const scroll = clamp(Math.round(shop.scroll), 0, maxScroll);
    const listTop = panelTop + headerH;
    add({
      id: "list:shop",
      kind: "zone",
      rect: box(x, listTop, w, listH),
      blocks: true,
      hit: true,
      act: "tap",
      scroll: "shop",
    });
    for (let n = 0; n < shown; n++) {
      const row = shop.rows[scroll + n];
      if (!row) break;
      const name = row.type === "all" ? "all" : row.kind;
      add({
        id: `row:${name}`,
        kind: "row",
        rect: box(
          x + 6 * s,
          listTop + 6 * s + n * (rowH + 4 * s),
          w - 12 * s,
          rowH,
        ),
        hit: true,
        act: "tap",
        scroll: "shop",
        name,
        item: row.type === "all" ? undefined : row.kind,
        text: row.type === "all"
          ? "Sell all ore"
          : ascii(itemInfo(row.kind)?.name ?? row.kind),
        sub2: row.type === "all"
          ? row.enabled ? `x${row.count}` : ""
          : `x${row.count}`,
        sub: row.type === "all"
          ? row.enabled
            ? `${row.coins} coin${row.coins === 1 ? "" : "s"}`
            : "no ore"
          : row.enabled
          ? `${row.price} each`
          : "not bought",
        on: row.enabled && name === shop.selected,
        dim: !row.enabled,
      });
    }
    add({
      id: "text:shop-hint",
      kind: "text",
      rect: box(x + 10 * s, panelTop + h - footH + 6 * s, w - 20 * s, pitch),
      text: touch ? "Tap a row to sell" : "IJKL: choose  Interact: sell",
      color: "dim",
      scale: ts,
      align: "left",
    });
    shopList = {
      x,
      y: listTop,
      w,
      h: listH,
      capacity,
    };
  }

  // Chat: the typed line, and on touch the keyboard under it.
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

  // The join QR code, over the panels.
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

  // The menu.
  const menu = view.menu;
  if (menu?.open) {
    add({
      id: "scrim:menu",
      kind: "scrim",
      rect: box(0, 0, W, H),
      hit: true,
      blocks: true,
      act: "down",
    });
    const w = Math.min(320 * s, safeRect.w - 20);
    const touchHints = menu.mode === "touch";
    const rootRows = ["Resume", "Settings", "Leave Game"];
    const hints = menu.mode === "gamepad"
      ? [
        "LEFT STICK MOVE",
        "RIGHT STICK CAMERA",
        "4 5 LEVEL  6 7 ZOOM",
        "3 MENU",
      ]
      : touchHints
      ? [
        "LEFT STICK MOVE",
        "RIGHT STICK CAMERA",
        "PINCH TO ZOOM",
        "TWO FINGERS DRAG Z",
        "A CHAT  B MENU",
      ]
      : [
        "ESDF MOVE  IJKL LOOK",
        "R V LEVEL  U N ZOOM",
        "T CHAT  / COMMAND",
        "ESC OR Q MENU",
      ];
    const rowH = Math.max(34 * s, lh + 12 * s);
    const settings = menu.page === "settings";
    const bodyRows = settings ? 7 : rootRows.length;
    const hintLines = settings ? 0 : hints.length + (menu.build ? 1 : 0);
    const h = Math.min(
      safeRect.h - 20,
      12 * s + pitch + 8 * s + bodyRows * (rowH + 4 * s) + hintLines * pitch +
        16 * s,
    );
    const x = middle - w / 2;
    const y = top + (safeRect.h - h) / 2;
    add({
      id: "panel:menu",
      kind: "panel",
      rect: box(x, y, w, h),
      blocks: true,
    });
    let cursor = y + 10 * s;
    add({
      id: "text:menu-title",
      kind: "text",
      rect: box(x, cursor, w, lh),
      text: settings ? "Settings" : "Open Dwarf",
      color: "amber",
      scale: ts,
      align: "center",
    });
    cursor += pitch + 8 * s;
    /** @param {string} id @param {string} label @param {Rect} rect @param {Partial<UiElement>} [extra] */
    const menuButton = (id, label, rect, extra = {}) =>
      add({
        id: `btn:${id}`,
        kind: "button",
        rect,
        hit: true,
        act: "down",
        text: label,
        align: "center",
        ...extra,
      });
    const inner = w - 24 * s;
    const bx = x + 12 * s;
    if (settings) {
      add({
        id: "text:menu-ui-scale",
        kind: "text",
        rect: box(x, cursor, w, lh),
        text: "UI Scale",
        color: "cream",
        scale: ts,
        align: "center",
      });
      cursor += pitch;
      const third = (inner - 2 * 6 * s) / 3;
      menuButton("scale-down", "-", box(bx, cursor, third, rowH));
      add({
        id: "text:menu-scale-value",
        kind: "text",
        rect: box(bx + third + 6 * s, cursor + (rowH - lh) / 2, third, lh),
        text: menu.scale.toFixed(2),
        color: "cream",
        scale: ts,
        align: "center",
      });
      menuButton(
        "scale-up",
        "+",
        box(bx + 2 * (third + 6 * s), cursor, third, rowH),
      );
      cursor += rowH + 8 * s;
      add({
        id: "text:menu-text-size",
        kind: "text",
        rect: box(x, cursor, w, lh),
        text: "Text Size",
        color: "cream",
        scale: ts,
        align: "center",
      });
      cursor += pitch;
      for (const [index, size] of menu.sizes.entries()) {
        menuButton(
          `size:${size}`,
          size[0].toUpperCase() + size.slice(1),
          box(bx + index * (third + 6 * s), cursor, third, rowH),
          { on: size === menu.textSize },
        );
      }
      cursor += rowH + 8 * s;
      if (menu.voiceLevels) {
        add({
          id: "text:menu-voices",
          kind: "text",
          rect: box(x, cursor, w, lh),
          text: "Voices",
          color: "cream",
          scale: ts,
          align: "center",
        });
        cursor += pitch;
        const quarter = (inner - 3 * 4 * s) / 4;
        for (const [index, level] of menu.voiceLevels.entries()) {
          menuButton(
            `voices:${level}`,
            level[0].toUpperCase() + level.slice(1),
            box(bx + index * (quarter + 4 * s), cursor, quarter, rowH),
            { on: level === menu.voices },
          );
        }
        cursor += rowH + 8 * s;
      }
      if (menu.musicLevels) {
        add({
          id: "text:menu-music",
          kind: "text",
          rect: box(x, cursor, w, lh),
          text: "Music",
          color: "cream",
          scale: ts,
          align: "center",
        });
        cursor += pitch;
        const fifth = (inner - 4 * 4 * s) / 5;
        for (const [index, level] of menu.musicLevels.entries()) {
          menuButton(
            `music:${level}`,
            level === "off" ? "Off" : level,
            box(bx + index * (fifth + 4 * s), cursor, fifth, rowH),
            { on: level === menu.music },
          );
        }
        cursor += rowH + 8 * s;
      }
      menuButton("back", "Back", box(bx, cursor, inner, rowH));
    } else {
      for (const [index, label] of rootRows.entries()) {
        menuButton(
          ["resume", "settings", "leave"][index],
          label,
          box(bx, cursor, inner, rowH),
        );
        cursor += rowH + 4 * s;
      }
      add({
        id: "text:menu-hints",
        kind: "text",
        rect: box(x, cursor + 6 * s, w, hints.length * pitch),
        text: hints.join("\n"),
        color: "dim",
        scale: ts,
        align: "center",
      });
      if (menu.build) {
        add({
          id: "text:menu-build",
          kind: "text",
          rect: box(x, cursor + 6 * s + hints.length * pitch, w, pitch),
          text: ascii(menu.build),
          color: "dim",
          scale: ts,
          align: "center",
        });
      }
    }
  }

  // The loading screen covers everything.
  if (loading) {
    add({
      id: "loading",
      kind: "scrim",
      rect: box(0, 0, W, H),
      hit: true,
      blocks: true,
      text: ascii(loading),
      scale: ts,
    });
  }

  /** @type {Map<string,UiElement>} */
  const byId = new Map();
  for (const element of elements) byId.set(element.id, element);
  return {
    width: W,
    height: H,
    ts,
    k,
    elements,
    byId,
    safeRect,
    shopList,
    logList,
    controlsTop,
    chatTop,
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
