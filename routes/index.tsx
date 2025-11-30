import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import GameCanvas from "../islands/GameCanvas.tsx";

export default define.page(function Home() {
  return (
    <div class="px-4 mx-auto fresh-gradient min-h-screen">
      <Head>
        <title>Open Dwarf</title>
      </Head>
      <div class="max-w-screen-md mx-auto flex flex-col items-center justify-center">
        <p class="my-4 flex items-center">
          Served using Deno Fresh
          <img
            class="mx-2"
            src="/logo.svg"
            width="28"
            height="28"
            alt="the Fresh logo: a sliced lemon dripping with juice"
          />
        </p>
        <h1 class="text-4xl font-bold">
          Loading Open Dwarf...
        </h1>
      </div>
      <GameCanvas />
    </div>
  );
});
