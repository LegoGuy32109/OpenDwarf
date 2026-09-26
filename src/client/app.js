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
  recomputeVisibility,
  visibilityPosition,
} from "../shared/visibility.js";
import { clampCameraAxis } from "../shared/surface.js";
import { createRenderer } from "./render.js";
import { joinWorld, startHost } from "./network.js";

/** @param {string} selector */
const $ = (
  selector,
) => /** @type {HTMLElement} */ (document.querySelector(selector));
const canvas = /** @type {HTMLCanvasElement} */ ($("#world"));
const chatInput = /** @type {HTMLInputElement} */ ($("#chat-input"));
const scene = {
  world: createWorld(),
  localId: "self",
  menu: false,
  menuPage: "root",
  uiScale: 1,
  zoom: 1,
  zoomTarget: 1,
  viewZ: 0,
  viewMode: "entity",
  inputMode: "keyboard",
  hudUntil: 0,
  touchGesture: false,
  visibility: createVisibility(),
  camera: { x: 480, y: 480 },
  chatOpen: false,
  chatDraft: "",
  status: "Local world",
  cameraOffset: { x: 0, y: 0 },
  sessionId: "",
  metrics:
    /** @type {{transport:string,joinMs:number|null,rttMs:number[]}|undefined} */ (undefined),
};
/** @type {Set<string>} */
const held = new Set();
/** @type {Set<string>} */
const pressed = new Set();
/** @type {{x:number,y:number}} */
let joystick = { x: 0, y: 0 };
/** @type {{x:number,y:number}} */
let cameraStick = { x: 0, y: 0 };
let sequence = 0;
let lastTyping = false;
/** @type {ReturnType<typeof startHost>|null} */
let host = null;
/** @type {ReturnType<typeof joinWorld>|null} */
let guest = null;
const isAdmin = location.pathname === "/admin";
let lastPlayerZ = 0;

/** @param {number} value @param {number} min @param {number} max */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** @param {number} step */
function changeLayer(step) {
  scene.viewZ = clamp(scene.viewZ + step, 0, WORLD_TOP);
  scene.hudUntil = performance.now() + 500;
}

/** @param {"entity"|"master"} mode */
function setViewMode(mode) {
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
  if (scene.localId === "admin") guest?.send({ type: "typing", typing: next });
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
    if (scene.localId === "admin") guest?.send({ type: "nick", name });
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
  if (scene.localId === "admin") guest?.send({ type: "message", text });
  else host?.publish();
}

/** @returns {{x:number,y:number}} */
function inputDirection() {
  if (joystick.x || joystick.y) return joystick;
  return {
    x: Number(held.has("KeyF") || pressed.has("KeyF")) -
      Number(held.has("KeyS") || pressed.has("KeyS")),
    y: Number(held.has("KeyD") || pressed.has("KeyD")) -
      Number(held.has("KeyE") || pressed.has("KeyE")),
  };
}

function move() {
  if (scene.chatOpen || scene.menu) {
    pressed.clear();
    return;
  }
  const direction = inputDirection();
  pressed.clear();
  if (!direction.x && !direction.y) return;
  const result = startMove(
    scene.world,
    scene.localId,
    direction.x,
    direction.y,
    ++sequence,
  );
  if (result.ok) {
    if (scene.localId === "admin") {
      guest?.send({ type: "move", dx: direction.x, dy: direction.y, sequence });
    } else host?.publish();
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
    const max = box.width * 0.3;
    const x = Math.max(
      -1,
      Math.min(1, (event.clientX - box.left - box.width / 2) / max),
    );
    const y = Math.max(
      -1,
      Math.min(1, (event.clientY - box.top - box.height / 2) / max),
    );
    knob.style.transform = `translate(${x * max}px, ${y * max}px)`;
    update(
      Math.abs(x) > 0.3 ? Math.sign(x) : 0,
      Math.abs(y) > 0.3 ? Math.sign(y) : 0,
    );
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
  const release = () => {
    pointer = -1;
    knob.style.transform = "";
    element.classList.remove("is-active");
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
      submitChat();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeChat();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (document.activeElement === chatInput) return;
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
    stats.textContent = `${metrics.transport.toUpperCase()} · join ${
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
        for (const mode of /** @type {const} */ (["webrtc", "sse"])) {
          const button = document.createElement("button");
          button.dataset.sessionId = item.id;
          button.dataset.transport = mode;
          button.textContent = `Join ${
            item.id.slice(0, 8)
          } · ${mode.toUpperCase()}`;
          button.addEventListener("click", () => {
            guest?.close();
            guest = joinWorld(scene, item.id, mode);
          });
          li.append(button);
        }
        sessions.append(li);
      }
    } catch {
      status.textContent = "Presence unavailable";
    }
  };
  void refresh();
  setInterval(() => void refresh(), 5000);
}

export async function startApp() {
  addPlayer(scene.world, "self");
  bindInput();
  const renderer = await createRenderer(canvas);
  $("#loading").hidden = true;
  if (isAdmin) startAdminList();
  else {
    scene.sessionId = crypto.randomUUID();
    host = startHost(scene, scene.sessionId);
  }
  let last = performance.now();
  let accumulator = 0;
  /** @param {number} now */
  const frame = (now) => {
    const dt = Math.min(100, now - last);
    last = now;
    accumulator += dt;
    while (accumulator >= TICK_MS) {
      advanceTicks(scene.world);
      move();
      accumulator -= TICK_MS;
    }
    const local = scene.world.players[scene.localId];
    if (local) {
      recomputeVisibility(
        scene.visibility,
        visibilityPosition(local, scene.world.tick + accumulator / TICK_MS),
      );
      if (local.z !== lastPlayerZ) {
        lastPlayerZ = local.z;
        scene.viewZ = clamp(local.z, 0, WORLD_TOP);
        scene.hudUntil = performance.now() + 500;
      }
    }
    if (
      !scene.chatOpen && !scene.menu && (held.has("KeyU") || held.has("KeyN"))
    ) {
      const zoomDirection = Number(held.has("KeyN")) - Number(held.has("KeyU"));
      scene.zoomTarget = clamp(
        scene.zoomTarget * Math.exp(zoomDirection * dt * 0.001),
        0.25,
        2,
      );
      scene.hudUntil = performance.now() + 500;
    }
    scene.zoom += (scene.zoomTarget - scene.zoom) * (1 - Math.exp(-dt * 0.012));
    const cameraX = Number(held.has("KeyL")) - Number(held.has("KeyJ")) +
      cameraStick.x;
    const cameraY = Number(held.has("KeyK")) - Number(held.has("KeyI")) +
      cameraStick.y;
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
      const targetX = (pos.x + 0.5) * 64 + scene.cameraOffset.x;
      const targetY = (pos.y + 0.5) * 64 + scene.cameraOffset.y;
      const follow = 1 - Math.exp(-dt * 0.01);
      scene.camera.x += (targetX - scene.camera.x) * follow;
      scene.camera.y += (targetY - scene.camera.y) * follow;
    }
    const zoom = scene.zoom;
    scene.camera.x = clampCameraAxis(scene.camera.x, canvas.clientWidth, zoom);
    scene.camera.y = clampCameraAxis(scene.camera.y, canvas.clientHeight, zoom);
    renderer.render(scene, accumulator / TICK_MS);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if (new URL(location.href).searchParams.has("harness")) {
    /** @type {{__od?:unknown}} */ (globalThis).__od = {
      scene,
      openChat,
      /** @param {number} dx @param {number} dy */
      startMove: (dx, dy) =>
        startMove(scene.world, scene.localId, dx, dy, ++sequence),
    };
  }
}
