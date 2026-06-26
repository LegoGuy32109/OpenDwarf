import { bootWebGl2Renderer } from "./webgl2/gpu-init.ts";
import { createInputController } from "./webgl2/input.ts";
import { startWebGl2RenderLoop } from "./webgl2/render-loop.ts";

function setErrorOverlay(overlay, message) {
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
  const canvas = document.querySelector("#webgl2-canvas");
  const errorOverlay = document.querySelector("#webgl2-error");
  const fullscreenButton = document.querySelector("#webgl2-fullscreen");
  const shell = document.querySelector(".webgl-experiment-shell");
  const viewModeRef = { current: "entity" };

  if (!canvas) {
    setErrorOverlay(errorOverlay, "WebGL2 canvas unavailable");
    return;
  }

  const boot = bootWebGl2Renderer(canvas);
  if (!boot) {
    setErrorOverlay(errorOverlay, "WebGL2 is required to play");
    return;
  }

  const stopInput = createInputController({ viewModeRef });
  const stopRender = startWebGl2RenderLoop(
    boot,
    (message) => setErrorOverlay(errorOverlay, message),
    () => viewModeRef.current,
  );

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
  setErrorOverlay(errorOverlay, null);

  const cleanup = () => {
    stopInput();
    stopRender();
  };
  window.addEventListener("pagehide", cleanup, { once: true });
}

startWebGl2Client();
