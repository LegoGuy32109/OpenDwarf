// @ts-check

import {
  addPlayer,
  advanceTicks,
  createWorld,
  setNickname,
  setTyping,
  startMove,
  submitMessage,
  TICK_MS,
} from "../shared/world.js";
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
    x: Number(held.has("KeyF")) - Number(held.has("KeyS")),
    y: Number(held.has("KeyD")) - Number(held.has("KeyE")),
  };
}

function move() {
  if (scene.chatOpen || scene.menu) return;
  const direction = inputDirection();
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

function bindInput() {
  bindStick($("[data-stick=move]"), (x, y) => {
    joystick = { x, y };
  });
  bindStick($("[data-stick=camera]"), (x, y) => {
    cameraStick = { x, y };
  });
  $("#chat-button").addEventListener("click", () => openChat());
  $("#menu-button").addEventListener("click", () => {
    scene.menu = !scene.menu;
    scene.menuPage = "root";
  });
  $("#chat-open").addEventListener("click", () => openChat());
  $("#menu-open").addEventListener("click", () => {
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
    if (event.code === "Escape") {
      event.preventDefault();
      scene.menu = !scene.menu;
      scene.menuPage = "root";
    } else if (event.code === "KeyT" || event.code === "Slash") {
      event.preventDefault();
      openChat(event.code === "Slash" ? "/" : "");
    } else {
      held.add(event.code);
      if (
        ["KeyE", "KeyS", "KeyD", "KeyF", "KeyI", "KeyJ", "KeyK", "KeyL"]
          .includes(event.code)
      ) {
        event.preventDefault();
      }
    }
  });
  document.addEventListener("keyup", (event) => held.delete(event.code));
  globalThis.addEventListener("blur", () => {
    held.clear();
    joystick = { x: 0, y: 0 };
    cameraStick = { x: 0, y: 0 };
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (!scene.menu) return;
    const x = event.clientX - canvas.clientWidth / 2;
    const y = event.clientY - canvas.clientHeight / 2;
    if (Math.abs(x) > 160 || Math.abs(y) > 115) {
      scene.menu = false;
      return;
    }
    if (scene.menuPage === "settings") {
      if (y > 43) scene.menuPage = "root";
      else if (y > -1 && y < 40 && x < 0) {
        scene.uiScale = Math.max(1, scene.uiScale - 0.25);
      } else if (y > -1 && y < 40) {
        scene.uiScale = Math.min(2, scene.uiScale + 0.25);
      }
      return;
    }
    if (y > -42 && y < 1) scene.menu = false;
    else if (y > 1 && y < 43) scene.menuPage = "settings";
    else if (y > 43 && y < 90) {
      guest?.close();
      location.reload();
    }
  });
  const touches = new Map();
  let pinchDistance = 0;
  canvas.addEventListener("pointerdown", (event) => {
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!touches.has(event.pointerId)) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size !== 2) return;
    const [a, b] = [...touches.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDistance) {
      scene.zoom = Math.max(
        0.5,
        Math.min(2.5, scene.zoom * distance / pinchDistance),
      );
    }
    pinchDistance = distance;
  });
  /** @param {PointerEvent} event */
  const releaseTouch = (event) => {
    touches.delete(event.pointerId);
    pinchDistance = 0;
  };
  canvas.addEventListener("pointerup", releaseTouch);
  canvas.addEventListener("pointercancel", releaseTouch);
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    scene.zoom = Math.max(
      0.5,
      Math.min(2.5, scene.zoom * (event.deltaY < 0 ? 1.1 : 0.9)),
    );
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
    const cameraX = Number(held.has("KeyL")) - Number(held.has("KeyJ")) +
      cameraStick.x;
    const cameraY = Number(held.has("KeyK")) - Number(held.has("KeyI")) +
      cameraStick.y;
    scene.cameraOffset.x += cameraX * dt * 0.35;
    scene.cameraOffset.y += cameraY * dt * 0.35;
    if (!cameraX) scene.cameraOffset.x *= Math.exp(-dt / 300);
    if (!cameraY) scene.cameraOffset.y *= Math.exp(-dt / 300);
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
