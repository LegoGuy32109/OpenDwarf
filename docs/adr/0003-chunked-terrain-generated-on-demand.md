---
status: accepted
---

# Chunked terrain generated on demand

Terrain moves from one fixed-size array to 16×16 chunks keyed by chunk
coordinates, which can be negative. The view keeps eight levels. The world host
generates a chunk from the session seed when any player comes within one chunk
of it, and sends each joining player only the chunks and tiles that player can
see. The 2×2 authored chunks stay as the spawn area. Open Dwarf needs an endless
world to explore and mine, and every item and mining feature depends on how
terrain is stored and sent, so this change goes first instead of after a
fixed-size demo. The trade-off is more work for the host: generating chunks,
tracking sight per chunk, and sending terrain changes to many peers. If
JavaScript cannot keep up in a browser-hosted P2P session, the plan is to move
the hot paths to WebAssembly, not to return to a fixed world.
