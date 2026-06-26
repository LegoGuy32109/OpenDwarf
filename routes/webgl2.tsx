import { Head } from "fresh/runtime";

export default function WebGl2Route() {
  const webgl2ClientUrl = `/@fs${Deno.cwd()}/static/webgl2-entry.js`;

  return (
    <div class="px-4 mx-auto fresh-gradient bg-[#1B1C1F] min-h-screen flex flex-col">
      <Head>
        <title>Open Dwarf WebGL2</title>
      </Head>
      <div class="flex-1 py-4">
        <div class="max-w-3xl mx-auto flex flex-col items-center justify-center relative">
          <h1 class="text-4xl font-extrabold uppercase tracking-[0.12em] my-4 text-[#D4B27A] drop-shadow-[0_3px_0_rgba(0,0,0,0.4)] [text-shadow:0_0_12px_rgba(120,78,32,0.35)]">
            Open Dwarf <span class="text-[#DA7027]">WebGL2</span>
          </h1>
        </div>
        <div class="max-w-7xl mx-auto">
          <div class="webgl-experiment-shell relative shadow-2xl shadow-black">
            <style>
              {`
                .webgl-experiment-shell:fullscreen {
                  width: 100vw;
                  height: 100vh;
                  border-radius: 0;
                }

                .webgl-experiment-shell:fullscreen .webgl-experiment-canvas {
                  width: 100vw;
                  height: 100vh;
                  border-radius: 0;
                }

                .webgl-experiment-canvas {
                  display: block;
                  width: 100%;
                  height: 74vh;
                  outline: none;
                }
              `}
            </style>
            <canvas
              id="webgl2-canvas"
              class="webgl-experiment-canvas"
            />
            <div
              id="webgl2-error"
              class="absolute inset-0 hidden items-center justify-center px-6 text-center text-sm uppercase tracking-[0.18em] text-white/80 bg-black/60"
            />
          </div>
        </div>
        <div class="flex flex-wrap justify-center items-center gap-6 pt-3">
          <button
            id="webgl2-fullscreen"
            type="button"
            class="inline-flex items-center gap-2 bg-white/5 px-3 py-1 text-sm font-medium uppercase tracking-[0.18em] text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            F11 for Fullscreen
          </button>
        </div>
      </div>
      <script type="module" src={webgl2ClientUrl} />
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
