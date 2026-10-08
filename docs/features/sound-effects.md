# Sound effects

Sound effects are recorded samples tagged in an index, as
[ADR 0008](../adr/0008-sound-effects-from-samples.md) describes. This file
covers the client player, `src/client/sfx.js`. The shell has no part in it
beyond the media route.

## Index and samples

`start()` reads `build.mediaUrl("index/sfx.v1.json")` with `cache: "no-cache"`
and keeps the last good copy in the Cache Storage cache `od-media`, so it still
starts offline. `parseSfxIndex` ignores an entry without a `key`, a `hash` and
tags, and any field it does not know.

The player downloads every sample, four at a time, into `od-media` under
`build.mediaUrl(key, hash)`. Nothing is evicted. A sample already in the cache
is not downloaded again. Once the `AudioContext` exists, each sample is decoded
into an `AudioBuffer`, so a play never waits on the network. A sample that fails
to download or decode is skipped.

## Picking and playing

`play(tags, options)` takes a tag list from general to specific. `matchSamples`
keeps the samples that hold every tag; with none, it drops the last tag and
tries again, down to the first tag alone. The pick is random among the matches
and never repeats the sample last played for the same tag list.

Each play sets a random `playbackRate` (`STEP_RATE` when the first tag is
`step`, else `SOUND_RATE`) and a random gain in `SOUND_GAIN`.

- **Distance.** With `x` and `y`, the gain is full to `FULL_GAIN_TILES` and
  falls linearly to silence at `SOUND_RANGE` from the position set with
  `setListener`, measured horizontally. Without a position the sound plays at
  full distance gain.
- **Muffled.** `muffled` adds a `MUFFLE_HZ` low-pass filter and `MUFFLE_GAIN`.
- **Timing.** `at` is a local `performance.now()` time to start. A play more
  than `LATE_MS` past `at` is dropped.
- **Cap.** At most `MAX_SOUNDS` play at once. A new sound replaces the quietest
  playing one, or is dropped when it is quieter than all of them.

The player has its own `AudioContext`. `unlock()` runs on the first
`pointerdown` or `keydown`, beside chatter and music, and the context suspends
while the tab is hidden.

## Setting

The settings page has an Effects row: Off, 25, 50, 75, 100. 75 is the default.
The choice is saved in `localStorage` under `open-dwarf-effects`. Off plays and
downloads nothing. `?sfx=0` turns effects off, and with `?harness=1` they are
off unless `sfx=1`.

## Local sounds

The panels play `["ui", "open"]` when the bag, the shop or the pickup grid
opens, and `["ui", "click"]` when their selection moves
(`src/client/ui-sounds.js`, checked each frame). `["sell"]` plays when your sale
succeeds. A guest hears it when it sends the sale, because the host answers a
refusal and nothing else. These sounds are never sound events.

## Diagnostics and harness

F3 shows one line: `Effects <loaded>/<total> samples  <n> playing`. With
`?harness=1`, `globalThis.__od.sfx` has `state()`, `log` (each play's `tags`,
`key`, `rate`, `gain` and `muffled`), and `setRandom(source)` for a fixed pick.
