# Voice forge

A standalone Open Dwarf voice editor. Plain browser JavaScript, custom CSS, and
a small Deno static server. No build step or runtime dependencies.

From the repository root:

```sh
deno run --allow-net --allow-read prototype/server.ts
```

Open http://localhost:8067/. Load Borin, Pip, or Mara to restore that voice's
original values. Edit the sliders or type exact values in the number fields.
Randomize generates a new combination of all four voice settings. Press Speak to
audition the current values. Volume also applies during playback.

These are the four settings that distinguish the original voices:

| Setting          | Borin | Pip  | Mara |
| ---------------- | ----- | ---- | ---- |
| Base pitch (Hz)  | 108   | 224  | 155  |
| Vowel resonance  | 0.82  | 1.19 | 1.02 |
| Speaking speed   | 0.94  | 1.17 | 1.02 |
| Personality seed | 31    | 83   | 59   |

The editor keeps the current setup in memory. Reloading starts with Borin.

`voice.js` builds vowel tones from sine harmonics. Smooth envelopes and a
low-pass filter soften each syllable. The voice contains no noise layer. The
audio clock controls the left-aligned syllable reveal. English syllable
boundaries use spelling heuristics, so unusual words can split approximately.
This produces fictional chatter, not intelligible English or a verified copy of
Crow Sign's implementation.

`synthesize()` accepts a voice recipe object and returns an AudioBuffer plus
syllable timestamps. All prototype code stays in this folder.
