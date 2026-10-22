# Networking

## Why the visitor hosts the world

Each visitor can start moving before a server round trip, and owns their world
in the browser
([ADR 0001](../adr/0001-browser-hosted-world-for-live-sessions.md)). The
visitor's browser owns the world state. Deno Deploy serves code and hands out
signaling credentials, so isolated server instances do not need a shared in
memory game loop. Joining tabs connect as players through WebRTC. A Xirsys
session channel carries connection signaling (see
[sessions and signaling](sessions-and-signaling.md)); it does not carry game
updates. The shell and Xirsys do not run the world.

## Snapshots and motion

The host sends recipient-specific full snapshots every 500 ms and compact
position updates about every 100 ms while entities move. Both browsers present
remote players about 150 ms behind the latest authoritative tick, interpolating
between received positions (remote player and NPC sprites interpolate recent
host positions). Full snapshots acknowledge that recipient's latest received
input sequence and correct meaningful local prediction errors; the joining tab
predicts its own position. Meaningful corrections ease back toward the host
position. The renderer does not queue old remote paths.

The reliable ordered `world` channel carries state, chat, and input. The
unordered `motion` channel has `maxRetransmits: 0` and carries independent
filtered entity records without chat or unnecessary simulation fields. Both
channels must open to complete a join. Both channels share SCTP congestion
control. When a WebRTC channel backs up, the host coalesces unsent snapshots and
skips superseded ones, then sends the newest state after the channel drains.
Movement also coalesces to the newest unsent state, and stops send a 300 ms
settling tail, with 500 ms reliable snapshots as recovery. Pending sends
coalesce to current state when each channel drains.

## Terrain reveals

A state packet carries no terrain except `reveal` (ADR 0005). For each joining
player the host keeps the remembered terrain and a pending reveal: the tiles
that entered it or changed in it since the last state packet. Sight adds a tile
when it copies one whose material differs. Mining or placing a tile the player
sees writes it and publishes a state packet at once. The host drains the pending
reveal when it builds the packet, not earlier, because the snapshot sender may
coalesce publishes and drop one.

A visible geometry change invalidates cached sight even when a snapshot already
copied the changed material into memory. The next mask advances `sightRevision`
even if the viewer stays on the same tile, fencing delayed motion from the old
view.

`reveal` maps a chunk key to a run-length chunk string (`chunk-wire.js`).
Material 0 (`UNKNOWN`) means no change, so the guest copies only the other tiles
into its own remembered terrain in `scene.world.chunks`. A packet holds at most
`MAX_REVEAL_CHUNKS` (32) chunks. The host keeps the rest pending and publishes
again, which waits for the channel to drain. Packet size follows what the player
sees and changes, not how far it has explored. The host diagnostics panel (F3)
shows each guest's remembered chunk count on its `Remembered` line.

A guest in `/master` gets every loaded chunk within `UNLOAD_RADIUS` of its
player, in full, through the same pending reveal. The host reads only chunks it
has loaded.

## Validation and versions

The wire uses validated JSON and rejects incompatible versions with a refresh
instruction. Protocol version 6 requires a matching join/offer version and adds
accepted action results to version 5's NPC flags and fixed-world bounds. Version
7 adds the entity `role` (the trader, Ulgar) and removes the shop tile list,
because the shopkeeper travels as an NPC entity. Complete snapshots are
validated before scene mutation. Motion packets carry attempt, view, and sight
revisions so delayed updates cannot restore an older view; motion is fenced by
connection attempt, view revision, sight revision, and tick. The guest retains
only the newest motion awaiting reliable sight. Older reliable state can refresh
sight without rewinding newer remote positions. A reveal in such a state still
applies, because the host drained it when it built the packet. Invalid motion is
discarded. Malformed reliable state requests a full resync, and the host then
sends the guest's whole remembered terrain again. Repeated recovery failure
closes the connection with a refresh instruction. An incomplete join attempt
expires after ten seconds, independently of player creation.

This is not rollback netcode. Input acknowledgments indicate the latest received
direction, not completed movement. Input replay remains deferred. WebRTC uses
direct connectivity when ICE can establish it; Xirsys TURN credentials supply a
relay when needed.

## Rejoin

Each joining tab keeps a session token while its tab exists and automatically
rejoins after a connection drop: if its WebRTC connection drops, it sends a
fresh join request. The host holds its sprite for at most five seconds and
preserves its name, tile, view mode, discovered terrain, and entity terrain
memory for a later rejoin while the host world remains open. Ping activity also
expires a silent connection.

A new attempt, a change of view mode, and a `resync` request make the guest
receive every tile the host holds for that view again, in batches of
`MAX_REVEAL_CHUNKS`. A new attempt or view mode clears the guest's terrain copy.
A `resync` fills the existing copy. There is no terrain baseline identifier,
terrain revision, or completion marker for a multi-packet resend. Recovery
detects malformed state and motion waiting too long for sight, but cannot detect
a well-formed packet that omits a required terrain reveal.

## Wire format

Both channels send JSON strings, capped at 256 KiB of UTF-8 before decoding. The
join and offer carry `version`. State, motion, and chat carry `attempt`,
`viewRevision`, and `sightRevision`. Revisions, ticks, and input sequences are
nonnegative safe integers. Coordinates `x` and `y` retain JavaScript number
precision without quantization. Player `z` is an integer level. Decoders bound
coordinates and validate entity records before accepting a packet.

A state holds `world` (tick, explicit player fields, including NPC flag and
role, and optional fixed-world bounds), `reveal`, `visibility`, `mode`,
`playerId`, `chat`, and `acknowledgedSequence`. Motion holds `tick`, explicit
player records, and `acknowledgedSequence`. Chat has its own reliable packet
with a tick and chat records. Control commands have separate schemas in
`control-wire.js`.

Each reveal chunk is a base64 string of byte pairs: material, then run length
minus one (1–256 cells per run). Decoding must fill exactly 2,048 cells, ordered
by `z`, local `y`, then local `x` (fastest). Material 0 means no change.
Visibility uses `bitset-v2`: base64 bytes per chunk for levels -1 through 8,
ordered by level, local `y`, then local `x`. Bit 0 is the least significant bit
of each byte. These byte encodings have no multibyte endianness convention.
Visibility sends the complete visible mask. Terrain supplies remembered tiles,
so the wire does not send a separate memory mask.

The wire types and validation live in `wire.js`, `wire-parse.js`,
`chunk-wire.js`, `visibility-wire.js`, and `action-wire.js`. Base64 fields
inside JSON do not constitute a binary transport. A matched binary format
comparison remains deferred under the
[protocol design](../multiplayer-protocol-design.md).

Successful guest pickup, place, and sell actions receive
`{type:"action-result",attempt,action,x,y,z}` on the reliable channel.
Coordinates are integer tiles. Pickup and place identify the target, and sell
identifies the seller's tile. The guest accepts only its current attempt and one
of these three actions, then plays fixed local sound tags. Refused actions send
only the existing refusal notice. A simulation result from an earlier attempt
cannot confirm an action on its replacement connection. See
[sound events](sound-events.md).

## Diagnostics

The admin panel records join time, selected ICE candidate types, and the last 32
ping round trips, and shows their median and 95th percentile (connection time,
selected ICE route, and recent round trip times). For a TURN diagnostic, open
`/host?relay=1` and join a world. That join forces relay candidates on both
browsers and shows the selected candidate types in the admin panel. A working
TURN configuration is required. Normal WebRTC joins allow a direct route.
Compare direct and relay paths on one network and again with a phone on cellular
service. Browser tests cover function and screenshots; they do not substitute
for those device measurements.

## Limits

- Joining players receive filtered state snapshots in `/entity` and can see
  brief corrections when the host rejects a predicted move. There is no clock
  synchronization, input replay, or authoritative server.
- After a cached visit, a visitor can load a single-player world offline. See
  [offline play](offline.md) for service-worker caching and connection limits.
- Visibility deltas and terrain baseline revisions remain deferred. Current
  terrain reveals already send recipient-specific changed tiles. Motion packets
  remain independent entity records.

## Background tab

A hidden tab gets no animation frames, so the world host would stop and every
guest would freeze. The shared simulation owns fixed-step work.
`stepWorld(ctx, now)` (`src/client/loop.js`) paces its ticks before each frame.
While `document.hidden`, `src/client/tick-clock.js` runs a dedicated Worker that
posts a message every `TICK_MS` (50 ms), and the main thread calls `stepWorld`
on each message. The Worker comes from an inline Blob URL, because the build's
files load from another origin and a worker script must be same-origin. If a
Worker cannot be made, the clock uses `setInterval`. The clock starts on
`visibilitychange` to hidden and stops when the tab is visible again.

A visible step spends at most 250 ms on ticks. A background step catches up at
most 2 s of missed ticks and drops the rest, so a long stall does not run
hundreds of ticks at once. Drawing, input polling, camera, and UI work stay in
the frame and do not run in the background. A guest keeps only its local
prediction ticking.
