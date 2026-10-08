// @ts-check
// Sound effects from tagged samples in the bucket (ADR 0008). The player reads
// the index, downloads every sample into the `od-media` cache, decodes each into
// an AudioBuffer, and plays one per request with a random pitch and gain.

import { SOUND_RANGE } from "../shared/sound.js";
import { build } from "./build.js";
import { CACHE_NAME } from "./music.js";

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
/** The master gain of each Effects setting. */
export const EFFECTS_VOLUME = {
  off: 0,
  "25": 0.25,
  "50": 0.5,
  "75": 0.75,
  "100": 1,
};
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
/** Samples downloaded at once. */
export const DOWNLOADS = 4;
/** Plays kept in the harness log. */
const LOG_LIMIT = 200;

/** @param {unknown} value @returns {EffectsLevel} */
export function parseEffectsLevel(value) {
  return EFFECTS_LEVELS.includes(/** @type {EffectsLevel} */ (value))
    ? /** @type {EffectsLevel} */ (value)
    : "75";
}

/**
 * The samples in an index; an entry without a key, a hash and tags is ignored.
 * @param {unknown} json @returns {Sample[]}
 */
export function parseSfxIndex(json) {
  const list = /** @type {{samples?:unknown}|null} */ (json)?.samples;
  if (!Array.isArray(list)) return [];
  /** @type {Sample[]} */
  const samples = [];
  const seen = new Set();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const { key, hash, tags, note } = entry;
    if (typeof key !== "string" || !key || seen.has(key)) continue;
    if (typeof hash !== "string" || !hash) continue;
    if (!Array.isArray(tags)) continue;
    const kept = tags.filter((tag) => typeof tag === "string" && tag);
    if (!kept.length) continue;
    seen.add(key);
    samples.push({
      key,
      hash,
      tags: kept,
      ...(typeof note === "string" ? { note } : {}),
    });
  }
  return samples;
}

/**
 * The samples matching `tags`: those holding every tag, dropping the last tag
 * until something matches. Empty when even the first tag alone matches nothing.
 * @param {Sample[]} samples @param {string[]} tags @returns {Sample[]}
 */
export function matchSamples(samples, tags) {
  for (let count = tags.length; count > 0; count--) {
    const wanted = tags.slice(0, count);
    const found = samples.filter((sample) =>
      wanted.every((tag) => sample.tags.includes(tag))
    );
    if (found.length) return found;
  }
  return [];
}

/**
 * The gain of a sound at a distance: full to `FULL_GAIN_TILES`, falling
 * linearly to silence at `SOUND_RANGE`. Horizontal only.
 * @param {number} distance
 */
export function distanceGain(distance) {
  if (distance <= FULL_GAIN_TILES) return 1;
  if (distance >= SOUND_RANGE) return 0;
  return (SOUND_RANGE - distance) / (SOUND_RANGE - FULL_GAIN_TILES);
}

/**
 * @typedef {object} SfxOptions
 * @property {EffectsLevel} [level]
 * @property {boolean} [enabled] false plays and downloads nothing
 * @property {() => AudioContext} [createContext]
 * @property {(key:string, hash?:string) => string} [mediaUrl]
 * @property {typeof fetch} [fetch]
 * @property {{open(name:string):Promise<Cache>}} [caches]
 * @property {() => number} [random]
 * @property {() => number} [now] local ms, as `performance.now()`
 */

/** @param {SfxOptions} [options] */
export function createSfx(options = {}) {
  const enabled = options.enabled ?? true;
  let level = options.level ?? "75";
  const mediaUrl = options.mediaUrl ?? build.mediaUrl;
  const fetchMedia = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const cacheStorage = options.caches ?? globalThis.caches;
  const createContext = options.createContext ??
    (() => new (globalThis.AudioContext)());
  const now = options.now ?? (() => performance.now());
  let random = options.random ?? Math.random;

  /** @type {AudioContext|null} */
  let audio = null;
  /** @type {GainNode|null} */
  let master = null;
  let started = false;
  let loading = false;
  /** @type {Sample[]} */
  let index = [];
  /** Downloaded bytes by sample key, waiting for a context to decode them. @type {Map<string,ArrayBuffer>} */
  const downloaded = new Map();
  /** Decoded samples. @type {Map<string,AudioBuffer>} */
  const buffers = new Map();
  /** @type {Sample[]} */
  let ready = [];
  /** @type {Map<string,string>} */
  const lastPlayed = new Map();
  /** @type {{x:number,y:number,z:number}|undefined} */
  let listener;
  /** @type {Voice[]} */
  let voices = [];
  /** @type {{tags:string[],key:string,rate:number,gain:number,muffled:boolean}[]} */
  const log = [];
  /** @type {"off"|"idle"|"loading"|"ready"} */
  let status = "off";
  /** @type {Promise<Cache|null>|null} */
  let cacheHandle = null;

  /**
   * @typedef {object} Voice
   * @property {number} gain The gain this play was given, before the setting.
   * @property {() => void} stop
   */

  const volume = () => EFFECTS_VOLUME[level];
  const active = () => enabled && level !== "off";
  const random01 = () => Math.min(0.999999, Math.max(0, random()));
  /** @param {[number,number]} range */
  const between = (range) => range[0] + random01() * (range[1] - range[0]);

  function openCache() {
    cacheHandle ??= Promise.resolve().then(() =>
      cacheStorage?.open(CACHE_NAME) ?? null
    ).catch(() => null);
    return cacheHandle;
  }

  /** The index from the bucket, else the last good copy in the device cache. */
  async function loadIndex() {
    const url = mediaUrl(SFX_INDEX_KEY);
    const cache = await openCache();
    /** @type {Sample[]} */
    let found = [];
    try {
      const response = await fetchMedia(url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      found = parseSfxIndex(JSON.parse(text));
      if (found.length && cache) {
        await cache.put(
          url,
          new Response(text, {
            headers: { "content-type": "application/json" },
          }),
        ).catch(() => {});
      }
    } catch {
      try {
        const kept = await cache?.match(url);
        if (kept) found = parseSfxIndex(await kept.json());
      } catch {
        // No index and no copy: the player stays quiet.
      }
    }
    return found;
  }

  /** One sample's bytes: from the device cache when it is there, else downloaded and cached. @param {Sample} sample */
  async function download(sample) {
    const url = mediaUrl(sample.key, sample.hash);
    const cache = await openCache();
    const hit = await cache?.match(url).catch(() => undefined);
    if (hit) return await hit.arrayBuffer();
    const response = await fetchMedia(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const copy = response.clone();
    const bytes = await response.arrayBuffer();
    await cache?.put(url, copy).catch(() => {});
    return bytes;
  }

  /** @param {Sample} sample */
  async function decode(sample) {
    const bytes = downloaded.get(sample.key);
    if (!audio || !bytes) return;
    downloaded.delete(sample.key);
    if (buffers.has(sample.key)) return;
    try {
      buffers.set(sample.key, await audio.decodeAudioData(bytes));
      ready = index.filter((candidate) => buffers.has(candidate.key));
    } catch {
      // A sample that does not decode is skipped.
    }
  }

  async function decodeAll() {
    await Promise.all(index.map(decode));
    if (status !== "off" && !loading) status = "ready";
  }

  async function load() {
    if (loading || !started || !active()) return;
    loading = true;
    status = "loading";
    index = await loadIndex();
    const queue = index.slice();
    const worker = async () => {
      for (let sample = queue.shift(); sample; sample = queue.shift()) {
        try {
          downloaded.set(sample.key, await download(sample));
          await decode(sample);
        } catch {
          // A sample that fails is skipped.
        }
      }
    };
    await Promise.all(Array.from({ length: DOWNLOADS }, worker));
    loading = false;
    status = "ready";
  }

  /** @param {Voice} voice */
  function release(voice) {
    voices = voices.filter((candidate) => candidate !== voice);
  }

  return {
    /** Fetches the index and downloads and decodes every sample. */
    start() {
      if (started || !enabled) return;
      started = true;
      globalThis.document?.addEventListener("visibilitychange", () => {
        if (!audio) return;
        if (document.hidden) audio.suspend?.();
        else audio.resume?.();
      });
      if (active()) void load();
    },
    /** Creates or resumes the AudioContext; call on a user gesture. */
    unlock() {
      if (!enabled) return;
      try {
        if (!audio) {
          audio = createContext();
          master = audio.createGain();
          master.gain.value = volume();
          master.connect(audio.destination);
        }
        if (audio.state === "suspended") audio.resume?.();
      } catch {
        audio = null;
        return;
      }
      void decodeAll();
    },
    /**
     * Plays one sample matching `tags`. Positioned sounds fade with distance
     * from the listener set by `setListener`.
     * @param {string[]} tags @param {PlayOptions} [playOptions]
     */
    play(tags, playOptions = {}) {
      const context = audio;
      if (!context || !master || !active()) return;
      // A suspended context (a hidden tab) would queue sounds that all play
      // together when the tab comes back.
      if (globalThis.document?.hidden || context.state === "suspended") return;
      const wait = playOptions.at === undefined ? 0 : playOptions.at - now();
      if (wait < -LATE_MS) return;
      const matches = matchSamples(ready, tags);
      if (!matches.length) return;
      const listKey = tags.join("\u0000");
      const fresh = matches.length > 1
        ? matches.filter((sample) => sample.key !== lastPlayed.get(listKey))
        : matches;
      const sample = fresh[Math.floor(random01() * fresh.length)];
      const buffer = buffers.get(sample.key);
      if (!buffer) return;
      let gain = between(SOUND_GAIN);
      const { x, y } = playOptions;
      if (listener && x !== undefined && y !== undefined) {
        gain *= distanceGain(Math.hypot(x - listener.x, y - listener.y));
      }
      const muffled = playOptions.muffled === true;
      if (muffled) gain *= MUFFLE_GAIN;
      if (gain <= 0) return;
      if (voices.length >= MAX_SOUNDS) {
        const quietest = voices.reduce((low, voice) =>
          voice.gain < low.gain ? voice : low
        );
        if (quietest.gain >= gain) return;
        quietest.stop();
        release(quietest);
      }
      const rate = between(tags[0] === "step" ? STEP_RATE : SOUND_RATE);
      lastPlayed.set(listKey, sample.key);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      const node = context.createGain();
      node.gain.value = gain;
      /** @type {BiquadFilterNode|null} */
      let filter = null;
      source.connect(node);
      if (muffled) {
        filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = MUFFLE_HZ;
        node.connect(filter);
        filter.connect(master);
      } else node.connect(master);
      /** @type {Voice} */
      const voice = {
        gain,
        stop() {
          try {
            source.stop();
          } catch {
            // Already ended.
          }
        },
      };
      voices.push(voice);
      source.onended = () => {
        release(voice);
        try {
          source.disconnect();
          node.disconnect();
          filter?.disconnect();
        } catch {
          // Already torn down.
        }
      };
      source.start(context.currentTime + Math.max(0, wait) / 1000);
      log.push({ tags: tags.slice(), key: sample.key, rate, gain, muffled });
      if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
    },
    /** @param {{x:number,y:number,z:number}|undefined} next */
    setListener(next) {
      listener = next;
    },
    /** @param {EffectsLevel} next */
    setLevel(next) {
      const wasActive = active();
      level = next;
      if (master) master.gain.value = volume();
      if (!active()) {
        for (const voice of voices.slice()) voice.stop();
        voices = [];
        return;
      }
      // A volume change keeps the loaded samples; only turning effects back on loads.
      if (started && !wasActive) void load().then(decodeAll);
    },
    /** For tests: the source of randomness. @param {() => number} source */
    setRandom(source) {
      random = source;
    },
    get level() {
      return level;
    },
    get enabled() {
      return enabled;
    },
    /** The plays so far, newest last, for `__od.sfx`. */
    log,
    /** For F3 and `__od.sfx`. */
    state() {
      return {
        status: active() ? status : "off",
        level,
        samples: index.length,
        loaded: ready.length,
        playing: voices.length,
      };
    },
    /** The F3 panel line. */
    line() {
      if (!active()) return "Effects off";
      const state = this.state();
      return `Effects ${state.loaded}/${state.samples} samples  ${state.playing} playing`;
    },
  };
}

/** @typedef {ReturnType<typeof createSfx>} Sfx */
