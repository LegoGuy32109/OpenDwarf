// @ts-check

/**
 * The input handlers: the keyboard, the gamepad, the on-screen sticks, the
 * pointer routing over the UI layer, and the pinch and two-finger gestures on
 * the world. They write the held keys and stick values to `ctx` and call the
 * actions that `interact.js`, `chat-input.js`, `panels.js`, and `session.js`
 * own. `input-values.js` turns that state into directions.
 */

import { TEXT_SIZE_KEY, TEXT_SIZES } from "../shared/chat.js";
import { VOICES_KEY, VOICES_LEVELS } from "./chatter.js";
import { MUSIC_KEY, MUSIC_LEVELS } from "./music.js";
import { EFFECTS_KEY, EFFECTS_LEVELS } from "./sfx.js";
import { setSprint } from "../shared/stamina.js";
import { createPointerRouter } from "./ui-pointer.js";
import { clamp, notify } from "./context.js";
import { openLevel, panelLookInput, stickDirection } from "./input-values.js";
import { interact } from "./interact.js";
import {
  actionPointer,
  cancelAction,
  pressAction,
  releaseAction,
  updateAction,
} from "./action-input.js";
import {
  chatKey,
  closeChat,
  openChat,
  pressKey,
  stopBackspaceRepeat,
} from "./chat-input.js";
import {
  closeMenu,
  goBack,
  gridKey,
  menuConfirm,
  menuStep,
  replaceWithBag,
  tapPickupGrid,
  toggleBag,
  toggleJoinPanel,
  toggleLog,
  toggleMenu,
} from "./panels.js";
import { currentLayout, scrollList, toggleFullscreen } from "./ui-view.js";
import { joinSession } from "./session.js";
import { MENU_ROWS } from "./menu-nav.js";

/** @typedef {import('./client-context.js').Context} Context */

/** Sprint doubles walk speed. It needs stamina and stays off while locked. @param {Context} ctx */
function toggleSprint(ctx) {
  setSprint(ctx.stamina, !ctx.stamina.sprint);
}

/** @param {Context} ctx @param {(Gamepad|null)[]} pads */
function selectGamepad(ctx, pads) {
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
  return { active, pad };
}

/** @param {Context} ctx @param {(Gamepad|null)[]} pads @param {Gamepad|null|undefined} pad @param {Gamepad|null|undefined} active */
function showGamepadDebug(ctx, pads, pad, active) {
  const { scene } = ctx;

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

/** @param {Context} ctx @param {(Gamepad|null)[]} pads */
function disconnectGamepad(ctx, pads) {
  const { scene } = ctx;

  const unknown = [...pads].find((candidate) => candidate?.connected);
  if (ctx.gamepadIndex !== -1) {
    cancelAction(ctx);
    notify(ctx, "Controller disconnected");
    if (scene.inputMode === "gamepad") scene.inputMode = "keyboard";
  } else if (unknown && unknown.id !== ctx.unsupportedGamepadId) {
    ctx.unsupportedGamepadId = unknown.id;
    notify(ctx, `Controller layout unavailable: ${unknown.id}`);
  }
  if (!unknown) ctx.unsupportedGamepadId = "";
  ctx.gamepadIndex = -1;
  ctx.gamepadId = "";
  ctx.gamepadDirection = { x: 0, y: 0 };
  ctx.gamepadCamera = { x: 0, y: 0 };
  ctx.gamepadStick = { x: 0, y: 0 };
  ctx.gamepadZoom = 0;
  ctx.gamepadButtons.clear();
  ctx.gamepadActionBlocked = true;
  return;
}

/** @param {Gamepad} pad @param {Set<number>} buttons */
function gamepadDpad(pad, buttons) {
  const standard = pad.mapping === "standard";
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
  return { x: dpadX, y: dpadY };
}

/** @param {Context} ctx @param {Gamepad} pad */
function readCameraAxes(ctx, pad) {
  const cameraX = pad.axes[2] ?? 0;
  const cameraY = pad.axes[3] ?? 0;
  ctx.gamepadCamera = Math.hypot(cameraX, cameraY) < 0.18
    ? { x: 0, y: 0 }
    : { x: cameraX, y: cameraY };
  ctx.gamepadStick = stickDirection(cameraX, cameraY, 0.5);
}

/** @param {Context} ctx @param {{x:number,y:number}} previousDirection @param {Set<number>} buttons */
function gamepadActive(ctx, previousDirection, buttons) {
  return Boolean(
    ctx.gamepadDirection.x !== previousDirection.x ||
      ctx.gamepadDirection.y !== previousDirection.y ||
      ctx.gamepadCamera.x || ctx.gamepadCamera.y ||
      buttons.size,
  );
}

/** @param {Context} ctx @param {Gamepad} pad @param {Set<number>} buttons */
function readGamepadAxes(ctx, pad, buttons) {
  const { scene } = ctx;
  const previousDirection = ctx.gamepadDirection;
  ctx.gamepadDirection = stickDirection(
    pad.axes[0] ?? 0,
    pad.axes[1] ?? 0,
    0.3,
  );
  const { x: dpadX, y: dpadY } = gamepadDpad(pad, buttons);
  ctx.gamepadDpad = { x: dpadX, y: dpadY };
  // The D-pad walks in the world; an open menu uses it to choose.
  const menuOpen = openLevel(ctx) !== null;
  if ((dpadX || dpadY) && !menuOpen) {
    ctx.gamepadDirection = { x: dpadX, y: dpadY };
  }
  readCameraAxes(ctx, pad);
  // A zooms in and B zooms out while held. Menus turn zoom off, and a B that
  // went Back keeps zoom out off until it is released.
  if (!buttons.has(0)) ctx.nav.zoomOutBlocked = false;
  const zoomIn = Number(!menuOpen && buttons.has(1));
  const zoomOut = Number(
    !menuOpen && !ctx.nav.zoomOutBlocked && buttons.has(0),
  );
  ctx.gamepadZoom = zoomIn - zoomOut;
  if (gamepadActive(ctx, previousDirection, buttons)) {
    scene.inputMode = "gamepad";
  }
  if (ctx.bag.isOpen) {
    ctx.bag.steer(ctx.gamepadDpad, performance.now());
    ctx.bag.steerStick(ctx.gamepadStick, performance.now());
  }
  return menuOpen;
}

/** @param {Context} ctx @param {(index:number)=>boolean} newlyPressed @param {boolean} menuOpen */
function gamepadActions(ctx, newlyPressed, menuOpen) {
  const { scene } = ctx;
  // B goes back one level. The press must not also zoom out once the menu is gone.
  if (newlyPressed(0) && menuOpen) {
    ctx.nav.zoomOutBlocked = true;
    goBack(ctx);
  }
  // Y opens the bag and X the menu; each replaces what is open.
  if (newlyPressed(2)) replaceWithBag(ctx);
  if (newlyPressed(3)) {
    if (scene.chatOpen) closeChat(ctx);
    toggleMenu(ctx);
  }
  if (!scene.chatOpen && newlyPressed(7)) confirmOrInteract(ctx, "gamepad");
  if (!scene.chatOpen && !scene.menu) {
    if (newlyPressed(6) && !menuOpen) toggleSprint(ctx);
  }
}

/** @param {Context} ctx */
function pollGamepad(ctx) {
  if (!ctx.gamepadEnabled) return;
  const pads = navigator.getGamepads?.() ?? [];
  const { active, pad } = selectGamepad(ctx, pads);
  if (ctx.gamepadDebug) showGamepadDebug(ctx, pads, pad, active);
  if (!pad) return disconnectGamepad(ctx, pads);
  ctx.unsupportedGamepadId = "";
  if (ctx.gamepadIndex !== pad.index || ctx.gamepadId !== pad.id) {
    if (ctx.gamepadIndex !== -1) cancelAction(ctx);
    ctx.gamepadActionBlocked = true;
    ctx.gamepadIndex = pad.index;
    ctx.gamepadId = pad.id;
    notify(ctx, `Controller connected: ${pad.id}`);
  }
  const buttons = new Set(
    pad.buttons.flatMap((button, index) => button.pressed ? [index] : []),
  );
  if (!buttons.has(7)) ctx.gamepadActionBlocked = false;
  const menuOpen = readGamepadAxes(ctx, pad, buttons);
  gamepadActions(
    ctx,
    (index) =>
      buttons.has(index) && !ctx.gamepadButtons.has(index) &&
      (index !== 7 || !ctx.gamepadActionBlocked),
    menuOpen,
  );
  if (!buttons.has(7) && ctx.gamepadButtons.has(7)) {
    releaseAction(ctx, "gamepad");
  }
  ctx.gamepadButtons = buttons;
}

/** Press a menu button by its id, as a tap on it would. @param {Context} ctx @param {string} id */
function pressMenuButton(ctx, id) {
  uiAction(ctx, { id, kind: "button", rect: { x: 0, y: 0, w: 0, h: 0 } });
}

/**
 * Space, ZR, or the interact button: confirm in the open menu, or interact
 * with the world. A newly opened menu ignores the press that is still held.
 * @param {Context} ctx @param {string} [source]
 */
function confirmOrInteract(ctx, source = "keyboard") {
  if (openLevel(ctx) === null) return pressAction(ctx, source);
  if (!ctx.nav.armed) return;
  if (ctx.scene.menu) menuConfirm(ctx, (id) => pressMenuButton(ctx, id));
  else interact(ctx);
}

/**
 * Step the Escape menu's selection from the D-pad, the right stick, or the
 * on-screen look stick by the shared stick step rule, and keep the fresh-press
 * gate current. IJKL step on the key press. Call it once a frame.
 * @param {Context} ctx @param {ReadonlySet<string>} pressed the UI element ids held down @param {number} now
 */
function steerMenu(ctx, pressed, now) {
  const { scene, nav } = ctx;
  nav.update(
    openLevel(ctx),
    ctx.confirmKeyHeld || ctx.gamepadButtons.has(7) ||
      pressed.has("btn:interact"),
  );
  if (!scene.menu) {
    nav.stick.releaseFirst();
    return;
  }
  const direction = ctx.gamepadDpad.x || ctx.gamepadDpad.y
    ? ctx.gamepadDpad
    : ctx.gamepadStick.x || ctx.gamepadStick.y
    ? ctx.gamepadStick
    : stickDirection(ctx.cameraStick.x, ctx.cameraStick.y, 0.5);
  const step = nav.stick.update(direction, now);
  if (step) {
    menuStep(ctx, step.x, step.y, (id) => pressMenuButton(ctx, id));
  }
}

/** @type {Record<string,(ctx:Context)=>unknown>} */
const UI_ACTIONS = {
  "btn:interact": (ctx) => confirmOrInteract(ctx, "pointer"),
  "btn:nav-back": goBack,
  "btn:sprint": toggleSprint,
  "btn:chat": openChat,
  "btn:log": toggleLog,
  "btn:menu": toggleMenu,
  "btn:bag": replaceWithBag,
  "btn:fullscreen": (ctx) => void toggleFullscreen(ctx),
  "btn:qr": toggleJoinPanel,
  "btn:update": () => location.reload(),
  "btn:log-close": (ctx) => toggleLog(ctx, false),
  "btn:bag-close": (ctx) => toggleBag(ctx, false),
  "btn:shop-close": (ctx) => ctx.shop.close(),
  "scrim:menu": closeMenu,
  "btn:resume": closeMenu,
  "btn:settings": (ctx) => {
    ctx.nav.rows.menu = MENU_ROWS.indexOf("settings");
    ctx.nav.rows.settings = 0;
    ctx.scene.menuPage = "settings";
  },
  "btn:back": (ctx) => {
    ctx.scene.menuPage = "root";
  },
  "btn:leave": (ctx) => {
    ctx.guest?.close();
    location.reload();
  },
  "btn:scale-down": (ctx) => {
    ctx.scene.uiScale = clamp(ctx.scene.uiScale - 0.25, 1, 2);
  },
  "btn:scale-up": (ctx) => {
    ctx.scene.uiScale = clamp(ctx.scene.uiScale + 0.25, 1, 2);
  },
};

/** @param {Context} ctx @param {string} id */
function chooseSize(ctx, id) {
  const { scene } = ctx;

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

/** @param {Context} ctx @param {string} id */
function chooseVoices(ctx, id) {
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

/** @param {Context} ctx @param {string} id */
function chooseMusic(ctx, id) {
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

/** @param {Context} ctx @param {string} id */
function chooseEffects(ctx, id) {
  const level = EFFECTS_LEVELS.find((candidate) => candidate === id.slice(12));
  if (!level) return;
  ctx.sfx.setLevel(level);
  try {
    localStorage.setItem(EFFECTS_KEY, level);
  } catch {
    // The choice still applies for this visit.
  }
  return;
}
/** A tap on a UI element. @param {Context} ctx @param {import('./ui-types.js').UiElement} element */
function uiAction(ctx, element) {
  const id = element.id;
  if (["btn:bag", "btn:chat", "btn:menu"].includes(id)) cancelAction(ctx);
  if (id.startsWith("key:")) return pressKey(ctx, element);
  if (id.startsWith("slot:")) return ctx.bag.tap(id.slice(5));
  if (id.startsWith("row:")) return ctx.shop.tapRow(id.slice(4));
  if (id.startsWith("btn:session:")) return joinSession(ctx, id.slice(12));
  if (id.startsWith("btn:size:")) return chooseSize(ctx, id);
  if (id.startsWith("btn:voices:")) return chooseVoices(ctx, id);
  if (id.startsWith("btn:music:")) return chooseMusic(ctx, id);
  if (id.startsWith("btn:effects:")) return chooseEffects(ctx, id);
  if (Object.hasOwn(UI_ACTIONS, id)) return UI_ACTIONS[id](ctx);
}

/**
 * Pinch zoom uses world pointers only: a pointer that starts on a UI element
 * never joins a gesture.
 * @param {Context} ctx
 */
function bindWorldGesture(ctx) {
  const { scene } = ctx;
  /** @type {Map<number,{x:number,y:number}>} */
  const pointers = new Map();
  /** @type {{distance:number,zoom:number}|null} */
  let gesture = null;
  const updateGesture = () => {
    if (!gesture || pointers.size !== 2) return;
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    scene.zoomTarget = clamp(
      gesture.zoom * distance / Math.max(1, gesture.distance),
      0.25,
      2,
    );
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
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        zoom: scene.zoomTarget,
      };
      scene.touchGesture = true;
    }
  };
  /** @param {PointerEvent} event */
  const move = (event) => {
    if (event.pointerType !== "touch" || !pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    updateGesture();
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

/** @type {Record<string,[number,number]>} */
const MENU_KEYS = { KeyI: [0, -1], KeyK: [0, 1], KeyJ: [-1, 0], KeyL: [1, 0] };

/** Q and Escape go back one level. @param {Context} ctx @param {KeyboardEvent} event */
function escapeKey(ctx, event) {
  event.preventDefault();
  if (event.repeat) return;
  cancelAction(ctx);
  goBack(ctx);
}
/** @type {Record<string,(ctx:Context)=>unknown>} */
const KEY_ACTIONS = {
  Backquote: toggleLog,
  KeyB: replaceWithBag,
  KeyT: openChat,
  Slash: (ctx) => openChat(ctx, "/"),
  KeyH: toggleSprint,
  Space: confirmOrInteract,
};
/** @param {Context} ctx @param {KeyboardEvent} event */
function commandKey(ctx, event) {
  if (!Object.hasOwn(KEY_ACTIONS, event.code)) return false;
  if (event.code === "KeyB" && event.repeat) return false;
  event.preventDefault();
  if (!event.repeat) {
    if (["KeyB", "KeyT", "Slash"].includes(event.code)) cancelAction(ctx);
    KEY_ACTIONS[event.code](ctx);
  }
  return true;
}

/** @param {Context} ctx @param {KeyboardEvent} event */
function globalKey(ctx, event) {
  const { scene, ui } = ctx;
  if (event.code === "KeyR" && (event.ctrlKey || event.metaKey)) return true;
  if (scene.chatOpen) {
    chatKey(ctx, event);
    return true;
  }
  if (event.code === "F3" && !ctx.isAdmin && !event.repeat) {
    event.preventDefault();
    ui.diagnosticsOpen = !ui.diagnosticsOpen;
    return true;
  }
  // Q does what Escape does.
  const code = event.code === "KeyQ" ? "Escape" : event.code;
  scene.inputMode = "keyboard";
  if (code === "Escape") {
    escapeKey(ctx, event);
    return true;
  }
  return commandKey(ctx, event);
}

/** IJKL choose in the Escape menu and the shop panel; the bag and the pickup grid read them in `worldKey` and `gridKey`. @param {Context} ctx @param {KeyboardEvent} event */
function menuKey(ctx, event) {
  const step = MENU_KEYS[event.code];
  if (!step) return false;
  if (ctx.scene.menu) {
    event.preventDefault();
    menuStep(ctx, step[0], step[1], (id) => pressMenuButton(ctx, id));
    return true;
  }
  if (ctx.shop.isOpen()) {
    // A held key repeats in `shop.steer`.
    event.preventDefault();
    if (!event.repeat && step[1]) ctx.shop.move(step[1]);
    return true;
  }
  return false;
}

/** @param {Context} ctx @param {KeyboardEvent} event */
function worldKey(ctx, event) {
  const { scene, bag, held, pressed } = ctx;
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
  if (event.code === "KeyU" || event.code === "KeyN") {
    scene.hudUntil = performance.now() + 500;
  }
}

/** @param {Context} ctx @param {KeyboardEvent} event */
function keyDown(ctx, event) {
  if (event.code === "Space") ctx.confirmKeyHeld = true;
  if (globalKey(ctx, event) || menuKey(ctx, event)) return;
  worldKey(ctx, event);
}

/**
 * Create the input handlers for `ctx`. `bind` attaches the DOM listeners,
 * `poll` reads the gamepad once a frame, and `router` is the pointer routing
 * over the UI layer.
 * @param {Context} ctx
 */
export function createInput(ctx) {
  const { scene, ui, canvas } = ctx;
  let cancellingPointer = false;
  /** The pointer routing over the UI layer. Elements act on pointer down. */
  const router = createPointerRouter({
    layout: () => currentLayout(ctx),
    onAction: (element) => uiAction(ctx, element),
    onInteract: (event) =>
      actionPointer(ctx, event, () => confirmOrInteract(ctx, "pointer")),
    onRelease: (element) => {
      if (element.id === "key:backspace") stopBackspaceRepeat(ctx);
      if (element.id === "btn:interact") {
        if (cancellingPointer) cancelAction(ctx);
        else releaseAction(ctx, "pointer");
      }
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
    // A touch pointerdown is not a user activation (only pointerup and
    // touchend are), so iOS refuses audio unlocked there; unlock on all three.
    const unlockAudio = () => {
      ctx.chatter.unlock();
      ctx.music.unlock();
      ctx.sfx.unlock();
    };
    document.addEventListener("touchend", unlockAudio, { passive: true });
    canvas.addEventListener("pointerdown", (event) => {
      unlockAudio();
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
      cancellingPointer = cancelled;
      router.up(point(event), cancelled);
      cancellingPointer = false;
      world.release(event);
    };
    canvas.addEventListener("pointerup", (event) => {
      unlockAudio();
      finish(event, false);
    });
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
      if (event.code === "Space") {
        event.preventDefault();
        releaseAction(ctx, "keyboard");
        ctx.confirmKeyHeld = false;
        // Arm the open menu now, so a quick press after the release counts.
        ctx.nav.update(openLevel(ctx), false);
      }
      ctx.held.delete(event.code);
      ctx.gridKeysAtOpen.delete(event.code);
      if (["KeyR", "KeyV", "KeyU", "KeyN"].includes(event.code)) {
        scene.hudUntil = performance.now() + 500;
      }
    });
    const cancelInputs = () => {
      cancelAction(ctx);
      ctx.held.clear();
      ctx.pressed.clear();
      ctx.confirmKeyHeld = false;
      router.releaseAll();
      ctx.joystick = { x: 0, y: 0 };
      ctx.cameraStick = { x: 0, y: 0 };
      ctx.gamepadDirection = { x: 0, y: 0 };
      ctx.gamepadCamera = { x: 0, y: 0 };
      ctx.gamepadStick = { x: 0, y: 0 };
      ctx.gamepadZoom = 0;
    };
    globalThis.addEventListener("blur", cancelInputs);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelInputs();
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

  return {
    bind,
    poll: () => {
      pollGamepad(ctx);
      updateAction(ctx);
    },
    steerMenu: (/** @type {number} */ now) =>
      steerMenu(ctx, router.pressed(), now),
    router,
  };
}
