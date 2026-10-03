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
input sequence, processed input, and correct meaningful local prediction errors;
the joining tab predicts its own position. Meaningful corrections ease back
toward the host position. The renderer does not queue old remote paths.

The reliable ordered `world` channel carries state, chat, and input. The
unordered `motion` channel has `maxRetransmits: 0` and carries independent
filtered entity records without chat or unnecessary simulation fields. Both
channels must open to complete a join. Both channels share SCTP congestion
control. When a WebRTC channel backs up, the host coalesces unsent snapshots and
skips superseded ones, then sends the newest state after the channel drains.
Movement also coalesces to the newest unsent state, and stops send a 300 ms
settling tail, with 500 ms reliable snapshots as recovery. Pending sends
coalesce to current state when each channel drains.

## Validation and versions

The wire uses validated JSON and rejects incompatible versions with a refresh
instruction. Protocol version 3 requires a matching join/offer version. Complete
snapshots are validated before scene mutation. Motion packets carry attempt,
view, and sight revisions so delayed updates cannot restore an older view;
motion is fenced by connection attempt, view revision, sight revision, and tick.
The guest retains only the newest motion awaiting reliable sight. Older reliable
state can refresh terrain and sight without rewinding newer remote positions.
Invalid motion is discarded. Malformed reliable state requests a full resync.
Repeated recovery failure closes the connection with a refresh instruction. An
incomplete join attempt expires after ten seconds, independently of player
creation.

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
- Offline caching is deferred. A visitor needs the website to load the game.
