// @ts-check
// Host to guest: the sound events a guest hears. Each decoder returns null for anything malformed.

import {
  counter,
  finite,
  identifier,
  MAX_COORD,
  record,
} from "./wire-parse.js";
import { WORLD_TOP } from "./terrain.js";
import { MAX_SOUND_ENTRIES, MAX_SOUND_TAGS } from "./sound.js";

/**
 * Host to guest: the sound events the guest hears this tick (ADR 0008).
 * Returns null for anything malformed.
 * @param {unknown} value @returns {import('./sound.js').HeardSound[]|null}
 */
export function decodeSounds(value) {
  if (
    !record(value) || value.type !== "sounds" || !Array.isArray(value.list) ||
    value.list.length > MAX_SOUND_ENTRIES
  ) return null;
  /** @type {import('./sound.js').HeardSound[]} */
  const list = [];
  for (const entry of value.list) {
    if (
      !record(entry) || !Array.isArray(entry.tags) || !entry.tags.length ||
      entry.tags.length > MAX_SOUND_TAGS ||
      !entry.tags.every((tag) => identifier(tag, 32)) ||
      !finite(entry.x, -MAX_COORD, MAX_COORD) ||
      !finite(entry.y, -MAX_COORD, MAX_COORD) ||
      !finite(entry.z, 0, WORLD_TOP) || !counter(entry.tick) ||
      typeof entry.seen !== "boolean"
    ) return null;
    list.push({
      tags: /** @type {string[]} */ (entry.tags),
      x: entry.x,
      y: entry.y,
      z: entry.z,
      tick: entry.tick,
      seen: entry.seen,
    });
  }
  return list;
}
