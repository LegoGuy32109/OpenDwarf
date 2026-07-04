import { useEffect } from "preact/hooks";

export default function EngineCanvas() {
  useEffect(() => {
    void import("../engine-entry.ts");
  }, []);

  return (
    <div class="engine-experiment-shell relative w-full overflow-visible">
      <style>
        {`
          .engine-experiment-shell:fullscreen {
            width: 100vw;
            height: 100vh;
            border-radius: 0;
          }

          .engine-experiment-shell:fullscreen .engine-experiment-canvas {
            width: 100vw;
            height: 100vh;
            border-radius: 0;
          }

          .engine-experiment-canvas {
            display: block;
            width: 100%;
            max-width: 100%;
            height: min(75vh, 56rem);
            margin: 0 auto;
            border-radius: 0;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
            outline: none;
          }

          .engine-experiment-canvas:focus {
            outline: none;
            box-shadow:
              0 0 0 2px rgba(183, 149, 96, 0.7),
              0 10px 30px rgba(0, 0, 0, 0.45);
          }
        `}
      </style>
      <canvas id="engine-canvas" class="engine-experiment-canvas" />
      <div
        id="engine-error"
        class="absolute inset-0 hidden items-center justify-center px-6 text-center text-sm uppercase tracking-[0.18em] text-white/80 bg-black/60"
      />
      <div class="flex flex-wrap justify-center items-center gap-6 pt-3">
        <button
          id="engine-fullscreen"
          type="button"
          class="inline-flex items-center gap-2 bg-white/5 px-3 py-1 text-sm font-medium uppercase tracking-[0.18em] text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          F11 for Fullscreen
        </button>
      </div>
    </div>
  );
}

