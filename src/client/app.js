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
import { viewMotionOpacity } from "../shared/view.js";
import { Z_LEVELS_BELOW } from "../shared/world.js";
import { createRenderer } from "./render.js";
import { joinWorld, startHost } from "./network.js";
import { createCornerNpc } from "../shared/npc.js";
import { createPresentation } from "./presentation.js";

/** @param {string} selector */
const $ = (
  selector,
) => /** @type {HTMLElement} */ (document.querySelector(selector));
const canvas = /** @type {HTMLCanvasElement} */ ($("#world"));
const chatInput = /** @type {HTMLInputElement} */ ($("#chat-input"));
const gamepadDebug = new URL(location.href).searchParams.has("gamepad-debug");
const gamepadEnabled = !new URL(location.href).searchParams.has("harness") ||
  gamepadDebug;
const scene = {
  world: createWorld(),
  localId: "self",
  menu: false,
  menuPage: "root",
  uiScale: 1,
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
  chatOpen: false,
  chatDraft: "",
  status: "Local world",
  cameraOffset: { x: 0, y: 0 },
  sessionId: "",
  metrics:
    /** @type {{joinMs:number|null,rttMs:number[],route:string}|undefined} */ (undefined),
  telemetry:
    /** @type {((kind:"summary"|"connection"|"error",fields?:Record<string,unknown>)=>void)|undefined} */ (undefined),
};
/** @type {Set<string>} */
const held = new Set();
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
let lastInputDirection = { x: 0, y: 0 };
let inputBlocked = false;
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
/** @type {ReturnType<typeof createCornerNpc>|null} */
let tickNpc = null;

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
  if (mode === "entity") scene.cameraOffset = { x: 0, y: 0 };
  notify(`${mode === "master" ? "Master" : "Entity"} view`);
}

/** @param {string} text */
function notify(text) {
  scene.status = text;
}

function typing() {
  const value = scene.chatDraft.trim();
  const next = scene.chatOpen && value.length > 0 && !value.startsWith("/");
  if (next === lastTyping) return;
  lastTyping = next;
  setTyping(scene.world, scene.localId, next);
  if (isAdmin) guest?.send({ type: "typing", typing: next });
  else host?.publish();
}

/** @param {string} [prefill] */
function openChat(prefill = "") {
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
      const result = setNickname(scene.world, scene.localId, name);
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

/** @returns {{x:number,y:number}} */
function inputDirection() {
  if (joystick.x || joystick.y) return joystick;
  if (gamepadDirection.x || gamepadDirection.y) return gamepadDirection;
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
  if (dpadX || dpadY) {
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
  if (newlyPressed(3)) {
    if (scene.chatOpen) closeChat();
    scene.menu = !scene.menu;
    scene.menuPage = "root";
  }
  if (!scene.chatOpen && !scene.menu) {
    if (newlyPressed(4)) changeLayer(-1);
    if (newlyPressed(5)) changeLayer(1);
  }
  gamepadButtons = buttons;
}

function move() {
  const direction = scene.chatOpen || scene.menu
    ? { x: 0, y: 0 }
    : inputDirection();
  pressed.clear();
  if (
    isAdmin &&
    (direction.x !== lastInputDirection.x ||
      direction.y !== lastInputDirection.y)
  ) {
    guest?.send({ type: "cancel", sequence });
    inputBlocked = false;
  }
  lastInputDirection = direction;
  if (!direction.x && !direction.y) {
    inputBlocked = false;
    return;
  }
  const result = startMove(
    scene.world,
    scene.localId,
    direction.x,
    direction.y,
    sequence + 1,
  );
  if (result.ok) {
    inputBlocked = false;
    sequence++;
    if (isAdmin) {
      guest?.send({ type: "move", dx: direction.x, dy: direction.y, sequence });
    } else host?.publish();
  } else if (isAdmin && result.reason !== "already moving" && !inputBlocked) {
    guest?.send({ type: "cancel", sequence });
    inputBlocked = true;
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
  $("#chat-button").addEventListener("click", () => {
    scene.inputMode = "touch";
    openChat();
  });
  $("#menu-button").addEventListener("click", () => {
    scene.inputMode = "touch";
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
      $("#join-panel").hidden = !$("#join-panel").hidden;
      return;
    }
    scene.inputMode = "keyboard";
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
    held.add(event.code);
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
    held.delete(event.code);
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
      if (y >= 132 && y < 166) scene.menuPage = "root";
      else if (y >= 88 && y < 126 && x < 0) {
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
    scene.world = (await import("../shared/authored-terrain.js"))
      .createAuthoredWorld(
        new URL(location.href).searchParams.get("world") === "32" ? 32 : 16,
      );
  }
  addPlayer(scene.world, "self");
  bindInput();
  const renderer = isSynthetic ? null : await createRenderer(canvas);
  $("#loading").hidden = true;
  if (isAdmin && !joinRoute) startAdminList();
  else {
    if (!isAdmin) {
      scene.sessionId = crypto.randomUUID();
      tickNpc = createCornerNpc(scene.world);
      host = startHost(scene, scene.sessionId);
      const hostTools = $("#host-tools");
      const joinPanel = $("#join-panel");
      const link = `${location.origin}/join/${scene.sessionId}`;
      const anchor = /** @type {HTMLAnchorElement} */ ($("#join-link"));
      const code = /** @type {HTMLImageElement} */ ($("#join-code"));
      anchor.href = link;
      anchor.textContent = link;
      code.src = `/api/qr/${scene.sessionId}`;
      hostTools.hidden = new URL(location.href).searchParams.has("harness");
      joinPanel.hidden = hostTools.hidden;
      $("#join-toggle").addEventListener("click", () => {
        joinPanel.hidden = !joinPanel.hidden;
      });
      $("#join-close").addEventListener("click", () => {
        joinPanel.hidden = true;
      });
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
          (sum, connection) => sum + connection.bufferedAmount,
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
            (sum, connection) => sum + connection.bufferedAmount,
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
      if (tickNpc?.()) host?.publish();
      host?.tick();
      move();
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
    const controllerCamera = scene.chatOpen || scene.menu
      ? { x: 0, y: 0 }
      : gamepadCamera;
    const cameraX = Number(held.has("KeyL")) - Number(held.has("KeyJ")) +
      cameraStick.x + controllerCamera.x;
    const cameraY = Number(held.has("KeyK")) - Number(held.has("KeyI")) +
      cameraStick.y + controllerCamera.y;
    if (scene.viewMode === "master") {
      scene.camera.x += cameraX * dt * 0.48;
      scene.camera.y += cameraY * dt * 0.48;
    } else {
      scene.cameraOffset.x += cameraX * dt * 0.48;
      scene.cameraOffset.y += cameraY * dt * 0.48;
      if (!cameraX) scene.cameraOffset.x *= Math.exp(-dt / 200);
      if (!cameraY) scene.cameraOffset.y *= Math.exp(-dt / 200);
      const pos = local
        ? renderPosition(local, scene.world.tick + accumulator / TICK_MS)
        : { x: 7, y: 7, z: 0 };
      const targetX = (pos.x + scene.renderOffset.x + 0.5) * 64 +
        scene.cameraOffset.x;
      const targetY = (pos.y + scene.renderOffset.y + 0.5) * 64 +
        scene.cameraOffset.y;
      const follow = 1 - Math.exp(-dt * 0.01);
      scene.camera.x += (targetX - scene.camera.x) * follow;
      scene.camera.y += (targetY - scene.camera.y) * follow;
    }
    const zoom = scene.zoom;
    scene.camera.x = clampCameraAxis(
      scene.camera.x,
      canvas.clientWidth,
      zoom,
      scene.world.edge,
    );
    scene.camera.y = clampCameraAxis(
      scene.camera.y,
      canvas.clientHeight,
      zoom,
      scene.world.edge,
    );
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
            tileVisibility(scene.visibility, x, y, z) === "visible");
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
