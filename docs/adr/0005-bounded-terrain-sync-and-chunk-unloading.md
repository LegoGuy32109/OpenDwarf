---
status: accepted
---

# Bounded terrain sync and chunk unloading

Terrain cost must not grow with how far players explore. Today every state
packet carries a guest's whole remembered terrain and sight memory, and it goes
out every 500 ms and on every tile step. That costs about 500 characters per
explored chunk, per packet. A guest that has seen about 500 chunks passes the
256 KB packet cap and can no longer take a snapshot. Master view fails sooner,
because it sends every loaded chunk in full. The world host also keeps every
chunk it has generated.

## Decisions

Settled in a grilling session on 2026-10-06.

**Sync: host-owned deltas.** The world host stays the owner of each guest's
remembered terrain, because a rejoin needs it. For each guest the host keeps the
remembered chunks plus a pending reveal: the tiles that entered that remembered
terrain or changed in it since the last state packet. A state packet drains the
pending reveal at the moment it is built, so a packet the snapshot sender
coalesces away loses nothing. The reliable, ordered `world` channel delivers it,
so there are no acks. The pending reveal also replaces the separate `terrain`
message: a visible tile change marks the reveal and publishes a state packet at
once.

- **Wire shape.** A state packet drops `world.chunks` and `visibility.memory`.
  It carries `reveal`, a record from chunk key to a run-length chunk string
  (`chunk-wire.js`) in which material 0 (`UNKNOWN`) means no change. A packet
  holds at most `MAX_REVEAL_CHUNKS` chunks; the host keeps the rest pending and
  publishes again when the channel drains. This is protocol version 4.
- **Guest.** The guest keeps its own copy of its remembered terrain and applies
  each reveal to it. A tile is remembered when that copy knows it and the
  visible mask does not hold it, so sight memory no longer travels.
- **Rejoin and view changes.** A new attempt or a change of view mode starts the
  guest's copy over. The host marks every tile it holds for that guest as
  pending and sends them in batches.
- **Master view.** A guest in master view uses the same path. Its remembered
  terrain is every loaded chunk within `UNLOAD_RADIUS` of its free-moving
  player, sent in full with no sight filter.

**Unloading: distance with a grace period.** The world host unloads a chunk when
no player, master view included, has been within `UNLOAD_RADIUS` (2) chunks of
it for `UNLOAD_GRACE_MS` (30 s). The radius is one ring beyond the generate
radius, so a player who walks to and fro across a chunk border does not make
chunks load and unload again and again. The authored chunks are pinned and never
unload.

**Edits: edit diffs.** `writeTile` is the only terrain write, so it also records
the tile in its chunk's edit diff: a sparse map of tile index to material.
Loading a chunk that was unloaded generates it from the seed, which is a pure
function, and applies its diff. Diffs last for the session. Dropped items and
mining progress are kept per tile outside chunk data, so unloading does not
touch them.

**Measure before compacting.** A guest's remembered terrain stays as 2 KB arrays
on the host and is never unloaded. The host diagnostics panel shows loaded and
pinned chunks, edit-diff totals, and each guest's remembered chunk count.
Compacting remembered terrain waits until those numbers show a need.

## Consequences

Snapshot size depends on what a player can see now (sight radius 20 tiles, at
most about 4×4 chunks), not on how far the player has explored. Host memory for
world chunks depends on how far apart the players are, not on how long the
session runs. Edit diffs and remembered terrain still grow with the session. A
far chunk costs one generation to come back, and generation takes well under one
millisecond. The host still sends each guest only what that guest has seen
([ADR 0003](0003-chunked-terrain-generated-on-demand.md)).
