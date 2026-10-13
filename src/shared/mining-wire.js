// @ts-check
// Host to guest: the mining actions a guest can see. Each decoder returns null for anything malformed.

import { finite, identifier, MAX_COORD, record } from "./wire-parse.js";
import { WORLD_TOP } from "./terrain.js";

/** Most mining entries one message may carry. */
const MAX_MINING_ENTRIES = 256;

/**
 * Host to guest: the mining actions the guest can see, replacing the earlier
 * list. Returns null for anything malformed.
 * @param {unknown} value @returns {import('./mining.js').MiningEntry[]|null}
 */
export function decodeMining(value) {
  if (
    !record(value) || value.type !== "mining" ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_MINING_ENTRIES
  ) return null;
  /** @type {import('./mining.js').MiningEntry[]} */
  const entries = [];
  for (const entry of value.entries) {
    if (
      !record(entry) || !identifier(entry.id) ||
      !finite(entry.x, -MAX_COORD, MAX_COORD) || !Number.isInteger(entry.x) ||
      !finite(entry.y, -MAX_COORD, MAX_COORD) || !Number.isInteger(entry.y) ||
      !finite(entry.z, 0, WORLD_TOP) || !Number.isInteger(entry.z) ||
      !finite(entry.elapsedMs, 0, 60_000) ||
      !finite(entry.totalMs, 1, 60_000)
    ) return null;
    entries.push({
      id: entry.id,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      elapsedMs: entry.elapsedMs,
      totalMs: entry.totalMs,
    });
  }
  return entries;
}
