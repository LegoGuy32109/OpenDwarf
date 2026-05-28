/// <reference lib="dom" />

const VGA_BITMAP_SRC = "/assets/ui/JoshPerfectDosVga.png";
const VGA_FIRST_CHAR = 33;
const VGA_LAST_CHAR = 126;
const VGA_COLS = 32;
const VGA_CELL_WIDTH = 8;
const VGA_CELL_HEIGHT = 16;

export type VgaFontAtlas = {
  texture: WebGLTexture;
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  lineHeight: number;
  advance: number;
};

export type VgaTextMetrics = {
  width: number;
  height: number;
  lines: number;
};

type VgaTextUniforms = {
  tintLoc: WebGLUniformLocation | null;
  alphaMultiplierLoc: WebGLUniformLocation | null;
  renderModeLoc: WebGLUniformLocation | null;
};

type VgaTextBatch = VgaTextUniforms & {
  gl: WebGL2RenderingContext;
  fontAtlas: VgaFontAtlas;
  scratch: Float32Array;
  maxInstances: number;
  flushPass: (count: number) => void;
};

function createBitmapTexture(
  gl: WebGL2RenderingContext,
  image: HTMLImageElement,
) {
  const tex = gl.createTexture();
  if (!tex) throw new Error("Failed to create VGA bitmap font texture");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function snap(value: number) {
  return Math.round(value);
}

export async function createVgaFontAtlas(
  gl: WebGL2RenderingContext,
): Promise<VgaFontAtlas> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${VGA_BITMAP_SRC}`));
    img.src = VGA_BITMAP_SRC;
  });

  if (image.naturalWidth !== VGA_COLS * VGA_CELL_WIDTH) {
    throw new Error(
      `${VGA_BITMAP_SRC} must be ${
        VGA_COLS * VGA_CELL_WIDTH
      }px wide, got ${image.naturalWidth}px`,
    );
  }
  if (image.naturalHeight < VGA_CELL_HEIGHT * 3) {
    throw new Error(
      `${VGA_BITMAP_SRC} must have at least 3 rows of ${VGA_CELL_HEIGHT}px cells`,
    );
  }

  return {
    texture: createBitmapTexture(gl, image),
    width: image.naturalWidth,
    height: image.naturalHeight,
    cellWidth: VGA_CELL_WIDTH,
    cellHeight: VGA_CELL_HEIGHT,
    lineHeight: VGA_CELL_HEIGHT,
    advance: VGA_CELL_WIDTH,
  };
}

export function drawVgaTextLines(
  batch: VgaTextBatch,
  text: string,
  x: number,
  y: number,
  rgb: [number, number, number],
  alpha = 1,
  scale = 1,
) {
  const {
    gl,
    fontAtlas,
    scratch,
    maxInstances,
    flushPass,
    tintLoc,
    alphaMultiplierLoc,
    renderModeLoc,
  } = batch;

  const integerScale = Math.max(1, Math.round(scale));
  const advance = fontAtlas.advance * integerScale;
  const cellWidth = fontAtlas.cellWidth * integerScale;
  const cellHeight = fontAtlas.cellHeight * integerScale;
  const lineHeight = fontAtlas.lineHeight * integerScale;

  gl.bindTexture(gl.TEXTURE_2D, fontAtlas.texture);
  if (tintLoc) gl.uniform3f(tintLoc, rgb[0], rgb[1], rgb[2]);
  if (alphaMultiplierLoc) gl.uniform1f(alphaMultiplierLoc, alpha);
  if (renderModeLoc) gl.uniform1i(renderModeLoc, 3);

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
    const off = count * 8;
    scratch[off + 0] = snap(x + cursorX);
    scratch[off + 1] = snap(y + cursorY);
    scratch[off + 2] = cellWidth;
    scratch[off + 3] = cellHeight;
    scratch[off + 4] = srcX / fontAtlas.width;
    scratch[off + 5] = srcY / fontAtlas.height;
    scratch[off + 6] = fontAtlas.cellWidth / fontAtlas.width;
    scratch[off + 7] = fontAtlas.cellHeight / fontAtlas.height;
    count++;
    cursorX += advance;
  }

  flushPass(count);
}

export function vgaTextLineHeight(
  fontAtlas: VgaFontAtlas,
  scale = 1,
) {
  return fontAtlas.lineHeight * Math.max(1, Math.round(scale));
}

export function vgaTextWidth(
  fontAtlas: VgaFontAtlas,
  text: string,
  scale = 1,
): number {
  return vgaTextMetrics(fontAtlas, text, scale).width;
}

export function vgaTextMetrics(
  fontAtlas: VgaFontAtlas,
  text: string,
  scale = 1,
): VgaTextMetrics {
  const integerScale = Math.max(1, Math.round(scale));
  const advance = fontAtlas.advance * integerScale;
  const lineHeight = fontAtlas.lineHeight * integerScale;
  let width = 0;
  let lineWidth = 0;
  let lines = 1;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      width = Math.max(width, lineWidth);
      lineWidth = 0;
      lines++;
      continue;
    }
    if (code === 32 || (code >= VGA_FIRST_CHAR && code <= VGA_LAST_CHAR)) {
      lineWidth += advance;
    }
  }

  return {
    width: Math.max(width, lineWidth),
    height: lines * lineHeight,
    lines,
  };
}

export const VGA_FONT_SRC = VGA_BITMAP_SRC;
