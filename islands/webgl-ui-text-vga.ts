const VGA_MSDF_IMAGE_SRC = "/assets/ui/AcPlus_IBM_VGA_9x16.msdf.png";
const VGA_MSDF_JSON_SRC = "/assets/ui/AcPlus_IBM_VGA_9x16.msdf.json";
const VGA_FONT_BASE_PX = 16;

export type MsdfAtlasJson = {
  atlas: {
    type: string;
    width: number;
    height: number;
    size: number;
    distanceRange?: number;
    pxRange?: number;
    yOrigin?: "bottom" | "top";
  };
  metrics: {
    lineHeight: number;
    ascender: number;
    descender: number;
  };
  glyphs: Array<{
    unicode: number;
    advance: number;
    planeBounds?: {
      left: number;
      bottom: number;
      right: number;
      top: number;
    };
    atlasBounds?: {
      left: number;
      bottom: number;
      right: number;
      top: number;
    };
  }>;
  kerning?: Array<{
    unicode1: number;
    unicode2: number;
    advance: number;
  }>;
};

export type VgaFontAtlas = {
  texture: WebGLTexture;
  width: number;
  height: number;
  size: number;
  distanceRange: number;
  lineHeight: number;
  ascender: number;
  descender: number;
  glyphMap: Map<number, MsdfAtlasJson["glyphs"][number]>;
  kerningMap: Map<string, number>;
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
  msdfPxRangeLoc: WebGLUniformLocation | null;
};

type VgaTextBatch = VgaTextUniforms & {
  gl: WebGL2RenderingContext;
  fontAtlas: VgaFontAtlas;
  scratch: Float32Array;
  maxInstances: number;
  flushPass: (count: number) => void;
};

function createMsdfTexture(
  gl: WebGL2RenderingContext,
  image: HTMLImageElement,
) {
  const tex = gl.createTexture();
  if (!tex) throw new Error("Failed to create MSDF font texture");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function fontScale(fontAtlas: VgaFontAtlas, scale: number) {
  return VGA_FONT_BASE_PX * Math.max(0.25, scale);
}

function kerningKey(left: number, right: number) {
  return `${left}:${right}`;
}

function getGlyph(fontAtlas: VgaFontAtlas, codePoint: number) {
  return fontAtlas.glyphMap.get(codePoint) ?? fontAtlas.glyphMap.get(0x003F);
}

export async function createVgaFontAtlas(
  gl: WebGL2RenderingContext,
): Promise<VgaFontAtlas> {
  const [atlasJson, atlasImage] = await Promise.all([
    fetch(VGA_MSDF_JSON_SRC).then((res) => {
      if (!res.ok) {
        throw new Error(
          `Failed to load ${VGA_MSDF_JSON_SRC}: ${res.status}`,
        );
      }
      return res.json() as Promise<MsdfAtlasJson>;
    }),
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error(`Failed to load ${VGA_MSDF_IMAGE_SRC}`));
      img.src = VGA_MSDF_IMAGE_SRC;
    }),
  ]);

  const glyphMap = new Map<number, MsdfAtlasJson["glyphs"][number]>();
  for (const glyph of atlasJson.glyphs) {
    glyphMap.set(glyph.unicode, glyph);
  }

  const kerningMap = new Map<string, number>();
  for (const pair of atlasJson.kerning ?? []) {
    kerningMap.set(kerningKey(pair.unicode1, pair.unicode2), pair.advance);
  }

  return {
    texture: createMsdfTexture(gl, atlasImage),
    width: atlasJson.atlas.width,
    height: atlasJson.atlas.height,
    size: atlasJson.atlas.size,
    distanceRange: atlasJson.atlas.distanceRange ?? atlasJson.atlas.pxRange ??
      4,
    lineHeight: atlasJson.metrics.lineHeight,
    ascender: atlasJson.metrics.ascender,
    descender: atlasJson.metrics.descender,
    glyphMap,
    kerningMap,
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
    msdfPxRangeLoc,
  } = batch;

  gl.bindTexture(gl.TEXTURE_2D, fontAtlas.texture);
  if (tintLoc) gl.uniform3f(tintLoc, rgb[0], rgb[1], rgb[2]);
  if (alphaMultiplierLoc) gl.uniform1f(alphaMultiplierLoc, alpha);
  if (renderModeLoc) gl.uniform1i(renderModeLoc, 4);
  if (msdfPxRangeLoc) {
    gl.uniform1f(msdfPxRangeLoc, fontAtlas.distanceRange);
  }

  let count = 0;
  let cursorX = 0;
  let cursorY = 0;
  let previousCodePoint: number | null = null;
  const pxScale = fontScale(fontAtlas, scale);
  const lineHeight = fontAtlas.lineHeight * pxScale;
  const baselineY = fontAtlas.ascender * pxScale;

  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i) ?? 0;
    i += cp > 0xffff ? 2 : 1;

    if (cp === 10) {
      cursorX = 0;
      cursorY += lineHeight;
      previousCodePoint = null;
      continue;
    }

    const glyph = getGlyph(fontAtlas, cp);
    if (!glyph) continue;

    if (previousCodePoint !== null) {
      cursorX +=
        (fontAtlas.kerningMap.get(kerningKey(previousCodePoint, cp)) ?? 0) *
        pxScale;
    }

    if (glyph.atlasBounds && glyph.planeBounds) {
      if (count >= maxInstances) {
        flushPass(count);
        count = 0;
      }

      const atlasLeft = glyph.atlasBounds.left;
      const atlasBottom = glyph.atlasBounds.bottom;
      const atlasRight = glyph.atlasBounds.right;
      const atlasTop = glyph.atlasBounds.top;
      const planeLeft = glyph.planeBounds.left;
      const planeBottom = glyph.planeBounds.bottom;
      const planeRight = glyph.planeBounds.right;
      const planeTop = glyph.planeBounds.top;
      const quadX = x + cursorX + planeLeft * pxScale;
      const quadY = y + cursorY + baselineY - planeTop * pxScale;
      const quadW = (planeRight - planeLeft) * pxScale;
      const quadH = (planeTop - planeBottom) * pxScale;
      const off = count * 8;
      scratch[off + 0] = quadX;
      scratch[off + 1] = quadY;
      scratch[off + 2] = quadW;
      scratch[off + 3] = quadH;
      scratch[off + 4] = atlasLeft / fontAtlas.width;
      scratch[off + 5] = 1 - atlasTop / fontAtlas.height;
      scratch[off + 6] = (atlasRight - atlasLeft) / fontAtlas.width;
      scratch[off + 7] = (atlasTop - atlasBottom) / fontAtlas.height;
      count++;
    }

    cursorX += glyph.advance * pxScale;
    previousCodePoint = cp;
  }

  flushPass(count);
}

export function vgaTextLineHeight(
  fontAtlas: VgaFontAtlas,
  scale = 1,
) {
  return fontAtlas.lineHeight * fontScale(fontAtlas, scale);
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
  const pxScale = fontScale(fontAtlas, scale);
  const lineHeight = vgaTextLineHeight(fontAtlas, scale);
  let width = 0;
  let lineWidth = 0;
  let lines = 1;
  let previousCodePoint: number | null = null;

  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i) ?? 0;
    i += cp > 0xffff ? 2 : 1;

    if (cp === 10) {
      width = Math.max(width, lineWidth);
      lineWidth = 0;
      lines++;
      previousCodePoint = null;
      continue;
    }

    const glyph = getGlyph(fontAtlas, cp);
    if (!glyph) continue;

    if (previousCodePoint !== null) {
      lineWidth +=
        (fontAtlas.kerningMap.get(kerningKey(previousCodePoint, cp)) ?? 0) *
        pxScale;
    }
    lineWidth += glyph.advance * pxScale;
    previousCodePoint = cp;
  }

  return {
    width: Math.max(width, lineWidth),
    height: lines * lineHeight,
    lines,
  };
}

export const VGA_FONT_SRC = VGA_MSDF_JSON_SRC;
