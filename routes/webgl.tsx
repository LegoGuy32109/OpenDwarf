import { Head } from "$fresh/runtime.ts";
import WebGlGameCanvas from "../islands/WebGlGameCanvas.tsx";

export default function WebGlRoute() {
  return (
    <div class="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,196,96,0.16),transparent_30%),linear-gradient(180deg,#10131a_0%,#0a0c10_100%)] px-4 py-6 text-zinc-100">
      <Head>
        <title>Open Dwarf WebGL</title>
      </Head>
      <div class="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <header class="flex flex-col gap-2 rounded-3xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-xs uppercase tracking-[0.28em] text-amber-200/70">
                Experiment Route
              </p>
              <h1 class="mt-1 text-3xl font-black uppercase tracking-[0.12em] text-amber-100">
                Open Dwarf WebGL
              </h1>
            </div>
            <a
              href="/"
              class="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              Back Home
            </a>
          </div>
          <p class="max-w-3xl text-sm leading-6 text-white/70">
            Step 1: render the single-rock smoke test, capture deterministic
            checkpoints, and keep replay/frame-dump artifacts readable before
            any wasm or world-simulation work is added.
          </p>
        </header>
        <WebGlGameCanvas />
      </div>
    </div>
  );
}
