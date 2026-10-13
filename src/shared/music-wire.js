// @ts-check
// Host to guest: the music cue and its heartbeat. Each decoder returns null for anything malformed.

import { counter, record } from "./wire-parse.js";

/**
 * A music cue: the track the world host started and the tick it started on
 * (ADR 0009).
 * @typedef {{key:string,hash:string,startTick:number,atTick?:number,position?:number}} MusicCue
 */

/** One segment of a media key, as the shell's `/media/` route accepts it. */
const MEDIA_SEGMENT = /^[A-Za-z0-9 ._()~-]+$/;

/** @param {unknown} value @returns {value is string} */
function mediaKey(value) {
  return typeof value === "string" && value.length >= 1 &&
    value.length <= 512 &&
    value.split("/").every((part) =>
      MEDIA_SEGMENT.test(part) && !part.startsWith(".")
    );
}

/** The longest track position a cue may carry, in seconds. */
const MAX_MUSIC_POSITION = 24 * 60 * 60;

/**
 * Host to guest: the current music cue. Returns null for anything malformed:
 * a key that is not a media key, a hash that is not 12 hex digits, or a start
 * tick that is not a bounded whole number. A heartbeat adds `atTick` and
 * `position`, the seconds the host's track was at on that tick; both or
 * neither, or the cue is malformed.
 * @param {unknown} value @returns {MusicCue|null}
 */
export function decodeMusicCue(value) {
  if (
    !record(value) || value.type !== "music" || !mediaKey(value.key) ||
    typeof value.hash !== "string" || !/^[0-9a-f]{12}$/.test(value.hash) ||
    !counter(value.startTick)
  ) return null;
  /** @type {MusicCue} */
  const cue = { key: value.key, hash: value.hash, startTick: value.startTick };
  if (value.atTick === undefined && value.position === undefined) return cue;
  const position = value.position;
  if (
    !counter(value.atTick) || typeof position !== "number" ||
    !Number.isFinite(position) || position < 0 ||
    position > MAX_MUSIC_POSITION
  ) return null;
  return { ...cue, atTick: value.atTick, position };
}
