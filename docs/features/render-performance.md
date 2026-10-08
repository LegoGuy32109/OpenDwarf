# Render performance

The terrain renderer (`src/client/render.js`) must stay cheap in master view at
zoom 0.25, where one frame draws about 8,000 tiles. Four rules keep it so.

- **Typed vertex batch.** `quad` writes straight into one reused `Float32Array`
  that doubles when it is full. `flush` uploads a `subarray` of it with
  `bufferData`. A frame makes no per-vertex arrays and no spreads.
- **Surface grid.** `surfaceGrid` (`src/shared/surface.js`) calls `surfaceAt`
  once for every tile of the visible rectangle, plus a one-tile border on the
  right and bottom, and returns `lookup(x, y)`. The floor, the edge shading, and
  both masks read it. Outside the rectangle, `lookup` falls back to `surfaceAt`.
  `elevationMask` and `ceilingMask` take the lookup as an optional last
  argument. Without it they call `surfaceAt` themselves and return the same
  result.
- **Material from the surface.** `surfaceAt` returns the `material` of the
  surface tile, so the ore frame needs no second `readTile`.

- **Cached chunk meshes (master view).** `src/client/terrain-mesh.js` builds the
  terrain quads of one 16×16 chunk at one `viewZ` into five passes: floor, ore
  tops, edge shading, ledge bands, ceiling shading. `render.js` uploads each
  pass once into its own static buffer and vertex array, then draws the visible
  chunks' buffers each frame, so panning changes only the camera. Entities,
  items, the cursor, decals and the interface still draw per frame, on top. A
  mesh is rebuilt when `meshIsFresh` fails: the `viewZ` differs, or the data or
  `chunkVersion` of any of the four chunks it read (itself and the chunks to its
  right, below, and diagonal, because masks and bands read the next tile)
  differs. `writeTile` and `applyReveal` advance `chunkVersion` (`touchChunk`),
  and a chunk that loads, unloads or is replaced changes the data it holds. This
  covers the terrain cache generation without rebuilding every mesh when one
  chunk loads. The cache keeps about four times the visible chunks, and frees
  the buffers of the rest.
- **Entity view keeps the per-frame path.** What a tile shows there depends on
  the player's sight, which changes as the player moves, so a mesh would be
  stale each frame. It uses the typed batch and surface grid above.

## Render stats

After each `render`, `renderer.stats` is `{ tiles, quads }` (type
`RenderStats`): `tiles` counts the terrain tiles with a visible surface, and
`quads` counts every quad batched that frame, interface included. Under
`?harness=1`, `__od.renderStats()` returns a copy of it. The lag-spike log reads
it.

## Measuring

Profile with Playwright on a GPU, vsync off
(`--disable-frame-rate-limit
--disable-gpu-vsync`), 1920×1080, master view, zoom
0.25, panning for 6 s. Pixels must not change: the e2e snapshots in
`game.spec.ts` cover it.

| Master view, zoom 0.25, panning | Before  | After  |
| ------------------------------- | ------- | ------ |
| p50 frame time                  | 23.4 ms | 3.2 ms |
| p95 frame time                  | 30.7 ms | 5.4 ms |
| JS per frame                    | 22.9 ms | 3.3 ms |

The meshes:
`deno run -A scripts/benchmark-render.ts --url=http://127.0.0.1:PORT` pans east
for 6 s so the host generates terrain, then west over terrain that no longer
changes, and times every animation frame callback of the west leg. It ran in
headless Chromium with software WebGL at 1920×1080, zoom 0.25, comparing the
tree before and after on the same machine. Software WebGL has no GPU, so read
the ratio, not the milliseconds.

| Master view, zoom 0.25, panning, no terrain change | Per-frame loops | Cached meshes |
| -------------------------------------------------- | --------------- | ------------- |
| median JS per frame                                | 5.9 ms          | 0.2–0.3 ms    |
| p90 JS per frame                                   | 41–42 ms        | 3.6–4.2 ms    |

A frame that builds a mesh costs more; panning into new terrain builds about ten
chunk meshes a second. The e2e check `tests/e2e/mesh-cache.spec.ts` covers
mining, placing and a `viewZ` change in master view, and
`tests/client/terrain_mesh_test.ts` covers the invalidation rules. A screenshot
of the same master view is byte-identical before and after.
