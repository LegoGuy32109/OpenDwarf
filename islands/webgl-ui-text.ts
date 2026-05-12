const UI_FONT_SRC_PATH = "/assets/ui/TinyPixie2.ttf";
const UI_FONT_FAMILY = "TinyPixie2WebGl";
const UI_FONT_FIRST_CHAR = 32;
const UI_FONT_LAST_CHAR = 126;
const UI_FONT_COLS = 16;
const UI_FONT_RENDER_PX = 24;
const UI_FONT_PADDING = 2;
const UI_FONT_SCALE = 1;
const UI_FONT_LINE_GAP = 2;

export type UiFontAtlas = {
  texture: WebGLTexture;
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  lineHeight: number;
  advance: number;
  ascent: number;
  descent: number;
  advances: Float32Array;
};

type UiTextUniforms = {
  tintLoc: WebGLUniformLocation | null;
  alphaMultiplierLoc: WebGLUniformLocation | null;
  renderModeLoc: WebGLUniformLocation | null;
};

type UiTextBatch = UiTextUniforms & {
  gl: WebGL2RenderingContext;
  fontAtlas: UiFontAtlas;
  scratch: Float32Array;
  maxInstances: number;
  flushPass: (count: number) => void;
};

function createAtlasTexture(gl: WebGL2RenderingContext) {
  const tex = gl.createTexture();
  if (!tex) throw new Error("Failed to create texture");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export async function createUiFontAtlas(
  gl: WebGL2RenderingContext,
): Promise<UiFontAtlas> {
  const fontFace = new FontFace(UI_FONT_FAMILY, `url(${UI_FONT_SRC_PATH})`);
  await fontFace.load();
  (document.fonts as FontFaceSet & { add(font: FontFace): void }).add(
    fontFace,
  );

  const glyphCount = UI_FONT_LAST_CHAR - UI_FONT_FIRST_CHAR + 1;
  const fontCanvas = document.createElement("canvas");
  const fontCtx = fontCanvas.getContext("2d");
  if (!fontCtx) throw new Error("Failed to create UI font probe canvas");
  fontCtx.font = `${UI_FONT_RENDER_PX}px ${UI_FONT_FAMILY}`;
  fontCtx.textBaseline = "alphabetic";
  fontCtx.textAlign = "left";

  let maxAdvance = 0;
  let maxAscent = 0;
  let maxDescent = 0;
  const advances = new Float32Array(glyphCount);
  for (let code = UI_FONT_FIRST_CHAR; code <= UI_FONT_LAST_CHAR; code++) {
    const glyphIndex = code - UI_FONT_FIRST_CHAR;
    const ch = String.fromCharCode(code);
    const metrics = fontCtx.measureText(ch);
    const advance = Math.ceil(metrics.width);
    advances[glyphIndex] = advance;
    maxAdvance = Math.max(maxAdvance, advance);
    maxAscent = Math.max(
      maxAscent,
      Math.ceil(metrics.actualBoundingBoxAscent || UI_FONT_RENDER_PX),
    );
    maxDescent = Math.max(
      maxDescent,
      Math.ceil(metrics.actualBoundingBoxDescent || UI_FONT_RENDER_PX * 0.25),
    );
  }

  const glyphWidth = maxAdvance;
  const glyphHeight = maxAscent + maxDescent;
  const cellWidth = glyphWidth + UI_FONT_PADDING * 2;
  const cellHeight = glyphHeight + UI_FONT_PADDING * 2;
  const rows = Math.ceil(glyphCount / UI_FONT_COLS);
  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = UI_FONT_COLS * cellWidth;
  atlasCanvas.height = rows * cellHeight;
  const ctx = atlasCanvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create UI font atlas canvas");
  ctx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = `${UI_FONT_RENDER_PX}px ${UI_FONT_FAMILY}`;

  for (let code = UI_FONT_FIRST_CHAR; code <= UI_FONT_LAST_CHAR; code++) {
    const glyphIndex = code - UI_FONT_FIRST_CHAR;
    const x = (glyphIndex % UI_FONT_COLS) * cellWidth;
    const y = Math.floor(glyphIndex / UI_FONT_COLS) * cellHeight;
    const ch = String.fromCharCode(code);
    const metrics = ctx.measureText(ch);
    const drawLeft = metrics.actualBoundingBoxLeft || 0;
    const ascent = Math.ceil(metrics.actualBoundingBoxAscent || maxAscent);
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      x + UI_FONT_PADDING,
      y + UI_FONT_PADDING,
      glyphWidth,
      glyphHeight,
    );
    ctx.clip();
    ctx.fillText(
      ch,
      x + UI_FONT_PADDING - drawLeft,
      y + UI_FONT_PADDING + ascent,
    );
    ctx.restore();
  }

  const atlasPixels = ctx.getImageData(
    0,
    0,
    atlasCanvas.width,
    atlasCanvas.height,
  );
  for (let i = 0; i < atlasPixels.data.length; i += 4) {
    const alpha = atlasPixels.data[i + 3] > 32 ? 255 : 0;
    atlasPixels.data[i + 0] = 255;
    atlasPixels.data[i + 1] = 255;
    atlasPixels.data[i + 2] = 255;
    atlasPixels.data[i + 3] = alpha;
  }
  ctx.putImageData(atlasPixels, 0, 0);

  const tex = createAtlasTexture(gl);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    atlasCanvas,
  );
  return {
    texture: tex,
    width: atlasCanvas.width,
    height: atlasCanvas.height,
    cellWidth,
    cellHeight,
    lineHeight: cellHeight + UI_FONT_LINE_GAP,
    advance: maxAdvance,
    ascent: maxAscent,
    descent: maxDescent,
    advances,
  };
}

export function drawUiTextLines(
  batch: UiTextBatch,
  text: string,
  x: number,
  y: number,
  rgb: [number, number, number],
  alpha = 1,
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

  gl.bindTexture(gl.TEXTURE_2D, fontAtlas.texture);
  if (tintLoc) gl.uniform3f(tintLoc, rgb[0], rgb[1], rgb[2]);
  if (alphaMultiplierLoc) gl.uniform1f(alphaMultiplierLoc, alpha);
  if (renderModeLoc) gl.uniform1i(renderModeLoc, 3);

  let count = 0;
  let cursorX = 0;
  const yOffset =
    (fontAtlas.lineHeight - fontAtlas.cellHeight + fontAtlas.descent) *
    UI_FONT_SCALE;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < UI_FONT_FIRST_CHAR || code > UI_FONT_LAST_CHAR) {
      continue;
    }
    if (count >= maxInstances) {
      flushPass(count);
      count = 0;
    }
    const glyph = code - UI_FONT_FIRST_CHAR;
    const gx = glyph % UI_FONT_COLS;
    const gy = Math.floor(glyph / UI_FONT_COLS);
    const u0 = gx * fontAtlas.cellWidth + UI_FONT_PADDING + 0.5;
    const v0 = gy * fontAtlas.cellHeight + UI_FONT_PADDING + 0.5;
    const advance = fontAtlas.advance * UI_FONT_SCALE;
    const off = count * 8;
    scratch[off + 0] = x + cursorX;
    scratch[off + 1] = y + yOffset;
    scratch[off + 2] = advance;
    scratch[off + 3] = fontAtlas.cellHeight * UI_FONT_SCALE;
    scratch[off + 4] = u0 / fontAtlas.width;
    scratch[off + 5] = v0 / fontAtlas.height;
    scratch[off + 6] = (fontAtlas.cellWidth - UI_FONT_PADDING * 2 - 1) /
      fontAtlas.width;
    scratch[off + 7] = (fontAtlas.cellHeight - UI_FONT_PADDING * 2 - 1) /
      fontAtlas.height;
    count++;
    cursorX += advance;
  }
  flushPass(count);
}

export function uiTextLineHeight(fontAtlas: UiFontAtlas) {
  return fontAtlas.lineHeight * UI_FONT_SCALE;
}

export const UI_FONT_SRC = UI_FONT_SRC_PATH;
