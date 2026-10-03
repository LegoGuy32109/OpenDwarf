// @ts-check

import { CHUNK_CELLS, parseChunkKey, STONE } from "./terrain.js";

/** @typedef {import('./terrain.js').ChunkData} ChunkData */

/** Chunks a state packet may carry; the packet cap bounds the real size. */
export const MAX_WIRE_CHUNKS = 1024;

/**
 * Run-length encode one chunk as base64 pairs of material and run length minus one.
 * Uniform and mostly uniform chunks stay small.
 * @param {ChunkData} data
 */
export function encodeChunk(data) {
  /** @type {number[]} */
  const bytes = [];
  let run = 0;
  for (let i = 1; i <= data.length; i++) {
    if (i < data.length && data[i] === data[i - 1] && i - run < 256) continue;
    bytes.push(data[i - 1], i - run - 1);
    run = i;
  }
  return btoa(String.fromCharCode(...bytes));
}

/** Return the chunk data, or null for a malformed or wrong-sized string. */
/** @param {unknown} value @returns {ChunkData|null} */
export function decodeChunk(value) {
  if (typeof value !== "string" || value.length > CHUNK_CELLS * 3) return null;
  let raw;
  try {
    raw = atob(value);
  } catch {
    return null;
  }
  if (raw.length % 2) return null;
  const data = new Uint8Array(CHUNK_CELLS);
  let cell = 0;
  for (let i = 0; i < raw.length; i += 2) {
    const material = raw.charCodeAt(i);
    const length = raw.charCodeAt(i + 1) + 1;
    if (material > STONE || cell + length > CHUNK_CELLS) return null;
    data.fill(material, cell, cell + length);
    cell += length;
  }
  return cell === CHUNK_CELLS ? data : null;
}

/** @param {Map<string,ChunkData>} chunks @returns {Record<string,string>} */
export function encodeChunks(chunks) {
  /** @type {Record<string,string>} */
  const encoded = {};
  for (const [key, data] of chunks) encoded[key] = encodeChunk(data);
  return encoded;
}

/** Validate a whole chunk record, or return null without partial results. */
/** @param {unknown} value @returns {Map<string,ChunkData>|null} */
export function decodeChunks(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_WIRE_CHUNKS) return null;
  const chunks = new Map();
  for (const [key, encoded] of entries) {
    if (!parseChunkKey(key)) return null;
    const data = decodeChunk(encoded);
    if (!data) return null;
    chunks.set(key, data);
  }
  return chunks;
}
