// @ts-check

import {
  addPlayer,
  advanceTicks,
  createWorld,
  renderPosition,
  setNickname,
  setTyping,
  startMove,
  submitMessage,
  TICK_MS,
  WORLD_TOP,
} from "../shared/world.js";
import {
  createVisibility,
  entityOpacity,
  recomputeVisibility,
  tileVisibility,
  visibilityPosition,
} from "../shared/visibility.js";
import { clampCameraAxis, playerOccluded } from "../shared/surface.js";
import { terrainExtent } from "../shared/terrain.js";
import {
  createChunkGenerator,
  generateAround,
  seedFromText,
} from "../shared/generation.js";
import { viewMotionOpacity } from "../shared/view.js";
import { Z_LEVELS_BELOW } from "../shared/world.js";
import { build } from "./build.js";
import { createRenderer } from "./render.js";
import { joinWorld, startHost } from "./network.js";
import { createCornerNpc } from "../shared/npc.js";
import {
  layoutFromParams,
  NPC_ORIGIN,
  roomSpawnTile,
} from "../shared/spawn-room.js";
import { createPresentation } from "./presentation.js";
import {
  chatView,
  parseTextSize,
  TEXT_SIZE_KEY,
  TEXT_SIZES,
} from "../shared/chat.js";
import { CHAT_LIMIT, layoutUi, typeKey } from "./ui.js";
import { createPointerRouter } from "./ui-pointer.js";
import {
  addSystemLine,
  createHearingLog,
  hearChat,
} from "../shared/hearing-log.js";
import {
  centerTile,
  enableLocomotion,
  moveEntity,
  speedTilesPerSecond,
} from "../shared/locomotion.js";
import { createStamina, setSprint, stepStamina } from "../shared/stamina.js";
import { highlightedTile } from "../shared/target.js";
import {
  cancelMining,
  heldItem,
  miningEntries,
  PICKAXE,
  startMining,
} from "../shared/mining.js";
import { setHeldItem } from "../shared/held-item.js";
import { createInventoryPanel } from "./inventory-panel.js";
import {
  cellAtPoint,
  clampSelection,
  closePickupGrid,
  closeReason,
  createPickupGrid,
  gridCenter,
  isPickupGridOpen,
  markRequested,
  moveSelection,
  openPickupGrid,
  pickupGridCells,
  selectedStack,
  selectStack,
  shownStacks,
  stepSelection,
} from "./pickup-grid.js";
import {
  droppedAt,
  droppedItems,
  inventoryOf,
  pickUp,
  pickupLine,
} from "../shared/items.js";
import { sellItems, SHOP_TILE } from "../shared/shop.js";
import { createShopPanel } from "./shop-panel.js";

/** @param {string} selector */
const $ = (
  selector,
) => /** @type {HTMLElement} */ (document.querySelector(selector));
const canvas = /** @type {HTMLCanvasElement} */ ($("#world"));
const liveStatus = $("#live-status");
const gameRoot = $("#game");
/** The inventory panel's selection and the held item. While it is open, interact and the look control drive it. */
const bag = createInventoryPanel({
  onHold: (kind) => holdItem(kind),
  onOpenChange: () => typing(),
});
/** The shop panel's selection. */
const shop = createShopPanel({
  sell: (request) => sellRequest(request),
  flash: (text) => flash(text),
});
const gamepadDebug = new URL(location.href).searchParams.has("gamepad-debug");
const gamepadEnabled = !new URL(location.href).searchParams.has("harness") ||
  gamepadDebug;
/** Private browsing can block storage; the default size then applies. */
function storedTextSize() {
  try {
    return localStorage.getItem(TEXT_SIZE_KEY);
  } catch {
    return null;
  }
}

const scene = {
  world: createWorld(),
  localId: "self",
  /** `room` is the spawn room; `test` is the old pillar and staircase for specs. */
  layout: /** @type {"room"|"test"} */ (layoutFromParams(
    new URL(location.href).searchParams,
  )),
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
  chatFeed: /** @type {import('../shared/chat.js').DisplayChatRecord[]} */ ([]),
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
  metrics:
    /** @type {{joinMs:number|null,rttMs:number[],route:string}|undefined} */ (undefined),
  telemetry:
    /** @type {((kind:"summary"|"connection"|"error",fields?:Record<string,unknown>)=>void)|undefined} */ (undefined),
};
/** @type {Set<string>} */
const held = new Set();
/** @type {Map<string,import('../shared/chat.js').ChatBand>} */
const localChatBands = new Map();
/** @type {Set<string>} */
const pressed = new Set();
/** @type {{x:number,y:number}} */
let joystick = { x: 0, y: 0 };
/** @type {{x:number,y:number}} */
let cameraStick = { x: 0, y: 0 };
/** @type {{x:number,y:number}} */
let gamepadDirection = { x: 0, y: 0 };
/** @type {{x:number,y:number}} */
let gamepadCamera = { x: 0, y: 0 };
let gamepadZoom = 0;
let gamepadIndex = -1;
let unsupportedGamepadId = "";
/** @type {Set<number>} */
let gamepadButtons = new Set();
let sequence = 0;
/** Local stamina. A guest predicts with it; the world host decides for guests. */
const stamina = createStamina();
let lastInputDirection = { x: 0, y: 0 };
let lastInputSent = -100;
let lastTyping = false;
/** @type {ReturnType<typeof startHost>|null} */
let host = null;
/** @type {ReturnType<typeof joinWorld>|null} */
let guest = null;
const route = build.route(location.pathname);
const joinRoute = route.kind === "join" ? route.session : null;
const isAdmin = route.kind !== "play";
const isSynthetic = new URL(location.href).searchParams.has("synthetic") &&
  new URL(location.href).searchParams.has("harness");
let lastPlayerZ = 0;
/** The aim and level the local player started mining with; aiming elsewhere cancels it. */
/** @type {{x:number,y:number,z:number}|null} */
let mineLock = null;
/** @type {ReturnType<typeof createCornerNpc>|null} */
let tickNpc = null;
const pickupGrid = createPickupGrid();
/** The D-pad direction. It moves the pickup grid's selector while the grid is open. */
let gamepadDpad = { x: 0, y: 0 };

/** The sticks, the log, and the other UI state that no game module owns. */
const ui = {
  sticks: {
    move: { active: false, x: 0, y: 0, dir: "center" },
    look: { active: false, x: 0, y: 0, dir: "center" },
  },
  chatPage: /** @type {"letters"|"symbols"} */ ("letters"),
  chatShift: false,
  logOpen: false,
  /** Lines the hearing log is scrolled up from its newest line. */
  logScroll: 0,
  joinOpen: false,
  qrReady: false,
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
const touchQuery = globalThis.matchMedia?.("(pointer: coarse)");
const standaloneQuery = globalThis.matchMedia?.("(display-mode: standalone)");

/** @param {number} value @param {number} min @param {number} max */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** @param {number} step */
function changeLayer(step) {
  scene.viewZ = clamp(scene.viewZ + step, 0, WORLD_TOP);
  scene.hudUntil = performance.now() + 500;
}

/** @param {"entity"|"master"} mode */
function setViewMode(mode) {
  if (isAdmin) {
    if (guest?.setMode(mode)) notify(`Switching to ${mode} view…`);
    return;
  }
  scene.viewMode = mode;
  notify(`${mode === "master" ? "Master" : "Entity"} view`);
}

/** @param {string} text */
function notify(text) {
  scene.status = text;
}

function typing() {
  const value = scene.chatDraft.trim();
  const next = bag.isOpen ||
    scene.chatOpen && value.length > 0 && !value.startsWith("/");
  if (next === lastTyping) return;
  lastTyping = next;
  setTyping(scene.world, scene.localId, next);
  if (isAdmin) guest?.send({ type: "typing", typing: next });
  else host?.publish();
}

/**
 * Measure the safe-area insets: the canvas draws its own text, so it needs them as numbers.
 * CSS cannot hand `env()` to script, so a hidden element padded by it is read instead.
 */
const safeProbe = document.createElement("div");
safeProbe.style.cssText =
  "position:fixed;inset:0;visibility:hidden;pointer-events:none;" +
  "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) " +
  "env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
document.body.append(safeProbe);
/** Specs and screenshots simulate a notch with `?harness&safe=top,right,bottom,left` (CSS pixels). */
const safeOverride = (() => {
  const params = new URL(location.href).searchParams;
  if (!params.has("harness")) return null;
  const parts = (params.get("safe") ?? "").split(",").map(Number);
  return parts.length === 4 && parts.every((part) => part >= 0)
    ? { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] }
    : null;
})();
function measureSafeArea() {
  if (safeOverride) {
    scene.safe = safeOverride;
    return;
  }
  const style = getComputedStyle(safeProbe);
  scene.safe = {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
}
measureSafeArea();
globalThis.addEventListener("resize", measureSafeArea);
globalThis.addEventListener("orientationchange", measureSafeArea);

/** @param {string} [prefill] */
function openChat(prefill = "") {
  bag.toggle(false);
  shop.close();
  scene.menu = false;
  scene.menuPage = "root";
  scene.chatOpen = true;
  scene.chatDraft = prefill.slice(0, CHAT_LIMIT);
  ui.chatPage = "letters";
  ui.chatShift = false;
  typing();
}

function closeChat() {
  stopBackspaceRepeat();
  scene.chatOpen = false;
  scene.chatDraft = "";
  typing();
}

function submitChat() {
  const text = scene.chatDraft.trim();
  closeChat();
  if (!text) return;
  if (text.toLowerCase().startsWith("/nick ")) {
    const name = text.slice(6);
    if (isAdmin) guest?.send({ type: "nick", name });
    else {
      const before = scene.world.players[scene.localId]?.name ?? "";
      const result = setNickname(scene.world, scene.localId, name);
      if (result.ok && result.name && result.name !== before) {
        host?.announce(nameChangeLine(before, result.name), scene.localId);
      }
      notify(
        result.ok
          ? `Name set to ${result.name}`
          : result.reason ?? "Name rejected",
      );
      host?.publish();
    }
    return;
  }
  if (text.toLowerCase() === "/entity" || text.toLowerCase() === "/master") {
    setViewMode(/** @type {"entity"|"master"} */ (text.slice(1).toLowerCase()));
    return;
  }
  if (text.startsWith("/")) {
    notify("Unknown command");
    return;
  }
  submitMessage(scene.world, scene.localId, text);
  if (isAdmin) guest?.send({ type: "message", text });
  else host?.publish();
}

/** @param {string} before @param {string} name */
function nameChangeLine(before, name) {
  return `${before || "A visitor"} is now ${name}`;
}

/** @param {boolean} [open] */
function toggleLog(open = !ui.logOpen) {
  ui.logOpen = open;
  if (open) ui.logScroll = 0;
}

/** @param {string} id */
function speakerName(id) {
  const name = scene.world.players[id]?.name;
  if (id === scene.localId) return name || "You";
  return name || "Visitor";
}

/** Sprint doubles walk speed. It needs stamina and stays off while locked. */
function toggleSprint() {
  setSprint(stamina, !stamina.sprint);
}

/** @param {string} text */
function flash(text) {
  scene.notice = { text, until: performance.now() + 2500 };
}

/** The aim input, held still while the shop panel uses the look controls. */
function cameraInput() {
  return shop.isOpen() ? { x: 0, y: 0 } : lookInput();
}

/** The look stick, IJKL, and controller camera input combined. */
function lookInput() {
  const controllerCamera = scene.chatOpen || scene.menu
    ? { x: 0, y: 0 }
    : gamepadCamera;
  return {
    x: Number(held.has("KeyL")) - Number(held.has("KeyJ")) + cameraStick.x +
      controllerCamera.x,
    y: Number(held.has("KeyK")) - Number(held.has("KeyI")) + cameraStick.y +
      controllerCamera.y,
  };
}

/** The stacks of dropped items on a tile, as this client knows them. @param {{x:number,y:number,z:number}} tile */
function droppedHere(tile) {
  if (!isAdmin) return droppedAt(scene.world, tile);
  return scene.itemFeed?.find((entry) =>
    entry.x === tile.x && entry.y === tile.y && entry.z === tile.z
  )?.stacks ?? [];
}

/** Pick up the stack of one kind from a tile. The host checks reach and who asked first. @param {{x:number,y:number,z:number}} target @param {string} kind */
function pickUpAt(target, kind) {
  if (isAdmin) {
    guest?.send({ type: "pickup", ...target, kind });
    return;
  }
  const result = pickUp(scene.world, scene.localId, target, kind);
  if (result.ok) scene.systemLine(pickupLine(result.kind, result.count));
  else flash(`Cannot pick up: ${result.reason}`);
}

/** The dropped items to draw this frame: tiles in sight, or all in master view. */
function itemsDisplay() {
  if (isAdmin) return scene.itemFeed ?? [];
  const store = droppedItems(scene.world).tiles;
  if (!store.size) return [];
  return [...store.values()].filter((entry) =>
    scene.viewMode === "master" ||
    tileVisibility(scene.visibility, entry.x, entry.y, entry.z) === "visible"
  );
}

/** The local player's inventory. */
function inventoryDisplay() {
  if (isAdmin) return scene.inventoryFeed ?? [];
  const player = scene.world.players[scene.localId];
  return player ? inventoryOf(player) : [];
}

/** Choose the held item. The host checks the inventory and cancels mining. @param {string} kind */
function holdItem(kind) {
  if (isAdmin) {
    guest?.send({ type: "hold", kind });
    return;
  }
  const result = setHeldItem(scene.world, scene.localId, kind);
  if (!result.ok) flash(`Cannot hold: ${result.reason}`);
  else host?.publish();
}

/** The item kind the local player holds. */
function heldDisplay() {
  if (isAdmin) return scene.heldFeed ?? PICKAXE;
  const player = scene.world.players[scene.localId];
  return player ? heldItem(player) : PICKAXE;
}

/** Open or close the inventory panel. Menu, chat, and master view keep it shut. @param {boolean} [open] */
function toggleBag(open = !bag.isOpen) {
  if (open && (scene.chatOpen || scene.menu || shop.isOpen())) return;
  bag.toggle(open);
}

/** Up or down on the look stick or the D-pad, for the shop panel. IJKL act on key presses. */
function shopDirection() {
  return stickDirection(
    cameraStick.x + gamepadCamera.x,
    cameraStick.y + gamepadCamera.y,
    0.18,
  ).y || gamepadDirection.y;
}

/**
 * Ask for a sale. A guest sends the request and the world host checks it; the
 * host's own player goes through the same `sellItems` check.
 * @param {import('../shared/shop.js').SaleRequest} request
 */
function sellRequest(request) {
  if (isAdmin) {
    guest?.send({ type: "sell", ...request });
    return;
  }
  const result = scene.layout === "room"
    ? sellItems(scene.world, scene.localId, request)
    : { ok: /** @type {const} */ (false), reason: "no shop here" };
  if (result.ok) scene.systemLine(result.line);
  else flash(`Cannot sell: ${result.reason}`);
}

/** Whether the highlighted tile holds the shopkeeper. @param {{x:number,y:number,z:number}} target */
function isShopkeeper(target) {
  return scene.layout === "room" && target.x === SHOP_TILE.x &&
    target.y === SHOP_TILE.y && target.z === SHOP_TILE.z;
}

/** Interact on the highlighted tile: pick up dropped items, or start mining it. The host checks everything. */
function interact() {
  if (bag.isOpen) {
    bag.confirm();
    return;
  }
  const player = scene.world.players[scene.localId];
  if (!player || scene.chatOpen || scene.menu) return;
  if (isPickupGridOpen(pickupGrid)) {
    confirmPickupGrid();
    return;
  }
  if (shop.isOpen()) {
    shop.confirm();
    return;
  }
  if (scene.viewMode !== "entity") {
    flash("Switch to entity view to interact");
    return;
  }
  // Read the aim now: a frame may not have run since the key went down.
  const input = cameraInput();
  scene.aim = stickDirection(input.x, input.y, 0.18);
  const target = highlightedTile(
    player,
    scene.aim,
    scene.viewZ,
    scene.world,
  );
  if (!target) {
    flash("Nothing to mine there");
    return;
  }
  if (isShopkeeper(target)) {
    shop.open(shopDirection());
    return;
  }
  const stacks = droppedHere(target);
  if (stacks.length === 1) {
    pickUpAt(target, stacks[0].kind);
    return;
  }
  if (stacks.length) {
    openPickupGrid(pickupGrid, target, performance.now());
    gridKeysAtOpen.clear();
    for (const code of held) gridKeysAtOpen.add(code);
    return;
  }
  mineLock = { x: scene.aim.x, y: scene.aim.y, z: scene.viewZ };
  if (isAdmin) guest?.send({ type: "mine", ...target });
  else {
    const result = startMining(scene.world, scene.localId, target);
    if (!result.ok) flash(`Cannot mine: ${result.reason}`);
  }
}

/** The stacks the open pickup grid shows. */
function pickupGridStacks() {
  const tile = pickupGrid.tile;
  return tile
    ? shownStacks(pickupGrid, droppedHere(tile), performance.now())
    : [];
}

/** Interact with the grid open: pick up the selected stack. */
function confirmPickupGrid() {
  const tile = pickupGrid.tile;
  const stack = selectedStack(pickupGrid, pickupGridStacks());
  if (!tile || !stack) return;
  if (isAdmin) markRequested(pickupGrid, stack.kind, performance.now());
  pickUpAt(tile, stack.kind);
}

/**
 * Each frame: close the grid when the entity leaves reach or the tile empties,
 * move the selector with IJKL, the look stick, or the D-pad, and compute the
 * squares to draw.
 */
function updatePickupGrid() {
  const player = scene.world.players[scene.localId];
  if (!isPickupGridOpen(pickupGrid)) {
    scene.pickupCells = [];
    return;
  }
  const now = performance.now();
  const stacks = pickupGridStacks();
  if (
    scene.viewMode !== "entity" || scene.chatOpen ||
    closeReason(pickupGrid, player, stacks.length)
  ) {
    closePickupGrid(pickupGrid);
    scene.pickupCells = [];
    return;
  }
  clampSelection(pickupGrid, stacks.length);
  // IJKL moves the selector on key press (`gridKey`); the sticks and D-pad here.
  const direction = gamepadDpad.x || gamepadDpad.y
    ? gamepadDpad
    : stickDirection(
      cameraStick.x + gamepadCamera.x,
      cameraStick.y + gamepadCamera.y,
      0.5,
    );
  if (!scene.menu) stepSelection(pickupGrid, stacks.length, direction, now);
  scene.pickupCells = scene.viewZ === pickupGrid.tile?.z && player
    ? pickupGridCells(pickupGrid, stacks, gridCenter(player), now)
    : [];
}

/** @type {Record<string,[number,number]>} */
const GRID_KEYS = { KeyI: [0, -1], KeyK: [0, 1], KeyJ: [-1, 0], KeyL: [1, 0] };
/** Keys still held from the aim that opened the grid; their key repeat must not move the selector. */
const gridKeysAtOpen = new Set();

/** IJKL moves the selector, with the browser's key repeat for a held key. @param {string} code @param {boolean} repeat */
function gridKey(code, repeat) {
  const step = GRID_KEYS[code];
  if (!step || !isPickupGridOpen(pickupGrid) || scene.menu) return;
  if (repeat && gridKeysAtOpen.has(code)) return;
  moveSelection(pickupGrid, pickupGridStacks().length, step[0], step[1]);
}

/** A tap on a square selects it. @param {number} clientX @param {number} clientY */
function tapPickupGrid(clientX, clientY) {
  if (!isPickupGridOpen(pickupGrid) || scene.menu) return;
  const rect = canvas.getBoundingClientRect();
  const cell = cellAtPoint(
    scene.pickupCells,
    (clientX - rect.left - rect.width / 2) / scene.zoom + scene.camera.x,
    (clientY - rect.top - rect.height / 2) / scene.zoom + scene.camera.y,
  );
  if (cell) selectStack(pickupGrid, pickupGridStacks().length, cell.index);
}

/**
 * The target locks when mining starts, so walking does not cancel (the host
 * cancels when the target leaves reach), and neither does letting the aim go
 * back to rest: on a phone the thumb leaves the look stick to tap interact.
 * Aiming in another direction or changing the view level cancels.
 */
function checkMineLock() {
  if (!mineLock) return;
  const resting = scene.aim.x === 0 && scene.aim.y === 0;
  if (
    scene.viewMode === "entity" && scene.viewZ === mineLock.z &&
    (resting || (scene.aim.x === mineLock.x && scene.aim.y === mineLock.y))
  ) return;
  mineLock = null;
  if (isAdmin) guest?.send({ type: "mine-cancel" });
  else cancelMining(scene.world, scene.localId);
}

/** The mining actions to draw this frame, with progress from 0 to 1. @param {number} alpha */
function miningDisplay(alpha) {
  if (isAdmin) {
    const feed = scene.mineFeed;
    if (!feed) return [];
    const now = performance.now();
    return feed.entries.map((entry) => ({
      id: entry.id,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      progress: clamp((entry.elapsedMs + now - feed.at) / entry.totalMs, 0, 1),
    }));
  }
  return miningEntries(scene.world).filter((entry) =>
    entry.id === scene.localId || scene.viewMode === "master" ||
    tileVisibility(scene.visibility, entry.x, entry.y, entry.z) === "visible"
  ).map((entry) => ({
    id: entry.id,
    x: entry.x,
    y: entry.y,
    z: entry.z,
    progress: clamp(
      (entry.elapsedMs + alpha * TICK_MS) / entry.totalMs,
      0,
      1,
    ),
  }));
}

/** Shows or hides the small join QR below the host tools. */
function toggleJoinPanel() {
  ui.joinOpen = !ui.joinOpen;
}

/** Opens or closes the menu. It shuts the panels, which would sit under it. */
function toggleMenu() {
  toggleBag(false);
  shop.close();
  scene.menu = !scene.menu;
  scene.menuPage = "root";
}

/** @returns {{x:number,y:number}} */
function inputDirection() {
  if (joystick.x || joystick.y) return joystick;
  // The D-pad and left stick steer the open inventory panel instead of walking.
  if (!bag.isOpen && (gamepadDirection.x || gamepadDirection.y)) {
    return gamepadDirection;
  }
  return {
    x: Number(held.has("KeyF") || pressed.has("KeyF")) -
      Number(held.has("KeyS") || pressed.has("KeyS")),
    y: Number(held.has("KeyD") || pressed.has("KeyD")) -
      Number(held.has("KeyE") || pressed.has("KeyE")),
  };
}

/** @param {number} x @param {number} y @param {number} deadzone */
function stickDirection(x, y, deadzone) {
  if (Math.hypot(x, y) < deadzone) return { x: 0, y: 0 };
  const octant = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  const directions = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const [dx, dy] = directions[(octant + 8) % 8];
  return { x: dx, y: dy };
}

function pollGamepad() {
  if (!gamepadEnabled) return;
  const pads = navigator.getGamepads?.() ?? [];
  const supported = (/** @type {Gamepad|null} */ pad) =>
    pad?.connected && (pad.mapping === "standard" ||
      /Afterglow Wireless Deluxe Controller|0e6f.*0186/i.test(pad.id));
  const active = [...pads].find((candidate) =>
    candidate && supported(candidate) &&
    (candidate.buttons.some((button) => button.pressed) ||
      candidate.axes.some((axis) => Math.abs(axis) > 0.3))
  );
  const pad = active ??
    (supported(pads[gamepadIndex]) ? pads[gamepadIndex] : null) ??
    [...pads].find(supported);
  if (gamepadDebug) {
    const inspected = active ?? pad ??
      [...pads].find((candidate) => candidate?.connected);
    scene.displayStatus = inspected
      ? `${inspected.id}\nMapping: ${inspected.mapping || "raw"}\nAxes: ${
        inspected.axes.map((axis) => axis.toFixed(2)).join(", ")
      }\nButtons: ${
        inspected.buttons.flatMap((button, index) =>
          button.pressed ? [index] : []
        ).join(", ") || "none"
      }\nPage focus: ${document.hasFocus()}`
      : `No controller reported by browser\nPage focus: ${document.hasFocus()}\nPress A or the D-pad`;
  }
  if (!pad) {
    const unknown = [...pads].find((candidate) => candidate?.connected);
    if (gamepadIndex !== -1) {
      notify("Controller disconnected");
      if (scene.inputMode === "gamepad") scene.inputMode = "keyboard";
    } else if (unknown && unknown.id !== unsupportedGamepadId) {
      unsupportedGamepadId = unknown.id;
      notify(`Controller layout unavailable: ${unknown.id}`);
    }
    if (!unknown) unsupportedGamepadId = "";
    gamepadIndex = -1;
    gamepadDirection = { x: 0, y: 0 };
    gamepadCamera = { x: 0, y: 0 };
    gamepadZoom = 0;
    gamepadButtons.clear();
    return;
  }
  unsupportedGamepadId = "";
  const standard = pad.mapping === "standard";
  if (gamepadIndex !== pad.index) {
    gamepadIndex = pad.index;
    notify(`Controller connected: ${pad.id}`);
  }
  const buttons = new Set(
    pad.buttons.flatMap((button, index) => button.pressed ? [index] : []),
  );
  /** @param {number} index */
  const newlyPressed = (index) =>
    buttons.has(index) && !gamepadButtons.has(index);
  const previousDirection = gamepadDirection;
  gamepadDirection = stickDirection(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 0.3);
  const dpadX = standard
    ? Number(buttons.has(15)) - Number(buttons.has(14))
    : Math.abs(pad.axes[4] ?? 0) > 0.5
    ? Math.sign(pad.axes[4])
    : 0;
  const dpadY = standard
    ? Number(buttons.has(13)) - Number(buttons.has(12))
    : Math.abs(pad.axes[5] ?? 0) > 0.5
    ? Math.sign(pad.axes[5])
    : 0;
  gamepadDpad = { x: dpadX, y: dpadY };
  if ((dpadX || dpadY) && !isPickupGridOpen(pickupGrid)) {
    gamepadDirection = { x: dpadX, y: dpadY };
  }
  const cameraX = pad.axes[2] ?? 0;
  const cameraY = pad.axes[3] ?? 0;
  gamepadCamera = Math.hypot(cameraX, cameraY) < 0.18
    ? { x: 0, y: 0 }
    : { x: cameraX, y: cameraY };
  gamepadZoom = Number(buttons.has(7)) - Number(buttons.has(6));
  if (
    gamepadDirection.x !== previousDirection.x ||
    gamepadDirection.y !== previousDirection.y ||
    gamepadCamera.x || gamepadCamera.y ||
    buttons.size
  ) scene.inputMode = "gamepad";
  if (newlyPressed(2)) toggleBag();
  if (newlyPressed(1) && bag.isOpen) toggleBag(false);
  if (bag.isOpen) bag.steer(gamepadDirection, performance.now());
  if (newlyPressed(3)) {
    if (scene.chatOpen) closeChat();
    toggleMenu();
  }
  if (!scene.chatOpen && !scene.menu) {
    if (newlyPressed(4)) changeLayer(-1);
    if (newlyPressed(5)) changeLayer(1);
    if (newlyPressed(0)) interact();
  }
  if (newlyPressed(1)) shop.close();
  gamepadButtons = buttons;
}

function move() {
  const direction = scene.chatOpen || scene.menu || shop.isOpen()
    ? { x: 0, y: 0 }
    : inputDirection();
  pressed.clear();
  const changed = direction.x !== lastInputDirection.x ||
    direction.y !== lastInputDirection.y;
  lastInputDirection = direction;
  const speed = speedTilesPerSecond(stamina.sprint);
  if (isAdmin && (changed || scene.world.tick - lastInputSent >= 4)) {
    if (changed) sequence++;
    guest?.send({
      type: "input",
      dx: direction.x,
      dy: direction.y,
      sequence,
      sprint: stamina.sprint,
    });
    lastInputSent = scene.world.tick;
  }
  const player = scene.world.players[scene.localId];
  const before = player
    ? { x: centerTile(player.x), y: centerTile(player.y), z: player.z }
    : null;
  const moved = moveEntity(
    scene.world,
    scene.localId,
    direction.x,
    direction.y,
    speed,
  );
  stepStamina(stamina);
  if (
    !isAdmin && moved && player &&
    (player.move || before?.x !== centerTile(player.x) ||
      before.y !== centerTile(player.y) || before.z !== player.z)
  ) {
    host?.publish();
  }
}

/** The pointer routing over the UI layer. Elements act on pointer down. */
const router = createPointerRouter({
  layout: () => currentLayout(),
  onAction: (element) => uiAction(element),
  onRelease: (element) => {
    if (element.id === "key:backspace") stopBackspaceRepeat();
  },
  onStick: (id, state) => {
    const stick = id === "stick:move" ? "move" : "look";
    ui.sticks[stick] = {
      active: state.active,
      x: state.knobX,
      y: state.knobY,
      dir: state.x || state.y ? `${state.x},${state.y}` : "center",
    };
    if (stick === "move") joystick = { x: state.x, y: state.y };
    else cameraStick = { x: state.x, y: state.y };
  },
  onScroll: (list, pixels) => scrollList(list, pixels),
});

/**
 * A list moved by a drag or the wheel. A positive distance shows later rows.
 * @param {string} list @param {number} pixels
 */
function scrollList(list, pixels) {
  const layout = scene.ui?.layout ?? currentLayout();
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
  else shop.scrollBy(rows);
}

/** What the layout needs to know about the game right now. @returns {import('./ui.js').UiView} */
function uiView() {
  const now = performance.now();
  const notice = scene.notice && now < scene.notice.until
    ? scene.notice.text
    : scene.status;
  const players =
    Object.keys(scene.world.players).filter((id) => id !== "npc-corner").length;
  const touch = Boolean(touchQuery?.matches);
  return {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    safe: scene.safe,
    scale: scene.uiScale,
    dpr: globalThis.devicePixelRatio || 1,
    touch,
    loading: scene.loading,
    status: notice.slice(0, 75),
    displayStatus: scene.displayStatus,
    diagnostics: ui.diagnosticsOpen && !isAdmin ? ui.diagnostics : null,
    zoom: scene.touchGesture || now < scene.hudUntil
      ? `Z ${scene.viewZ}  ZOOM ${scene.zoom.toFixed(2)}`
      : null,
    // Only a browser tab offers fullscreen; a Home Screen app already fills the screen.
    fullscreen: !isStandalone(),
    fullscreenOn: document.fullscreenElement === gameRoot,
    host: isAdmin
      ? undefined
      : { tools: ui.hostTools, players, joinOpen: ui.joinOpen, qr: ui.qrReady },
    held: heldDisplay(),
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

/** Lay the UI out for this moment. Every frame and every pointer event asks. */
function currentLayout() {
  return layoutUi(uiView());
}

function isStandalone() {
  return Boolean(/** @type {{standalone?:boolean}} */ (navigator).standalone) ||
    Boolean(standaloneQuery?.matches);
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await gameRoot.requestFullscreen();
    scene.displayStatus = "";
  } catch {
    scene.displayStatus =
      "Fullscreen unavailable. Add this page to your Home Screen.";
  }
}

/** Backspace on the keyboard repeats while the key is held. */
/** @type {ReturnType<typeof setTimeout>|undefined} */
let backspaceTimer;
function stopBackspaceRepeat() {
  clearTimeout(backspaceTimer);
  clearInterval(backspaceTimer);
  backspaceTimer = undefined;
}

/** @param {string} key a character, "space", or "backspace" */
function typeIntoChat(key) {
  const next = typeKey(scene.chatDraft, key, ui.chatShift);
  scene.chatDraft = next.draft;
  ui.chatShift = next.shift;
  typing();
}

/** A tap on an in-game keyboard key. @param {import('./ui.js').UiElement} element */
function pressKey(element) {
  switch (element.key) {
    case "send":
      submitChat();
      break;
    case "close":
      closeChat();
      break;
    case "page":
      ui.chatPage = ui.chatPage === "letters" ? "symbols" : "letters";
      break;
    case "shift":
      ui.chatShift = !ui.chatShift;
      break;
    case "backspace":
      typeIntoChat("backspace");
      stopBackspaceRepeat();
      backspaceTimer = setTimeout(() => {
        backspaceTimer = setInterval(() => typeIntoChat("backspace"), 70);
      }, 400);
      break;
    default:
      if (element.key) typeIntoChat(element.key);
  }
}

/** A key on a physical keyboard while chat is open. @param {KeyboardEvent} event */
function chatKey(event) {
  // Browser shortcuts such as Ctrl+R keep working.
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "Enter") submitChat();
  else if (event.key === "Escape") closeChat();
  else if (event.key === "Backspace") typeIntoChat("backspace");
  else if (event.key.length === 1) typeIntoChat(event.key);
  else return;
  event.preventDefault();
}

/** A tap on a UI element. @param {import('./ui.js').UiElement} element */
function uiAction(element) {
  const id = element.id;
  if (id.startsWith("key:")) return pressKey(element);
  if (id.startsWith("slot:")) return bag.tap(id.slice(5));
  if (id.startsWith("row:")) return shop.tapRow(id.slice(4));
  if (id.startsWith("btn:session:")) return joinSession(id.slice(12));
  if (id.startsWith("btn:size:")) {
    const size = TEXT_SIZES.find((candidate) => candidate === id.slice(9));
    if (!size) return;
    scene.textSize = size;
    try {
      localStorage.setItem(TEXT_SIZE_KEY, scene.textSize);
    } catch {
      // The choice still applies for this visit.
    }
    return;
  }
  switch (id) {
    case "btn:interact":
      return interact();
    case "btn:sprint":
      return toggleSprint();
    case "btn:chat":
      return openChat();
    case "btn:log":
      return toggleLog();
    case "btn:menu":
      return toggleMenu();
    case "btn:bag":
      return toggleBag();
    case "btn:fullscreen":
      return void toggleFullscreen();
    case "btn:qr":
      return toggleJoinPanel();
    case "btn:log-close":
      return toggleLog(false);
    case "btn:bag-close":
      return toggleBag(false);
    case "btn:shop-close":
      return shop.close();
    case "scrim:menu":
    case "btn:resume":
      scene.menu = false;
      return;
    case "btn:settings":
      scene.menuPage = "settings";
      return;
    case "btn:back":
      scene.menuPage = "root";
      return;
    case "btn:leave":
      guest?.close();
      location.reload();
      return;
    case "btn:scale-down":
      scene.uiScale = clamp(scene.uiScale - 0.25, 1, 2);
      return;
    case "btn:scale-up":
      scene.uiScale = clamp(scene.uiScale + 0.25, 1, 2);
      return;
  }
}

/**
 * Pinch and two-finger level drags work on the world only: a pointer that
 * starts on a UI element never joins a gesture.
 */
function bindWorldGesture() {
  /** @type {Map<number,{x:number,y:number}>} */
  const pointers = new Map();
  /** @type {{mode:"pending"|"pinch"|"layer",distance:number,y:number,zoom:number,z:number}|null} */
  let gesture = null;
  let updateQueued = false;
  const updateGesture = () => {
    updateQueued = false;
    if (!gesture || pointers.size !== 2) return;
    const [a, b] = [...pointers.values()];
    if (!a || !b) return;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const dy = (a.y + b.y) / 2 - gesture.y;
    const distanceChange = Math.abs(distance - gesture.distance);
    if (gesture.mode === "pending") {
      if (distanceChange > 12 && distanceChange > Math.abs(dy) * 0.7) {
        gesture.mode = "pinch";
      } else if (Math.abs(dy) > 14 && Math.abs(dy) > distanceChange * 1.2) {
        gesture.mode = "layer";
      }
    }
    if (gesture.mode === "pinch") {
      scene.zoomTarget = clamp(
        gesture.zoom * distance / Math.max(1, gesture.distance),
        0.25,
        2,
      );
    } else if (gesture.mode === "layer") {
      const steps = Math.floor(Math.abs(dy) / 48);
      scene.viewZ = clamp(gesture.z - Math.sign(dy) * steps, 0, WORLD_TOP);
    }
  };
  /** @param {PointerEvent} event */
  const down = (event) => {
    tapPickupGrid(event.clientX, event.clientY);
    if (event.pointerType !== "touch") return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      gesture = {
        mode: "pending",
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        y: (a.y + b.y) / 2,
        zoom: scene.zoomTarget,
        z: scene.viewZ,
      };
      scene.touchGesture = true;
    }
  };
  /** @param {PointerEvent} event */
  const move = (event) => {
    if (event.pointerType !== "touch" || !pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!updateQueued) {
      updateQueued = true;
      requestAnimationFrame(updateGesture);
    }
  };
  /** @param {PointerEvent} event */
  const release = (event) => {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size < 2) {
      gesture = null;
      scene.touchGesture = false;
      scene.hudUntil = 0;
    }
  };
  return { down, move, release };
}

function bindInput() {
  document.addEventListener("fullscreenchange", () => {
    scene.displayStatus = "";
  });
  const world = bindWorldGesture();
  /** @param {PointerEvent} event */
  const point = (event) => {
    const box = canvas.getBoundingClientRect();
    return {
      id: event.pointerId,
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    };
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    if (event.pointerType === "touch") scene.inputMode = "touch";
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that already ended cannot be captured.
    }
    if (router.down(point(event)) === "world") world.down(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    router.move(point(event));
    world.move(event);
  });
  /** @param {PointerEvent} event @param {boolean} cancelled */
  const finish = (event, cancelled) => {
    router.up(point(event), cancelled);
    world.release(event);
  };
  canvas.addEventListener("pointerup", (event) => finish(event, false));
  canvas.addEventListener("pointercancel", (event) => finish(event, true));
  canvas.addEventListener(
    "lostpointercapture",
    (event) => finish(event, true),
  );
  canvas.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
  document.addEventListener("keydown", (event) => {
    if (event.code === "KeyR" && (event.ctrlKey || event.metaKey)) return;
    if (scene.chatOpen) {
      chatKey(event);
      return;
    }
    if (event.code === "F3" && !isAdmin && !event.repeat) {
      event.preventDefault();
      ui.diagnosticsOpen = !ui.diagnosticsOpen;
      return;
    }
    if (event.code === "KeyQ" && !isAdmin && !event.repeat) {
      event.preventDefault();
      toggleJoinPanel();
      return;
    }
    scene.inputMode = "keyboard";
    if (event.code === "Backquote") {
      event.preventDefault();
      if (!event.repeat) toggleLog();
      return;
    }
    if (event.code === "KeyB" && !event.repeat) {
      event.preventDefault();
      toggleBag();
      return;
    }
    if (event.code === "Escape" && bag.isOpen) {
      event.preventDefault();
      if (!event.repeat) toggleBag(false);
      return;
    }
    if (event.code === "Escape" && isPickupGridOpen(pickupGrid)) {
      event.preventDefault();
      if (!event.repeat) closePickupGrid(pickupGrid);
      return;
    }
    if (event.code === "Escape" && shop.isOpen()) {
      event.preventDefault();
      if (!event.repeat) shop.close();
      return;
    }
    if (event.code === "Escape" && ui.logOpen) {
      event.preventDefault();
      if (!event.repeat) toggleLog(false);
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      if (!event.repeat) {
        scene.menu = !scene.menu;
        scene.menuPage = "root";
      }
      return;
    }
    if (event.code === "KeyT" || event.code === "Slash") {
      event.preventDefault();
      if (!event.repeat) openChat(event.code === "Slash" ? "/" : "");
      return;
    }
    if (event.code === "KeyH") {
      event.preventDefault();
      if (!event.repeat) toggleSprint();
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      if (!event.repeat) interact();
      return;
    }
    if (
      shop.isOpen() && ["KeyI", "KeyK", "KeyJ", "KeyL"].includes(event.code)
    ) {
      // IJKL choose a row in the shop panel; a held key repeats in `shop.steer`.
      event.preventDefault();
      if (!event.repeat && event.code === "KeyI") shop.move(-1);
      if (!event.repeat && event.code === "KeyK") shop.move(1);
      return;
    }
    gridKey(event.code, event.repeat);
    held.add(event.code);
    if (
      bag.isOpen && ["KeyI", "KeyJ", "KeyK", "KeyL"].includes(event.code) &&
      !event.repeat
    ) {
      // Step on the key press itself, so a tap shorter than a frame still counts.
      const look = cameraInput();
      bag.steer(stickDirection(look.x, look.y, 0.18), performance.now());
    }
    if (
      ["KeyE", "KeyS", "KeyD", "KeyF"].includes(event.code) && !event.repeat
    ) pressed.add(event.code);
    if (
      [
        "KeyE",
        "KeyS",
        "KeyD",
        "KeyF",
        "KeyI",
        "KeyJ",
        "KeyK",
        "KeyL",
        "KeyR",
        "KeyV",
        "KeyU",
        "KeyN",
      ].includes(event.code)
    ) {
      event.preventDefault();
    }
    if (event.code === "KeyR" && !event.repeat) changeLayer(1);
    if (event.code === "KeyV" && !event.repeat) changeLayer(-1);
    if (event.code === "KeyU" || event.code === "KeyN") {
      scene.hudUntil = performance.now() + 500;
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.code === "Space") event.preventDefault();
    held.delete(event.code);
    gridKeysAtOpen.delete(event.code);
    if (["KeyR", "KeyV", "KeyU", "KeyN"].includes(event.code)) {
      scene.hudUntil = performance.now() + 500;
    }
  });
  globalThis.addEventListener("blur", () => {
    held.clear();
    pressed.clear();
    router.releaseAll();
    joystick = { x: 0, y: 0 };
    cameraStick = { x: 0, y: 0 };
    gamepadDirection = { x: 0, y: 0 };
    gamepadCamera = { x: 0, y: 0 };
    gamepadZoom = 0;
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const scrolled = router.wheel(
      event.clientX - canvas.getBoundingClientRect().left,
      event.clientY - canvas.getBoundingClientRect().top,
      event.deltaY,
    );
    if (scrolled) return;
    scene.inputMode = "keyboard";
    scene.zoomTarget = clamp(
      scene.zoomTarget * (event.deltaY < 0 ? 1.1 : 0.9),
      0.25,
      2,
    );
    scene.hudUntil = performance.now() + 500;
  }, { passive: false });
}

function startAdminList() {
  ui.sessions.open = true;
  setInterval(() => {
    const metrics = scene.metrics;
    if (!metrics) return;
    const samples = [...metrics.rttMs].sort((a, b) => a - b);
    const median = samples.length
      ? samples[Math.floor(samples.length / 2)]
      : null;
    const p95 = samples.length
      ? samples[Math.ceil(samples.length * 0.95) - 1]
      : null;
    ui.sessions.stats = `WebRTC · route ${metrics.route} · join ${
      metrics.joinMs ?? "…"
    } ms · RTT median ${median ?? "…"} ms · p95 ${
      p95 ?? "…"
    } ms (${samples.length} samples)`;
  }, 500);
  const refresh = async () => {
    try {
      const response = await fetch(build.apiUrl("sessions"));
      const data = await response.json();
      ui.sessions.items = data.sessions.map((
        /** @type {{id:string}} */ item,
      ) => ({
        id: item.id,
      }));
      ui.sessions.status = data.sessions.length
        ? "Choose a world to join"
        : "No active visitors";
    } catch {
      ui.sessions.status = "Sessions unavailable";
    }
  };
  void refresh();
  setInterval(() => void refresh(), 5000);
}

/**
 * Load the join QR code as a texture. The shell serves it as an SVG, which a
 * canvas draws at a fixed size. A data URL keeps the canvas from tainting.
 * @param {string} url @param {{setQr:(source:TexImageSource|null)=>void}} renderer
 */
async function loadQr(url, renderer) {
  const response = await fetch(url);
  const svg = await response.text();
  const picture = new Image();
  picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await picture.decode();
  const surface = document.createElement("canvas");
  surface.width = surface.height = 384;
  const context = surface.getContext("2d");
  if (!context) return;
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 384, 384);
  context.drawImage(picture, 0, 0, 384, 384);
  renderer.setQr(surface);
  ui.qrReady = true;
}

/** @param {string} id */
function joinSession(id) {
  guest?.close();
  scene.presentation.reset();
  scene.sessionId = id;
  guest = joinWorld(scene, id);
}

export async function startApp() {
  if (!isAdmin) {
    scene.world = scene.layout === "room"
      ? (await import("../shared/spawn-room.js")).createSpawnRoomWorld()
      : (await import("../shared/authored-terrain.js")).createAuthoredWorld(
        new URL(location.href).searchParams.get("world") === "32" ? 32 : 16,
      );
  }
  enableLocomotion(
    addPlayer(
      scene.world,
      "self",
      scene.layout === "room" && !isAdmin ? roomSpawnTile(0) : undefined,
    ),
  );
  bindInput();
  const renderer = isSynthetic ? null : await createRenderer(canvas);
  const finishLoading = () => {
    scene.loading = null;
    canvas.dataset.ready = "true";
  };
  if (renderer) {
    renderer.ready.then(finishLoading).catch((error) => {
      scene.loading = "Cannot load the game. Reload to try again.";
      scene.telemetry?.("error", { status: "assets-failed" });
      console.error(error);
    });
  } else finishLoading();
  if (isAdmin && !joinRoute) startAdminList();
  else {
    if (!isAdmin) {
      scene.sessionId = crypto.randomUUID();
      tickNpc = scene.layout === "room"
        ? createCornerNpc(scene.world, NPC_ORIGIN)
        : createCornerNpc(scene.world);
      host = startHost(scene, scene.sessionId);
      // Only the host generates terrain. `?seed=` replays a world for tests.
      scene.world.generateChunk = createChunkGenerator(seedFromText(
        new URL(location.href).searchParams.get("seed") ?? scene.sessionId,
      ));
      generateAround(scene.world, Object.values(scene.world.players), 9);
      const link = build.joinLink(scene.sessionId, location.origin);
      ui.qrUrl = build.apiUrl(
        `qr/${scene.sessionId}?link=${encodeURIComponent(link)}`,
      );
      const params = new URL(location.href).searchParams;
      // Specs hide the host tools, which sit in screenshots, unless they ask with `?tools=1`.
      ui.hostTools = !params.has("harness") || params.has("tools");
      if (renderer) loadQr(ui.qrUrl, renderer).catch(() => {});
    }
  }
  if (joinRoute) joinSession(joinRoute);
  if (!isAdmin) {
    let previousBytes = 0;
    let previousTime = performance.now();
    setInterval(() => {
      if (!ui.diagnosticsOpen || !host) return;
      void host.diagnostics().then((stats) => {
        const now = performance.now();
        const bytes = stats.connections.reduce(
          (sum, connection) => sum + connection.bytesSent,
          0,
        );
        const upload = Math.max(0, bytes - previousBytes) * 1000 /
          Math.max(1, now - previousTime);
        previousBytes = bytes;
        previousTime = now;
        const queued = stats.connections.reduce(
          (sum, connection) =>
            sum + connection.bufferedAmount + connection.motionBufferedAmount,
          0,
        );
        const frameMean = frameMs.length
          ? frameMs.reduce((sum, value) => sum + value, 0) / frameMs.length
          : 0;
        ui.diagnostics =
          `HOST  F3 close\nFPS ${
            frameMean ? (1000 / frameMean).toFixed(0) : "…"
          }` +
          `  peers ${
            stats.connections.filter((connection) => connection.connected)
              .length
          }` +
          `\nPayload ${Math.round(upload / 1024)} KiB/s  queued ${
            Math.round(queued / 1024)
          } KiB` +
          `\nJoin failures ${stats.joinFailures}`;
      }).catch(() => {});
    }, 1000);
  }
  let last = performance.now();
  let accumulator = 0;
  /** @type {number[]} */
  const frameMs = [];
  const params = new URL(location.href).searchParams;
  // Telemetry is on by default so the admin dashboard shows how sessions run; `?telemetry=0`
  // turns it off. Test pages mark their reports so they can be told apart.
  if (params.get("telemetry") !== "0") {
    const test = params.get("test") === "1" || params.has("harness");
    /** @param {"summary"|"connection"|"error"} kind @param {Record<string,unknown>} fields */
    const report = (kind, fields = {}) => {
      if (!scene.sessionId) return;
      void fetch(build.apiUrl("telemetry"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          session: scene.sessionId,
          participant: scene.localId,
          role: isAdmin ? "guest" : "host",
          test,
          ...fields,
        }),
        keepalive: true,
      }).catch(() => {});
    };
    scene.telemetry = report;
    let lastConnection = "";
    setInterval(() => {
      const status = isAdmin
        ? /retry|disconnect|failed/i.test(scene.status)
          ? "reconnecting"
          : scene.localId.startsWith("peer-")
          ? "connected"
          : "connecting"
        : "hosting";
      if (status !== lastConnection) {
        lastConnection = status;
        report("connection", { status, route: scene.metrics?.route ?? "none" });
      }
      const orderedRtt = [...(scene.metrics?.rttMs ?? [])].sort((a, b) =>
        a - b
      );
      void (async () => {
        const stats = await host?.diagnostics();
        report("summary", {
          status,
          route: scene.metrics?.route ?? "none",
          players: Object.keys(scene.world.players).length,
          frameMeanMs: frameMs.length
            ? frameMs.reduce((sum, value) => sum + value, 0) / frameMs.length
            : 0,
          frameMaxMs: Math.max(0, ...frameMs),
          rttMs: orderedRtt[Math.floor(orderedRtt.length / 2)] ?? null,
          bytesSent: stats?.connections.reduce(
            (sum, connection) => sum + connection.bytesSent,
            0,
          ) ?? 0,
          queuedBytes: stats?.connections.reduce(
            (sum, connection) =>
              sum + connection.bufferedAmount + connection.motionBufferedAmount,
            0,
          ) ?? 0,
        });
      })().catch(() => report("error", { status: "metrics-failed" }));
    }, 10_000);
    globalThis.addEventListener(
      "error",
      () => report("error", { status: "script-error" }),
    );
    globalThis.addEventListener(
      "unhandledrejection",
      () => report("error", { status: "unhandled-rejection" }),
    );
  }
  /** @param {number} now */
  const frame = (now) => {
    const elapsed = now - last;
    const dt = Math.min(250, elapsed);
    last = now;
    frameMs.push(elapsed);
    if (frameMs.length > 300) frameMs.shift();
    pollGamepad();
    accumulator += dt;
    while (accumulator >= TICK_MS) {
      advanceTicks(scene.world);
      tickNpc?.();
      host?.tick();
      generateAround(scene.world, Object.values(scene.world.players));
      move();
      if (!isAdmin) {
        for (const player of Object.values(scene.world.players)) {
          scene.presentation.observe(player, scene.world.tick);
        }
      }
      accumulator -= TICK_MS;
    }
    const local = scene.world.players[scene.localId];
    if (local) {
      if (!isAdmin && scene.viewMode === "entity") {
        recomputeVisibility(
          scene.world,
          scene.visibility,
          visibilityPosition(local, scene.world.tick + accumulator / TICK_MS),
        );
      }
      if (local.z !== lastPlayerZ) {
        lastPlayerZ = local.z;
        scene.viewZ = clamp(local.z, 0, WORLD_TOP);
        scene.hudUntil = performance.now() + 500;
      }
    }
    if (!scene.chatOpen && !scene.menu) {
      const zoomDirection = Number(held.has("KeyN")) -
        Number(held.has("KeyU")) + gamepadZoom;
      if (zoomDirection) {
        scene.zoomTarget = clamp(
          scene.zoomTarget * Math.exp(zoomDirection * dt * 0.001),
          0.25,
          2,
        );
        scene.hudUntil = performance.now() + 500;
      }
    }
    scene.zoom += (scene.zoomTarget - scene.zoom) * (1 - Math.exp(-dt * 0.012));
    const correctionDecay = Math.exp(-dt / 140);
    scene.renderOffset.x *= correctionDecay;
    scene.renderOffset.y *= correctionDecay;
    scene.renderOffset.z *= correctionDecay;
    const look = cameraInput();
    // The look control steers the open inventory panel, not the aim or camera.
    bag.steer(stickDirection(look.x, look.y, 0.18), now);
    const { x: cameraX, y: cameraY } = bag.isOpen ? { x: 0, y: 0 } : look;
    if (scene.viewMode === "master") {
      scene.camera.x += cameraX * dt * 0.48;
      scene.camera.y += cameraY * dt * 0.48;
    } else {
      // While the pickup grid is open the look control moves its selector.
      scene.aim = isPickupGridOpen(pickupGrid)
        ? { x: 0, y: 0 }
        : stickDirection(cameraX, cameraY, 0.18);
      checkMineLock();
      const pos = local
        ? renderPosition(local, scene.world.tick + accumulator / TICK_MS)
        : { x: 7, y: 7, z: 0 };
      const targetX = (pos.x + scene.renderOffset.x + 0.5) * 64;
      const targetY = (pos.y + scene.renderOffset.y + 0.5) * 64;
      scene.camera.x = targetX;
      scene.camera.y = targetY;
    }
    if (scene.viewMode === "master") {
      const zoom = scene.zoom;
      const extent = terrainExtent(scene.world);
      scene.camera.x = clampCameraAxis(
        scene.camera.x,
        canvas.clientWidth,
        zoom,
        extent.maxX,
        extent.minX,
      );
      scene.camera.y = clampCameraAxis(
        scene.camera.y,
        canvas.clientHeight,
        zoom,
        extent.maxY,
        extent.minY,
      );
    }
    if (!isAdmin) {
      scene.chatFeed = chatView(scene.world, scene.localId, localChatBands);
    }
    hearChat(scene.hearingLog, scene.chatFeed, speakerName);
    scene.mining = miningDisplay(accumulator / TICK_MS);
    scene.items = itemsDisplay();
    updatePickupGrid();
    scene.inventory = inventoryDisplay();
    bag.update(scene.inventory, heldDisplay());
    shop.update(scene.inventory);
    shop.steer(shopDirection(), now);
    scene.ui = {
      layout: currentLayout(),
      state: { pressed: router.pressed(), sticks: ui.sticks, now },
    };
    shop.fit(scene.ui.layout.shopList?.capacity ?? 1);
    const liveText = [
      scene.notice && now < scene.notice.until
        ? scene.notice.text
        : scene.status,
      scene.displayStatus,
    ].filter(Boolean).join("\n");
    if (liveStatus.textContent !== liveText) liveStatus.textContent = liveText;
    renderer?.render(scene, accumulator / TICK_MS);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if (new URL(location.href).searchParams.has("harness")) {
    /** @type {{__od?:unknown}} */ (globalThis).__od = {
      scene,
      openChat,
      stamina,
      join: joinSession,
      /** The UI layer's current layout, for specs that tap elements. */
      ui: {
        layout: () => currentLayout(),
        /** @param {string} id */
        rect: (id) => currentLayout().byId.get(id)?.rect ?? null,
        ids: () => [...currentLayout().byId.keys()],
        state: ui,
        qrUrl: () => ui.qrUrl,
      },
      /** @param {Record<string,unknown>} message */
      send: (message) => guest?.send(message) ?? false,
      hostStats: () => host?.diagnostics() ?? null,
      wireDebug: () => guest?.wireDebug() ?? null,
      dropSignaling: () => guest?.dropSignaling(),
      resetNetworkStats: () => guest?.resetDiagnostics(),
      /** @param {unknown} value @param {boolean} [replaceable] */
      injectPacket: (value, replaceable = false) =>
        guest?.injectPacket(value, replaceable),
      frameStats: () => ({
        samples: frameMs.length,
        meanMs: frameMs.length
          ? frameMs.reduce((sum, value) => sum + value, 0) / frameMs.length
          : 0,
        maxMs: Math.max(0, ...frameMs),
      }),
      /** @param {number} dx @param {number} dy */
      startMove: (dx, dy) =>
        startMove(scene.world, scene.localId, dx, dy, ++sequence),
      /** @param {string} id */
      visualPosition: (id) => {
        const player = scene.world.players[id];
        if (!player) return null;
        const tick = scene.world.tick + accumulator / TICK_MS;
        const pos = scene.presentation.positionAt(
          player,
          tick,
          id === scene.localId,
        );
        return { tick, ...pos };
      },
      /** @param {string} id */
      visualSample: (id) => {
        const player = scene.world.players[id];
        if (!player) return null;
        const tick = scene.world.tick + accumulator / TICK_MS;
        const position = scene.presentation.positionAt(
          player,
          tick,
          id === scene.localId,
        );
        let opacity = scene.viewMode === "master"
          ? 1
          : player.viewMotion
          ? viewMotionOpacity(player.viewMotion, tick)
          : entityOpacity(player, tick, (x, y, z) =>
            tileVisibility(scene.visibility, x, y, z) === "visible", position);
        if (
          playerOccluded(scene.world, player, scene.viewZ) ||
          player.z < scene.viewZ - Z_LEVELS_BELOW
        ) opacity = 0;
        return {
          tick,
          ...position,
          opacity,
          typing: player.typing,
          hasMessage: Boolean(player.message),
          moveSequence: player.move?.sequence ?? null,
          sight: scene.visibility.sample,
        };
      },
      /** @param {string} id */
      authoritativePosition: (id) => {
        const player = scene.world.players[id];
        return player
          ? renderPosition(player, scene.world.tick + accumulator / TICK_MS)
          : null;
      },
      /** @param {string} id */
      authoritativeSample: (id) => {
        const player = scene.world.players[id];
        const tick = scene.world.tick + accumulator / TICK_MS;
        return player
          ? {
            ...renderPosition(player, tick),
            tick,
            motion: player.move
              ? {
                startPosition: player.move.startPosition,
                target: player.move.target,
                startTick: player.move.startTick,
                durationTicks: player.move.durationTicks,
              }
              : null,
            moveSequence: player.move?.sequence ?? null,
            typing: player.typing,
            hasMessage: Boolean(player.message),
          }
          : null;
      },
    };
  }
}
