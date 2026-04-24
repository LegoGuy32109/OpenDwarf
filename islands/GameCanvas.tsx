type GameCanvasProps = {
  gameDir?: string;
  wasmFile?: string;
};

export default function GameCanvas(
  { gameDir = "/game/", wasmFile = "" }: GameCanvasProps,
) {
  const gameJs = `${gameDir}open_dwarf_lib.js`;
  const gameWasm = wasmFile
    ? `${gameDir}${wasmFile}`
    : gameDir.replace(/\/$/, "");

  return (
    <>
      <style>
        {`
          #game-canvas {
            width: 90vw !important;
            height: 75vh !important;
            min-width: 0 !important;
            min-height: 0 !important;
            border-radius: 0.5rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.45);
          }
          #game-canvas:focus {
            outline: 2px solid rgba(183, 149, 96, 0.7);
            outline-offset: 2px;
          }
          #game-canvas.is-fullscreen {
            width: 100vw !important;
            height: 100vh !important;
            min-width: 0 !important;
            min-height: 0 !important;
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
import init, { main } from "${gameJs}";

async function startGame() {
  await init("${gameWasm}");
  main();
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
