// @ts-check

export const ARROW_ROLES = /** @type {const} */ ([
  "outline",
  "shadow",
  "body",
  "highlight",
]);
export const ARROW_MASK_LEVELS = [0, 85, 170, 255];
/** @typedef {{width:number,height:number,data:Uint8ClampedArray}} ArrowPixels */
/** @typedef {[number,number,number,number]} Rgba */

/** Four named hex colors, with optional alpha. @param {unknown} value @returns {Rgba[]} */
export function parseArrowPalette(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("An arrow palette must contain four named hex colors");
  }
  const colors = /** @type {Record<string,unknown>} */ (value);
  return ARROW_ROLES.map((role) => {
    const color = colors[role];
    if (
      typeof color !== "string" || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(color)
    ) {
      throw new TypeError(`Invalid arrow palette color: ${role}`);
    }
    return /** @type {Rgba} */ ([
      parseInt(color.slice(1, 3), 16),
      parseInt(color.slice(3, 5), 16),
      parseInt(color.slice(5, 7), 16),
      color.length === 9 ? parseInt(color.slice(7, 9), 16) : 255,
    ]);
  });
}

/** @param {ArrowPixels} pixels */
function validatePixels(pixels) {
  if (
    !Number.isSafeInteger(pixels.width) || pixels.width < 1 ||
    !Number.isSafeInteger(pixels.height) || pixels.height < 1 ||
    pixels.data.length !== pixels.width * pixels.height * 4
  ) throw new RangeError("Invalid arrow pixel dimensions");
}

/** Decode grayscale role IDs without changing the mask or its coverage. */
/** @param {ArrowPixels} mask @param {unknown} palette @returns {ArrowPixels} */
export function recolorArrowMask(mask, palette) {
  validatePixels(mask);
  const colors = parseArrowPalette(palette);
  const data = new Uint8ClampedArray(mask.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const coverage = mask.data[i + 3];
    if (!coverage) continue;
    const level = mask.data[i];
    const role = ARROW_MASK_LEVELS.indexOf(level);
    if (role < 0 || mask.data[i + 1] !== level || mask.data[i + 2] !== level) {
      throw new RangeError(`Invalid arrow mask shade at pixel ${i / 4}`);
    }
    const color = colors[role];
    data.set(color.slice(0, 3), i);
    data[i + 3] = Math.round(coverage * color[3] / 255);
  }
  return { width: mask.width, height: mask.height, data };
}

/** Encode approved source colors as grayscale IDs. Unknown colors fail export. */
/** @param {ArrowPixels} pixels @param {unknown} palette @returns {ArrowPixels} */
export function encodeArrowMask(pixels, palette) {
  validatePixels(pixels);
  const colors = parseArrowPalette(palette);
  const keys = colors.map((color) => color.slice(0, 3).join(","));
  if (new Set(keys).size !== keys.length) {
    throw new TypeError("The source palette needs four distinct RGB colors");
  }
  const data = new Uint8ClampedArray(pixels.data.length);
  for (let i = 0; i < data.length; i += 4) {
    if (!pixels.data[i + 3]) continue;
    const role = keys.indexOf(pixels.data.slice(i, i + 3).join(","));
    if (role < 0) throw new RangeError(`Unmapped arrow source pixel ${i / 4}`);
    data.fill(ARROW_MASK_LEVELS[role], i, i + 3);
    data[i + 3] = pixels.data[i + 3];
  }
  return { width: pixels.width, height: pixels.height, data };
}
