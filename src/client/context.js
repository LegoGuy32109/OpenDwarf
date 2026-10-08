// @ts-check

/**
 * The client's shared state and the few actions every module needs.
 *
 * `createContext` builds the one `ctx` object that `app.js` passes to the other
 * client modules: the `scene` the renderer draws, the UI state, the input state,
 * the panels, and the `host` or `guest` network handle. Modules read and write
 * `ctx`; they never import each other's state. This file imports no other
 * client module at run time, so every module can import it without a cycle.
 */

import { createWorld, setTyping } from "../shared/world.js";
import { createVisibility } from "../shared/visibility.js";
import { layoutFromParams } from "../shared/spawn-room.js";
import { createPresentation } from "./presentation.js";
import { parseTextSize, TEXT_SIZE_KEY } from "../shared/chat.js";
import { createChatter, parseVoicesLevel, VOICES_KEY } from "./chatter.js";
import { createMusic, MUSIC_KEY, parseMusicLevel } from "./music.js";
import { createSoundEvents } from "./sound-events.js";
import { createSfx, EFFECTS_KEY, parseEffectsLevel } from "./sfx.js";
import { addSystemLine, createHearingLog } from "../shared/hearing-log.js";
import { createStamina } from "../shared/stamina.js";
import { setHeldItem } from "../shared/held-item.js";
import { sellItems } from "../shared/shop.js";
import { build } from "./build.js";
import { createInventoryPanel } from "./inventory-panel.js";
import { createShopPanel } from "./shop-panel.js";
import { createPickupGrid } from "./pickup-grid.js";

/** @typedef {ReturnType<typeof import('./network.js').startHost>} Host */
/** @typedef {ReturnType<typeof import('./network.js').joinWorld>} Guest */
/** @typedef {ReturnType<typeof createContext>} Context */

/** @param {string} selector */
const $ = (
  selector,
) => /** @type {HTMLElement} */ (document.querySelector(selector));

/** Private browsing can block storage; the default size then applies. */
function storedTextSize() {
  try {
    return localStorage.getItem(TEXT_SIZE_KEY);
  } catch {
    return null;
  }
}

/** Private browsing can block storage; Medium then applies. */
function storedVoices() {
  try {
    return localStorage.getItem(VOICES_KEY);
  } catch {
    return null;
  }
}

/** Private browsing can block storage; 50% then applies. */
function storedMusic() {
  try {
    return localStorage.getItem(MUSIC_KEY);
  } catch {
    return null;
  }
}

/** Private browsing can block storage; 75% then applies. */
function storedEffects() {
  try {
    return localStorage.getItem(EFFECTS_KEY);
  } catch {
    return null;
  }
}

/** @param {number} value @param {number} min @param {number} max */
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createContext() {
  const params = new URL(location.href).searchParams;
  const gamepadDebug = params.has("gamepad-debug");
  const route = build.route(location.pathname);

  const scene = {
    world: createWorld(),
    localId: "self",
    /** `room` is the spawn room; `test` is the old pillar and staircase for specs. */
    layout: /** @type {"room"|"test"} */ (layoutFromParams(params)),
    menu: false,
    menuPage: "root",
    uiScale: 1,
    textSize: parseTextSize(storedTextSize()),
    zoom: 1,
    zoomTarget: 1,
    viewZ: 0,
    viewMode: /** @type {"entity"|"master"} */ ("entity"),
    inputMode: "keyboard",
    hudUntil: 0,
    touchGesture: false,
    visibility: createVisibility(),
    camera: { x: 480, y: 480 },
    renderOffset: { x: 0, y: 0, z: 0 },
    presentation: createPresentation(),
    chatFeed: /** @type {import('../shared/chat.js').DisplayChatRecord[]} */ (
      []
    ),
    chatOpen: false,
    chatDraft: "",
    hearingLog: createHearingLog(),
    /** @param {string} text */
    systemLine: (text) => addSystemLine(scene.hearingLog, text),
    /** The screen's safe-area insets in CSS pixels (the notch, the home indicator). */
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
    status: "Local world",
    /** Extra status lines at the top right, such as gamepad details. */
    displayStatus: "",
    /** The loading screen text, or null once the world can draw. */
    loading: /** @type {string|null} */ ("Connecting to world…"),
    /** What `ui.js` laid out this frame, for the renderer. */
    ui: /** @type {import('./render.js').Scene["ui"]} */ (undefined),
    aim: { x: 0, y: 0 },
    /** Mining actions to draw, with progress from 0 to 1. */
    mining:
      /** @type {{id:string,x:number,y:number,z:number,progress:number}[]} */ ([]),
    /** Mining actions a guest was told about by the world host. */
    mineFeed:
      /** @type {import('./network.js').MineFeed|undefined} */ (undefined),
    /** Dropped items to draw: the tiles the local player can see. */
    items: /** @type {import('../shared/items.js').DroppedEntry[]} */ ([]),
    /** The local player's inventory, for the panel and shop tickets. */
    inventory: /** @type {import('../shared/items.js').Stack[]} */ ([]),
    /** Dropped items and the inventory a guest was told about by the world host. */
    itemFeed:
      /** @type {import('../shared/items.js').DroppedEntry[]|undefined} */ (undefined),
    inventoryFeed:
      /** @type {import('../shared/items.js').Stack[]|undefined} */ (undefined),
    /** The held item kind a guest was told about by the world host. */
    heldFeed: /** @type {string|undefined} */ (undefined),
    /** The pickup grid's squares to draw, in world pixels. Empty while it is closed. */
    pickupCells: /** @type {import('./pickup-grid.js').GridCell[]} */ ([]),
    /** A short message that shows over the status line, such as a refused action. */
    notice: /** @type {{text:string,until:number}|undefined} */ (undefined),
    sessionId: "",
    /** Plays the sound events the world host sends this client. */
    hearSounds:
      /** @type {((list:import('../shared/sound.js').HeardSound[])=>void)|undefined} */ (undefined),
    metrics:
      /** @type {{joinMs:number|null,rttMs:number[],route:string}|undefined} */ (undefined),
    telemetry:
      /** @type {((kind:"summary"|"connection"|"error",fields?:Record<string,unknown>)=>void)|undefined} */ (undefined),
  };

  /** The sticks, the log, and the other UI state that no game module owns. */
  const ui = {
    sticks: {
      move: { active: false, x: 0, y: 0, dir: "center" },
      look: { active: false, x: 0, y: 0, dir: "center" },
    },
    /** A newer main exists than the build this host runs. */
    updateAvailable: false,
    chatPage: /** @type {"letters"|"symbols"} */ ("letters"),
    chatShift: false,
    logOpen: false,
    /** Lines the hearing log is scrolled up from its newest line. */
    logScroll: 0,
    joinOpen: false,
    qrReady: false,
    /** The page started with no network: a single-player world, with no join link. */
    offline: false,
    qrUrl: "",
    hostTools: false,
    diagnosticsOpen: false,
    diagnostics: "HOST  F3 close\nFPS …",
    /** Distance a drag or wheel has moved a list that is not yet a whole row. */
    scrollRemainder: { log: 0, shop: 0 },
    sessions: {
      open: false,
      status: "Looking for visitors…",
      stats: "",
      items: /** @type {{id:string}[]} */ ([]),
    },
  };

  /** Plays sound effects from tagged samples (ADR 0008). `?sfx=0` turns it off; test pages need `sfx=1`. */
  const sfx = createSfx({
    level: parseEffectsLevel(storedEffects()),
    enabled: params.get("sfx") !== "0" &&
      (!params.has("harness") || params.get("sfx") === "1"),
  });

  const ctx = {
    scene,
    ui,
    canvas: /** @type {HTMLCanvasElement} */ ($("#world")),
    /** Plays chatter for the bubbles in `scene.chatFeed` (ADR 0006). */
    chatter: createChatter({ level: parseVoicesLevel(storedVoices()) }),
    /** Plays background music from the device cache or the bucket (ADR 0007). `?music=0` turns it off; test pages need `music=1`. */
    music: createMusic({
      level: parseMusicLevel(storedMusic()),
      enabled: params.get("music") !== "0" &&
        (!params.has("harness") || params.get("music") === "1"),
    }),
    sfx,
    liveStatus: $("#live-status"),
    /** Plays the sound events this client hears and its own sounds (ADR 0008). */
    sounds: createSoundEvents({ scene, sfx }),
    gameRoot: $("#game"),
    touchQuery: globalThis.matchMedia?.("(pointer: coarse)"),
    standaloneQuery: globalThis.matchMedia?.("(display-mode: standalone)"),
    route,
    /** The session a join link names, or null. */
    joinRoute: route.kind === "join" ? route.session : null,
    /** Whether this tab is a guest (the admin and join pages), not the world host. */
    isAdmin: route.kind !== "play",
    isSynthetic: params.has("synthetic") && params.has("harness"),
    gamepadDebug,
    gamepadEnabled: !params.has("harness") || gamepadDebug,

    /** @type {Host|null} */
    host: null,
    /** @type {Guest|null} */
    guest: null,

    /** The inventory panel's selection and the held item. While it is open, interact and the look control drive it. */
    bag: createInventoryPanel({
      onHold: (kind) => {
        holdItem(ctx, kind);
      },
      onOpenChange: () => {
        typing(ctx);
      },
    }),
    /** The shop panel's selection. */
    shop: createShopPanel({
      sell: (request) => {
        sellRequest(ctx, request);
      },
      flash: (text) => {
        flash(ctx, text);
      },
    }),
    pickupGrid: createPickupGrid(),
    /** Keys still held from the aim that opened the grid; their key repeat must not move the selector. */
    gridKeysAtOpen: /** @type {Set<string>} */ (new Set()),

    /** Keys held down, by `KeyboardEvent.code`. */
    held: /** @type {Set<string>} */ (new Set()),
    /** Movement keys pressed since the last tick, so a tap shorter than a tick counts. */
    pressed: /** @type {Set<string>} */ (new Set()),
    joystick: { x: 0, y: 0 },
    cameraStick: { x: 0, y: 0 },
    gamepadDirection: { x: 0, y: 0 },
    gamepadCamera: { x: 0, y: 0 },
    /** The D-pad direction. It moves the pickup grid's selector while the grid is open. */
    gamepadDpad: { x: 0, y: 0 },
    /** The left stick's direction, or the right stick's when the left is centered, for the panels. */
    gamepadStick: { x: 0, y: 0 },
    gamepadZoom: 0,
    gamepadIndex: -1,
    unsupportedGamepadId: "",
    gamepadButtons: /** @type {Set<number>} */ (new Set()),
    /** Backspace on the keyboard repeats while the key is held. */
    backspaceTimer: /** @type {ReturnType<typeof setTimeout>|undefined} */ (
      undefined
    ),

    sequence: 0,
    /** Local stamina. A guest predicts with it; the world host decides for guests. */
    stamina: createStamina(),
    lastInputDirection: { x: 0, y: 0 },
    lastInputSent: -100,
    lastTyping: false,
    lastPlayerZ: 0,
    /** The aim and level the local player started mining with; aiming elsewhere cancels it. */
    mineLock: /** @type {{x:number,y:number,z:number}|null} */ (null),
    tickNpc: /** @type {(() => void)|null} */ (null),

    /** Fixed-step time not yet spent on world ticks, in milliseconds. */
    accumulator: 0,
    /** The last frame times in milliseconds, for diagnostics and telemetry. */
    frameMs: /** @type {number[]} */ ([]),
    /** The local chat bands a host's own chat view remembers. */
    localChatBands:
      /** @type {Map<string,import('../shared/chat.js').ChatBand>} */ (
        new Map()
      ),
  };
  scene.hearSounds = (list) => ctx.sounds.hear(list);
  return ctx;
}

/** @param {Context} ctx @param {string} text */
export function notify(ctx, text) {
  ctx.scene.status = text;
}

/** A short message that shows over the status line. @param {Context} ctx @param {string} text */
export function flash(ctx, text) {
  ctx.scene.notice = { text, until: performance.now() + 2500 };
}

/** Tell the world whether the local player is typing: the chat draft or the open bag. @param {Context} ctx */
export function typing(ctx) {
  const { scene } = ctx;
  const value = scene.chatDraft.trim();
  const next = ctx.bag.isOpen ||
    scene.chatOpen && value.length > 0 && !value.startsWith("/");
  if (next === ctx.lastTyping) return;
  ctx.lastTyping = next;
  setTyping(scene.world, scene.localId, next);
  if (ctx.isAdmin) ctx.guest?.send({ type: "typing", typing: next });
  else ctx.host?.publish();
}

/** @param {Context} ctx @param {"entity"|"master"} mode */
export function setViewMode(ctx, mode) {
  if (ctx.isAdmin) {
    if (ctx.guest?.setMode(mode)) notify(ctx, `Switching to ${mode} view…`);
    return;
  }
  ctx.scene.viewMode = mode;
  notify(ctx, `${mode === "master" ? "Master" : "Entity"} view`);
}

/** Choose the held item. The host checks the inventory and cancels mining. @param {Context} ctx @param {string} kind */
export function holdItem(ctx, kind) {
  const { scene } = ctx;
  if (ctx.isAdmin) {
    ctx.guest?.send({ type: "hold", kind });
    return;
  }
  const result = setHeldItem(scene.world, scene.localId, kind);
  if (!result.ok) flash(ctx, `Cannot hold: ${result.reason}`);
  else ctx.host?.publish();
}

/**
 * Ask for a sale. A guest sends the request and the world host checks it; the
 * host's own player goes through the same `sellItems` check.
 * @param {Context} ctx
 * @param {import('../shared/shop.js').SaleRequest} request
 */
export function sellRequest(ctx, request) {
  const { scene } = ctx;
  if (ctx.isAdmin) {
    ctx.guest?.send({ type: "sell", ...request });
    // The host answers only a refusal, so a guest hears its own request.
    ctx.sfx.play(["sell"]);
    return;
  }
  const result = scene.layout === "room"
    ? sellItems(scene.world, scene.localId, request)
    : { ok: /** @type {const} */ (false), reason: "no shop here" };
  if (result.ok) {
    scene.systemLine(result.line);
    ctx.sfx.play(["sell"]);
  } else flash(ctx, `Cannot sell: ${result.reason}`);
}
