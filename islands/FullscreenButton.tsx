import { useEffect, useState } from "preact/hooks";
import { Button } from "../components/Button.tsx";
import { IS_BROWSER } from "$fresh/runtime.ts";

const GAME_CANVAS_ID = "game-canvas";
const { window, document } = globalThis;

export default function FullscreenButton() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  if (IS_BROWSER) {
    console.log(document.fullscreenElement);
  }

  const syncState = () => {
    const canvas = document.getElementById(GAME_CANVAS_ID);
    const domFullscreen = !!document.fullscreenElement;
    // F11/browser fullscreen has no fullscreenElement; use heuristics
    const tolerance = 8;
    const windowFullscreen =
      Math.abs(window.innerHeight - screen.availHeight) <= tolerance &&
      Math.abs(window.innerWidth - screen.availWidth) <= tolerance;
    const mediaFullscreen = window.matchMedia?.("(display-mode: fullscreen)")
      .matches;
    const active = domFullscreen || windowFullscreen || mediaFullscreen;
    setIsFullscreen(active);
    if (canvas) {
      canvas.classList.toggle("full-window", active);
    }
  };

  useEffect(() => {
    const handler = () => syncState();
    document.addEventListener("fullscreenchange", handler);
    window.addEventListener("resize", handler);
    syncState();
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      window.removeEventListener("resize", handler);
    };
  }, []);

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
      {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
    </Button>
  );
}
