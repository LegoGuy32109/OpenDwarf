import { Head } from "fresh/runtime";
import WebGlGameCanvas from "../islands/WebGlGameCanvas.tsx";
import WebGlFullscreenButton from "../islands/WebGlFullscreenButton.tsx";

export default function WebGlRoute() {
  return (
    <div class="px-4 mx-auto fresh-gradient bg-[#1B1C1F] min-h-screen flex flex-col">
      <Head>
        <title>Open Dwarf WebGL</title>
      </Head>
      <div class="flex-1">
        <div class="max-w-3xl mx-auto flex flex-col items-center justify-center relative">
          <h1 class="text-4xl font-extrabold uppercase tracking-[0.12em] my-4 text-[#D4B27A] drop-shadow-[0_3px_0_rgba(0,0,0,0.4)] [text-shadow:0_0_12px_rgba(120,78,32,0.35)]">
            Open Dwarf <span class="text-[#DA7027]">WebGL</span>
          </h1>
        </div>
        <div class="max-w-7xl mx-auto">
          <WebGlGameCanvas />
        </div>
        <div class="flex flex-wrap justify-center items-center gap-6 pt-3">
          <WebGlFullscreenButton />
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
