import { useEffect, useState } from "preact/hooks";
import { Button } from "../components/Button.tsx";

export default function FullscreenButton() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const targetId = "game-canvas";

  useEffect(() => {
    const handler = () =>
      setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = async () => {
    const canvas = document.getElementById(targetId) as
      | HTMLCanvasElement
      | null;
    if (!canvas) return;
    if (!document.fullscreenElement) {
      await canvas.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  };

  return (
    <Button onClick={toggleFullscreen}>
      {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
    </Button>
  );
}
