import { speechSchedule } from "../src/shared/speech.js";
import { synthesize as synthesizeAudio } from "../src/client/voice.js";
export { syllables } from "../src/shared/speech.js";

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
/** Generate a phrase with the same timing and synthesizer used by the game.
 * @param {AudioContext} context @param {string} text
 * @param {string | Partial<VoiceRecipe>} recipe
 * @param {{pace:number,pitch:number}} options
 */
export function synthesize(
  context,
  text,
  recipe,
  options = { pace: 1, pitch: 0 },
) {
  const source = normalizeVoice(
    typeof recipe === "string" ? voices[recipe] : recipe,
  );
  const voice = {
    ...source,
    pitch: source.pitch * 2 ** (options.pitch / 12),
    speed: source.speed * options.pace,
  };
  const schedule = speechSchedule(text, voice);
  return { buffer: synthesizeAudio(context, schedule, voice), ...schedule };
}
