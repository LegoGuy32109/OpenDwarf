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
      <canvas id="game-canvas" />
    </>
  );
}
