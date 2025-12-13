import { Head } from "$fresh/runtime.ts";
import DebugControls from "../islands/DebugControls.tsx";
import GameCanvas from "../islands/GameCanvas.tsx";

export default function Debug() {
  return (
    <div class="px-4 mx-auto fresh-gradient bg-[#2B2C2F] min-h-screen">
      <Head>
        <title>Open Dwarf Debug</title>
      </Head>
      <div class="max-w-3xl mx-auto flex flex-col items-center justify-center">
        <h1 class="text-4xl font-bold my-4 text-[#7C584F]">
          Open Dwarf <span class="text-[#DA7027]">(Debug)</span>
        </h1>
      </div>
      <GameCanvas gameDir="/game_debug/" wasmFile="open_dwarf_lib_bg.wasm" />
      <DebugControls />
    </div>
  );
}
