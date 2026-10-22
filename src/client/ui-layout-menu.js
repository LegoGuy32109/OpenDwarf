// @ts-check
// The menu and the loading screen. Each function adds its elements to `ctx`.

import { ascii } from "./ui-kit.js";

/** @typedef {import('./ui-types.js').Rect} Rect */
/** @typedef {import('./ui-types.js').UiElement} UiElement */
/** @typedef {import('./ui-layout-context.js').LayoutContext} LayoutContext */

/**
 * The menu.
 * @param {LayoutContext} ctx
 * @param {Pick<ReturnType<typeof import('./ui-layout-panels.js').layoutArea>, "middle">} input
 */
export function layoutMenu(ctx, input) {
  const menu = ctx.view.menu;
  if (!menu?.open) return;
  const frame = menuFrame(ctx, menu, input.middle);
  if (menu.page === "settings") settingsRows(frame);
  else rootRows(frame);
}

/** @typedef {NonNullable<LayoutContext['view']['menu']>} Menu */
/** @typedef {ReturnType<typeof menuFrame>} MenuFrame */
/** @param {LayoutContext} ctx @param {Menu} menu @param {number} middle */
function menuFrame(ctx, menu, middle) {
  const { W, H, s, ts, lh, pitch, safeRect, top, add, box } = ctx;
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
      "L R LEVEL  A B ZOOM",
      "ZR ACT  ZL SPRINT",
      "Y BAG  X MENU  B BACK",
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
      "ESDF MOVE  IJKL CHOOSE",
      "R V LEVEL  U N ZOOM",
      "T CHAT  / COMMAND",
      "ESC OR Q BACK",
    ];
  const settings = menu.page === "settings";
  // The settings page has five labelled rows and Back; on a short screen the
  // buttons shrink so they all fit.
  const settingsFixed = 10 * s + 2 * pitch + 8 * s + 5 * (pitch + 8 * s) +
    12 * s;
  const rowH = settings
    ? Math.max(
      20 * s,
      Math.min(
        Math.max(34 * s, lh + 12 * s),
        (safeRect.h - 20 - settingsFixed) / 6,
      ),
    )
    : Math.max(34 * s, lh + 12 * s);
  const bodyRows = settings ? 8 : rootRows.length;
  const hintLines = settings
    ? 0
    : hints.length + (menu.build ? 1 : 0) + (menu.audio ? 1 : 0);
  const h = settings
    ? Math.min(safeRect.h - 20, settingsFixed + 6 * rowH)
    : Math.min(
      safeRect.h - 20,
      12 * s + pitch + 8 * s + bodyRows * (rowH + 4 * s) +
        hintLines * pitch + 16 * s,
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
  /** The selected row marks its label with arrows and amber text. @param {string} row @param {string} label */
  const rowLabel = (row, label) =>
    menu.row === row
      ? { text: `< ${label} >`, color: "amber" }
      : { text: label, color: "cream" };

  return {
    ctx,
    menu,
    x,
    w,
    cursor,
    inner,
    bx,
    rowH,
    hints,
    menuButton,
    rowLabel,
  };
}

/** @param {MenuFrame} frame */
function settingsRows(frame) {
  const { ctx, menu, x, w, inner, bx, rowH, menuButton, rowLabel } = frame;
  const { s, ts, lh, pitch, add, box } = ctx;
  let { cursor } = frame;

  add({
    id: "text:menu-ui-scale",
    kind: "text",
    rect: box(x, cursor, w, lh),
    ...rowLabel("scale", "UI Scale"),
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
    ...rowLabel("size", "Text Size"),
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
  cursor = volumeRow(
    frame,
    cursor,
    "voices",
    "Voices",
    menu.voiceLevels,
    menu.voices,
    true,
  );
  cursor = volumeRow(
    frame,
    cursor,
    "music",
    "Music",
    menu.musicLevels,
    menu.music,
  );
  cursor = volumeRow(
    frame,
    cursor,
    "effects",
    "Effects",
    menu.effectsLevels,
    menu.effects,
  );
  menuButton("back", "Back", box(bx, cursor, inner, rowH), {
    sel: menu.row === "back",
  });
}

/** @param {MenuFrame} frame */
function rootRows(frame) {
  const { ctx, menu, x, w, inner, bx, rowH, hints, menuButton } = frame;
  const { s, ts, pitch, add, box } = ctx;
  let { cursor } = frame;
  const rootRows = ["Resume", "Settings", "Leave Game"];

  for (const [index, label] of rootRows.entries()) {
    menuButton(
      ["resume", "settings", "leave"][index],
      label,
      box(bx, cursor, inner, rowH),
      { sel: menu.row === ["resume", "settings", "leave"][index] },
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
  if (menu.audio) {
    add({
      id: "text:menu-audio",
      kind: "text",
      rect: box(
        x,
        cursor + 6 * s + (hints.length + (menu.build ? 1 : 0)) * pitch,
        w,
        pitch,
      ),
      text: ascii(menu.audio),
      color: "dim",
      scale: ts,
      align: "center",
    });
  }
}

/** @param {MenuFrame} frame @param {number} cursor @param {string} id @param {string} label @param {readonly string[]|undefined} levels @param {string|undefined} selected @param {boolean} [capitalize] */
function volumeRow(
  frame,
  cursor,
  id,
  label,
  levels,
  selected,
  capitalize = false,
) {
  if (!levels) return cursor;
  const { ctx, x, w, inner, bx, rowH, menuButton, rowLabel } = frame;
  const { s, ts, lh, pitch, add, box } = ctx;
  add({
    id: `text:menu-${id}`,
    kind: "text",
    rect: box(x, cursor, w, lh),
    ...rowLabel(id, label),
    scale: ts,
    align: "center",
  });
  cursor += pitch;
  const gap = 4 * s;
  const count = id === "voices" ? 4 : 5;
  const width = (inner - (count - 1) * gap) / count;
  for (const [index, level] of levels.entries()) {
    const text = capitalize
      ? level[0].toUpperCase() + level.slice(1)
      : level === "off"
      ? "Off"
      : level;
    menuButton(
      `${id}:${level}`,
      text,
      box(bx + index * (width + gap), cursor, width, rowH),
      { on: level === selected },
    );
  }
  return cursor + rowH + 8 * s;
}

/**
 * The loading screen covers everything.
 * @param {LayoutContext} ctx
 */
export function layoutLoading(ctx) {
  const { W, H, ts, add, box, loading } = ctx;
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
}
