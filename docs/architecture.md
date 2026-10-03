# Client first demo

## What this branch keeps

The WebGL experiment gives the demo its floor texture, 16×16 dwarf sprite,
camera motion, movement rules, line of sight, edge and ceiling atlases, and
depth tint. The engine page gives it the VGA bitmap font and the Escape menu
structure: Open Dwarf, Resume, Settings, Leave Game, and UI Scale. The current
demo draws these with one small WebGL2 renderer. The older Rust engine stays on
`webgl-version`.

A normal page starts the spawn room (`src/shared/spawn-room.js`): a 9×7 room
at z 4 in the 2×2 spawn chunks, one doorway in its south wall that opens into
solid stone, two stair tiles down to a tunnel at z 2, and a reserved shopkeeper
tile. Everything else is solid stone. The host and every joining player spawn
inside the room, and the corner NPC walks a square in its south west corner.
`?layout=test` loads the older layout below. A page with `?harness=1` uses that
test layout unless it adds `?layout=room`, so the motion and sight specs keep
their pillar and staircase.

The test layout is one 16×16 tile square across z levels 0–7.
`?world=32` starts an expanded 32×32 authored area with four fixed 16×16 chunks
and the same eight levels. The expanded area includes a second pillar.
Terrain is stored per 16×16 chunk in a map keyed by chunk coordinates, which can
be negative ([ADR 0003](adr/0003-chunked-terrain-generated-on-demand.md)).
`src/shared/terrain.js` is the API: `readTile` and `writeTile` for one material
at x, y, z; `world.generateChunk`, a hook `ensureChunk` calls to create a missing
chunk (the generator plugs into it); and `drainTileChanges`, which lists the
tiles written since the last call so the host can send them to peers. A tile in
a chunk that does not exist reads as solid stone. Materials and their stable ids
live in `src/shared/materials.js`: air, stone, then coal, iron ore, gold ore,
lapis, redstone, diamond, and emerald. Every material except air is solid. The
chunk wire accepts ids up to `MAX_MATERIAL`, and the renderer draws an ore from
`public/assets/ores.png`. A test row of each ore sits in the authored area.
The world host creates generated terrain from the session seed in
`src/shared/generation.js`: every chunk within one chunk of any player is
created, at most two per 50 ms tick, nearest first, and an existing chunk,
including the authored area, is never replaced. A chunk is solid stone with
noise caves that continue across chunk borders, and ore clusters by depth band:
coal and iron at z 5–7, gold, lapis, redstone and some iron at z 2–4, and
diamond and emerald at z 0–1. A chunk takes well under one millisecond to
generate. `?seed=` replays a world for tests. Joining players never generate;
they receive generated terrain only for tiles they see. A seven-step staircase on the south edge reaches
the top landing; a full-height pillar tests occlusion. The view can show five
lower levels, with deeper floors turning blue before they disappear. There is no
chunk unloading, persistence, or inventory. Players and the corner NPC use continuous x/y centers and half-tile square
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
The hearing log keeps each message text it receives once, so unheard messages
never enter it. The world host adds join, leave, and name change system lines
to its own log and sends them to guests as `system` packets on the reliable
channel. Visibility and memory use one bit mask per chunk in network snapshots, and
terrain travels as run-length encoded chunks. A joining player receives only the
chunks that hold a tile it has seen. The host skips superseded snapshots while a guest's data channel is
backed up, then sends the current state when that channel drains. R/V changes
view level, holding U/N lerps zoom, and touch offers pinch zoom and two-finger
vertical drag for view levels. A brief bitmap HUD shows both values during
changes.

## Mining

Interact starts a mining action in `src/shared/mining.js`. A guest sends only the
tile it aimed at (`mine`, or `mine-cancel`); the world host checks that the tile
lies on the entity's level next to its center tile, holds a mineable material
(the table in `materials.js` gives each material's time), and that the entity
holds a pickaxe. The target locks at the start. Each host tick `stepMining`
cancels an action whose target left reach, whose held item changed, or whose
tile changed, and finishes the ones that are done. `completeMining` is the one
place a finished action is handled: it writes air with `writeTile`, and #17 adds
the dropped item there. The host sends the tiles `drainTileChanges` returns to
each peer as a small `terrain` message, only for tiles that peer sees now, and
updates that peer's remembered terrain for them; a tile out of sight keeps its
last observed state until seen again. A `mining` message lists the actions a
peer can see (and its own), with elapsed and total time, so a peer draws the
breaking decal on other players' tiles and the miner draws a growing square.
Clients cancel when the aim changes by sending `mine-cancel`.

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
remote paths. The reliable ordered `world` channel carries state, chat, and input. The
unordered `motion` channel has `maxRetransmits: 0` and carries independent
filtered entity records without chat or unnecessary simulation fields. Both
channels share SCTP congestion control. Pending sends coalesce to current
state when each channel drains. Stops send a 300 ms settling tail, with 500 ms
reliable snapshots as recovery.

Protocol version 3 requires a matching join/offer version. Complete snapshots
are validated before scene mutation. Motion is fenced by connection attempt,
view revision, sight revision, and tick. The guest retains only the newest
motion awaiting reliable sight. Older reliable state can refresh terrain and
sight without rewinding newer remote positions. Invalid motion is discarded.
Malformed reliable state requests a full resync. Repeated recovery failure
closes the connection with a refresh instruction. Incomplete attempts expire
after ten seconds independently of player creation.

This is not rollback netcode. Input acknowledgments indicate the latest
received direction, not completed movement. Input replay remains deferred.
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
