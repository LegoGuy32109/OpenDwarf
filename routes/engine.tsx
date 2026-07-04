import { Head } from "fresh/runtime";
import EngineCanvas from "../islands/EngineCanvas.tsx";

export default function EngineRoute() {
  return (
    <div class="px-4 mx-auto fresh-gradient bg-[#1B1C1F] min-h-screen flex flex-col">
      <Head>
        <title>Open Dwarf Engine</title>
      </Head>
      <div class="flex-1">
        <div class="max-w-7xl mx-auto w-full">
          <EngineCanvas />
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

