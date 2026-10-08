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

## Shared music

[ADR 0009](../adr/0009-reach-free-cursor-and-controller.md): the world host's
player is the **conductor** and every guest plays what it plays.

- **Conductor.** `onTrackStart(listener)` marks a player as a host. It keeps
  picking tracks for the mood when its Music level is Off or the first gesture
  has not come yet: it counts each track out by the index `duration` (the next
  starts `CROSSFADE_SECONDS` before the end, as it would with audio) and
  downloads nothing. Turning Music on mid-track plays that same track from the
  offset it has reached, with no new cue; turning it Off keeps counting the
  track that was playing. With no `duration`, a track counts as 180 s. A player
  that is `enabled: false` (`?music=0`, or a test page without `music=1`) does
  not conduct.
- **Cue.** Each start calls `host.cue(track)` in `network.js`, which sends every
  guest `{type:"music", key, hash, startTick}` on the reliable `world` channel,
  and sends the current cue to a guest when it joins or rejoins.
  `decodeMusicCue` (`src/shared/wire.js`) accepts a media key (the shell's
  `/media/` rules), a 12 digit lowercase hex hash, and a whole `startTick`.
- **Guest.** The first state sets the tick clock, then `scene.followMusic` calls
  `follow(track, offsetSeconds)` with the host's position in the track at the
  presentation time (`presentation.timeOfTick`, the 150 ms delay included). The
  player stops picking, loads the track (the device cache applies) and starts it
  at the offset, crossfading from the previous one. A cue for a track the
  guest's index does not list, or one that fails to load, keeps the current
  track. A guest whose Music is Off downloads nothing; it keeps the cue and
  starts the track at its then-current offset when Music turns on (or the first
  gesture comes). `follow(null, 0)` returns to local picking.
- **Offline and single player** pick locally, as before. A tab that joins
  another world is not a conductor; until the first cue arrives it may play a
  local pick, and the cue crossfades from it.
- **F3.** The music line says `(host)` or `(cued)` after the track name.

## Testing

`globalThis.__od.music` has `state()` (status, current and next track, skipped
tracks, cache size, plus `role`, `cue` and `offset` for shared music),
`setMood`, and `setRandom` for a fixed pick. The unit tests are
`tests/client/music_test.ts` and `tests/client/music_cue_test.ts` (shared
music); `tests/e2e/music-shared.spec.ts` runs a host and a guest on the fixture
media; the e2e spec is `tests/e2e/music.spec.ts`, which plays the fixture media
(`tests/e2e/fixtures/media`: two tones and an index entry whose file is
missing).
