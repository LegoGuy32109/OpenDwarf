import { Head } from "$fresh/runtime.ts";
import { PageProps } from "$fresh/server.ts";
import GameCanvas from "../islands/GameCanvas.tsx";
import FullscreenButton from "../islands/FullscreenButton.tsx";
import MultiplayerSidebar from "../islands/MultiplayerSidebar.tsx";

export default function Home({ url }: PageProps) {
  const params = new URLSearchParams(url.searchParams);
  const isDebug = params.has("debug");
  const isPerf = params.has("perf");
  const gameDir = isPerf ? "/game_perf/" : isDebug ? "/game_debug/" : "/game/";
  const wasmFile = isDebug ? "open_dwarf_lib_bg.wasm" : "";
  const titleMode = isPerf ? "Perf" : isDebug ? "Debug" : "";

  return (
    <div class="px-4 mx-auto fresh-gradient bg-[#1B1C1F] min-h-screen flex flex-col">
      <Head>
        <title>Open Dwarf {titleMode}</title>
      </Head>
      <div class="flex-1">
        <div class="max-w-3xl mx-auto flex flex-col items-center justify-center relative">
          <h1 class="text-4xl font-extrabold uppercase tracking-[0.12em] my-4 text-[#D4B27A] drop-shadow-[0_3px_0_rgba(0,0,0,0.4)] [text-shadow:0_0_12px_rgba(120,78,32,0.35)]">
            Open Dwarf {isPerf
              ? <span class="text-[#B8D18A]">(Perf)</span>
              : isDebug
              ? <span class="text-[#DA7027]">(Debug)</span>
              : (
                ""
              )}
          </h1>
        </div>
        <GameCanvas gameDir={gameDir} wasmFile={wasmFile} />
        <div class="flex flex-wrap justify-center items-center gap-6 pt-3">
          <FullscreenButton />
          <MultiplayerSidebar />
        </div>
      </div>
      <footer class="flex justify-center items-center py-4">
        <p class="flex items-center text-yellow-400 text-sm">
          Served using Deno Fresh
          <img
            src="/logo.svg"
            class="pl-1"
            width="22"
            height="22"
            alt="the Fresh logo: a sliced lemon dripping with juice"
          />
        </p>
      </footer>
    </div>
  );
}
