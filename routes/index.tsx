import { Head } from "$fresh/runtime.ts";
import { PageProps } from "$fresh/server.ts";
import GameCanvas from "../islands/GameCanvas.tsx";
import FullscreenButton from "../islands/FullscreenButton.tsx";
import MultiplayerSidebar from "../islands/MultiplayerSidebar.tsx";

export default function Home({ url }: PageProps) {
  const params = new URLSearchParams(url.searchParams);
  const isDebug = params.has("debug");

  return (
    <div class="px-4 mx-auto fresh-gradient bg-[#2B2C2F] min-h-screen">
      <Head>
        <title>Open Dwarf {isDebug ? "Debug" : ""}</title>
      </Head>
      <div class="max-w-3xl mx-auto flex flex-col items-center justify-center relative">
        <p class="my-1 flex items-center text-yellow-400">
          Served using Deno Fresh
          <img
            src="/logo.svg"
            class="pl-1"
            width="22"
            height="22"
            alt="the Fresh logo: a sliced lemon dripping with juice"
          />
        </p>
        <h1 class="text-4xl font-bold my-4 text-[#7C584F]">
          Open Dwarf{" "}
          {isDebug ? <span class="text-[#DA7027]">(Debug)</span> : ""}
        </h1>
        <div class="absolute top-2 right-4">
          <MultiplayerSidebar />
        </div>
        <div class="absolute top-2 left-4">
          <FullscreenButton />
        </div>
      </div>
      <GameCanvas
        gameDir={isDebug ? "/game_debug/" : undefined}
        wasmFile={isDebug ? "open_dwarf_lib_bg.wasm" : undefined}
      />
    </div>
  );
}
