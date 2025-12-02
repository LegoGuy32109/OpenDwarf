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
import init, { main } from "${gameJs}";
init("${gameWasm}").then( () => {
    main();
});
`,
        }}
      >
      </script>
      <canvas id="game-canvas" />
    </>
  );
}
