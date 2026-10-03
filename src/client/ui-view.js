// @ts-check

/**
 * The bridge from the game to the canvas UI: the `UiView` that `ui.js` lays out,
 * the current layout, list scrolling, the safe-area insets, and fullscreen.
 * `ui.js` owns the layout and `render.js` draws it; this file only describes
 * the game to them.
 */

import { TEXT_SIZES } from "../shared/chat.js";
import { heldDisplay } from "./display.js";
import { layoutUi } from "./ui.js";

/** @typedef {import('./context.js').Context} Context */

function isStandalone(/** @type {Context} */ ctx) {
  return Boolean(/** @type {{standalone?:boolean}} */ (navigator).standalone) ||
    Boolean(ctx.standaloneQuery?.matches);
}

/** What the layout needs to know about the game right now. @param {Context} ctx @returns {import('./ui.js').UiView} */
function uiView(ctx) {
  const { scene, ui, bag, shop, stamina } = ctx;
  const now = performance.now();
  const notice = scene.notice && now < scene.notice.until
    ? scene.notice.text
    : scene.status;
  const players =
    Object.keys(scene.world.players).filter((id) => id !== "npc-corner").length;
  const touch = Boolean(ctx.touchQuery?.matches);
  return {
    width: ctx.canvas.clientWidth,
    height: ctx.canvas.clientHeight,
    safe: scene.safe,
    scale: scene.uiScale,
    dpr: globalThis.devicePixelRatio || 1,
    touch,
    loading: scene.loading,
    status: notice.slice(0, 75),
    displayStatus: scene.displayStatus,
    diagnostics: ui.diagnosticsOpen && !ctx.isAdmin ? ui.diagnostics : null,
    zoom: scene.touchGesture || now < scene.hudUntil
      ? `Z ${scene.viewZ}  ZOOM ${scene.zoom.toFixed(2)}`
      : null,
    // Only a browser tab offers fullscreen; a Home Screen app already fills the screen.
    fullscreen: !isStandalone(ctx),
    fullscreenOn: document.fullscreenElement === ctx.gameRoot,
    host: ctx.isAdmin
      ? undefined
      : { tools: ui.hostTools, players, joinOpen: ui.joinOpen, qr: ui.qrReady },
    held: heldDisplay(ctx),
    stamina: {
      value: stamina.value,
      on: stamina.sprint,
      locked: stamina.locked,
    },
    logButton: { open: ui.logOpen },
    bagOpenButton: bag.isOpen,
    chat: scene.chatOpen
      ? {
        open: true,
        draft: scene.chatDraft,
        page: ui.chatPage,
        shift: ui.chatShift,
      }
      : undefined,
    menu: scene.menu
      ? {
        open: true,
        page: scene.menuPage,
        scale: scene.uiScale,
        textSize: scene.textSize,
        sizes: TEXT_SIZES,
        mode: scene.inputMode,
      }
      : undefined,
    log: {
      open: ui.logOpen,
      lines: scene.hearingLog.lines,
      scroll: ui.logScroll,
    },
    bag: {
      open: bag.isOpen,
      stacks: bag.stacks,
      selected: bag.selected,
      held: bag.held,
    },
    shop: {
      open: shop.isOpen(),
      rows: shop.rows,
      selected: shop.selected,
      scroll: shop.scroll,
    },
    sessions: ui.sessions,
  };
}

/** Lay the UI out for this moment. Every frame and every pointer event asks. @param {Context} ctx */
export function currentLayout(ctx) {
  return layoutUi(uiView(ctx));
}

/**
 * A list moved by a drag or the wheel. A positive distance shows later rows.
 * @param {Context} ctx @param {string} list @param {number} pixels
 */
export function scrollList(ctx, list, pixels) {
  const { scene, ui } = ctx;
  const layout = scene.ui?.layout ?? currentLayout(ctx);
  const unit = list === "log"
    ? 20 * layout.ts
    : (Math.max(40 * scene.uiScale, 16 * layout.ts + 12 * scene.uiScale) +
      4 * scene.uiScale);
  const key = list === "log" ? "log" : "shop";
  ui.scrollRemainder[key] += pixels;
  const rows = Math.trunc(ui.scrollRemainder[key] / unit);
  if (!rows) return;
  ui.scrollRemainder[key] -= rows * unit;
  if (list === "log") ui.logScroll = Math.max(0, ui.logScroll - rows);
  else ctx.shop.scrollBy(rows);
}

/** @param {Context} ctx */
export async function toggleFullscreen(ctx) {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await ctx.gameRoot.requestFullscreen();
    ctx.scene.displayStatus = "";
  } catch {
    ctx.scene.displayStatus =
      "Fullscreen unavailable. Add this page to your Home Screen.";
  }
}

/**
 * Measure the safe-area insets: the canvas draws its own text, so it needs them as numbers.
 * CSS cannot hand `env()` to script, so a hidden element padded by it is read instead.
 * @param {Context} ctx
 */
export function bindSafeArea(ctx) {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;inset:0;visibility:hidden;pointer-events:none;" +
    "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) " +
    "env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  document.body.append(probe);
  /** Specs and screenshots simulate a notch with `?harness&safe=top,right,bottom,left` (CSS pixels). */
  const override = (() => {
    const params = new URL(location.href).searchParams;
    if (!params.has("harness")) return null;
    const parts = (params.get("safe") ?? "").split(",").map(Number);
    return parts.length === 4 && parts.every((part) => part >= 0)
      ? { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] }
      : null;
  })();
  const measure = () => {
    if (override) {
      ctx.scene.safe = override;
      return;
    }
    const style = getComputedStyle(probe);
    ctx.scene.safe = {
      top: parseFloat(style.paddingTop) || 0,
      right: parseFloat(style.paddingRight) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0,
    };
  };
  measure();
  globalThis.addEventListener("resize", measure);
  globalThis.addEventListener("orientationchange", measure);
}
