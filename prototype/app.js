import {
  normalizeVoice,
  parameters,
  randomVoice,
  synthesize,
  voices,
} from "./voice.js";
/** @param {string} id @returns {HTMLElement} */
function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found;
}
const text = /** @type {HTMLTextAreaElement} */ (element("text"));
const dialogue = element("dialogue");
const status = element("status");
const stopButton = /** @type {HTMLButtonElement} */ (element("stop"));
const speakButton = /** @type {HTMLButtonElement} */ (element("speak"));
const canvas = /** @type {HTMLCanvasElement} */ (element("scope"));
const drawing =
  /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
const dwarf = element("dwarf");
let draft = { ...voices.borin };
/** @type {AudioContext | undefined} */
let context;
/** @type {AnalyserNode | undefined} */
let analyser;
/** @type {GainNode | undefined} */
let gain;
/** @type {AudioBufferSourceNode | undefined} */
let source;
/** @type {ReturnType<typeof synthesize> | undefined} */
let utterance;
let started = 0;
let generation = 0;
let playingText = "";
const volume = /** @type {HTMLInputElement} */ (element("volume"));
/** @type {Map<import('./voice.js').VoiceParameter,{range:HTMLInputElement,number:HTMLInputElement}>} */
const sliders = new Map();
/** @param {string | undefined} [preset] */
function renderEditor(preset) {
  for (const setting of parameters) {
    const slider = sliders.get(setting.key);
    if (slider) {
      slider.range.value = String(draft[setting.key]);
      slider.number.value = String(draft[setting.key]);
    }
  }
  element("speaker-name").textContent = draft.name;
  element("speaker-role").textContent = draft.role;
  for (const button of document.querySelectorAll("[data-voice]")) {
    const selected =
      /** @type {HTMLElement} */ (button).dataset.voice === preset;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  dialogue.textContent = text.value;
}
for (const setting of parameters) {
  const label = document.createElement("div");
  label.className = "slider";
  const caption = document.createElement("label");
  caption.textContent = setting.label;
  const number = document.createElement("input");
  number.type = "number";
  number.className = "recipe-number";
  number.id = `recipe-${setting.key}`;
  number.setAttribute("aria-label", setting.label);
  caption.htmlFor = number.id;
  const value = document.createElement("div");
  value.className = "parameter-value";
  const unit = document.createElement("span");
  unit.textContent = setting.unit;
  value.append(number, unit);
  const range = document.createElement("input");
  range.type = "range";
  range.setAttribute("aria-label", `${setting.label} slider`);
  for (const input of [number, range]) {
    input.min = String(setting.min);
    input.max = String(setting.max);
    input.step = String(setting.step);
  }
  const help = document.createElement("small");
  help.textContent = setting.help;
  label.append(caption, value, range, help);
  element("recipe-controls").append(label);
  sliders.set(setting.key, { range, number });
  range.addEventListener("input", () => {
    stop();
    draft = normalizeVoice({
      ...draft,
      name: "Custom voice",
      role: "Custom setup",
      [setting.key]: Number(range.value),
    });
    renderEditor();
  });
  number.addEventListener("change", () => {
    stop();
    const entered = number.valueAsNumber;
    draft = normalizeVoice({
      ...draft,
      name: "Custom voice",
      role: "Custom setup",
      [setting.key]: entered,
    });
    renderEditor();
  });
}
for (const button of document.querySelectorAll("[data-voice]")) {
  button.addEventListener("click", () => {
    stop();
    const preset = /** @type {HTMLElement} */ (button).dataset.voice;
    if (preset && Object.hasOwn(voices, preset)) {
      draft = { ...voices[preset] };
      renderEditor(preset);
    }
  });
}
element("randomize-voice").addEventListener("click", () => {
  stop();
  draft = randomVoice();
  renderEditor();
});
renderEditor("borin");
function stop() {
  generation++;
  if (source) {
    source.onended = null;
    source.stop();
    source.disconnect();
    source = undefined;
  }
  utterance = undefined;
  stopButton.disabled = true;
  element("lamp").classList.remove("active");
  status.textContent = "READY TO SPEAK";
  dwarf.style.transform = "";
  speakButton.disabled = false;
}
for (const button of document.querySelectorAll("[data-line]")) {
  button.addEventListener("click", () => {
    stop();
    text.value = /** @type {HTMLElement} */ (button).dataset.line ?? "";
    dialogue.textContent = text.value;
  });
}
text.addEventListener("input", () => {
  if (!source) dialogue.textContent = text.value;
});
volume.addEventListener("input", () => {
  const value = Number(volume.value);
  element("volume-value").textContent = Math.round(value * 100) + "%";
  if (gain && context) {
    gain.gain.setTargetAtTime(value, context.currentTime, 0.02);
  }
});
/** @param {import('./voice.js').VoiceRecipe} recipe @param {string} [speaker] @param {string} [role] */
async function play(recipe, speaker = recipe.name, role = recipe.role) {
  stop();
  const currentGeneration = generation;
  if (!text.value.trim()) {
    text.focus();
    return;
  }
  try {
    if (!context) {
      context = new AudioContext();
      gain = context.createGain();
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      gain.connect(analyser);
      analyser.connect(context.destination);
    }
    await context.resume();
    if (generation !== currentGeneration) return;
    playingText = text.value;
    utterance = synthesize(context, playingText, recipe);
    element("speaker-name").textContent = speaker;
    element("speaker-role").textContent = role;
    if (!gain) throw new Error("Audio output is unavailable");
    gain.gain.value = Number(volume.value);
    source = context.createBufferSource();
    source.buffer = utterance.buffer;
    source.connect(gain);
    source.onended = () => {
      stop();
      dialogue.textContent = playingText;
    };
    started = context.currentTime + 0.04;
    source.start(started);
    dialogue.textContent = "";
    element("duration").textContent = `${
      utterance.duration.toFixed(1)
    } SEC / ${speaker.toUpperCase()}`;
    element("lamp").classList.add("active");
    status.textContent = "SPEAKING";
    stopButton.disabled = false;
  } catch (error) {
    stop();
    status.textContent = "AUDIO COULD NOT START";
    console.error(error);
  }
}
speakButton.addEventListener("click", () => {
  void play(normalizeVoice(draft));
});
stopButton.addEventListener("click", stop);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});
const waveform = new Uint8Array(1024);
function draw() {
  const width = Math.round(canvas.clientWidth * devicePixelRatio);
  const height = Math.round(canvas.clientHeight * devicePixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  drawing.clearRect(0, 0, width, height);
  drawing.strokeStyle = "#3c5141";
  drawing.lineWidth = 1;
  drawing.beginPath();
  drawing.moveTo(0, height / 2);
  drawing.lineTo(width, height / 2);
  drawing.stroke();
  if (source && analyser && utterance && context) {
    analyser.getByteTimeDomainData(waveform);
    drawing.strokeStyle = "#e0a866";
    drawing.lineWidth = devicePixelRatio;
    drawing.beginPath();
    let energy = 0;
    for (let i = 0; i < waveform.length; i++) {
      const sample = (waveform[i] - 128) / 128;
      energy += sample * sample;
      const x = i / (waveform.length - 1) * width;
      const y = height / 2 + sample * height * 0.7;
      if (i === 0) drawing.moveTo(x, y);
      else drawing.lineTo(x, y);
    }
    drawing.stroke();
    const elapsed = context.currentTime - started;
    const event = utterance.events.findLast((event) => event.start <= elapsed);
    dialogue.textContent = playingText.slice(0, event?.index ?? 0);
    dwarf.style.transform = `translateY(${-Math.min(
      5,
      Math.sqrt(energy / waveform.length) * 25,
    )}px)`;
  }
  requestAnimationFrame(draw);
}
draw();
