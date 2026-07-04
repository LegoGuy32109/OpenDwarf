import { bootWebGl2Renderer } from "./webgl2/gpu-init.ts";
import { createInputController } from "./webgl2/input.ts";
import { startWebGl2RenderLoop } from "./webgl2/render-loop.ts";
import { applyCanvasDisplaySize } from "./webgl2/canvas.ts";
import { createWebGl2GameState } from "./webgl2/game-state.ts";

function setErrorOverlay(
  overlay: HTMLElement | null,
  message: string | null,
) {
  if (!overlay) {
    return;
  }
  if (message) {
    overlay.textContent = message;
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
  } else {
    overlay.textContent = "";
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
  }
}

function startWebGl2Client() {
  const canvas = document.querySelector<HTMLCanvasElement>("#webgl2-canvas");
  const errorOverlay = document.querySelector<HTMLElement>("#webgl2-error");
  const fullscreenButton = document.querySelector<HTMLButtonElement>(
    "#webgl2-fullscreen",
  );
  const shell = document.querySelector<HTMLElement>(".webgl-experiment-shell");
  const state = createWebGl2GameState();

  if (!canvas) {
    setErrorOverlay(errorOverlay, "WebGL2 canvas unavailable");
    return;
  }

  const boot = bootWebGl2Renderer(canvas);
  if (!boot) {
    setErrorOverlay(errorOverlay, "WebGL2 is required to play");
    return;
  }

  const stopInput = createInputController({
    state,
    fullscreenTarget: shell,
    canvas,
  });
  const stopRender = startWebGl2RenderLoop(
    boot,
    state,
    (message) => setErrorOverlay(errorOverlay, message),
  );

  const syncCanvas = () => {
    applyCanvasDisplaySize(canvas);
  };

  const handleFullscreenChange = () => {
    syncCanvas();
    canvas.focus();
  };

  const handleResize = () => {
    syncCanvas();
  };

  const handlePointerDown = () => {
    canvas.focus();
  };

  fullscreenButton?.addEventListener("click", async () => {
    if (!shell) {
      return;
    }
    if (document.fullscreenElement === shell) {
      await document.exitFullscreen();
    } else {
      await shell.requestFullscreen();
    }
  });

  canvas.tabIndex = 0;
  canvas.focus();
  canvas.addEventListener("pointerdown", handlePointerDown);
  globalThis.addEventListener("resize", handleResize);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  const resizeObserver = shell ? new ResizeObserver(syncCanvas) : null;
  if (shell) {
    resizeObserver?.observe(shell);
  }
  syncCanvas();
  setErrorOverlay(errorOverlay, null);

  const cleanup = () => {
    stopInput();
    stopRender();
    canvas.removeEventListener("pointerdown", handlePointerDown);
    globalThis.removeEventListener("resize", handleResize);
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
    resizeObserver?.disconnect();
  };
  globalThis.addEventListener("pagehide", cleanup, { once: true });
}

startWebGl2Client();
