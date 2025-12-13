import { useEffect, useState } from "preact/hooks";
import { Button } from "../components/Button.tsx";

declare global {
  // Exposed in islands/GameCanvas.tsx after the wasm module initializes
  var bevyWasmLog: (() => void) | undefined;
  var flipPlayerSpriteY: (() => void) | undefined;
}

export default function DebugControls() {
  const [logReady, setLogReady] = useState(
    typeof globalThis.bevyWasmLog === "function" &&
      typeof globalThis.flipPlayerSpriteY === "function",
  );

  useEffect(() => {
    const markReady = () => {
      setLogReady(
        typeof globalThis.bevyWasmLog === "function" &&
          typeof globalThis.flipPlayerSpriteY === "function",
      );
    };

    markReady();
    globalThis.addEventListener?.("bevy-wasm-ready", markReady);

    return () => globalThis.removeEventListener?.("bevy-wasm-ready", markReady);
  }, []);

  const handleClick = () => {
    globalThis.bevyWasmLog?.();
  };

  const handleFlip = () => {
    globalThis.flipPlayerSpriteY?.();
  };

  return (
    <div class="flex flex-col items-center gap-2 my-4">
      {!logReady && <p class="text-sm text-gray-600">Loading wasm module...</p>}
      <Button onClick={handleClick} disabled={!logReady}>Log from Bevy</Button>
      <Button onClick={handleFlip} disabled={!logReady}>Flip Player Y</Button>
    </div>
  );
}
