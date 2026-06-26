/// <reference lib="dom" />

export const UI_RECT_STRIDE_FLOATS = 8;

export function writeUiRectInstance(
  scratch: Float32Array,
  index: number,
  x: number,
  y: number,
  w: number,
  h: number,
  tint: [number, number, number],
  alpha: number,
) {
  const off = index * UI_RECT_STRIDE_FLOATS;
  scratch[off + 0] = x;
  scratch[off + 1] = y;
  scratch[off + 2] = w;
  scratch[off + 3] = h;
  scratch[off + 4] = tint[0];
  scratch[off + 5] = tint[1];
  scratch[off + 6] = tint[2];
  scratch[off + 7] = alpha;
}
