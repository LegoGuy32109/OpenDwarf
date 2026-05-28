import { Head } from "fresh/runtime";
import { PageProps } from "fresh";
import GameCanvas from "../islands/GameCanvas.tsx";
import FullscreenButton from "../islands/FullscreenButton.tsx";
import MultiplayerSidebar from "../islands/MultiplayerSidebar.tsx";

export default function Home({ url }: PageProps) {
  const params = new URLSearchParams(url.searchParams);
  const isDebug = params.has("debug");

  return (
    <div class="px-4 mx-auto fresh-gradient bg-[#1B1C1F] min-h-screen flex flex-col">
      <Head>
        <title>Open Dwarf {isDebug ? "Debug" : ""}</title>
      </Head>
      <div class="flex-1">
        <div class="max-w-3xl mx-auto flex flex-col items-center justify-center relative">
          <h1 class="text-4xl font-extrabold uppercase tracking-[0.12em] my-4 text-[#D4B27A] drop-shadow-[0_3px_0_rgba(0,0,0,0.4)] [text-shadow:0_0_12px_rgba(120,78,32,0.35)]">
            Open Dwarf{" "}
            {isDebug ? <span class="text-[#DA7027]">(Debug)</span> : ""}
          </h1>
        </div>
        <GameCanvas
          gameDir={isDebug ? "/game_debug/" : undefined}
          wasmFile={isDebug ? "open_dwarf_lib_bg.wasm" : undefined}
        />
        <div class="flex flex-wrap justify-center items-center gap-6 pt-3">
          <FullscreenButton />
          <a
            href="/webgl"
            class="inline-flex items-center gap-2 bg-white/5 px-3 py-1 text-sm font-medium uppercase tracking-[0.18em] text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            WebGL Experiment
          </a>
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
