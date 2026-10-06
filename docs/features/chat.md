# Chat

`T` opens chat, `/` opens a command, and Escape opens the menu. The on-screen A
button opens chat with an in-game keyboard drawn at the bottom of the safe area,
so the system keyboard never opens on a phone (see
[controls and UI](controls-and-ui.md)). It holds 120 characters. A physical
keyboard types through `keydown`: letters, Backspace, Enter sends, and Escape
closes. Paste and dictation are not supported. Use `/nick Josh Hale` to set a
name. Names are unique within a world. `/master` and `/entity` switch the view
(see [sight](sight.md)).

Chat has its own recipient-specific feed: each joining tab receives chat by
distance from its character. Message text reaches a player within five
horizontal blocks and four levels; from five through twelve horizontal blocks
the feed carries only a `:0` talking indicator, and there is no bubble beyond
that range. Speech passes through walls and sight boundaries, so bubbles can be
heard outside sight without exposing the speaker's sprite or name.

## Queued speech and the reveal

A speaker says one message at a time (ADR 0006). The world host gives each
`Bubble` a `start` tick: the later of now and the end of the speaker's previous
bubble's speech (`speechDurationMs` in `src/shared/speech.js`, with the voice
from `voiceFromId`). A bubble expires two seconds after its speech ends, and
never sooner than `bubbleTicks` counted from its start. A speaker keeps at most
`MAX_BUBBLES` (3) bubbles that have started, and at most `MAX_QUEUED` (5)
waiting; a message sent to a full queue is dropped.

`chatView` sends only bubbles whose start has come, each with `startTick`. A
bubble that waits never leaves the host: not its text, and not in the talking
indicator. The record carries `queued: true` while the speaker has one waiting.
A talking indicator carries `syllables`, the syllable count of the message the
speaker is speaking now. `receiveChat` turns `startTick` into a local `startAt`
the way it makes `expiresAt` from `expiresTick`; the host runs its own feed
through `receiveChat` too, so every client times a bubble the same way. The
local echo in `render.js` follows the same rules.

The renderer draws each bubble at its final size and shows
`text.slice(0, revealedLength(schedule, text, now - startAt))`. It builds each
bubble's speech schedule once and caches it.

The thought icon replaces the old `...` bubble. While a player types, or while
the speaker has a queued message, a small white speech bubble with a dark
outline, three rising dots and a short tail appears beside the upper left of the
head, within five blocks.

The hearing log keeps each message text it receives once, and a message enters
it when its bubble starts, so unheard and waiting messages never enter it. The
world host adds join, leave, and name change system lines to its own log and
sends them to guests as `system` packets on the reliable channel. Chat uses the
reliable `world` channel with snapshots and player input (see
[networking](networking.md)).
