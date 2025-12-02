type GameCanvasProps = {
  gameDir?: string;
  wasmFile?: string;
};

export default function GameCanvas(
  { gameDir = "/game/", wasmFile = "opt_open_dwarf_lib.wasm.br" }:
    GameCanvasProps,
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
import init, { flip_player_sprite_y, log_debug_message, main } from "${gameJs}";

async function startGame() {
  await init("${gameWasm}");
  main();
  // expose functions so debug controls can call into Bevy
  globalThis.bevyWasmLog = log_debug_message;
  globalThis.flipPlayerSpriteY = flip_player_sprite_y;
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
