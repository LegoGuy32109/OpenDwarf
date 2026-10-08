// @ts-check

/**
 * The input handlers: the keyboard, the gamepad, the on-screen sticks, the
 * pointer routing over the UI layer, and the pinch and two-finger gestures on
 * the world. They write the held keys and stick values to `ctx` and call the
 * actions that `interact.js`, `chat-input.js`, `panels.js`, and `session.js`
 * own. `input-read.js` turns that state into directions.
 */

import { WORLD_TOP } from "../shared/world.js";
import { TEXT_SIZE_KEY, TEXT_SIZES } from "../shared/chat.js";
import { VOICES_KEY, VOICES_LEVELS } from "./chatter.js";
import { MUSIC_KEY, MUSIC_LEVELS } from "./music.js";
import { EFFECTS_KEY, EFFECTS_LEVELS } from "./sfx.js";
import { setSprint } from "../shared/stamina.js";
import { closePickupGrid, isPickupGridOpen } from "./pickup-grid.js";
import { createPointerRouter } from "./ui-pointer.js";
import { clamp, notify } from "./context.js";
import { panelLookInput, stickDirection } from "./input-read.js";
import { interact } from "./interact.js";
import {
  chatKey,
  closeChat,
  openChat,
  pressKey,
  stopBackspaceRepeat,
} from "./chat-input.js";
import {
  gridKey,
  tapPickupGrid,
  toggleBag,
  toggleJoinPanel,
  toggleLog,
  toggleMenu,
} from "./panels.js";
import { currentLayout, scrollList, toggleFullscreen } from "./ui-view.js";
import { joinSession } from "./session.js";

/** @typedef {import('./context.js').Context} Context */

/** @param {Context} ctx @param {number} step */
function changeLayer(ctx, step) {
  ctx.scene.viewZ = clamp(ctx.scene.viewZ + step, 0, WORLD_TOP);
  ctx.scene.hudUntil = performance.now() + 500;
}

/** Sprint doubles walk speed. It needs stamina and stays off while locked. @param {Context} ctx */
function toggleSprint(ctx) {
  setSprint(ctx.stamina, !ctx.stamina.sprint);
}

/** @param {Context} ctx */
function pollGamepad(ctx) {
  const { scene } = ctx;
  if (!ctx.gamepadEnabled) return;
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
    (supported(pads[ctx.gamepadIndex]) ? pads[ctx.gamepadIndex] : null) ??
    [...pads].find(supported);
  if (ctx.gamepadDebug) {
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
    if (ctx.gamepadIndex !== -1) {
      notify(ctx, "Controller disconnected");
      if (scene.inputMode === "gamepad") scene.inputMode = "keyboard";
    } else if (unknown && unknown.id !== ctx.unsupportedGamepadId) {
      ctx.unsupportedGamepadId = unknown.id;
      notify(ctx, `Controller layout unavailable: ${unknown.id}`);
    }
    if (!unknown) ctx.unsupportedGamepadId = "";
    ctx.gamepadIndex = -1;
    ctx.gamepadDirection = { x: 0, y: 0 };
    ctx.gamepadCamera = { x: 0, y: 0 };
    ctx.gamepadStick = { x: 0, y: 0 };
    ctx.gamepadZoom = 0;
    ctx.gamepadButtons.clear();
    return;
  }
  ctx.unsupportedGamepadId = "";
  const standard = pad.mapping === "standard";
  if (ctx.gamepadIndex !== pad.index) {
    ctx.gamepadIndex = pad.index;
    notify(ctx, `Controller connected: ${pad.id}`);
  }
  const buttons = new Set(
    pad.buttons.flatMap((button, index) => button.pressed ? [index] : []),
  );
  /** @param {number} index */
  const newlyPressed = (index) =>
    buttons.has(index) && !ctx.gamepadButtons.has(index);
  const previousDirection = ctx.gamepadDirection;
  ctx.gamepadDirection = stickDirection(
    pad.axes[0] ?? 0,
    pad.axes[1] ?? 0,
    0.3,
  );
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
  ctx.gamepadDpad = { x: dpadX, y: dpadY };
  if ((dpadX || dpadY) && !isPickupGridOpen(ctx.pickupGrid)) {
    ctx.gamepadDirection = { x: dpadX, y: dpadY };
  }
  const cameraX = pad.axes[2] ?? 0;
  const cameraY = pad.axes[3] ?? 0;
  ctx.gamepadCamera = Math.hypot(cameraX, cameraY) < 0.18
    ? { x: 0, y: 0 }
    : { x: cameraX, y: cameraY };
  const leftStick = stickDirection(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 0.3);
  ctx.gamepadStick = leftStick.x || leftStick.y
    ? leftStick
    : stickDirection(cameraX, cameraY, 0.5);
  const panelOpen = ctx.bag.isOpen || isPickupGridOpen(ctx.pickupGrid) ||
    ctx.shop.isOpen();
  // A zooms in and B zooms out while held. Panels turn zoom off.
  ctx.gamepadZoom = panelOpen
    ? 0
    : Number(buttons.has(1)) - Number(buttons.has(0));
  if (
    ctx.gamepadDirection.x !== previousDirection.x ||
    ctx.gamepadDirection.y !== previousDirection.y ||
    ctx.gamepadCamera.x || ctx.gamepadCamera.y ||
    buttons.size
  ) scene.inputMode = "gamepad";
  if (ctx.bag.isOpen) {
    ctx.bag.steer(ctx.gamepadDpad, performance.now());
    ctx.bag.steerStick(ctx.gamepadStick, performance.now());
  }
  // Y or X closes the open panel; X opens the menu only with no panel open.
  if (newlyPressed(2) || newlyPressed(3)) {
    if (panelOpen) {
      toggleBag(ctx, false);
      closePickupGrid(ctx.pickupGrid);
      ctx.shop.close();
    } else if (newlyPressed(3)) {
      if (scene.chatOpen) closeChat(ctx);
      toggleMenu(ctx);
    } else toggleBag(ctx);
  }
  if (!scene.chatOpen && !scene.menu) {
    if (newlyPressed(4)) changeLayer(ctx, -1);
    if (newlyPressed(5)) changeLayer(ctx, 1);
    if (newlyPressed(7)) interact(ctx);
    if (newlyPressed(6) && !panelOpen) toggleSprint(ctx);
  }
  ctx.gamepadButtons = buttons;
}

/** A tap on a UI element. @param {Context} ctx @param {import('./ui.js').UiElement} element */
function uiAction(ctx, element) {
  const { scene } = ctx;
  const id = element.id;
  if (id.startsWith("key:")) return pressKey(ctx, element);
  if (id.startsWith("slot:")) return ctx.bag.tap(id.slice(5));
  if (id.startsWith("row:")) return ctx.shop.tapRow(id.slice(4));
  if (id.startsWith("btn:session:")) return joinSession(ctx, id.slice(12));
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
  if (id.startsWith("btn:voices:")) {
    const level = VOICES_LEVELS.find((candidate) => candidate === id.slice(11));
    if (!level) return;
    ctx.chatter.setLevel(level);
    try {
      localStorage.setItem(VOICES_KEY, level);
    } catch {
      // The choice still applies for this visit.
    }
    return;
  }
  if (id.startsWith("btn:music:")) {
    const level = MUSIC_LEVELS.find((candidate) => candidate === id.slice(10));
    if (!level) return;
    ctx.music.setLevel(level);
    try {
      localStorage.setItem(MUSIC_KEY, level);
    } catch {
      // The choice still applies for this visit.
    }
    return;
  }
  if (id.startsWith("btn:effects:")) {
    const level = EFFECTS_LEVELS.find((candidate) =>
      candidate === id.slice(12)
    );
    if (!level) return;
    ctx.sfx.setLevel(level);
    try {
      localStorage.setItem(EFFECTS_KEY, level);
    } catch {
      // The choice still applies for this visit.
    }
    return;
  }
  switch (id) {
    case "btn:interact":
      return interact(ctx);
    case "btn:sprint":
      return toggleSprint(ctx);
    case "btn:chat":
      return openChat(ctx);
    case "btn:log":
      return toggleLog(ctx);
    case "btn:menu":
      return toggleMenu(ctx);
    case "btn:bag":
      return toggleBag(ctx);
    case "btn:fullscreen":
      return void toggleFullscreen(ctx);
    case "btn:qr":
      return toggleJoinPanel(ctx);
    case "btn:update":
      location.reload();
      return;
    case "btn:log-close":
      return toggleLog(ctx, false);
    case "btn:bag-close":
      return toggleBag(ctx, false);
    case "btn:shop-close":
      return ctx.shop.close();
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
      ctx.guest?.close();
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
 * @param {Context} ctx
 */
function bindWorldGesture(ctx) {
  const { scene } = ctx;
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
    tapPickupGrid(ctx, event.clientX, event.clientY);
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

/** @param {Context} ctx @param {KeyboardEvent} event */
function keyDown(ctx, event) {
  const { scene, ui, bag, shop, held, pressed } = ctx;
  if (event.code === "KeyR" && (event.ctrlKey || event.metaKey)) return;
  if (scene.chatOpen) {
    chatKey(ctx, event);
    return;
  }
  if (event.code === "F3" && !ctx.isAdmin && !event.repeat) {
    event.preventDefault();
    ui.diagnosticsOpen = !ui.diagnosticsOpen;
    return;
  }
  // Q does what Escape does.
  const code = event.code === "KeyQ" ? "Escape" : event.code;
  scene.inputMode = "keyboard";
  if (event.code === "Backquote") {
    event.preventDefault();
    if (!event.repeat) toggleLog(ctx);
    return;
  }
  if (event.code === "KeyB" && !event.repeat) {
    event.preventDefault();
    toggleBag(ctx);
    return;
  }
  if (code === "Escape" && bag.isOpen) {
    event.preventDefault();
    if (!event.repeat) toggleBag(ctx, false);
    return;
  }
  if (code === "Escape" && isPickupGridOpen(ctx.pickupGrid)) {
    event.preventDefault();
    if (!event.repeat) closePickupGrid(ctx.pickupGrid);
    return;
  }
  if (code === "Escape" && shop.isOpen()) {
    event.preventDefault();
    if (!event.repeat) shop.close();
    return;
  }
  if (code === "Escape" && ui.logOpen) {
    event.preventDefault();
    if (!event.repeat) toggleLog(ctx, false);
    return;
  }
  if (code === "Escape") {
    event.preventDefault();
    if (!event.repeat) {
      scene.menu = !scene.menu;
      scene.menuPage = "root";
    }
    return;
  }
  if (event.code === "KeyT" || event.code === "Slash") {
    event.preventDefault();
    if (!event.repeat) openChat(ctx, event.code === "Slash" ? "/" : "");
    return;
  }
  if (event.code === "KeyH") {
    event.preventDefault();
    if (!event.repeat) toggleSprint(ctx);
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    if (!event.repeat) interact(ctx);
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
  gridKey(ctx, event.code, event.repeat);
  held.add(event.code);
  if (
    bag.isOpen && ["KeyI", "KeyJ", "KeyK", "KeyL"].includes(event.code) &&
    !event.repeat
  ) {
    // Step on the key press itself, so a tap shorter than a frame still counts.
    const look = panelLookInput(ctx);
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
  if (event.code === "KeyR" && !event.repeat) changeLayer(ctx, 1);
  if (event.code === "KeyV" && !event.repeat) changeLayer(ctx, -1);
  if (event.code === "KeyU" || event.code === "KeyN") {
    scene.hudUntil = performance.now() + 500;
  }
}

/**
 * Create the input handlers for `ctx`. `bind` attaches the DOM listeners,
 * `poll` reads the gamepad once a frame, and `router` is the pointer routing
 * over the UI layer.
 * @param {Context} ctx
 */
export function createInput(ctx) {
  const { scene, ui, canvas } = ctx;
  /** The pointer routing over the UI layer. Elements act on pointer down. */
  const router = createPointerRouter({
    layout: () => currentLayout(ctx),
    onAction: (element) => uiAction(ctx, element),
    onRelease: (element) => {
      if (element.id === "key:backspace") stopBackspaceRepeat(ctx);
    },
    onStick: (id, state) => {
      const stick = id === "stick:move" ? "move" : "look";
      ui.sticks[stick] = {
        active: state.active,
        x: state.knobX,
        y: state.knobY,
        dir: state.x || state.y ? `${state.x},${state.y}` : "center",
      };
      if (stick === "move") ctx.joystick = { x: state.x, y: state.y };
      else ctx.cameraStick = { x: state.x, y: state.y };
    },
    onScroll: (list, pixels) => scrollList(ctx, list, pixels),
  });

  function bind() {
    document.addEventListener("fullscreenchange", () => {
      scene.displayStatus = "";
    });
    const world = bindWorldGesture(ctx);
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
      ctx.chatter.unlock();
      ctx.music.unlock();
      ctx.sfx.unlock();
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
    // A long press must not open the browser's menu over a stick or a key.
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("touchmove", (event) => {
      if (event.touches.length > 1) event.preventDefault();
    }, { passive: false });
    document.addEventListener("keydown", (event) => {
      ctx.chatter.unlock();
      ctx.music.unlock();
      ctx.sfx.unlock();
      keyDown(ctx, event);
    });
    document.addEventListener("keyup", (event) => {
      if (event.code === "Space") event.preventDefault();
      ctx.held.delete(event.code);
      ctx.gridKeysAtOpen.delete(event.code);
      if (["KeyR", "KeyV", "KeyU", "KeyN"].includes(event.code)) {
        scene.hudUntil = performance.now() + 500;
      }
    });
    globalThis.addEventListener("blur", () => {
      ctx.held.clear();
      ctx.pressed.clear();
      router.releaseAll();
      ctx.joystick = { x: 0, y: 0 };
      ctx.cameraStick = { x: 0, y: 0 };
      ctx.gamepadDirection = { x: 0, y: 0 };
      ctx.gamepadCamera = { x: 0, y: 0 };
      ctx.gamepadStick = { x: 0, y: 0 };
      ctx.gamepadZoom = 0;
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

  return { bind, poll: () => pollGamepad(ctx), router };
}
