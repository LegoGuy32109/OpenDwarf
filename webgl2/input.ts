/// <reference lib="dom" />

import {
  closeChat,
  deleteChatBufferWord,
  openChat,
  submitChat,
} from "./runtime.ts";
import type { WebGl2GameState } from "./game-state.ts";

type InputControllerArgs = {
  state: WebGl2GameState;
  fullscreenTarget?: HTMLElement | null;
  canvas?: HTMLCanvasElement | null;
};

const PLAYER_KEYS = new Set(["KeyE", "KeyS", "KeyD", "KeyF"]);
const CAMERA_KEYS = new Set(["KeyI", "KeyJ", "KeyK", "KeyL"]);
const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0];

function toggleFullscreen(target?: HTMLElement | null) {
  if (!target) return;
  if (document.fullscreenElement === target) {
    void document.exitFullscreen();
  } else {
    void target.requestFullscreen();
  }
}

function nextZoom(current: number, direction: -1 | 1) {
  const idx = ZOOM_LEVELS.reduce(
    (best, z, i) =>
      Math.abs(z - current) < Math.abs(ZOOM_LEVELS[best] - current) ? i : best,
    0,
  );
  return ZOOM_LEVELS[
    Math.max(0, Math.min(ZOOM_LEVELS.length - 1, idx + direction))
  ];
}

export function createInputController(args: InputControllerArgs) {
  const { state } = args;

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "F11") {
      event.preventDefault();
      toggleFullscreen(args.fullscreenTarget);
      return;
    }
    if (
      event.key === "Escape" &&
      document.fullscreenElement === args.fullscreenTarget
    ) {
      event.preventDefault();
      void document.exitFullscreen();
      return;
    }

    state.keysHeld.add(event.code);

    if (state.scene.uiMode === "chat") {
      event.preventDefault();
      if (event.key === "Escape") {
        closeChat(state);
      } else if (event.key === "Enter") {
        submitChat(state);
      } else if (event.key === "Backspace") {
        if (event.ctrlKey || event.shiftKey) {
          deleteChatBufferWord(state);
        } else {
          state.scene.chatBuffer = state.scene.chatBuffer.slice(0, -1);
        }
      } else if (event.key.length === 1) {
        state.scene.chatBuffer = `${state.scene.chatBuffer}${event.key}`;
      }
      return;
    }

    if (event.key === "/" || event.code === "Slash") {
      event.preventDefault();
      openChat(state, "/");
      return;
    }
    if (event.code === "KeyT") {
      event.preventDefault();
      openChat(state, "");
      return;
    }

    if (PLAYER_KEYS.has(event.code)) {
      event.preventDefault();
      state.playerKeysHeld.add(event.code);
      if (!event.repeat) {
        state.playerKeysJustPressed.add(event.code);
      }
    }

    if (CAMERA_KEYS.has(event.code)) {
      event.preventDefault();
      state.cameraKeysHeld.add(event.code);
    }

    if (event.code === "KeyR") {
      event.preventDefault();
      state.viewZ += 1;
      state.topmostDirty = true;
    }
    if (event.code === "KeyV") {
      event.preventDefault();
      state.viewZ -= 1;
      state.topmostDirty = true;
    }
    if (event.code === "KeyU") {
      event.preventDefault();
      state.scene.camera = {
        ...state.scene.camera,
        zoom: nextZoom(state.scene.camera.zoom, -1),
      };
      state.topmostDirty = true;
    }
    if (event.code === "KeyM") {
      event.preventDefault();
      state.scene.camera = {
        ...state.scene.camera,
        zoom: nextZoom(state.scene.camera.zoom, 1),
      };
      state.topmostDirty = true;
    }
    if (event.code === "Digit1") {
      event.preventDefault();
      state.uiOverlayVisible = !state.uiOverlayVisible;
    }
    if (event.code === "Digit6") {
      event.preventDefault();
      state.layers.floor = !state.layers.floor;
    }
    if (event.code === "Digit7") {
      event.preventDefault();
      state.layers.edgeShadow = !state.layers.edgeShadow;
    }
    if (event.code === "Digit8") {
      event.preventDefault();
      state.layers.ceilShadow = !state.layers.ceilShadow;
    }
    if (event.code === "Digit9") {
      event.preventDefault();
      state.layers.depthTint = !state.layers.depthTint;
    }
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    state.keysHeld.delete(event.code);
    state.cameraKeysHeld.delete(event.code);
    state.playerKeysHeld.delete(event.code);
  };

  const handleBlur = () => {
    state.keysHeld.clear();
    state.cameraKeysHeld.clear();
    state.playerKeysHeld.clear();
  };

  const handlePointerDown = () => {
    args.canvas?.focus();
  };

  const handleFullscreenChange = () => {
    handleBlur();
    state.scene.fullscreen = !!args.fullscreenTarget &&
      document.fullscreenElement === args.fullscreenTarget;
  };

  window.addEventListener("keydown", handleKeyDown, { passive: false });
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", handleBlur);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  args.canvas?.addEventListener("pointerdown", handlePointerDown);

  return () => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("blur", handleBlur);
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
    args.canvas?.removeEventListener("pointerdown", handlePointerDown);
  };
}
