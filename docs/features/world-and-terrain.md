# World and terrain

A normal page starts the spawn room (`src/shared/spawn-room.js`): a 9×7 room at
z 4 in the 2×2 spawn chunks, one doorway in its south wall that opens into solid
stone, two stair tiles down to a tunnel at z 2, and a reserved shopkeeper tile.
The spawn chunks are generated from the world seed like any other chunk. The
room, stairs and tunnel are then dug into a solid stone `SHELL`, so caves never
break into them. The tunnel runs on east until it opens into a generated cave.
The host and every joining player spawn inside the room, and the corner NPC
walks a square in its south west corner.

Every world uses the same seed for now, `WORLD_SEED` in
`src/shared/generation.js`, made from the text `opendwarf-1`. That seed was
chosen because its cave network meets the tunnel: from the room, a player can
walk to more than 5,000 tiles on every level within three chunks of spawn.
`tests/shared/spawn_room_test.ts` checks this. If you change the seed or the
cave noise, run that test to find out whether the tunnel still reaches a large
cave. `?layout=test` loads the older layout below. A page with `?harness=1` uses
that test layout unless it adds `?layout=room`, so the motion and sight specs
keep their pillar and staircase.

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
in a chunk that does not exist reads as solid stone. `terrainExtent`, the tile
rectangle of the loaded chunks that bounds the master camera, is cached until a
chunk is added or unloaded.

Materials and their stable ids live in `src/shared/materials.js`: air, stone,
then coal, iron ore, gold ore, lapis, redstone, diamond, and emerald. Every
material except air is solid. The chunk wire accepts ids up to `MAX_MATERIAL`,
and the renderer draws an ore from `public/assets/ores.png`. A test row of each
ore sits in the authored area.

The world host creates generated terrain from the session seed in
`src/shared/generation.js`: every chunk within one chunk of any player is
created, at most two per 50 ms tick, nearest first, and an existing chunk,
including the authored area, is never replaced. A chunk is solid stone with
noise caves that continue across chunk borders (`isCaveTile`), and ore clusters
by depth band: coal and iron at z 5–7, gold, lapis, redstone and some iron at z
2–4, and diamond and emerald at z 0–1. A chunk takes well under one millisecond
to generate. When the host is in master view it also generates the chunks the
camera's view covers (`generateInView`), nearest the view center first and
within what is left of the tick's two-chunk budget after the players' chunks, so
panning at zoom 0.25 keeps finding terrain. `?seed=` replaces the world seed for
tests, and the spawn chunks use it too. Joining players never generate; they
receive generated terrain only for tiles they see.

Terrain changes the world host sends to guests are described in
[sight](sight.md) and [networking](networking.md); mining writes terrain through
`writeTile` ([mining and items](mining-and-items.md)).

## Chunk unloading

The world host unloads a chunk when no player has been within `UNLOAD_RADIUS`
(2) chunks of it for `UNLOAD_GRACE_MS` (30 s)
([ADR 0005](../adr/0005-bounded-terrain-sync-and-chunk-unloading.md)). Players
here include the corner NPC, a guest in master view, and the host's own
master-view camera. The unloader also takes the master view's tile rectangle,
and every chunk inside it (plus one chunk around it) counts as near, so panning
does not thrash load and unload. `src/shared/chunk-unload.js` keeps when each
chunk last had a player near and takes the clock as an argument. The host loop
runs it next to `generateAround`, at most once a second.

- **Edit diffs.** `writeTile` records each change in `world.edits`: chunk key to
  a map of tile index to material. `ensureChunk` applies the diff after it
  regenerates a chunk from the seed, so mined tunnels and placed stone come
  back. Diffs last for the session. The authored build leaves none, because a
  diff is recorded only when the world has a generator and the chunk is not
  pinned.
- **Pinned chunks.** `pinLoadedChunks` runs when the host starts, so every chunk
  that exists before play (the spawn room, `?layout=test`, `?world=32`) is in
  `world.pinned` and never unloads. A world without `world.generateChunk` never
  unloads anything.
- **Cache.** `unloadChunk` bumps the `getChunk` cache generation, so a read
  never returns the dropped tiles.
- **Items and mining.** Dropped items and mining progress live outside chunk
  data and are not touched.
- **Diagnostics.** The host panel (F3) shows loaded chunks, pinned chunks, and
  edit-diff totals in chunks and tiles.
- **Harness.** `?harness=1&unloadGraceMs=<ms>` replaces the grace period.
