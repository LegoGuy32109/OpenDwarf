# Music

Background music plays from the `opendwarf` bucket and stays on the player's
device, as [ADR 0007](../adr/0007-media-from-r2-and-offline-play.md) describes.
It is client only: `src/client/music.js` has the player and the shell has no
part in it beyond the media route.

## Index and mood

The player reads `build.mediaUrl("index/music.v1.json")` with
`cache: "no-cache"` and keeps the last good copy in the Cache Storage cache
`od-media`, so it still starts offline. An entry without a `key`, a `hash`, and
tags is ignored, and so is any field the client does not know.

A **mood** is a list of tags. `setMood(tags)` is the API; the game sets one mood
for now, `GAME_MOOD` (`adventure`, `soft`, `forest`). A track matches when it
shares at least one tag. The player picks at random among matching tracks and
never repeats one of the last five played. When fewer tracks match than that,
the window shrinks until one is left, so a small index still plays. A new mood
crossfades a playing track that no longer fits into one that does.

## Playing

Each track plays through an `HTMLAudioElement` (a blob URL) into a
`MediaElementAudioSourceNode` and a `GainNode`, because iOS ignores
`audio.volume`. A master gain sets the volume, and per-track gains do a 3 s
crossfade. The next track is picked and downloaded as soon as the current one
starts, and it starts 3 s before the current one ends.

Nothing plays until the first `pointerdown` or `keydown`. `unlock` (called next
to chatter's) creates or resumes the `AudioContext` and reuses chatter's
`useMediaSession`, which lets audio play with the iPhone silent switch on. The
audio suspends while the tab is hidden.

A track that fails to download or decode is skipped for the current mood. After
three failures in a row the player stops quietly until the next `setMood`.

## Device cache

Each track is stored in `od-media`, keyed by the full
`build.mediaUrl(key, hash)` (the `?v=` hash makes a changed file a new URL). A
cached track plays with no network request. The player keeps at most 150 MB of
music and, after a download, evicts the least recently played tracks first. Play
times and sizes are in `localStorage` under `open-dwarf-music-plays`; at start
the player matches that record to what the cache really holds. It asks
`navigator.storage.persist()` once.

## Settings

The settings page has a Music row: Off, 25, 50, 75, 100, saved in `localStorage`
under `open-dwarf-music`. 50 is the default. Off stops the music and downloads
nothing. `?music=0` turns music off. With `?harness=1` music is off unless
`music=1`, so other specs stay silent and fast.

The F3 panel has a line with the current track, the mood, and the number and
size of the cached tracks.

## Testing

`globalThis.__od.music` has `state()` (status, current and next track, skipped
tracks, cache size), `setMood`, and `setRandom` for a fixed pick. The unit tests
are `tests/client/music_test.ts`; the e2e spec is `tests/e2e/music.spec.ts`,
which plays the fixture media (`tests/e2e/fixtures/media`: two tones and an
index entry whose file is missing).
