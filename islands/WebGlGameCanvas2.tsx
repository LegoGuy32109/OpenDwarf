/// <reference lib="dom" />

import { useEffect, useRef, useState } from "preact/hooks";
import { bootWebGl2Renderer } from "./webgl2/gpu-init.ts";
import { startWebGl2RenderLoop } from "./webgl2/render-loop.ts";

export default function WebGlGameCanvas2() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const boot = bootWebGl2Renderer(canvas);
    if (!boot) {
      setError("WebGL2 is required to play");
      return;
    }

    const stop = startWebGl2RenderLoop(boot, setError);
    return () => stop();
  }, []);

  return (
    <div
      ref={hostRef}
      class="webgl-experiment-shell relative shadow-2xl shadow-black"
    >
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
      <canvas ref={canvasRef} class="webgl-experiment-canvas" />
      {error
        ? (
          <div class="absolute inset-0 flex items-center justify-center px-6 text-center text-sm uppercase tracking-[0.18em] text-white/80 bg-black/60">
            {error}
          </div>
        )
        : null}
    </div>
  );
}
