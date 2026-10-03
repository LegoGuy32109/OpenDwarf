// @ts-check

import { parseTileKey, tileKey } from "./visibility.js";
import {
  CHUNK_EDGE,
  chunkCoord,
  chunkKey,
  localCoord,
  parseChunkKey,
  WORLD_TOP,
} from "./terrain.js";
import { MAX_WIRE_CHUNKS } from "./chunk-wire.js";

/** @typedef {import('./visibility.js').Visibility} Visibility */
/** @typedef {{encoding:"bitset-v2",visible:Record<string,string>,memory:Record<string,string>,sample:string}} WireVisibility */

/** Levels -1 through the top level plus one, so the floor and ceiling shells fit. */
const HEIGHT = WORLD_TOP + 3;
const BITS = CHUNK_EDGE * CHUNK_EDGE * HEIGHT;
const BYTES = BITS / 8;

/** @param {number} localX @param {number} localY @param {number} z */
function bitIndex(localX, localY, z) {
  return ((z + 1) * CHUNK_EDGE + localY) * CHUNK_EDGE + localX;
}

/** One bit mask per chunk that holds at least one tile. */
/** @param {Set<string>} tiles @returns {Record<string,string>} */
function encodeTiles(tiles) {
  /** @type {Map<string,Uint8Array>} */
  const masks = new Map();
  let lastCx = NaN;
  let lastCy = NaN;
  /** @type {Uint8Array|undefined} */
  let bits;
  for (const key of tiles) {
    const [x, y, z] = parseTileKey(key);
    if (
      !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) ||
      z < -1 || z > WORLD_TOP + 1
    ) throw new RangeError("visibility tile is outside the encoded view");
    const cx = chunkCoord(x);
    const cy = chunkCoord(y);
    if (cx !== lastCx || cy !== lastCy) {
      lastCx = cx;
      lastCy = cy;
      const chunk = chunkKey(cx, cy);
      bits = masks.get(chunk);
      if (!bits) masks.set(chunk, bits = new Uint8Array(BYTES));
    }
    const index = bitIndex(localCoord(x), localCoord(y), z);
    /** @type {Uint8Array} */ (bits)[index >> 3] |= 1 << (index & 7);
  }
  /** @type {Record<string,string>} */
  const encoded = {};
  for (const [chunk, bits] of masks) {
    encoded[chunk] = btoa(String.fromCharCode(...bits));
  }
  return encoded;
}

/** @param {unknown} encoded @returns {Set<string>} */
function decodeTiles(encoded) {
  if (
    encoded === null || typeof encoded !== "object" || Array.isArray(encoded) ||
    Object.keys(encoded).length > MAX_WIRE_CHUNKS
  ) throw new Error("invalid visibility mask");
  const tiles = new Set();
  for (const [key, value] of Object.entries(encoded)) {
    const chunk = parseChunkKey(key);
    if (!chunk || typeof value !== "string") {
      throw new Error("invalid visibility mask");
    }
    const raw = atob(value);
    if (raw.length !== BYTES) throw new Error("invalid visibility mask");
    for (let index = 0; index < BITS; index++) {
      if (!(raw.charCodeAt(index >> 3) & (1 << (index & 7)))) continue;
      const localX = index % CHUNK_EDGE;
      const localY = Math.floor(index / CHUNK_EDGE) % CHUNK_EDGE;
      const z = Math.floor(index / (CHUNK_EDGE * CHUNK_EDGE)) - 1;
      tiles.add(
        tileKey(
          chunk.cx * CHUNK_EDGE + localX,
          chunk.cy * CHUNK_EDGE + localY,
          z,
        ),
      );
    }
  }
  return tiles;
}

/** @param {Visibility} visibility @returns {WireVisibility} */
export function packVisibility(visibility) {
  return {
    encoding: "bitset-v2",
    visible: encodeTiles(visibility.visible),
    memory: encodeTiles(visibility.memory),
    sample: visibility.sample,
  };
}

/** @param {WireVisibility} packed @returns {Visibility} */
export function unpackVisibility(packed) {
  if (packed.encoding !== "bitset-v2") {
    throw new Error("unsupported visibility encoding");
  }
  return {
    visible: decodeTiles(packed.visible),
    memory: decodeTiles(packed.memory),
    sample: packed.sample,
  };
}
