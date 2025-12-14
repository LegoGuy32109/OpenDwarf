import { useCallback, useEffect } from "preact/hooks";
import { Button } from "../components/Button.tsx";

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

  return (
    <Button onClick={toggleFullscreen}>
      Fullscreen
    </Button>
  );
}
