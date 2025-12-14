import { Button } from "../components/Button.tsx";

const GAME_CANVAS_ID = "game-canvas";

export default function FullscreenButton() {
  const { window, document } = globalThis;

  const toggleFullscreen = async () => {
    const canvas = document.getElementById(GAME_CANVAS_ID) as
      | HTMLCanvasElement
      | null;
    if (!canvas) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await canvas.requestFullscreen();
    }
  };

  return (
    <Button onClick={toggleFullscreen}>
      Fullscreen
    </Button>
  );
}
