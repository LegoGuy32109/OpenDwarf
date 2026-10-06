// @ts-check

/**
 * The synthesizer for chatter (ADR 0006): turns a speech schedule into audio.
 * Ported from the audio half of `synthesize()` in `prototype/voice.js`. The
 * timing comes from `speechSchedule` in `src/shared/speech.js`, so the sound
 * stays in step with the syllable reveal.
 */

/** @typedef {import('../shared/speech.js').Voice} Voice */
/** @typedef {import('../shared/speech.js').SpeechSchedule} SpeechSchedule */
/** @typedef {Record<string,Float32Array>} VowelTables */

/** The first three formant frequencies of each vowel, in Hz. */
const VOWELS = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [270, 2290, 3010],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
};
const TABLE_SIZE = 1024;
/** Voices whose vowel tables stay cached; the oldest is dropped past this. */
const TABLE_CACHE_LIMIT = 32;

/** @type {Map<string,VowelTables>} */
const tableCache = new Map();
/** How many times the tables were built, for tests. */
export const tableBuilds = { count: 0 };

/**
 * An additive oscillator: sine harmonics shaped into three vowel resonances.
 * @param {number} pitch @param {number[]} formants @param {Voice} voice @param {number} rate
 */
function vowelTable(pitch, formants, voice, rate) {
  const table = new Float32Array(TABLE_SIZE + 1);
  for (let harmonic = 1; harmonic <= 38; harmonic++) {
    const frequency = pitch * harmonic;
    // Leave headroom for intonation and vibrato to keep harmonics below Nyquist.
    if (frequency * 1.28 * 1.02 * 1.004 >= rate / 2) break;
    let amplitude = 0.055 / harmonic;
    for (let band = 0; band < 3; band++) {
      const distance = (frequency - formants[band] * voice.formant) /
        [95, 130, 180][band];
      amplitude += Math.exp(-0.5 * distance * distance) *
        [1, 0.55, 0.24][band] / Math.sqrt(harmonic);
    }
    for (let sample = 0; sample < TABLE_SIZE; sample++) {
      table[sample] += amplitude *
        Math.sin(2 * Math.PI * harmonic * sample / TABLE_SIZE);
    }
  }
  let peak = 0;
  for (const sample of table) peak = Math.max(peak, Math.abs(sample));
  for (let i = 0; i < TABLE_SIZE; i++) table[i] /= Math.max(peak, 0.001);
  table[TABLE_SIZE] = table[0];
  return table;
}

/** A voice's five vowel tables, built once and cached by voice and sample rate. @param {Voice} voice @param {number} rate */
export function vowelTables(voice, rate) {
  const key = `${voice.pitch}:${voice.formant}:${rate}`;
  const cached = tableCache.get(key);
  if (cached) return cached;
  tableBuilds.count++;
  /** @type {VowelTables} */
  const tables = {};
  for (const [vowel, formants] of Object.entries(VOWELS)) {
    tables[vowel] = vowelTable(voice.pitch, formants, voice, rate);
  }
  tableCache.set(key, tables);
  if (tableCache.size > TABLE_CACHE_LIMIT) {
    tableCache.delete(/** @type {string} */ (tableCache.keys().next().value));
  }
  return tables;
}

/** @param {Float32Array} table @param {number} phase */
function lookup(table, phase) {
  const position = phase * TABLE_SIZE;
  const index = Math.floor(position);
  return table[index] + (table[index + 1] - table[index]) * (position - index);
}

/**
 * Render a schedule as mono samples, one audio phrase per spoken syllable.
 * @param {SpeechSchedule} schedule @param {Voice} voice @param {number} rate
 */
export function renderSamples(schedule, voice, rate) {
  const tables = vowelTables(voice, rate);
  const samples = new Float32Array(Math.ceil(schedule.duration * rate));
  let phase = 0;
  let currentPitch = voice.pitch;
  let filtered = 0;
  let smoothed = 0;
  const lowpass = 1 - Math.exp(-2 * Math.PI * 2600 / rate);
  for (const event of schedule.events) {
    if (!event.spoken) continue;
    const from = Math.floor(event.start * rate);
    const count = Math.floor(event.duration * rate);
    for (let i = 0; i < count && from + i < samples.length; i++) {
      const localTime = i / rate;
      const progress = i / count;
      const absoluteTime = (from + i) / rate;
      currentPitch += (event.pitch - currentPitch) *
        (1 - Math.exp(-1 / (0.028 * rate)));
      const vibrato = 1 + 0.004 * Math.sin(absoluteTime * Math.PI * 2 * 5);
      phase = (phase + currentPitch * vibrato / rate) % 1;
      const entry = Math.min(1, localTime / 0.045);
      const blend = entry * entry * (3 - 2 * entry);
      const change = Math.max(0, Math.min(1, (progress - 0.3) / 0.5));
      const body = lookup(tables[event.vowel], phase) * (1 - change) +
        lookup(tables[event.target], phase) * change;
      const tone = lookup(tables[event.previous], phase) * (1 - blend) +
        body * blend;
      filtered += lowpass * (tone - filtered);
      smoothed += lowpass * (filtered - smoothed);
      const attack = Math.min(1, localTime / 0.028);
      const release = Math.min(1, (event.duration - localTime) / 0.045);
      const envelope = Math.sin(attack * Math.PI / 2) ** 2 *
        Math.sin(release * Math.PI / 2) ** 2;
      samples[from + i] = smoothed * envelope * 0.80;
    }
  }
  return samples;
}

/**
 * The audio of a message in a voice.
 * @param {Pick<BaseAudioContext,"createBuffer"|"sampleRate">} context
 * @param {SpeechSchedule} schedule @param {Voice} voice
 */
export function synthesize(context, schedule, voice) {
  const rate = context.sampleRate;
  const samples = renderSamples(schedule, voice, rate);
  const buffer = context.createBuffer(1, samples.length, rate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}
