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
world generation, chunk loading, persistence, or inventory. Players and the corner NPC use continuous x/y centers and half-tile square
footprints. They stop between tiles, slide along flat walls, and block one
another when footprints overlap. A one-level climb or descent is a short
committed step with reserved origin and landing footprints. The renderer
interpolates elevation during the step. See [movement design](movement-design.md).

`/entity` uses a 20-tile, three-axis field of view. Terrain leaving view is
remembered with a warm tint; unseen terrain is black. Remote entities fade by
their center's distance to the closest visible edge, and the fade persists
when they stop. A sight change blends over 150 ms; the guest can briefly retain
the last visible sprite position while it fades out. `/master` shows the full world and permits camera panning while keeping
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
Different-height sight retains the earlier ray rule. The host sends only entities whose center tile is visible. Chat has its own recipient-specific feed:
message text reaches a player within five horizontal blocks and four levels;
from five to twelve horizontal blocks the feed carries only a `:0` talking
indicator. Typing shows `...` only within five blocks. Bubbles can be heard
through walls and outside sight without exposing the speaker's sprite or name.
Visibility and memory use fixed-size bit masks in network
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

The browser host applies each joining player's eight-direction input on its
20 Hz simulation tick. The joining browser predicts its own movement immediately.
The host sends recipient-specific full snapshots every 500 ms and compact
position updates about every 100 ms while entities move. Both browsers present
remote players about 150 ms behind the latest authoritative tick, interpolating
between received positions. Full snapshots acknowledge processed input and
correct meaningful local prediction errors. The renderer does not queue old
remote paths. This is not rollback netcode.
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
