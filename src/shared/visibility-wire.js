// @ts-check

import { WORLD_EDGE, WORLD_TOP } from "./world.js";
import { tileKey } from "./visibility.js";

/** @typedef {import('./visibility.js').Visibility} Visibility */
/** @typedef {{encoding:"bitset-v1",edge:number,visible:string,memory:string,sample:string}} WireVisibility */

const HEIGHT = WORLD_TOP + 3;

/** @param {number} x @param {number} y @param {number} z @param {number} edge */
function bitIndex(x, y, z, edge) {
  if (
    !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) ||
    x < -1 || x > edge || y < -1 || y > edge ||
    z < -1 || z > WORLD_TOP + 1
  ) throw new RangeError("visibility tile is outside the encoded view");
  const WIDTH = edge + 2;
  return ((z + 1) * WIDTH + y + 1) * WIDTH + x + 1;
}

/** @param {Set<string>} tiles @param {number} edge */
function encodeTiles(tiles, edge) {
  const bits = new Uint8Array(Math.ceil((edge + 2) ** 2 * HEIGHT / 8));
  for (const key of tiles) {
    const [x, y, z] = key.split(",").map(Number);
    const index = bitIndex(x, y, z, edge);
    bits[index >> 3] |= 1 << (index & 7);
  }
  return btoa(String.fromCharCode(...bits));
}

/** @param {string} encoded @param {number} edge */
function decodeTiles(encoded, edge) {
  const width = edge + 2;
  const cellCount = width * width * HEIGHT;
  const raw = atob(encoded);
  if (raw.length !== Math.ceil(cellCount / 8)) {
    throw new Error("invalid visibility mask");
  }
  const tiles = new Set();
  for (let index = 0; index < cellCount; index++) {
    if (!(raw.charCodeAt(index >> 3) & (1 << (index & 7)))) continue;
    const x = index % width - 1;
    const y = Math.floor(index / width) % width - 1;
    const z = Math.floor(index / (width * width)) - 1;
    tiles.add(tileKey(x, y, z));
  }
  return tiles;
}

/** @param {Visibility} visibility @param {number} [edge] @returns {WireVisibility} */
export function packVisibility(visibility, edge = WORLD_EDGE) {
  return {
    encoding: "bitset-v1",
    edge,
    visible: encodeTiles(visibility.visible, edge),
    memory: encodeTiles(visibility.memory, edge),
    sample: visibility.sample,
  };
}

/** @param {WireVisibility} packed @returns {Visibility} */
export function unpackVisibility(packed) {
  if (
    packed.encoding !== "bitset-v1" ||
    (packed.edge !== 16 && packed.edge !== 32)
  ) {
    throw new Error("unsupported visibility encoding");
  }
  return {
    visible: decodeTiles(packed.visible, packed.edge),
    memory: decodeTiles(packed.memory, packed.edge),
    sample: packed.sample,
  };
}
