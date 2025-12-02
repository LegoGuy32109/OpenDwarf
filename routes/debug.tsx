import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import GameCanvas from "../islands/GameCanvas.tsx";

export default define.page(function Debug() {
  return (
    <div class="px-4 mx-auto fresh-gradient min-h-screen">
      <Head>
        <title>Open Dwarf Debug</title>
      </Head>
      <div class="max-w-screen-md mx-auto flex flex-col items-center justify-center">
        <h1 class="text-4xl font-bold">
          Loading Open Dwarf (Debug)...
        </h1>
      </div>
      <GameCanvas gameDir="/game_debug/" wasmFile="open_dwarf_lib_bg.wasm" />
    </div>
  );
});
