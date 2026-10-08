# Render performance

The terrain renderer (`src/client/render.js`) must stay cheap in master view at
zoom 0.25, where one frame draws about 8,000 tiles. Three rules keep it so.

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
