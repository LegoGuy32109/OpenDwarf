# Sound events

The world host records what makes a sound, and each listener hears the sound
events in range ([ADR 0008](../adr/0008-sound-effects-from-samples.md)). The
effects player (`src/client/sfx.js`) turns a played event into audio; this file
covers who hears what and when.

## Recording

`src/shared/sound.js` holds the rules. The host records a **sound event**,
`{tags, x, y, z, tick, source}`, with `recordSound`, and `drainSounds` takes the
events recorded since the last drain once per host tick.

| Event      | Tags                                    | Recorded by                                             |
| ---------- | --------------------------------------- | ------------------------------------------------------- |
| Step       | `step`, `walk` or `run`, floor material | `recordSteps`, every `STEP_DISTANCE` (0.5) tiles walked |
| Mining hit | `mine`, `hit`, material                 | `stepMining`, when an action starts, then every 500 ms  |
| Break      | `mine`, `break`, material               | `completeMining`, at the tile                           |
| Place      | `place`, `stone`                        | `placeStone`, when it succeeds                          |
| Pickup     | `pickup`                                | `pickUp`, when it succeeds, at the tile                 |

- Steps come from the **step accumulator**: `stepsTaken(tracker, x, y)` adds the
  horizontal distance since its last call and returns the whole steps that
  completes. A jump over 2 tiles only sets the new start. An entity that is not
  walking (no tile move and almost no speed) makes none, so a correction that
  snaps a standing entity is silent. Every entity in `world.players` steps,
  including the corner NPC. The host and each client use this one rule.
- The floor material is the name from `materials.js` of the tile under the
  entity. Air or unknown adds no material tag, so the sound falls back to the
  general step samples.
- `run` is for an entity that is sprinting. The host knows each guest's stamina,
  and its own through `startHost`'s `running` option.
- Events wait in a store per world, at most 256 if nobody drains them.

## Hearing

`soundsFor(world, events, listenerId, sees)` returns the events a listener
hears: within `SOUND_RANGE` (12) tiles horizontally and `SOUND_Z_LIMIT` (4)
levels, and not the listener's own. `seen` comes from `sees`. The host passes
the listener's current sight: `sourceTile` names the tile it checks, which is
the tile of a break or a place, and otherwise the tile the source entity stands
on (a master view guest sees everything). At most `MAX_SOUND_ENTRIES` (64) go in
one message; the newest are kept.

## Network

After each host tick, a guest with events in range gets
`{type:"sounds", list:[{tags, x, y, z, tick, seen}]}` on the reliable `world`
channel. `decodeSounds` in `wire.js` rejects a list over the limit, an event
with no tags, more than `MAX_SOUND_TAGS` (4) tags, a tag that is not a short
string, a coordinate out of bounds or not a number, a tick that is not a safe
integer, and a `seen` that is not a boolean. The host's own player hears through
the same `soundsFor`, handed to `scene.hearSounds`.

## Client

`src/client/sound-events.js` (`ctx.sounds`):

- `hear(list)` plays each heard event with
  `ctx.sfx.play(tags, {x, y, z, muffled:
  !seen, at})`. `at` is the tick's
  presentation time from `scene.presentation.timeOfTick(tick)`, the same 150 ms
  behind as remote sprites. An event more than 500 ms (`LATE_MS`) after its time
  is dropped. With no clock yet, it plays at once.
- Your own sounds play at once, without a position, and are logged `own`: steps
  from your predicted motion (`ownSteps`, once per world tick in `loop.js`),
  mining hits and the break from your own mining progress (`frame`, from
  `scene.mining`; a break plays when the progress reached 90% and the action
  then ended), and place and pickup when you send the request (a guest), or when
  the host's rule accepts it (the host's player).
- `frame` also calls `ctx.sfx.setListener` with the local entity's position
  every frame.

The host never plays its own recorded events back to itself, and a guest never
hears its own: `soundsFor` leaves them out.

## Test harness

`globalThis.__od.sounds` logs the events this client chose to play, as
`{tags,
x, y, z, muffled, own}`, so specs work while the player is silent (a
harness page has effects off).
