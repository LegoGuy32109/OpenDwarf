# Client first demo

## What this branch keeps

The WebGL experiment gives the demo its floor texture, 16×16 dwarf sprite,
camera motion, movement rules, line of sight, edge and ceiling atlases, and
depth tint. The engine page gives it the VGA bitmap font and the Escape menu
structure: Open Dwarf, Resume, Settings, Leave Game, and UI Scale. The current
demo draws these with one small WebGL2 renderer. The older Rust engine stays
on `webgl-version`.

The authored world is one 16×16 tile square across z levels 0–7. Unknown XY
coordinates are solid stone at every level. A seven-step staircase on the
south edge reaches the top landing; a full-height pillar tests occlusion.
The view can show five lower levels, with deeper floors turning blue before
they disappear. There is no world generation, chunk loading, persistence,
inventory, or collision rule between players. A move has whole tile origin
and target coordinates, plus a start tick and duration. The renderer
interpolates the sprite between those tiles. The world reports origin and
target occupancy during a move.

`/entity` uses a 20-tile, three-axis field of view. Terrain leaving view is
remembered with a warm tint; unseen terrain is black. Entities fade between
25% and 75% of a move into or out of visible tiles and do not leave ghosts in
memory. `/master` shows the full world and permits camera panning while
keeping at least one full row and column of the authored square visible.
These view commands change only the local client. R/V changes view level,
holding U/N lerps zoom, and touch offers pinch zoom and two-finger vertical
drag for view levels. A brief bitmap HUD shows both values during changes.

## Why the visitor hosts the world

Each visitor can start moving before a server round trip. The visitor's browser
owns the world state. Deno Deploy serves code and relays small signaling
messages through KV, so isolated server instances do not need a shared in
memory game loop. The admin route lists recent visitor heartbeats and joins
through a WebRTC data channel. HTTP POST and SSE carry connection signaling;
they do not carry game updates.

The browser host applies admin move intents in sequence order and sends a
world snapshot every 500 ms. The admin predicts movement locally. Snapshots
acknowledge the latest processed input: the admin keeps an unacknowledged or
matching local animation, maps the host's animation onto its own tick, and
eases the sprite after a real correction. This avoids resetting the local
animation every half second. If a straight-line intent arrives just before
the host finishes its current tile, the host queues it for the next tick.
It is not rollback netcode. WebRTC uses direct
connectivity when ICE can establish it; Xirsys TURN credentials supply a relay
when needed. The signaling route uses Deno KV as a mailbox.

The admin panel records join time, selected ICE candidate types, and the last
32 ping round trips. It shows their median and 95th percentile. `/admin?relay=1`
forces a TURN relay for a WebRTC diagnostic. Compare direct and relay paths on
one network and again with a phone on cellular service. Browser tests cover
function and screenshots; they do not substitute for those device measurements.

## Current limits

- `/admin` and its APIs have no authentication. Anyone who knows the route can
  list and join active worlds in this stage.
- A world has one visitor and one admin. It ends when the visitor closes the
  page. A missed close signal leaves presence until the 30 second TTL ends.
- The KV mailbox is bounded to 32 recent signals. It suits this small demo,
  but it is not a general game message bus.
- The admin receives state snapshots and can see brief corrections when the
  host rejects a predicted move. There is no clock synchronization, input
  replay, or authoritative server.
- Offline caching is deferred. A visitor needs the website to load the game.

## Next experiment

Test a direct join and `/admin?relay=1` from a desktop on the same network,
then from a phone on cellular service. Record the selected candidate route,
join time, median RTT, 95th percentile RTT, and whether a move visibly snaps
after correction. Use the same devices and world for each path. That evidence
can guide TURN configuration and future server-owned world experiments.
