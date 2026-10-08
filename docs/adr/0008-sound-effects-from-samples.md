---
status: accepted
---

# Sound effects from samples

The world is silent apart from music and chatter. Walking, mining, placing and
picking up should make sounds, and a sound should vary each time it plays so a
repeated footstep does not sound mechanical. Josh supplies the samples as `.ogg`
files from Minecraft mods and resource packs he plays with (not from Minecraft
itself), so the game plays recorded samples rather than synthesizing them.

## Decisions

Settled with Josh on 2026-10-08.

**Samples are media.** Sound effect samples live in the bucket under `sfx/`, as
64 kbps Opus `.ogg`, like music
([ADR 0007](0007-media-from-r2-and-offline-play.md)).
`deno task media convert
<folder> --to sfx/<group>` converts them. A new sample,
or a retagged one, needs an upload and no client change. Samples are tested
locally from `media/sfx/` before they go to the bucket.

**Index.** `index/sfx.v1.json` is a flat list of samples, each with a key, a
hash, tags and an optional note. The note names where the sample came from.
Pitch and volume variation live in the client, not the index.

```json
{
  "version": 1,
  "samples": [
    {
      "key": "sfx/step-stone-walk/step-stone-walk-01.ogg",
      "hash": "1f2e3d4c5b6a",
      "tags": ["step", "walk", "stone"],
      "note": "Dynamic Surroundings resource pack"
    }
  ]
}
```

**Picking a sample.** The game asks for a sound with a tag list from general to
specific, such as `["step", "run", "iron ore"]`. A sample matches when it has
every tag. With no match, the last tag is dropped and the search repeats, down
to the first tag alone; with none left, nothing plays. Among the matches the
pick is random and never repeats the sample last played for the same request. So
a few general samples cover every case now, and specific ones can be added later
with no code change.

**Variation.** Each play sets a random `playbackRate`, which changes pitch and
speed together: 0.85 to 1.15 for steps, 0.9 to 1.1 for every other sound. Each
play also scales its gain by a random 0.8 to 1.0.

**Sound events.** A **sound event** is one sound in the world:
`{tags, x, y, z, tick, source}`, where `source` is the entity that made it. The
world host records them:

| Event      | Tags                                    | When                                                         |
| ---------- | --------------------------------------- | ------------------------------------------------------------ |
| Step       | `step`, `walk` or `run`, floor material | every 0.5 tiles an entity travels; `run` while sprinting     |
| Mining hit | `mine`, `hit`, material                 | when a mining action starts, then every 500 ms until it ends |
| Break      | `mine`, `break`, material               | when `completeMining` turns the tile to air                  |
| Place      | `place`, `stone`                        | when `placeStone` succeeds                                   |
| Pickup     | `pickup`                                | when a pickup succeeds                                       |

Material tags use the material's name from `materials.js`, such as `iron ore`.

**Who hears.** Sound ignores sight, as chat already does. A listener hears every
sound event within 12 tiles horizontally and 4 levels, seen or not. The host
sends each guest the events in its range, except its own, on the reliable
`world` channel as `{type:"sounds", list:[{tags, x, y, z, tick, seen}]}`. `seen`
says whether the listener can see the source entity, or the tile for a break or
a place. The host's own player hears through the same filter. Hearing sound
through rock is a deliberate exception to the sight boundary, like chat; the
host's packets are not an anti-cheat boundary anyway.

**Your own sounds.** A client never waits for the host to hear itself. It plays
its own steps from its predicted motion, its own mining hits and break from its
own mining progress, and its own place and pickup when it sends the request.
Selling (`sell`) and UI sounds (`ui`, `open` for a panel opening; `ui`, `click`
for a selection moving) are local only and never sound events.

**Timing and distance.** The client plays another entity's event at that tick's
presentation time, 150 ms behind the host like remote sprites, so a step lines
up with the walk. An event more than 500 ms late is dropped. Gain is full to 2
tiles and falls linearly to silence at 12. An event that is not `seen` plays
**muffled**: through a 600 Hz low-pass filter, at 60% gain.

**Player.** `src/client/sfx.js` has its own `AudioContext`, unlocked on the
first `pointerdown` or `keydown` beside chatter and music. At start it fetches
the index fresh, downloads every sample into the `od-media` cache (no eviction:
the samples are small) and decodes each into an `AudioBuffer`, so a play never
waits on the network. At most 16 sounds play at once; a new sound replaces the
quietest. A sample that fails to load is skipped.

**Setting.** The settings page has an Effects row: Off, 25, 50, 75, 100, saved
in `localStorage` under `open-dwarf-effects`. 75 is the default. Off plays
nothing and downloads nothing. `?sfx=0` turns effects off. With `?harness=1`
effects are off unless `sfx=1`.

## Consequences

- The samples come from mods and resource packs with mixed licenses, some All
  Rights Reserved, and the bucket and repo are public. Josh accepted that risk
  for a casual project. Each sample's `note` records its source, so the samples
  can be found and replaced later.
- A guest hears hidden entities, which tells it roughly where they are.
- Sound events add reliable messages. Steps are the most frequent: 2 per second
  per walking entity, 4 while sprinting, sent only to listeners in range.
- Material-specific steps, hits and breaks need only new tagged samples.
