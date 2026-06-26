import type { WebGl2Boot } from "./gpu-init.ts";

const BACKGROUND_COLOR: [number, number, number, number] = [
  0.106,
  0.109,
  0.122,
  1,
];

function syncCanvasSize(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
  const dpr = globalThis.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  gl.viewport(0, 0, canvas.width, canvas.height);
}

export function startWebGl2RenderLoop(boot: WebGl2Boot): () => void {
  const { gl, canvas } = boot;
  let rafId = 0;
  let stopped = false;

  const frame = () => {
    if (stopped) {
      return;
    }

    syncCanvasSize(gl, canvas);
    gl.clearColor(
      BACKGROUND_COLOR[0],
      BACKGROUND_COLOR[1],
      BACKGROUND_COLOR[2],
      BACKGROUND_COLOR[3],
    );
    gl.clear(gl.COLOR_BUFFER_BIT);

    rafId = globalThis.requestAnimationFrame(frame);
  };

  frame();

  return () => {
    stopped = true;
    globalThis.cancelAnimationFrame(rafId);
  };
}
