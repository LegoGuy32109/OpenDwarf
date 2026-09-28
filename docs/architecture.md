# Client first demo

## What this branch keeps

The WebGL experiment gives the demo its floor texture, 16×16 dwarf sprite,
camera motion, movement rules, line of sight, edge and ceiling atlases, and
depth tint. The engine page gives it the VGA bitmap font and the Escape menu
structure: Open Dwarf, Resume, Settings, Leave Game, and UI Scale. The current
demo draws these with one small WebGL2 renderer. The older Rust engine stays on
`webgl-version`.

The default authored world is one 16×16 tile square across z levels 0–7.
`?world=32` starts an expanded 32×32 authored area with four fixed 16×16 chunks
and the same eight levels. The expanded area includes a second pillar. All
chunks load at join; there is no distance-based loading. Unknown XY coordinates
are solid stone at every level. A seven-step staircase on the south edge reaches
the top landing; a full-height pillar tests occlusion. The view can show five
lower levels, with deeper floors turning blue before they disappear. There is no
world generation, chunk loading, persistence, or inventory. Players and the
corner NPC block each other's destination tiles. A move has whole tile origin
and target coordinates, plus a start tick and duration. The renderer
interpolates the sprite between those tiles. The world reports origin and target
occupancy during a move.

`/entity` uses a 20-tile, three-axis field of view. Terrain leaving view is
remembered with a warm tint; unseen terrain is black. Entities fade between 25%
and 75% of a move into or out of visible tiles and do not leave ghosts in
memory. `/master` shows the full world and permits camera panning while keeping
at least one full row and column of the authored square visible. The browser
host computes each joining player's sight and sends only currently visible
entities and discovered terrain in `/entity`. Terrain remembered from earlier
sight keeps its last observed state. `/master` requests a full snapshot from the
host; any player can use it. Returning to `/entity` drops master-only data and
adds only tiles in the player's current sight to entity memory. Master travel
does not reveal the path in entity memory. These commands grant no movement or
world-editing powers. The host browser still owns the full world, so this is a
view protocol, not a security boundary. Same-level rays check every grid cell
touched at a corner, making sight reciprocal between stationary positions.
Different-height sight retains the earlier ray rule. When an entity crosses a
same-level sight boundary, the host sends a short visual path inside the visible
tile. The guest animates position and opacity without receiving the hidden
movement endpoint. Visibility and memory use fixed-size bit masks in network
snapshots. The host skips superseded snapshots while a guest's data channel is
backed up, then sends the current state when that channel drains. R/V changes
view level, holding U/N lerps zoom, and touch offers pinch zoom and two-finger
vertical drag for view levels. A brief bitmap HUD shows both values during
changes.

## Why the visitor hosts the world

Each visitor can start moving before a server round trip. The visitor's browser
owns the world state. Deno Deploy serves code and relays small signaling
messages through KV, so isolated server instances do not need a shared in memory
game loop. The admin route lists recent visitor heartbeats and joins through a
WebRTC data channel. HTTP POST and SSE carry connection signaling; they do not
carry game updates. The host displays a session-specific QR code for
`/join/<session>`. The Deno server generates its SVG with one server-side
dependency; guest browser code still has no build step.

The browser host applies each joining player's move intents in sequence order
and sends a recipient-specific snapshot every 500 ms, and sooner when that
recipient crosses a sight tile. Joining players predict movement locally. Each
snapshot acknowledges that recipient's latest processed input. The joining
player keeps an unacknowledged or matching local animation, maps the host's
animation onto its own tick, and eases the sprite after a real correction. This
avoids resetting the local animation every half second. Each browser presents
remote player and NPC moves near their latest authoritative position, smoothing
short visual corrections. The host applies movement to the world as soon as an
intent arrives. If a straight-line intent arrives just before the host finishes
its current tile, the host queues it for the next tick. The game engine runs at
20 ticks per second and renders between ticks. The renderer does not queue old
remote paths when updates arrive close together. It is not rollback netcode.
WebRTC uses direct connectivity when ICE can establish it; Xirsys TURN
credentials supply a relay when needed. The signaling route uses Deno KV as a
mailbox.

Each joining tab keeps a session token while its tab exists. If its WebRTC
connection drops, it sends a fresh join request. The host keeps its sprite for
at most five seconds and preserves its name, tile, view mode, and entity terrain
memory for a later rejoin while the host world remains open. Ping activity also
expires a silent connection. The corner NPC follows an E, S, W, N loop and
pauses one second after every two loops. It uses the same move rules as players.

The admin panel records join time, selected ICE candidate types, and the last 32
ping round trips. It shows their median and 95th percentile. `/admin?relay=1`
forces a TURN relay for a WebRTC diagnostic. Compare direct and relay paths on
one network and again with a phone on cellular service. Browser tests cover
function and screenshots; they do not substitute for those device measurements.
An opt-in `/phone-test` route accepts a small set of scripted commands through
Deno KV. Its random code expires 30 minutes after the phone stops polling.

## Current limits

- `/admin` and its APIs have no authentication. Anyone who knows the route can
  list and join active worlds in this stage.
- A world has one browser host and currently has no fixed joining cap. Host
  upload and browser performance set the practical limit. It ends when the host
  closes the page. A missed close signal leaves presence until the 30 second TTL
  ends.
- The KV mailbox is bounded to 32 recent signals. It suits this small demo, but
  it is not a general game message bus.
- Joining players receive filtered state snapshots in `/entity` and can see
  brief corrections when the host rejects a predicted move. There is no clock
  synchronization, input replay, or authoritative server.
- Terrain memory and view mode live in the browser host; closing that world
  discards them. Guest packet filtering is not an anti-cheat boundary.
- Offline caching is deferred. A visitor needs the website to load the game.

## Next experiment

Test a direct join and forced relay from `/phone-test` on a phone, with a
desktop hosting the world. Repeat on Wi-Fi and cellular. Record the candidate
route, join time, median RTT, 95th percentile RTT, and whether a move visibly
snaps after correction. Use the same devices and world for each path. That
evidence can guide TURN configuration and future server-owned world experiments.
