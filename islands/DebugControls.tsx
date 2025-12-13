import { useEffect, useState } from "preact/hooks";
import { Button } from "../components/Button.tsx";
import { WebrtcManager } from "../domain/webrtc.ts";

const webrtc = new WebrtcManager();

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

  const handleHost = async () => {
    const result = await webrtc.makeOfferingPeers(10);
    if (result.ok) {
      console.log("offers made");
      return;
    }
    console.error(result.errors);
  };

  const handleGuest = async () => {
    const offerResult = webrtc.getOfferPayload();
    if (!offerResult.ok) {
      console.error(offerResult.errors);
      return;
    }
    const result = await webrtc.makeGuestAnswers(offerResult.payload);
    if (result.ok) {
      console.log("answers made");
      return;
    }
    console.error(result.errors);
  };

  return (
    <div class="flex flex-col items-center gap-2 my-4">
      {!logReady && <p class="text-sm text-gray-600">Loading wasm module...</p>}
      <Button onClick={handleClick} disabled={!logReady}>Log from Bevy</Button>
      <Button onClick={handleFlip} disabled={!logReady}>Flip Player Y</Button>
      <div class="flex">
        <Button onClick={handleHost}>Generate Connections</Button>
        <Button onClick={handleGuest}>Generate Answer Connections</Button>
      </div>
    </div>
  );
}
