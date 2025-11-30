export default function Counter() {
  return (
    <>
      <script
        type="module"
        // I need a script module to initiate the bevy game
        // deno-lint-ignore react-no-danger
        dangerouslySetInnerHTML={{
          __html: `
import init, { main } from "./game/bevy_wasm.js";
init("./game/opt_bevy_wasm.wasm.br").then( () => {
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
