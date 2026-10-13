// @ts-check
// The corner readouts: status, diagnostics, held item and display. Each function adds its elements to `ctx`.

import { ascii, wrapText } from "./ui-kit.js";

/** @typedef {import('./ui-layout-context.js').LayoutContext} LayoutContext */

/**
 * The top left column: status, then diagnostics. The log goes under both.
 * @param {LayoutContext} ctx
 */
export function layoutStatus(ctx) {
  const {
    view,
    s,
    ts,
    cw,
    lh,
    pitch,
    edge,
    touch,
    safeRect,
    left,
    right,
    top,
    add,
    box,
  } = ctx;
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
    // Offline there is no join link: a label stands where the QR button is.
    const qrW = host.offline ? 7 * cw + 8 * s : 2 * cw + 24 * s;
    const toolH = 30 * s;
    const toolY = top + edge + (fullscreenSize - toolH) / 2;
    const qrX = rightEdge - countW - 8 * s - qrW;
    if (host.offline) {
      add({
        id: "text:offline",
        kind: "text",
        rect: box(qrX, toolY + (toolH - lh) / 2, qrW - 8 * s, lh),
        text: "OFFLINE",
        color: "cream",
        scale: ts,
      });
    } else {
      add({
        id: "btn:qr",
        kind: "button",
        rect: box(qrX, toolY, qrW, toolH),
        hit: true,
        act: "down",
        text: "QR",
        on: host.joinOpen,
      });
    }
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
  return { fullscreenSize, host, leftY };
}

/**
 * Top right, below the buttons: the held item, then the display status.
 * @param {LayoutContext} ctx
 * @param {Pick<ReturnType<typeof import('./ui-layout-hud.js').layoutStatus>, "fullscreenSize">} input
 */
export function layoutHeld(ctx, input) {
  const { view, s, ts, cw, pitch, edge, safeRect, left, right, top, add, box } =
    ctx;
  const { fullscreenSize } = input;
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
}
