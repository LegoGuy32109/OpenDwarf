import { useCallback, useEffect } from "preact/hooks";

const GAME_CANVAS_ID = "game-canvas";

export default function FullscreenButton() {
  const { window, document } = globalThis;

  const toggleFullscreen = useCallback(async () => {
    const canvas = document.getElementById(GAME_CANVAS_ID) as
      | HTMLCanvasElement
      | null;
    if (!canvas) return;

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await canvas.requestFullscreen();
    }
  }, [document]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "F11") {
        event.preventDefault();
        toggleFullscreen();
      }
    };

    window?.addEventListener("keydown", handleKeydown);

    return () => window?.removeEventListener("keydown", handleKeydown);
  }, [toggleFullscreen, window]);

  // this effect keeps track of style for canvas
  useEffect(() => {
    const handleFullscreenChange = () => {
      const canvas = document.getElementById(GAME_CANVAS_ID) as
        | HTMLCanvasElement
        | null;
      if (!canvas) return;

      if (document.fullscreenElement === canvas) {
        canvas.classList.add("is-fullscreen");
      } else {
        canvas.classList.remove("is-fullscreen");
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [document]);

  return (
    <button
      type="button"
      onClick={toggleFullscreen}
      class="inline-flex items-center gap-2 bg-white/5 px-3 py-1 text-sm font-medium uppercase tracking-[0.18em] text-white/80 transition hover:bg-white/10 hover:text-white"
    >
      F11 for Fullscreen
    </button>
  );
}
