/// <reference lib="dom" />

export type CanvasDisplaySize = {
  dpr: number;
  width: number;
  height: number;
};

export function measureCanvasDisplaySize(
  canvas: HTMLCanvasElement,
): CanvasDisplaySize {
  const dpr = globalThis.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  return { dpr, width, height };
}

export function syncCanvasSize(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
) {
  const size = measureCanvasDisplaySize(canvas);
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  return size;
}

export function applyCanvasDisplaySize(canvas: HTMLCanvasElement) {
  const size = measureCanvasDisplaySize(canvas);
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
  }
  return size;
}
