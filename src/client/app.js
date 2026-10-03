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

/** @param {string} selector */
const $ = (
  selector,
) => /** @type {HTMLElement} */ (document.querySelector(selector));
const canvas = /** @type {HTMLCanvasElement} */ ($("#world"));
const chatInput = /** @type {HTMLInputElement} */ ($("#chat-input"));
const logPanel = $("#hearing-log");
/** The inventory panel and the held item icon. While it is open, interact and the look control drive it. */
const bag = createInventoryPanel({
  parent: $("#game"),
  onHold: (kind) => holdItem(kind),
  onOpenChange: () => typing(),
});
const logList = $("#hearing-log-lines");
let renderedLog = -1;
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
  status: "Local world",
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
const isPhoneTest = location.pathname === "/phone-test";
const joinRoute = /^\/join\/([a-zA-Z0-9_-]{8,80})$/.exec(location.pathname);
const isAdmin = location.pathname === "/admin" || isPhoneTest || !!joinRoute;
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

/** @param {string} [prefill] */
function openChat(prefill = "") {
  bag.toggle(false);
  scene.menu = false;
  scene.menuPage = "root";
  scene.chatOpen = true;
  scene.chatDraft = prefill;
  chatInput.value = prefill;
  chatInput.classList.add("open");
  chatInput.focus();
  typing();
}

function closeChat() {
  scene.chatOpen = false;
  scene.chatDraft = "";
  chatInput.value = "";
  chatInput.classList.remove("open");
  chatInput.blur();
  typing();
}

function submitChat() {
  const text = chatInput.value.trim();
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
function toggleLog(open = !logPanel.classList.contains("open")) {
  logPanel.hidden = !open;
  logPanel.classList.toggle("open", open);
  $("#log-button").setAttribute("aria-pressed", String(open));
  if (open) {
    renderedLog = -1;
    drawLog();
  }
}

/** @param {string} id */
function speakerName(id) {
  const name = scene.world.players[id]?.name;
  if (id === scene.localId) return name || "You";
  return name || "Visitor";
}

function drawLog() {
  const log = scene.hearingLog;
  if (logPanel.hidden || renderedLog === log.version) return;
  renderedLog = log.version;
  const atEnd = logList.scrollTop + logList.clientHeight >=
    logList.scrollHeight - 8;
  logList.replaceChildren(...log.lines.map((line) => {
    const item = document.createElement("li");
    item.className = line.kind;
    if (line.kind === "chat") {
      const who = document.createElement("b");
      who.textContent = `${line.speaker}: `;
      item.append(who, line.text ?? "");
    } else item.textContent = line.text;
    return item;
  }));
  if (atEnd || logList.scrollTop === 0) {
    logList.scrollTop = logList.scrollHeight;
  }
}

/** Draw the sprint button: pressed, dimmed while locked, and the stamina line. */
function showSprint() {
  const button = $("#sprint-button");
  button.setAttribute("aria-pressed", String(stamina.sprint));
  button.classList.toggle("is-on", stamina.sprint);
  button.classList.toggle("is-locked", stamina.locked);
  button.style.setProperty("--stamina", String(stamina.value));
  button.setAttribute(
    "aria-label",
    stamina.locked ? "Sprint locked until stamina is full" : "Sprint",
  );
}

/** Sprint doubles walk speed. It needs stamina and stays off while locked. */
function toggleSprint() {
  setSprint(stamina, !stamina.sprint);
  showSprint();
}

/** @param {string} text */
function flash(text) {
  scene.notice = { text, until: performance.now() + 2500 };
}

/** The look stick, IJKL, and controller camera input combined. */
function cameraInput() {
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
  if (open && (scene.chatOpen || scene.menu)) return;
  bag.toggle(open);
  $("#bag-button").setAttribute("aria-pressed", String(bag.isOpen));
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
 * The target locks when mining starts, so walking while the aim holds does not
 * cancel (the host cancels when the target leaves reach). A new aim direction
 * or view level means aiming at another tile, which cancels.
 */
function checkMineLock() {
  if (!mineLock) return;
  if (
    scene.viewMode === "entity" && scene.aim.x === mineLock.x &&
    scene.aim.y === mineLock.y && scene.viewZ === mineLock.z
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
  const panel = $("#join-panel");
  panel.hidden = !panel.hidden;
  $("#join-toggle").setAttribute("aria-expanded", String(!panel.hidden));
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
    $("#display-status").textContent = inspected
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
    toggleBag(false);
    scene.menu = !scene.menu;
    scene.menuPage = "root";
  }
  if (!scene.chatOpen && !scene.menu) {
    if (newlyPressed(4)) changeLayer(-1);
    if (newlyPressed(5)) changeLayer(1);
    if (newlyPressed(0)) interact();
  }
  gamepadButtons = buttons;
}

function move() {
  const direction = scene.chatOpen || scene.menu
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
  showSprint();
  if (
    !isAdmin && moved && player &&
    (player.move || before?.x !== centerTile(player.x) ||
      before.y !== centerTile(player.y) || before.z !== player.z)
  ) {
    host?.publish();
  }
}

/** @param {HTMLElement} element @param {(x:number,y:number)=>void} update */
function bindStick(element, update) {
  const knob =
    /** @type {HTMLElement} */ (element.querySelector(".stick-knob"));
  let pointer = -1;
  /** @param {PointerEvent} event */
  const change = (event) => {
    const box = element.getBoundingClientRect();
    const dx = event.clientX - box.left - box.width / 2;
    const dy = event.clientY - box.top - box.height / 2;
    const length = Math.hypot(dx, dy);
    const reach = box.width * 0.3;
    const scale = Math.min(1, reach / Math.max(1, length));
    knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    const deadzone = Math.max(20, box.width * 0.12);
    const octant = length < deadzone
      ? null
      : Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
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
    const [x, y] = octant === null ? [0, 0] : directions[(octant + 8) % 8];
    element.dataset.direction = x || y ? `${x},${y}` : "center";
    update(x, y);
  };
  element.addEventListener("pointerdown", (raw) => {
    const event = /** @type {PointerEvent} */ (raw);
    if (pointer !== -1) return;
    event.preventDefault();
    pointer = event.pointerId;
    element.setPointerCapture(pointer);
    element.classList.add("is-active");
    change(event);
  });
  element.addEventListener("pointermove", (raw) => {
    const event = /** @type {PointerEvent} */ (raw);
    if (event.pointerId === pointer) change(event);
  });
  /** @param {PointerEvent} event */
  const release = (event) => {
    if (event.pointerId !== pointer) return;
    pointer = -1;
    knob.style.transform = "";
    element.classList.remove("is-active");
    element.dataset.direction = "center";
    update(0, 0);
  };
  element.addEventListener("pointerup", release);
  element.addEventListener("pointercancel", release);
  element.addEventListener("lostpointercapture", release);
}

function bindTouchGesture() {
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
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" || scene.menu) return;
    event.preventDefault();
    scene.inputMode = "touch";
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
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
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "touch" || !pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!updateQueued) {
      updateQueued = true;
      requestAnimationFrame(updateGesture);
    }
  });
  /** @param {PointerEvent} event */
  const release = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) {
      gesture = null;
      scene.touchGesture = false;
      scene.hudUntil = 0;
    }
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
}

function bindInput() {
  const fullscreenButton = $("#fullscreen-toggle");
  const displayStatus = $("#display-status");
  const updateFullscreen = () => {
    const fullscreen = document.fullscreenElement === $("#game");
    fullscreenButton.textContent = fullscreen ? "×" : "⛶";
    fullscreenButton.setAttribute(
      "aria-label",
      fullscreen ? "Exit fullscreen" : "Enter fullscreen",
    );
    fullscreenButton.title = fullscreen
      ? "Exit fullscreen"
      : "Enter fullscreen";
  };
  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $("#game").requestFullscreen();
      displayStatus.textContent = "";
    } catch {
      displayStatus.textContent =
        "Fullscreen unavailable. Add this page to your Home Screen.";
    }
  });
  document.addEventListener("fullscreenchange", updateFullscreen);
  bindStick($("[data-stick=move]"), (x, y) => {
    scene.inputMode = "touch";
    joystick = { x, y };
  });
  bindStick($("[data-stick=camera]"), (x, y) => {
    scene.inputMode = "touch";
    cameraStick = { x, y };
  });
  $("#sprint-button").addEventListener("click", () => {
    scene.inputMode = "touch";
    toggleSprint();
  });
  $("#interact-button").addEventListener("click", () => {
    scene.inputMode = "touch";
    interact();
  });
  $("#chat-button").addEventListener("click", () => {
    scene.inputMode = "touch";
    openChat();
  });
  $("#log-button").addEventListener("click", () => {
    scene.inputMode = "touch";
    toggleLog();
  });
  $("#log-close").addEventListener("click", () => toggleLog(false));
  $("#bag-button").addEventListener("click", () => {
    scene.inputMode = "touch";
    toggleBag();
  });
  $("#menu-button").addEventListener("click", () => {
    scene.inputMode = "touch";
    toggleBag(false);
    scene.menu = !scene.menu;
    scene.menuPage = "root";
  });
  chatInput.addEventListener("input", () => {
    scene.chatDraft = chatInput.value;
    typing();
  });
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      submitChat();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeChat();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.code === "KeyR" && (event.ctrlKey || event.metaKey)) return;
    if (document.activeElement === chatInput) return;
    if (event.code === "F3" && !isAdmin && !event.repeat) {
      event.preventDefault();
      $("#diagnostics").hidden = !$("#diagnostics").hidden;
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
    if (event.code === "Escape" && logPanel.classList.contains("open")) {
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
    joystick = { x: 0, y: 0 };
    cameraStick = { x: 0, y: 0 };
    gamepadDirection = { x: 0, y: 0 };
    gamepadCamera = { x: 0, y: 0 };
    gamepadZoom = 0;
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") scene.inputMode = "touch";
    tapPickupGrid(event.clientX, event.clientY);
    if (!scene.menu) return;
    const panelHeight = Math.min(300, canvas.clientHeight - 20);
    const y = event.clientY - (canvas.clientHeight - panelHeight) / 2;
    const x = event.clientX - canvas.clientWidth / 2;
    if (
      Math.abs(x) > Math.min(160, (canvas.clientWidth - 20) / 2) || y < 0 ||
      y > panelHeight
    ) {
      scene.menu = false;
      return;
    }
    if (scene.menuPage === "settings") {
      if (y >= 208 && y < 244) scene.menuPage = "root";
      else if (y >= 164 && y < 202) {
        scene.textSize = TEXT_SIZES[x < -45 ? 0 : x > 45 ? 2 : 1];
        try {
          localStorage.setItem(TEXT_SIZE_KEY, scene.textSize);
        } catch {
          // The choice still applies for this visit.
        }
      } else if (y >= 88 && y < 126 && x < 0) {
        scene.uiScale = clamp(scene.uiScale - 0.25, 1, 2);
      } else if (y >= 88 && y < 126) {
        scene.uiScale = clamp(scene.uiScale + 0.25, 1, 2);
      }
      return;
    }
    if (y >= 40 && y < 73) scene.menu = false;
    else if (y >= 73 && y < 106) scene.menuPage = "settings";
    else if (y >= 106 && y < 140) {
      guest?.close();
      location.reload();
    }
  });
  bindTouchGesture();
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
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
  $("#admin").hidden = false;
  const sessions = $("#sessions");
  const status = $("#admin-status");
  const stats = $("#net-stats");
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
    stats.textContent = `WebRTC · route ${metrics.route} · join ${
      metrics.joinMs ?? "…"
    } ms · RTT median ${median ?? "…"} ms · p95 ${
      p95 ?? "…"
    } ms (${samples.length} samples)`;
  }, 500);
  const refresh = async () => {
    try {
      const response = await fetch("/api/admin/sessions");
      const data = await response.json();
      sessions.replaceChildren();
      status.textContent = data.sessions.length
        ? "Choose a world to join"
        : "No active visitors";
      for (const item of data.sessions) {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.dataset.sessionId = item.id;
        button.dataset.transport = "webrtc";
        button.textContent = `Join ${item.id.slice(0, 8)} · WebRTC`;
        button.addEventListener("click", () => {
          joinSession(item.id);
        });
        li.append(button);
        sessions.append(li);
      }
    } catch {
      status.textContent = "Presence unavailable";
    }
  };
  void refresh();
  setInterval(() => void refresh(), 5000);
}

/** @param {string} id */
function joinSession(id) {
  guest?.close();
  scene.presentation.reset();
  scene.sessionId = id;
  guest = joinWorld(scene, id);
}

/** Expose only predefined diagnostics from the opt-in phone test page. */
export const phoneDiagnostics = {
  /** @param {string} id */
  join(id) {
    if (!isPhoneTest || !/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return false;
    joinSession(id);
    return true;
  },
  /** @param {number} [holdMs] */
  drop(holdMs = 0) {
    if (isPhoneTest) guest?.dropConnection(holdMs);
  },
  sample() {
    return {
      at: new Date().toISOString(),
      session: scene.sessionId,
      status: scene.status,
      route: scene.metrics?.route ?? "none",
      joinMs: scene.metrics?.joinMs ?? null,
      rttMs: scene.metrics?.rttMs ?? [],
      localId: scene.localId,
      player: scene.world.players[scene.localId]
        ? {
          x: scene.world.players[scene.localId].x,
          y: scene.world.players[scene.localId].y,
          z: scene.world.players[scene.localId].z,
        }
        : null,
    };
  },
};

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
  $("#loading").hidden = true;
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
      const hostTools = $("#host-tools");
      const code = /** @type {HTMLImageElement} */ ($("#join-code"));
      code.src = `/api/qr/${scene.sessionId}`;
      hostTools.hidden = new URL(location.href).searchParams.has("harness");
      $("#join-toggle").addEventListener("click", toggleJoinPanel);
      setInterval(() => {
        const count = Object.keys(scene.world.players).filter((id) =>
          id !== "npc-corner"
        ).length;
        $("#player-count").textContent = `${count} player${
          count === 1 ? "" : "s"
        }`;
      }, 1000);
    }
  }
  if (isPhoneTest) {
    const selected = new URL(location.href).searchParams.get("session");
    if (selected) joinSession(selected);
  }
  if (joinRoute) joinSession(joinRoute[1]);
  if (!isAdmin) {
    let previousBytes = 0;
    let previousTime = performance.now();
    setInterval(() => {
      const panel = $("#diagnostics");
      if (panel.hidden || !host) return;
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
        panel.textContent =
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
  if (new URL(location.href).searchParams.get("telemetry") === "1") {
    const test = new URL(location.href).searchParams.get("test") === "1";
    /** @param {"summary"|"connection"|"error"} kind @param {Record<string,unknown>} fields */
    const report = (kind, fields = {}) => {
      if (!scene.sessionId) return;
      void fetch("/api/telemetry", {
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
    drawLog();
    scene.mining = miningDisplay(accumulator / TICK_MS);
    scene.items = itemsDisplay();
    updatePickupGrid();
    scene.inventory = inventoryDisplay();
    bag.update(scene.inventory, heldDisplay());
    renderer?.render(scene, accumulator / TICK_MS);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if (new URL(location.href).searchParams.has("harness")) {
    /** @type {{__od?:unknown}} */ (globalThis).__od = {
      scene,
      openChat,
      join: joinSession,
      /** @param {Record<string,unknown>} message */
      send: (message) => guest?.send(message) ?? false,
      hostStats: () => host?.diagnostics() ?? null,
      wireDebug: () => guest?.wireDebug() ?? null,
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
