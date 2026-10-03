# World and terrain

A normal page starts the spawn room (`src/shared/spawn-room.js`): a 9×7 room at
z 4 in the 2×2 spawn chunks, one doorway in its south wall that opens into solid
stone, two stair tiles down to a tunnel at z 2, and a reserved shopkeeper tile.
Everything else is solid stone. The host and every joining player spawn inside
the room, and the corner NPC walks a square in its south west corner.
`?layout=test` loads the older layout below. A page with `?harness=1` uses that
test layout unless it adds `?layout=room`, so the motion and sight specs keep
their pillar and staircase.

The test layout is one 16×16 tile square across z levels 0–7, with eight view
levels, a staircase, and a center pillar. `?world=32` starts an expanded 32×32
authored area with four fixed 16×16 chunks and the same eight levels. The
expanded area includes a second pillar. A seven-step staircase on the south edge
reaches the top landing; a full-height pillar tests occlusion. The view can show
five lower levels, with deeper floors turning blue before they disappear.

Terrain is stored per 16×16 chunk in a map keyed by chunk coordinates, which can
be negative ([ADR 0003](../adr/0003-chunked-terrain-generated-on-demand.md)).
`src/shared/terrain.js` is the API: `readTile` and `writeTile` for one material
at x, y, z; `world.generateChunk`, a hook `ensureChunk` calls to create a
missing chunk (the generator plugs into it); and `drainTileChanges`, which lists
the tiles written since the last call so the host can send them to peers. A tile
in a chunk that does not exist reads as solid stone. There is no chunk unloading
or persistence.

Materials and their stable ids live in `src/shared/materials.js`: air, stone,
then coal, iron ore, gold ore, lapis, redstone, diamond, and emerald. Every
material except air is solid. The chunk wire accepts ids up to `MAX_MATERIAL`,
and the renderer draws an ore from `public/assets/ores.png`. A test row of each
ore sits in the authored area.

The world host creates generated terrain from the session seed in
`src/shared/generation.js`: every chunk within one chunk of any player is
created, at most two per 50 ms tick, nearest first, and an existing chunk,
including the authored area, is never replaced. A chunk is solid stone with
noise caves that continue across chunk borders, and ore clusters by depth band:
coal and iron at z 5–7, gold, lapis, redstone and some iron at z 2–4, and
diamond and emerald at z 0–1. A chunk takes well under one millisecond to
generate. `?seed=` replays a world for tests. Joining players never generate;
they receive generated terrain only for tiles they see.

Terrain changes the world host sends to guests are described in
[sight](sight.md) and [networking](networking.md); mining writes terrain through
`writeTile` ([mining and items](mining-and-items.md)).
