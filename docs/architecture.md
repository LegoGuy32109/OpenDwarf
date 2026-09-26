# Client first demo

## What this branch keeps

The WebGL experiment gives the demo its floor texture, 16×16 dwarf sprite,
camera motion, and movement feel. The engine page gives it the VGA bitmap font
and the Escape menu structure: Open Dwarf, Resume, Settings, Leave Game, and
UI Scale. The current demo draws these with one small WebGL2 renderer. The
older Rust engine stays on `webgl-version`.

The world is one fixed 16×16 tile square. There is no world generation, chunk
loading, persistence, inventory, or collision rule between players. A move has
whole tile origin and target coordinates, plus a start tick and duration. The
renderer interpolates between those tiles. The world can still report the
origin and target tiles occupied during a move.

## Why the visitor hosts the world

Each visitor can start moving before a server round trip. The visitor's browser
owns the world state. Deno Deploy serves code and relays small signaling
messages through KV, so isolated server instances do not need a shared in
memory game loop. The admin route lists recent visitor heartbeats and offers
two ways to join: WebRTC data channel or HTTP POST with SSE delivery.

The browser host applies admin move intents in sequence order and sends a
world snapshot every 500 ms. The admin predicts movement locally and replaces
its world with host snapshots. This is enough to compare feel and correct
simple drift. It is not rollback netcode. WebRTC uses direct connectivity when
ICE can establish it; Xirsys TURN credentials are optional. The SSE route uses
Deno KV as a mailbox. It is a comparison path, not a latency guarantee.

The admin panel records join time and the last 32 ping round trips. It shows
their median and 95th percentile. Compare the transports on one network and
again with a phone on cellular service. Browser tests cover function and
screenshots; they do not substitute for those device measurements.

## Current limits

- `/admin` and its APIs have no authentication. Anyone who knows the route can
  list and join active worlds in this stage.
- A world has one visitor and one admin. It ends when the visitor closes the
  page. A missed close signal leaves presence until the 30 second TTL ends.
- The KV mailbox is bounded to 32 recent signals. It suits this small demo,
  but it is not a general game message bus.
- The admin receives state snapshots and can see brief corrections. There is
  no clock synchronization, input replay, or authoritative server.
- Offline caching is deferred. A visitor needs the website to load the game.

## Next experiment

Test both join buttons from a desktop on the same network, then from a phone
on cellular service. Record join time, median RTT, 95th percentile RTT, and
whether a move visibly snaps after correction. Use the same devices and world
for each path. That evidence can decide if this demo needs WebRTC, whether SSE
is sufficient, and when a server owned world becomes useful.
