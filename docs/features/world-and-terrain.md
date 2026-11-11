# World and terrain

A normal page starts the spawn room through `roomRecipe` in
`src/shared/world-recipes.js` and the shared [world builder](world-building.md):
a 9×7 room at Z=1 in the 2×2 spawn chunks, one doorway in its south wall that
opens into solid stone, a flat east tunnel, and the shopkeeper NPC Ulgar against
the north wall. The room and tunnel are carved into a solid stone shell on the
playing plane, so generated caves cannot break into the room. The host and
joining players spawn inside it. The optional corner NPC patrols its southwest
corner.

All built-in playable recipes set `world.planeZ=PLAY_Z` (1). Z=0 is permanent,
ore-free stone support. Z=2 through Z=7 are air. Chunk storage still allocates
all eight levels. Gameplay edits through `writeTile` can change only Z=1. Mining
a wall exposes the supporting floor without removing it.

Every world uses `WORLD_SEED` in `src/shared/generation.js`, made from the text
`opendwarf-1`, unless `?seed=` replaces it. The east exit searches for a natural
cave with at least 96 connected cells beyond the room shell, then carves a flat
connection to it. A bounded search falls back to an east gallery. The default
seed gives more than 500 walkable cells within three chunks of spawn, all at
Z=1. `tests/shared/spawn_room_test.ts` checks connectivity.

`?layout=test` selects planar obstacles and an ore row, with no staircase.
`?world=32` expands the authored region from 16×16 to 32×32. Browser tests
construct the same playable recipes through `tests/e2e/world.ts`, adding a
corner NPC only when requested. `createAuthoredWorld` in `authored-terrain.js`
is an explicit legacy unit-test helper, with no production imports and no
`planeZ`, so engine tests can continue to cover 3D climbs and descents.

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
including the authored area, is never replaced. A chunk has stone support, an XY
cave field on Z=1, and air above. The smooth noise field uses global tile
coordinates (`isCaveTile`), so caves continue across chunk borders. Ore clusters
take horizontal random walks through stone on Z=1. All seven ores remain
available: coal and iron are common, followed by redstone, lapis and gold, with
diamond and emerald rare. Attempts per chunk are 3 coal, 2 iron, 1 redstone, 0.7
lapis, 0.6 gold, 0.25 diamond and 0.12 emerald. Fractional attempts use seeded
probability. Veins replace stone only, preserve cave openings, and stay within
their chunk. Total ore occupies less than 16% of the playing plane in the
distribution survey. A chunk takes well under one millisecond to generate. When
the host is in master view it also generates the chunks the camera's view covers
(`generateInView`), nearest the view center first and within what is left of the
tick's two-chunk budget after the players' chunks, so panning at zoom 0.25 keeps
finding terrain. `?seed=` replaces the world seed for tests, and the spawn
chunks use it too. Joining players never generate; they receive generated
terrain only for tiles they see.

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
chunk last had a player near and takes the clock as an argument. The shared
simulation runs it next to `generateAround`, every 20 ticks, with time derived
from the tick count.

- **Edit diffs.** `writeTile` records each change in `world.edits`: chunk key to
  a map of tile index to material. `ensureChunk` applies the diff after it
  regenerates a chunk from the seed, so mined tunnels and placed stone come
  back. Diffs last for the session. The authored build leaves none, because a
  diff is recorded only when the world has a generator and the chunk is not
  pinned.
- **Pinned chunks.** Recipes explicitly name pinned chunks. The built-in spawn
  room, `?layout=test`, and `?world=32` recipes pin their initial chunks in
  `world.pinned`, so those chunks never unload. A world without
  `world.generateChunk` never unloads anything.
- **Cache.** `unloadChunk` bumps the `getChunk` cache generation, so a read
  never returns the dropped tiles.
- **Items and mining.** Dropped items and mining progress live outside chunk
  data and are not touched.
- **Diagnostics.** The host panel (F3) shows loaded chunks, pinned chunks, and
  edit-diff totals in chunks and tiles.
- **Harness.** `?harness=1&unloadGraceMs=<ms>` replaces the grace period.
