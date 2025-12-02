export default function Counter() {
  return (
    <>
      <script
        type="module"
        // I need a script module to initiate the bevy game
        // deno-lint-ignore react-no-danger
        dangerouslySetInnerHTML={{
          __html: `
import init, { main } from "./game/open_dwarf_lib.js";
init("./game/opt_open_dwarf_lib.wasm.br").then( () => {
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
