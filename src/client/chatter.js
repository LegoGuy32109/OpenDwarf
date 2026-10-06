// @ts-check

/**
 * The chatter player (ADR 0006). Each bubble in `scene.chatFeed` plays in its
 * speaker's seeded voice when its `startAt` arrives; a talking record plays a
 * quiet murmur. The player reads display records and never changes them.
 */

import { CHAT_TEXT_RADIUS } from "../shared/chat.js";
import { speechSchedule, voiceFromId } from "../shared/speech.js";
import { synthesize } from "./voice.js";

/** @typedef {import('../shared/chat.js').DisplayChatRecord} DisplayChatRecord */
/** @typedef {"off"|"low"|"medium"|"high"} VoicesLevel */
/** @typedef {{speaker:string,length:number,syllables:number,gain:number,volume:number,murmur:boolean}} ChatterLogEntry */

export const VOICES_LEVELS = /** @type {VoicesLevel[]} */ ([
  "off",
  "low",
  "medium",
  "high",
]);
/** The master volume of each Voices setting. Medium is the default. */
export const VOICES_VOLUME = { off: 0, low: 0.35, medium: 0.7, high: 1 };
export const VOICES_KEY = "open-dwarf-voices";

/** Full volume to this many blocks, then a fall to `FAR_GAIN` at the text radius. */
export const NEAR_BLOCKS = 2;
export const FAR_GAIN = 0.3;
export const MURMUR_GAIN = 0.1;
export const MURMUR_CUTOFF_HZ = 600;
export const MAX_VOICES = 6;
const HEARD_LIMIT = 400;
const BUFFER_CACHE_LIMIT = 24;

/** A tiny silent WAV (eight 8-bit samples at 8 kHz). Playing it moves iOS to the playback audio session. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA==";

/**
 * A message is its speaker and start (tick, or local time when only that is at
 * hand); text and murmur of one message share it.
 * @param {string} id @param {number|undefined} start
 */
function messageKey(id, start) {
  return start === undefined ? undefined : `${id}:${start}`;
}

/** @param {unknown} value @returns {VoicesLevel} */
export function parseVoicesLevel(value) {
  return VOICES_LEVELS.find((level) => level === value) ?? "medium";
}

/** Distance gain of another speaker's text bubble. @param {number} blocks */
export function distanceGain(blocks) {
  if (blocks <= NEAR_BLOCKS) return 1;
  const share = Math.min(
    1,
    (blocks - NEAR_BLOCKS) / (CHAT_TEXT_RADIUS - NEAR_BLOCKS),
  );
  return 1 - (1 - FAR_GAIN) * share;
}

/** The neutral text a murmur speaks: `count` "ba" syllables. @param {number} count */
export function murmurText(count) {
  return Array.from({ length: count }, () => "ba").join(" ");
}

/**
 * @typedef {object} ChatterOptions
 * @property {() => AudioContext} [createContext] Makes the AudioContext; default `new AudioContext()`.
 * @property {() => boolean} [hidden] Whether the tab is hidden.
 * @property {VoicesLevel} [level]
 */

/** @param {ChatterOptions} [options] */
export function createChatter(options = {}) {
  const createContext = options.createContext ??
    (() => new (globalThis.AudioContext)());
  const hidden = options.hidden ?? (() => globalThis.document?.hidden ?? false);
  /** @type {AudioContext|null} */
  let audio = null;
  let level = options.level ?? "medium";
  /** Keys of bubbles already played or skipped. */
  const heard = new Set();
  /** @type {{distance:number,end:number,source:AudioBufferSourceNode}[]} */
  let active = [];
  /** @type {Map<string,AudioBuffer>} */
  const buffers = new Map();
  /** The chatter that started, for the harness. @type {ChatterLogEntry[]} */
  const log = [];

  /** @param {string} key */
  function markHeard(key) {
    heard.add(key);
    if (heard.size > HEARD_LIMIT) {
      heard.delete(/** @type {string} */ (heard.values().next().value));
    }
  }

  function stopAll() {
    for (const voice of active) {
      try {
        voice.source.stop();
      } catch {
        // A source that already ended cannot be stopped again.
      }
    }
    active = [];
  }

  let silentPlayed = false;

  /**
   * On iOS the ringer switch mutes Web Audio unless the page's audio session is
   * "playback". Safari 17 has `navigator.audioSession`; older iOS needs an
   * HTMLAudioElement to play once. Never throws.
   */
  function useMediaSession() {
    try {
      const session = /** @type {{audioSession?:{type:string}}} */ (
        globalThis.navigator ?? {}
      ).audioSession;
      if (session) {
        session.type = "playback";
        return;
      }
      if (silentPlayed || typeof globalThis.Audio !== "function") return;
      silentPlayed = true;
      const element = new globalThis.Audio(SILENT_WAV);
      element.play()?.catch?.(() => {});
    } catch {
      // Audio still works with the ringer on.
    }
  }

  /** Create or resume the context; call it from a user gesture. */
  function unlock() {
    useMediaSession();
    try {
      audio ??= createContext();
      if (audio.state === "suspended") audio.resume?.();
    } catch {
      audio = null;
    }
  }

  /** @param {string} text @param {import('../shared/speech.js').Voice} voice */
  function bufferFor(
    /** @type {AudioContext} */ context,
    text,
    voice,
    schedule = speechSchedule(text, voice),
  ) {
    const key =
      `${voice.seed}:${voice.pitch}:${voice.formant}:${voice.speed}:${text}`;
    let buffer = buffers.get(key);
    if (!buffer) {
      buffer = synthesize(context, schedule, voice);
      buffers.set(key, buffer);
      if (buffers.size > BUFFER_CACHE_LIMIT) {
        buffers.delete(/** @type {string} */ (buffers.keys().next().value));
      }
    }
    return buffer;
  }

  /**
   * Start one voice, unless six already play and all are nearer.
   * @param {{speaker:string,text:string,length:number,syllables:number,distance:number,gain:number,murmur:boolean,offset:number}} request
   */
  function play(request) {
    const context = audio;
    if (!context) return;
    const voice = voiceFromId(request.speaker);
    const schedule = speechSchedule(request.text, voice);
    const remaining = schedule.duration - request.offset;
    if (remaining <= 0) return;
    const now = performance.now();
    active = active.filter((voice) => voice.end > now);
    if (active.length >= MAX_VOICES) {
      const farthest = active.reduce((far, voice) =>
        voice.distance > far.distance ? voice : far
      );
      if (farthest.distance <= request.distance) return;
      try {
        farthest.source.stop();
      } catch {
        // Already ended.
      }
      active = active.filter((voice) => voice !== farthest);
    }
    const volume = request.gain * VOICES_VOLUME[level];
    const source = context.createBufferSource();
    source.buffer = bufferFor(context, request.text, voice, schedule);
    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    if (request.murmur) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = MURMUR_CUTOFF_HZ;
      gain.connect(filter);
      filter.connect(context.destination);
    } else {
      gain.connect(context.destination);
    }
    source.start(context.currentTime, request.offset);
    const entry = {
      distance: request.distance,
      end: now + remaining * 1000,
      source,
    };
    active.push(entry);
    source.onended = () => {
      active = active.filter((voice) => voice !== entry);
    };
    log.push({
      speaker: request.speaker,
      length: request.length,
      syllables: request.syllables,
      gain: request.gain,
      volume,
      murmur: request.murmur,
    });
  }

  /**
   * Play what is due. Call it every frame with the feed, the listener's id and
   * position, and `performance.now()`.
   * @param {DisplayChatRecord[]} feed
   * @param {string} localId
   * @param {{x:number,y:number}|undefined} listener
   * @param {number} now
   */
  function update(feed, localId, listener, now) {
    const mute = level === "off" || hidden() || !audio;
    if (hidden()) stopAll();
    for (const record of feed) {
      const distance = record.id === localId || !listener
        ? 0
        : Math.hypot(listener.x - record.x, listener.y - record.y);
      if (record.text !== undefined) {
        const bubbles = record.bubbles?.length ? record.bubbles : [{
          text: record.text,
          expiresTick: record.expiresTick,
          startAt: /** @type {number|undefined} */ (undefined),
        }];
        for (const bubble of bubbles) {
          const key = messageKey(
            record.id,
            /** @type {{startTick?:number}} */ (bubble).startTick ??
              bubble.startAt,
          ) ?? `${record.id}:${bubble.expiresTick}:${bubble.text}`;
          if (heard.has(key)) continue;
          const startAt = bubble.startAt ?? now;
          if (startAt > now) continue;
          markHeard(key);
          if (mute) continue;
          const voice = voiceFromId(record.id);
          const offset = (now - startAt) / 1000;
          if (offset > speechSchedule(bubble.text, voice).duration) continue;
          play({
            speaker: record.id,
            text: bubble.text,
            length: bubble.text.length,
            syllables: 0,
            distance,
            gain: record.id === localId ? 1 : distanceGain(distance),
            murmur: false,
            offset,
          });
        }
      } else if (record.talking && record.syllables) {
        const key = messageKey(record.id, record.startTick ?? record.startAt) ??
          `${record.id}:${record.expiresTick}:murmur:${record.syllables}`;
        if (heard.has(key)) continue;
        const startAt = record.startAt ?? now;
        if (startAt > now) continue;
        markHeard(key);
        if (mute) continue;
        const text = murmurText(record.syllables);
        const offset = (now - startAt) / 1000;
        if (offset > speechSchedule(text, voiceFromId(record.id)).duration) {
          continue;
        }
        play({
          speaker: record.id,
          text,
          length: 0,
          syllables: record.syllables,
          distance,
          gain: MURMUR_GAIN,
          murmur: true,
          offset,
        });
      }
    }
  }

  return {
    log,
    unlock,
    update,
    stopAll,
    get level() {
      return level;
    },
    /** @param {VoicesLevel} value */
    setLevel(value) {
      level = value;
      if (value === "off") stopAll();
    },
    get activeCount() {
      return active.length;
    },
  };
}

/** @typedef {ReturnType<typeof createChatter>} Chatter */
