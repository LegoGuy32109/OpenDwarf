type GameCanvasProps = {
  gameDir?: string;
  wasmFile?: string;
};

export default function GameCanvas(
  { gameDir = "/game/", wasmFile = "" }: GameCanvasProps,
) {
  const gameJs = `${gameDir}open_dwarf_lib.js`;
  const gameWasm = `${gameDir}${wasmFile}`;

  return (
    <>
      <style>
        {`
          #game-canvas {
            width: 100%;
            max-width: 960px;
            aspect-ratio: 16 / 9;
            background: #0f0f10;
            border-radius: 0.5rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.35);
          }
          #game-canvas:fullscreen {
            width: 100vw;
            height: 100vh;
            max-width: none;
            border-radius: 0;
          }
          #game-canvas.full-window {
            width: 100vw;
            height: 100vh;
            max-width: none;
            border-radius: 0;
          }
        `}
      </style>
      <script
        type="module"
        // I need a script module to initiate the bevy game
        // deno-lint-ignore react-no-danger
        dangerouslySetInnerHTML={{
          __html: `
import init, { main, send_game_bytes } from "${gameJs}";

const OP_FLIP_PLAYER_SPRITE = 1;
const OP_LOG_DEBUG = 2;

function sendLogMessage(text) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const buffer = new Uint8Array(1 + 2 + bytes.length);
  buffer[0] = OP_LOG_DEBUG;
  buffer[1] = bytes.length & 0xff;
  buffer[2] = (bytes.length >> 8) & 0xff;
  buffer.set(bytes, 3);
  send_game_bytes(buffer);
}

function sendFlipMessage() {
  const buffer = new Uint8Array([OP_FLIP_PLAYER_SPRITE]);
  send_game_bytes(buffer);
}

async function startGame() {
  await init("${gameWasm}");
  main();
  // expose functions so debug controls can call into Bevy
  globalThis.bevyWasmLog = sendLogMessage;
  globalThis.flipPlayerSpriteY = () => sendFlipMessage();
  if (typeof globalThis.dispatchEvent === "function") {
    globalThis.dispatchEvent(new Event("bevy-wasm-ready"));
  }
}

startGame().catch((error) =>
  console.error("Failed to start Bevy game", error)
);
`,
        }}
      >
      </script>
      <div class="flex justify-center">
        <canvas id="game-canvas" />
      </div>
    </>
  );
}
