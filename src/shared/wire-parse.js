// @ts-check
// The checks every wire decoder shares: records, bounded numbers, counters,
// identifiers and tiles.

import { WORLD_TOP } from "./terrain.js";

/** Tile coordinates are bounded, not tied to a world size; terrain is chunked. */
export const MAX_COORD = 1 << 24;
const MAX_TICK = Number.MAX_SAFE_INTEGER;

/** @param {unknown} value @returns {value is Record<string,unknown>} */
export function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @param {number} min @param {number} max @returns {value is number} */
export function finite(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min &&
    value <= max;
}

/** @param {unknown} value @param {number} [max] @returns {value is number} */
export function counter(value, max = MAX_TICK) {
  return finite(value, 0, max) && Number.isSafeInteger(value);
}

/** @param {unknown} value @param {number} [limit] @returns {value is string} */
export function identifier(value, limit = 128) {
  return typeof value === "string" && value.length > 0 &&
    value.length <= limit &&
    ![...value].some((char) => char.charCodeAt(0) < 32) &&
    value !== "__proto__" && value !== "constructor" && value !== "prototype";
}

/** @param {unknown} value */
export function tile(value) {
  return record(value) && finite(value.x, -MAX_COORD, MAX_COORD) &&
    finite(value.y, -MAX_COORD, MAX_COORD) &&
    finite(value.z, -1, WORLD_TOP + 1);
}
