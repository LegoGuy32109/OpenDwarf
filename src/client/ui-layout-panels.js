// @ts-check
// The panels: log, host list, inventory and shop. Each function adds its elements to `ctx`.

import { ascii, clamp, wrapText } from "./ui-kit.js";
import { itemInfo } from "../shared/items.js";

/** @typedef {import('./ui-types.js').Rect} Rect */
/** @typedef {import('./ui-types.js').UiLayout} UiLayout */
/** @typedef {import('./ui-layout-context.js').LayoutContext} LayoutContext */

/** @param {NonNullable<LayoutContext['view']['log']>['lines']} feed @param {number} columns */
function logRows(feed, columns) {
  /** @type {{text:string,kind:string,speaker:number}[]} */
  const wrapped = [];
  for (const line of feed) {
    const prefix = line.kind === "chat" ? `${ascii(line.speaker ?? "")}: ` : "";
    const lines = wrapText(`${prefix}${ascii(line.text ?? "")}`, columns);
    for (const [index, text] of lines.entries()) {
      wrapped.push({
        text,
        kind: line.kind,
        speaker: index === 0 ? prefix.length : 0,
      });
    }
  }
  return wrapped;
}

/**
 * The area panels may use: the middle of the screen, above the controls.
 * @param {LayoutContext} ctx
 * @param {Pick<ReturnType<typeof import('./ui-layout-controls.js').layoutControls>, "controlRects"> & Pick<ReturnType<typeof import('./ui-layout-hud.js').layoutStatus>, "leftY">} input
 */
export function layoutArea(ctx, input) {
  const {
    view,
    H,
    s,
    ts,
    cw,
    lh,
    pitch,
    edge,
    touch,
    safeRect,
    right,
    top,
    bottom,
    elements,
    add,
    box,
    left,
  } = ctx;
  const { controlRects, leftY } = input;
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
    const wrapped = logRows(log.lines, columns);
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
  return { panelTop, panelLimit, middle, headerH, frame, logList };
}

/**
 * The /host world list.
 * @param {LayoutContext} ctx
 */
export function layoutHostList(ctx) {
  const {
    view,
    H,
    s,
    ts,
    cw,
    lh,
    pitch,
    edge,
    safeRect,
    right,
    top,
    add,
    box,
  } = ctx;
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
}

/**
 * The inventory panel, centered.
 * @param {LayoutContext} ctx
 * @param {Pick<ReturnType<typeof import('./ui-layout-panels.js').layoutArea>, "panelTop" | "panelLimit" | "middle" | "headerH" | "frame">} input
 */
export function layoutInventory(ctx, input) {
  const { view, s, ts, pitch, edge, touch, safeRect, top, add, box } = ctx;
  const { panelTop, panelLimit, middle, headerH, frame } = input;
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
}

/** @param {NonNullable<LayoutContext['view']['shop']>['rows'][number]} row @param {string} selected */
function shopRow(row, selected) {
  const name = row.type === "all" ? "all" : row.kind;
  return {
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
    on: row.enabled && name === selected,
    dim: !row.enabled,
  };
}

/**
 * The shop panel.
 * @param {LayoutContext} ctx
 * @param {Pick<ReturnType<typeof import('./ui-layout-panels.js').layoutArea>, "panelTop" | "panelLimit" | "middle" | "headerH" | "frame">} input
 */
export function layoutShop(ctx, input) {
  const { view, s, ts, lh, pitch, edge, touch, safeRect, add, box } = ctx;
  const { panelTop, panelLimit, middle, headerH, frame } = input;
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
        ...shopRow(row, shop.selected),
      });
    }
    add({
      id: "text:shop-hint",
      kind: "text",
      rect: box(x + 10 * s, panelTop + h - footH + 6 * s, w - 20 * s, pitch),
      text: touch ? "Tap a row to sell" : "IJKL: choose  Space: sell  Q: back",
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
  return { shopList };
}
