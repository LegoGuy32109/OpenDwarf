/** Character settings remain stable between lines. */
const originalVoices = {
  borin: {
    name: "Borin",
    role: "Keeper of the forge",
    pitch: 108,
    formant: 0.82,
    speed: 0.94,
    seed: 31,
  },
  pip: {
    name: "Pip",
    role: "Scout of the upper tunnels",
    pitch: 224,
    formant: 1.19,
    speed: 1.17,
    seed: 83,
  },
  mara: {
    name: "Mara",
    role: "Warden of the halls",
    pitch: 155,
    formant: 1.02,
    speed: 1.02,
    seed: 59,
  },
};
/** @typedef {{name:string,role:string,pitch:number,formant:number,speed:number,seed:number}} VoiceRecipe */
/** @typedef {"pitch"|"formant"|"speed"|"seed"} VoiceParameter */
const defaults = {
  name: "Custom voice",
  role: "Custom setup",
  pitch: 155,
  formant: 1.02,
  speed: 1.02,
  seed: 59,
};
/** These four values distinguish the original Borin, Pip, and Mara setups.
 * @type {{key:VoiceParameter,label:string,min:number,max:number,step:number,unit:string,help:string}[]}
 */
export const parameters = [
  {
    key: "pitch",
    label: "Base pitch",
    min: 65,
    max: 360,
    step: 1,
    unit: "Hz",
    help: "The fundamental tone. Low values sound deeper.",
  },
  {
    key: "formant",
    label: "Vowel resonance",
    min: 0.55,
    max: 1.65,
    step: 0.01,
    unit: "×",
    help:
      "Changes the apparent size of the vocal tract, independently of pitch.",
  },
  {
    key: "speed",
    label: "Speaking speed",
    min: 0.5,
    max: 1.8,
    step: 0.01,
    unit: "×",
    help: "Sets the voice's natural syllable pace.",
  },
  {
    key: "seed",
    label: "Personality seed",
    min: 0,
    max: 99999,
    step: 1,
    unit: "",
    help: "Changes the repeatable delivery pattern.",
  },
];
/** @param {Partial<VoiceRecipe>} [input] @returns {VoiceRecipe} */
export function normalizeVoice(input = {}) {
  const result = { ...defaults };
  result.name = typeof input.name === "string"
    ? input.name.trim().slice(0, 60) || defaults.name
    : defaults.name;
  result.role = typeof input.role === "string"
    ? input.role.trim().slice(0, 100)
    : defaults.role;
  for (const setting of parameters) {
    const value = input[setting.key];
    result[setting.key] = typeof value === "number" && Number.isFinite(value)
      ? Math.max(setting.min, Math.min(setting.max, value))
      : defaults[setting.key];
  }
  result.seed = Math.round(result.seed);
  return result;
}
export const voices = Object.fromEntries(
  Object.entries(originalVoices).map((
    [id, voice],
  ) => [id, normalizeVoice(voice)]),
);
/** @returns {VoiceRecipe} */
export function randomVoice() {
  const result = { ...defaults };
  for (const setting of parameters) {
    const steps = Math.round((setting.max - setting.min) / setting.step);
    const value = setting.min +
      Math.floor(Math.random() * (steps + 1)) * setting.step;
    result[setting.key] = Number(value.toFixed(4));
  }
  return normalizeVoice(result);
}
const vowels = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [270, 2290, 3010],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
};
const TABLE_SIZE = 1024;
/** @param {number} seed */
function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
}
/** An additive oscillator: sine harmonics shaped into three vowel resonances.
 * @param {number} pitch @param {number[]} formants @param {VoiceRecipe} voice @param {number} rate
 */
function vowelTable(pitch, formants, voice, rate) {
  const table = new Float32Array(TABLE_SIZE + 1);
  for (let harmonic = 1; harmonic <= 38; harmonic++) {
    const frequency = pitch * harmonic;
    // Leave headroom for intonation and vibrato to keep harmonics below Nyquist.
    if (
      frequency * (1.1 + 0.18 * 1) * (1 + 0.04 / 2) *
          (1 + 0.004) >= rate / 2
    ) break;
    let amplitude = 0.055 / harmonic;
    for (let band = 0; band < 3; band++) {
      const distance = (frequency - formants[band] * voice.formant) /
        [95, 130, 180][band];
      amplitude += Math.exp(-0.5 * distance * distance) *
        [1, 0.55 * 1, 0.24 * 1][band] /
        Math.sqrt(harmonic);
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
/** @param {Float32Array} table @param {number} phase */
function lookup(table, phase) {
  const position = phase * TABLE_SIZE;
  const index = Math.floor(position);
  return table[index] + (table[index + 1] - table[index]) * (position - index);
}
/** Common irregular spellings in the sample dialogue. Other words use vowel groups. */
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
/** Approximate English syllables while preserving the exact original spelling.
 * @param {string} word @returns {string[]}
 */
function splitWord(word) {
  const lower = word.toLowerCase();
  const known = wordBreaks[/** @type {keyof typeof wordBreaks} */ (lower)];
  if (Object.hasOwn(wordBreaks, lower)) {
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
    const gapStart = previous.index + previous[0].length;
    const consonants = lower.slice(gapStart, next.index);
    const onset = consonants.match(
      /(?:ch|sh|th|ph|wh|[bcfgp]r|[bcfgp]l|st|tr|dr)$/,
    )?.[0];
    const boundary = next.index -
      (onset?.length ?? Math.min(1, consonants.length));
    if (boundary > start) {
      parts.push(word.slice(start, boundary));
      start = boundary;
    }
  }
  parts.push(word.slice(start));
  return parts;
}
/** Reveal units use UTF-16 offsets, matching String.slice in the dialogue UI.
 * @param {string} text
 */
export function syllables(text) {
  const units = [];
  for (
    const match of text.matchAll(
      /[\p{L}\p{N}]+(?:['’][\p{L}]+)*|[^\p{L}\p{N}]+/gu,
    )
  ) {
    const spoken = /[\p{L}\p{N}]/u.test(match[0]);
    let offset = match.index;
    for (const part of spoken ? splitWord(match[0]) : [match[0]]) {
      offset += part.length;
      units.push({ text: part, index: offset, spoken });
    }
  }
  return units;
}
/** Generate smooth fictional chatter with one audio phrase per reveal syllable.
 * @param {AudioContext} context
 * @param {string} text
 * @param {string | Partial<VoiceRecipe>} recipe
 * @param {{ pace: number, pitch: number }} options
 */
export function synthesize(
  context,
  text,
  recipe,
  options = { pace: 1, pitch: 0 },
) {
  const voice = normalizeVoice(
    typeof recipe === "string" ? voices[recipe] : recipe,
  );
  const basePitch = voice.pitch * 2 ** (options.pitch / 12);
  const random = randomGenerator(
    voice.seed +
      Array.from(text).reduce(
        (sum, char) => sum + (char.codePointAt(0) ?? 0),
        0,
      ),
  );
  const tables = Object.fromEntries(
    Object.entries(vowels).map((
      [key, value],
    ) => [key, vowelTable(basePitch, value, voice, context.sampleRate)]),
  );
  const rate = context.sampleRate;
  const pace = options.pace * voice.speed;
  const units = syllables(text);
  let time = 0.04;
  let previous = "e";
  let phraseStart = 0;
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
    const pitch = basePitch * (1 + (random() - 0.5) * 0.04) *
      (question
        ? 1 + 0.18 * 1 * progress ** 3
        : 1 + 1 * (0.07 - 0.14 * progress));
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
  const buffer = context.createBuffer(1, Math.ceil((time + 0.08) * rate), rate);
  const samples = buffer.getChannelData(0);
  let phase = 0;
  let currentPitch = basePitch;
  let filtered = 0;
  let smoothed = 0;
  const lowpass = 1 - Math.exp(-2 * Math.PI * 2600 / rate);
  for (const event of events) {
    if (!event.spoken) continue;
    const from = Math.floor(event.start * rate);
    const count = Math.floor(event.duration * rate);
    for (let i = 0; i < count; i++) {
      const localTime = i / rate;
      const progress = i / count;
      const absoluteTime = (from + i) / rate;
      currentPitch += (event.pitch - currentPitch) *
        (1 - Math.exp(-1 / (0.028 * rate)));
      const vibrato = 1 +
        0.004 *
          Math.sin(absoluteTime * Math.PI * 2 * 5);
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
  return { buffer, events, duration: time + 0.08 };
}
