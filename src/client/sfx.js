// @ts-check
// Sound effects from tagged samples in the bucket (ADR 0008). The contract
// commit leaves the player silent; the effects player ticket fills it in.

/** @typedef {{key:string,hash:string,tags:string[],note?:string}} Sample */
/** @typedef {"off"|"25"|"50"|"75"|"100"} EffectsLevel */
/**
 * Where and how a sound plays. Without a position it plays at full distance
 * gain, as your own sounds and UI sounds do.
 * @typedef {{x?:number,y?:number,z?:number,muffled?:boolean,at?:number}} PlayOptions
 * `at` is a local `performance.now()` time to start; omitted means now.
 */

export const EFFECTS_LEVELS = /** @type {EffectsLevel[]} */ ([
  "off",
  "25",
  "50",
  "75",
  "100",
]);
export const EFFECTS_KEY = "open-dwarf-effects";
export const SFX_INDEX_KEY = "index/sfx.v1.json";
/** Random playbackRate range for steps, and for every other sound. */
export const STEP_RATE = /** @type {[number,number]} */ ([0.85, 1.15]);
export const SOUND_RATE = /** @type {[number,number]} */ ([0.9, 1.1]);
/** Random gain scale for every play. */
export const SOUND_GAIN = /** @type {[number,number]} */ ([0.8, 1.0]);
/** Full gain to this many tiles, silent at `SOUND_RANGE` (shared/sound.js). */
export const FULL_GAIN_TILES = 2;
export const MUFFLE_HZ = 600;
export const MUFFLE_GAIN = 0.6;
export const MAX_SOUNDS = 16;
/** An event later than this after its presentation time is dropped. */
export const LATE_MS = 500;

/** @param {unknown} value @returns {EffectsLevel} */
export function parseEffectsLevel(value) {
  return EFFECTS_LEVELS.includes(/** @type {EffectsLevel} */ (value))
    ? /** @type {EffectsLevel} */ (value)
    : "75";
}

/**
 * The samples in an index; an entry without a key, a hash and tags is ignored.
 * @param {unknown} _json @returns {Sample[]}
 */
export function parseSfxIndex(_json) {
  return [];
}

/**
 * The samples matching `tags`: those holding every tag, dropping the last tag
 * until something matches. Empty when even the first tag alone matches nothing.
 * @param {Sample[]} _samples @param {string[]} _tags @returns {Sample[]}
 */
export function matchSamples(_samples, _tags) {
  return [];
}

/**
 * @typedef {object} SfxOptions
 * @property {EffectsLevel} [level]
 * @property {boolean} [enabled] false plays and downloads nothing
 * @property {() => AudioContext} [createContext]
 */

/** @param {SfxOptions} [_options] */
export function createSfx(_options = {}) {
  return {
    /** Fetches the index and downloads and decodes every sample. */
    start() {},
    /** Creates or resumes the AudioContext; call on a user gesture. */
    unlock() {},
    /**
     * Plays one sample matching `tags`. Positioned sounds fade with distance
     * from the listener set by `setListener`.
     * @param {string[]} _tags @param {PlayOptions} [_options]
     */
    play(_tags, _options) {},
    /** @param {{x:number,y:number,z:number}|undefined} _listener */
    setListener(_listener) {},
    /** @param {EffectsLevel} _level */
    setLevel(_level) {},
    /** For F3 and `__od.sfx`. */
    state() {
      return { status: "off", samples: 0, loaded: 0, playing: 0 };
    },
  };
}
