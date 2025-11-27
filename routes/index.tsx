import { useSignal } from "@preact/signals";
import Counter from "../islands/Counter.tsx";
// import init from "../lib/bevy_wasm.js";
// init();

export default function Home() {
  const count = useSignal(3);
  return (
    <div class="px-4 py-8 mx-auto bg-[#86efac]">
      <div class="max-w-screen-md mx-auto flex flex-col items-center justify-center">
        <p class="my-4">Delving into...</p>
        <h1 class="text-4xl font-bold">⛏️ Open Dwarf ⛏️</h1>
        <Counter count={count} />
        <canvas id="game-canvas" tabindex={0} width="1280" height="720" />
      </div>
    </div>
  );
}
