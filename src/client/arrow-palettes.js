// @ts-check
import {
  ARROW_ROLES,
  parseArrowPalette,
  recolorArrowMask,
} from "../shared/arrow-palette.js";

/** @typedef {import('../shared/arrow-palette.js').ArrowPixels} ArrowPixels */
/** @typedef {{cardinal:ArrowPixels,diagonal:ArrowPixels}} ArrowSet */

/** Read a CORS-enabled PNG once. Its grayscale bytes are palette-role IDs. @param {string} url @returns {Promise<ArrowPixels>} */
async function loadMask(url) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error(`Cannot load arrow mask ${url}`));
    image.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Arrow masks require a 2D canvas");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** @param {string} url @returns {Promise<unknown>} */
async function loadPalette(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load arrow palette ${url}`);
  return response.json();
}

/**
 * Decode two masks once, then cache recolored pixel buffers by color values.
 * A palette is either four named colors or a URL containing that JSON object.
 * Returned buffers are shared cache entries. Upload them once and do not edit.
 * @param {{readMask?:(url:string)=>Promise<ArrowPixels>,readPalette?:(url:string)=>Promise<unknown>,maskUrls?:[string,string],maxPalettes?:number}} [options]
 */
export function createArrowPaletteLoader(options = {}) {
  const readMask = options.readMask ?? loadMask;
  const readPalette = options.readPalette ?? loadPalette;
  const urls = options.maskUrls ?? [
    "assets/ui/arrow-cardinal-mask.png",
    "assets/ui/arrow-diagonal-mask.png",
  ];
  const limit = options.maxPalettes ?? 64;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("Arrow palette cache size must be a positive integer");
  }
  /** @type {Promise<ArrowPixels[]>|undefined} */
  let masks;
  /** @type {Map<string,Promise<ArrowSet>>} */
  const cache = new Map();
  /** @type {Map<string,Promise<unknown>>} */
  const paletteFiles = new Map();
  /** @param {string} url */
  function paletteFile(url) {
    let result = paletteFiles.get(url);
    if (!result) {
      result = Promise.resolve().then(() => readPalette(url));
      paletteFiles.set(url, result);
      result.catch(() => {
        if (paletteFiles.get(url) === result) paletteFiles.delete(url);
      });
      while (paletteFiles.size > limit) {
        paletteFiles.delete(
          /** @type {string} */ (paletteFiles.keys().next().value),
        );
      }
    }
    return result;
  }
  return {
    /** @param {unknown} palette @returns {Promise<ArrowSet>} */
    async load(palette) {
      const value = typeof palette === "string"
        ? await paletteFile(palette)
        : palette;
      const colors = parseArrowPalette(value);
      const key = JSON.stringify(colors);
      const snapshot = Object.fromEntries(ARROW_ROLES.map((role, i) => [
        role,
        "#" + colors[i].map((c) => c.toString(16).padStart(2, "0")).join(""),
      ]));
      const existing = cache.get(key);
      if (existing) {
        cache.delete(key);
        cache.set(key, existing);
        return existing;
      }
      if (!masks) {
        const pending = Promise.all(urls.map((url) => readMask(url)));
        masks = pending;
        pending.catch(() => {
          if (masks === pending) masks = undefined;
        });
      }
      const result = masks.then(([cardinal, diagonal]) => ({
        cardinal: recolorArrowMask(cardinal, snapshot),
        diagonal: recolorArrowMask(diagonal, snapshot),
      }));
      cache.set(key, result);
      result.catch(() => {
        if (cache.get(key) === result) cache.delete(key);
      });
      while (cache.size > limit) {
        cache.delete(/** @type {string} */ (cache.keys().next().value));
      }
      return result;
    },
    clear() {
      cache.clear();
      paletteFiles.clear();
    },
  };
}

/** Convert cached pixels to an uploadable canvas. Call once per palette, outside the frame loop. @param {ArrowPixels} pixels */
export function arrowCanvas(pixels) {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Arrow colors require a 2D canvas");
  context.putImageData(
    new ImageData(
      new Uint8ClampedArray(pixels.data),
      pixels.width,
      pixels.height,
    ),
    0,
    0,
  );
  return canvas;
}

/** Eight pixel-exact octants, E through NE, from the north and NE masters.
 * Quarter-turns preserve the authored pixel grid. Build once before GL upload.
 * @param {ArrowSet} arrows
 */
export function arrowAtlas(arrows) {
  const canvas = document.createElement("canvas");
  const side = arrows.cardinal.width;
  if (
    arrows.cardinal.height !== side || arrows.diagonal.width !== side ||
    arrows.diagonal.height !== side
  ) {
    throw new Error("Arrow masters must be equally sized squares");
  }
  canvas.width = side;
  canvas.height = side * 8;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Arrow atlas requires a 2D canvas");
  context.imageSmoothingEnabled = false;
  const sources = [arrowCanvas(arrows.cardinal), arrowCanvas(arrows.diagonal)];
  for (let octant = 0; octant < 8; octant++) {
    context.save();
    context.translate(side / 2, octant * side + side / 2);
    context.rotate(((Math.floor(octant / 2) + 1) % 4) * Math.PI / 2);
    context.drawImage(sources[octant % 2], -side / 2, -side / 2);
    context.restore();
  }
  return canvas;
}
