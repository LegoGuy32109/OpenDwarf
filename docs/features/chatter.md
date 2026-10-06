# Chatter

A speech bubble plays synthesized chatter as it reveals, in the speaker's seeded
voice ([ADR 0006](../adr/0006-speech-chatter-and-queued-reveal.md)). The sound
is vowel-like, not words. `src/shared/speech.js` times it and
`prototype/voice.js` stays the tool for tuning voices.

## Synth

`src/client/voice.js` turns a `speechSchedule(text, voice)` into samples, one
phrase per spoken syllable, so the sound stays in step with the reveal. A
voice's five vowel tables are built once and cached by pitch, formant, and
sample rate.

## Player

`src/client/chatter.js` runs each frame from `src/client/loop.js`, next to
`hearChat`, and reads `scene.chatFeed`. It plays each bubble once:

- When a bubble's `startAt` (a local `performance.now()` time) arrives, its
  chatter starts at the matching offset. A bubble that started longer ago than
  its speech lasts is skipped. A bubble with no `startAt` starts when it first
  appears.
- Your own bubbles play at full volume. Another speaker's play at full volume to
  2 blocks and fall to 30% at 5, measured as `chatBand` measures distance.
- A record with `talking` and `syllables` plays a **murmur**: that many "ba"
  syllables in the speaker's voice, at 10% volume through a 600 Hz low-pass
  filter.
- At most 6 voices play at once. The nearest are kept.
- The `AudioContext` is created or resumed on the first `pointerdown` or
  `keydown`. Until then, and while `document.hidden`, chatter is skipped and
  stopped.

## Voices setting

The settings page has a Voices row: Off, Low, Medium, and High, built like the
text-size row and saved in `localStorage` under `open-dwarf-voices`. Medium is
the default. Off plays nothing; the text still reveals. The setting scales the
volume (Low 35%, Medium 70%, High 100%) on top of the distance gain.

## Testing

`globalThis.__od.chatter.log` lists the chatter that started: `speaker`,
`length` (text length), `syllables` (for a murmur), `gain` (distance gain),
`volume` (gain times the Voices setting), and `murmur`. Unit tests in
`tests/client/voice_test.ts` use a fake audio context; the e2e spec is
`tests/e2e/chatter.spec.ts`.
