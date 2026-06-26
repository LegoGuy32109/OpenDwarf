/// <reference lib="dom" />

const TRANSPARENT_PIXEL = new Uint8Array([0, 0, 0, 0]);
const WHITE_PIXEL = new Uint8Array([255, 255, 255, 255]);

export const TEXTURE_UNITS = {
  floor: 0,
  edgeShadow: 1,
  ceilShadow: 2,
  sprite: 3,
  font: 4,
  white: 5,
} as const;

export function bindTextureToUnit(
  gl: WebGL2RenderingContext,
  unit: number,
  texture: WebGLTexture,
) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
}

function createTextureWithPixel(
  gl: WebGL2RenderingContext,
  unit: number,
  pixel: Uint8Array,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error("[webgl2] failed to create texture");
  }
  bindTextureToUnit(gl, unit, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixel,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image: ${src}`));
    img.src = src;
  });
}

export function createTextureSlot(
  gl: WebGL2RenderingContext,
  unit: number,
): WebGLTexture {
  return createTextureWithPixel(gl, unit, TRANSPARENT_PIXEL);
}

export function uploadWhiteTo(
  gl: WebGL2RenderingContext,
  unit: number,
): WebGLTexture {
  return createTextureWithPixel(gl, unit, WHITE_PIXEL);
}

export async function loadAtlasInto(
  gl: WebGL2RenderingContext,
  unit: number,
  src: string,
  texture = createTextureSlot(gl, unit),
): Promise<{ texture: WebGLTexture; width: number; height: number }> {
  const image = await loadImage(src);
  bindTextureToUnit(gl, unit, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { texture, width: image.naturalWidth, height: image.naturalHeight };
}
