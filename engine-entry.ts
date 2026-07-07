import { startEngineClient } from "./engine/runtime.ts";

function syncCanvas(canvas: HTMLCanvasElement) {
  const width = Math.max(
    1,
    Math.round(canvas.clientWidth * (globalThis.devicePixelRatio || 1)),
  );
  const height = Math.max(
    1,
    Math.round(canvas.clientHeight * (globalThis.devicePixelRatio || 1)),
  );
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function startEngine() {
  const canvas = document.querySelector<HTMLCanvasElement>("#engine-canvas");
  const errorOverlay = document.querySelector<HTMLElement>("#engine-error");
  const fullscreenButton = document.querySelector<HTMLButtonElement>(
    "#engine-fullscreen",
  );
  const shell = document.querySelector<HTMLElement>(".engine-experiment-shell");

  if (!canvas) {
    if (errorOverlay) {
      errorOverlay.textContent = "Engine canvas unavailable";
      errorOverlay.classList.remove("hidden");
      errorOverlay.classList.add("flex");
    }
    return;
  }

  canvas.tabIndex = 0;
  syncCanvas(canvas);

  const resizeObserver = shell
    ? new ResizeObserver(() => syncCanvas(canvas))
    : null;
  if (shell) {
    resizeObserver?.observe(shell);
  }

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

  let stop: (() => void) | null = null;
  const harness = new URL(globalThis.location.href).searchParams.get("harness") ===
    "1";
  void startEngineClient(canvas, errorOverlay, { harness }).then((cleanup) => {
    stop = cleanup;
  });

  const cleanup = () => {
    stop?.();
    resizeObserver?.disconnect();
  };
  globalThis.addEventListener("pagehide", cleanup, { once: true });
}

startEngine();
