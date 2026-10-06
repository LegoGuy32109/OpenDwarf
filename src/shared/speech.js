// @ts-check

/**
 * Speech timing (ADR 0006). Splits a message into syllables and schedules them
 * for a voice. The schedule is a pure function of the text and the voice, with
 * no audio, so the world host can time a bubble and every client can reveal it
 * syllable by syllable in step. The chatter audio plays the same schedule.
 * Ported from the voice forge prototype (`prototype/voice.js`), which stays the
 * tool for tuning voices.
 */

/** @typedef {{pitch:number,formant:number,speed:number,seed:number}} Voice */
/**
 * One reveal unit. `index` is the UTF-16 end offset of the unit in the text, so
 * `text.slice(0, index)` is visible once the unit starts. `vowel`, `target` and
 * `previous` are the vowel sounds the audio blends; `pitch` is in Hz.
 * @typedef {{text:string,index:number,spoken:boolean,start:number,duration:number,vowel:string,target:string,previous:string,pitch:number}} SpeechEvent
 */
/** @typedef {{events:SpeechEvent[],duration:number}} SpeechSchedule */

/** Ranges a seeded voice takes, chosen so every voice sounds pleasant. */
export const VOICE_RANGES = Object.freeze({
  pitch: [90, 240],
  formant: [0.8, 1.2],
  speed: [0.9, 1.15],
});

/** Silence before the first syllable and after the last, in seconds. */
const LEAD_IN = 0.04;
const TAIL = 0.08;

/** @param {number} seed */
function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
}

/** A 32-bit FNV-1a hash of a string. @param {string} text */
function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The voice an entity speaks with, seeded from its player id. The same id
 * always gives the same voice on every client, so nothing is sent.
 * @param {string} id @returns {Voice}
 */
export function voiceFromId(id) {
  const random = randomGenerator(hashText(id));
  /** @param {readonly number[]} range */
  const pick = ([min, max]) => min + (max - min) * random();
  const pitch = Math.round(pick(VOICE_RANGES.pitch));
  const formant = Math.round(pick(VOICE_RANGES.formant) * 100) / 100;
  const speed = Math.round(pick(VOICE_RANGES.speed) * 100) / 100;
  const seed = Math.floor(random() * 100000);
  return { pitch, formant, speed, seed };
}

/** Common irregular spellings. Other words split at vowel groups. */
const wordBreaks = {
  traveler: ["trav", "el", "er"],
  something: ["some", "thing"],
  moving: ["mov", "ing"],
  beneath: ["be", "neath"],
  mountain: ["moun", "tain"],
  another: ["a", "noth", "er"],
  welcome: ["wel", "come"],
  history: ["his", "to", "ry"],
  waiting: ["wait", "ing"],
  kettle: ["ket", "tle"],
  iron: ["i", "ron"],
  fine: ["fine"],
};

/** Approximate English syllables, keeping the exact original spelling. @param {string} word @returns {string[]} */
function splitWord(word) {
  const lower = word.toLowerCase();
  if (Object.hasOwn(wordBreaks, lower)) {
    const known = wordBreaks[/** @type {keyof typeof wordBreaks} */ (lower)];
    let offset = 0;
    return known.map((part) => {
      const result = word.slice(offset, offset + part.length);
      offset += part.length;
      return result;
    });
  }
  const nuclei = [...lower.matchAll(/[aeiouy]+/g)];
  if (nuclei.length > 1 && /e$/.test(lower) && !/[^aeiou]le$/.test(lower)) {
    const last = nuclei.at(-1);
    if (last?.[0] === "e" && last.index === lower.length - 1) nuclei.pop();
  }
  if (nuclei.length < 2) return [word];
  const parts = [];
  let start = 0;
  for (let index = 1; index < nuclei.length; index++) {
    const previous = nuclei[index - 1];
    const next = nuclei[index];
    const gapStart = (previous.index ?? 0) + previous[0].length;
    const consonants = lower.slice(gapStart, next.index);
    const onset = consonants.match(
      /(?:ch|sh|th|ph|wh|[bcfgp]r|[bcfgp]l|st|tr|dr)$/,
    )?.[0];
    const boundary = (next.index ?? 0) -
      (onset?.length ?? Math.min(1, consonants.length));
    if (boundary > start) {
      parts.push(word.slice(start, boundary));
      start = boundary;
    }
  }
  parts.push(word.slice(start));
  return parts;
}

/**
 * Reveal units: spoken syllables and the punctuation and spaces between them.
 * @param {string} text @returns {{text:string,index:number,spoken:boolean}[]}
 */
export function syllables(text) {
  const units = [];
  for (
    const match of text.matchAll(
      /[\p{L}\p{N}]+(?:['’][\p{L}]+)*|[^\p{L}\p{N}]+/gu,
    )
  ) {
    const spoken = /[\p{L}\p{N}]/u.test(match[0]);
    let offset = match.index ?? 0;
    for (const part of spoken ? splitWord(match[0]) : [match[0]]) {
      offset += part.length;
      units.push({ text: part, index: offset, spoken });
    }
  }
  return units;
}

/** How many syllables a message speaks; the talking indicator carries it. @param {string} text */
export function syllableCount(text) {
  return syllables(text).filter((unit) => unit.spoken).length;
}

/**
 * Schedule a message for a voice: when each unit starts, how long it lasts, and
 * its vowels and pitch. Times are seconds from the start of the speech.
 * @param {string} text @param {Voice} voice @returns {SpeechSchedule}
 */
export function speechSchedule(text, voice) {
  const random = randomGenerator(
    voice.seed +
      Array.from(text).reduce(
        (sum, char) => sum + (char.codePointAt(0) ?? 0),
        0,
      ),
  );
  const pace = voice.speed;
  const units = syllables(text);
  let time = LEAD_IN;
  let previous = "e";
  let phraseStart = 0;
  /** @type {SpeechEvent[]} */
  const events = [];
  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    const duration = (unit.spoken
      ? 0.14 + Math.min(5, unit.text.length) * 0.021 + random() * 0.012
      : /[.!?]/.test(unit.text)
      ? 0.30
      : /[,;:]/.test(unit.text)
      ? 0.15
      : 0.055) / pace;
    const nucleus = unit.text.toLowerCase().match(/[aeiou]+/)?.[0] ?? "e";
    const vowel = nucleus[0];
    const target = nucleus.at(-1) ?? vowel;
    const phraseEndOffset = units.slice(index).findIndex((part) =>
      /[.!?]/.test(part.text)
    );
    const phraseEnd = phraseEndOffset < 0
      ? units.length
      : index + phraseEndOffset;
    const progress = (index - phraseStart) /
      Math.max(1, phraseEnd - phraseStart);
    const question = units[phraseEnd]?.text.includes("?");
    const pitch = voice.pitch * (1 + (random() - 0.5) * 0.04) *
      (question ? 1 + 0.18 * progress ** 3 : 1 + (0.07 - 0.14 * progress));
    events.push({
      ...unit,
      start: time,
      duration,
      vowel,
      target,
      previous,
      pitch,
    });
    time += duration;
    if (/[.!?]/.test(unit.text)) {
      phraseStart = index + 1;
    }
    if (unit.spoken) {
      previous = target;
    }
  }
  return { events, duration: time + TAIL };
}

/** Speech length in milliseconds. @param {string} text @param {Voice} voice */
export function speechDurationMs(text, voice) {
  return Math.ceil(speechSchedule(text, voice).duration * 1000);
}

/**
 * How many UTF-16 code units of the text show `elapsedMs` after the speech
 * started: every unit that has started, so a syllable appears as it is spoken.
 * @param {SpeechSchedule} schedule @param {string} text @param {number} elapsedMs
 */
export function revealedLength(schedule, text, elapsedMs) {
  if (elapsedMs < 0) return 0;
  const seconds = elapsedMs / 1000;
  let length = 0;
  for (const event of schedule.events) {
    if (event.start > seconds) break;
    length = event.index;
  }
  return seconds >= schedule.duration ? text.length : length;
}
