---
status: accepted
---

# Speech chatter and the queued reveal

A speech bubble fills from left to right, one syllable at a time, while
synthesized chatter plays. The sound is vowel-like, not words, in the manner of
Animal Crossing, Celeste, and Crow Sign. Josh's voice forge prototype
(`prototype/voice.js`) makes the sound. It stays in the repository as the tool
for tuning voices later.

## Decisions

Settled in a grilling session on 2026-10-06.

**One schedule for text and sound.** `src/shared/speech.js` splits a message
into syllables and times them for a voice. It is pure: it needs only the text
and the voice, with no audio. So the world host can time a bubble, every client
can reveal it in step, and the audio plays the same schedule. A test holds the
schedule equal to the prototype's.

**Seeded voices.** Every entity speaks with `voiceFromId(id)`: pitch, vowel
resonance (formant), speed, and a seed, drawn from ranges that sound pleasant.
The same id gives the same voice on every client, so no voice data is sent.
Choosing or editing a voice waits for a later change.

**Queued speech.** A speaker says one message at a time. The world host gives
each bubble a start tick: the later of when it was sent and when the speaker's
previous message finishes speaking. It expires two seconds after its speech
ends, and never sooner than the rule in `bubbleTicks`. A queued bubble's text
does not leave the host before its start tick. Then its reveal and its sound
begin together on every client, and it enters the hearing log.

**Thought icon.** A small animated thought icon at the upper left of an entity's
head replaces today's `...` typing bubble. It shows while the player types, and
while the speaker has a queued message. Spoken bubbles stay above the head and
stack as before. The bubble is drawn at its final size, and the text fills it.

**Who hears it.** A client plays chatter for each bubble whose text it receives,
which is within chat hearing range. Your own messages play at full volume.
Another speaker's play at full volume up to two blocks away, and fall to about
30% at five. From five to twelve blocks, the talking indicator carries the
message's syllable count, never its text. The listener murmurs that many seeded
syllables at about 10% volume through a low-pass filter.

**Controls.** A Voices row in the settings page offers Off, Low, Medium, and
High, saved in `localStorage`. Medium is the default. Audio starts on the first
tap or key press, because browsers block sound until a user gesture. Chatter
stops while the tab is hidden. At most six voices play at once, the nearest
ones, and each voice's vowel tables are built once and cached. With Voices off,
text still reveals syllable by syllable.

## Wire

- A chat feed bubble gains `startTick`. A record gains `queued: true` when the
  speaker has a message that has not started.
- A talking indicator gains `syllables`, the count of spoken syllables.
- No voice field: each client derives the voice from the speaker's id.

## Consequences

Fast chat now waits: a third quick message can start some seconds after it was
sent. Bubbles of long messages last longer, because a bubble lasts for its
speech plus two seconds. A far listener learns roughly how long a message is,
but not its text. Sound costs CPU on phones; the voice limit and cached tables
bound it.
