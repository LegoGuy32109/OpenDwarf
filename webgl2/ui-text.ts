/// <reference lib="dom" />

import type { ProgramHandle } from "./gpu-types.ts";
import {
  bindTextureToUnit,
  createTextureSlot,
  TEXTURE_UNITS,
} from "./texture-units.ts";

const VGA_FONT_SRC = "/assets/ui/JoshPerfectDosVga.png";
const VGA_FIRST_CHAR = 33;
const VGA_LAST_CHAR = 126;
const VGA_COLS = 32;
const VGA_CELL_WIDTH = 8;
const VGA_CELL_HEIGHT = 16;

export type UiFontAtlas = {
  texture: WebGLTexture;
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  lineHeight: number;
  advance: number;
};

type UiTextBatch = {
  gl: WebGL2RenderingContext;
  program: ProgramHandle;
  fontAtlas: UiFontAtlas;
  scratch: Float32Array;
  maxInstances: number;
  flushPass: (count: number) => void;
  canvasSize: { width: number; height: number };
  simTick: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load image: ${src}`));
    image.src = src;
  });
}

function snap(value: number) {
  return Math.round(value);
}

export async function loadUiFontAtlas(
  gl: WebGL2RenderingContext,
  texture = createTextureSlot(gl, TEXTURE_UNITS.font),
): Promise<UiFontAtlas> {
  const image = await loadImage(VGA_FONT_SRC);
  if (image.naturalWidth !== VGA_COLS * VGA_CELL_WIDTH) {
    throw new Error(
      `${VGA_FONT_SRC} must be ${
        VGA_COLS * VGA_CELL_WIDTH
      }px wide, got ${image.naturalWidth}px`,
    );
  }
  if (image.naturalHeight < VGA_CELL_HEIGHT * 3) {
    throw new Error(
      `${VGA_FONT_SRC} must have at least 3 rows of ${VGA_CELL_HEIGHT}px cells`,
    );
  }
  bindTextureToUnit(gl, TEXTURE_UNITS.font, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return {
    texture,
    width: image.naturalWidth,
    height: image.naturalHeight,
    cellWidth: VGA_CELL_WIDTH,
    cellHeight: VGA_CELL_HEIGHT,
    lineHeight: VGA_CELL_HEIGHT,
    advance: VGA_CELL_WIDTH,
  };
}

export function uiTextLineHeight(
  fontAtlas: UiFontAtlas,
  scale = 1,
) {
  return fontAtlas.lineHeight * Math.max(1, Math.round(scale));
}

export function uiTextWidth(
  fontAtlas: UiFontAtlas,
  text: string,
  scale = 1,
): number {
  const integerScale = Math.max(1, Math.round(scale));
  const advance = fontAtlas.advance * integerScale;
  let width = 0;
  let lineWidth = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      width = Math.max(width, lineWidth);
      lineWidth = 0;
      continue;
    }
    if (code === 32 || (code >= VGA_FIRST_CHAR && code <= VGA_LAST_CHAR)) {
      lineWidth += advance;
    }
  }

  return Math.max(width, lineWidth);
}

export function drawUiTextLines(
  batch: UiTextBatch,
  text: string,
  x: number,
  y: number,
  rgb: [number, number, number],
  alpha = 1,
  scale = 1,
) {
  const {
    gl,
    program,
    fontAtlas,
    scratch,
    maxInstances,
    flushPass,
    canvasSize,
    simTick,
  } = batch;

  const integerScale = Math.max(1, Math.round(scale));
  const advance = fontAtlas.advance * integerScale;
  const cellWidth = fontAtlas.cellWidth * integerScale;
  const cellHeight = fontAtlas.cellHeight * integerScale;
  const lineHeight = fontAtlas.lineHeight * integerScale;

  gl.bindVertexArray(program.vao);
  gl.useProgram(program.handle);
  program.setGlobals(
    { x: 0, y: 0, zoom: 1 },
    1,
    canvasSize,
    simTick,
  );

  let count = 0;
  let cursorX = 0;
  let cursorY = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      cursorX = 0;
      cursorY += lineHeight;
      continue;
    }
    if (code === 32) {
      cursorX += advance;
      continue;
    }
    if (code < VGA_FIRST_CHAR || code > VGA_LAST_CHAR) {
      continue;
    }

    if (count >= maxInstances) {
      flushPass(count);
      count = 0;
    }

    const glyph = code - VGA_FIRST_CHAR;
    const gx = glyph % VGA_COLS;
    const gy = Math.floor(glyph / VGA_COLS);
    const srcX = gx * fontAtlas.cellWidth;
    const srcY = gy * fontAtlas.cellHeight;
    const off = count * 12;
    scratch[off + 0] = snap(x + cursorX);
    scratch[off + 1] = snap(y + cursorY);
    scratch[off + 2] = cellWidth;
    scratch[off + 3] = cellHeight;
    scratch[off + 4] = srcX / fontAtlas.width;
    scratch[off + 5] = srcY / fontAtlas.height;
    scratch[off + 6] = fontAtlas.cellWidth / fontAtlas.width;
    scratch[off + 7] = fontAtlas.cellHeight / fontAtlas.height;
    scratch[off + 8] = rgb[0];
    scratch[off + 9] = rgb[1];
    scratch[off + 10] = rgb[2];
    scratch[off + 11] = alpha;
    count++;
    cursorX += advance;
  }

  flushPass(count);
}

export { VGA_FONT_SRC };
