• Assessment The WebGL2 renderer has a good GPU-facing foundation, but it is not
yet shaped for “instant playable, never drop below 60fps.” The main risk is CPU
work on the render thread, especially cache rebuilds, FOV, chunk generation,
per-frame string/object churn, and per-tile instance construction.

Local microprofile on this machine:

- Generating ~200 solid chunks: ~79ms total if done continuously.
- FOV recompute: ~4-9ms.
- Topmost rebuild: ~4-6ms for common viewport sizes.
- Those numbers are too large to happen unpredictably on the main render frame.

High-Impact Issues

- webgl2/render-loop.ts:67 sets state.topmostDirty = true every entity-mode
  frame while following the player camera. That forces
  webgl2/frame-builder.ts:57 to rebuild topmost cache every frame. Topmost
  should only dirty when visible chunk bounds, viewZ, loaded terrain,
  FOV/memory, or terrain data changes. Camera interpolation alone should not
  rebuild terrain caches.

- webgl2/render-loop.ts:84 gates sceneReady on all texture/font assets. For
  instant load, render with placeholder textures immediately, prewarm the spawn
  chunk ring first, allow input immediately, then progressively upgrade assets
  as they decode.

- webgl2/runtime.ts:305 generates solid chunks synchronously on the render
  thread. The 5-chunk cap helps, but it still risks spikes and marks topmost
  dirty every batch. This should move to a worker, ideally returning
  transferable Uint8Array chunk buffers.

- webgl2/runtime.ts:200 and webgl2/frame-builder.ts:54 share FOV ownership
  awkwardly. syncFovCache can recompute without clearing state.fovDirty, so
  dirty events can cause repeated FOV work across render frames until a sim tick
  clears it. Make FOV recompute single-owner and clear dirty immediately after
  recompute.

- lib/webgl-world-sim.ts:457 recomputes 3D FOV with many Set<string>, Map,
  string keys, parse/split, and object allocation paths. This is a prime
  Rust/WASM or worker candidate, but only if the boundary returns typed
  arrays/bitsets, not per-tile JS calls.

- webgl2/passes/floor.ts:86, webgl2/passes/edge-shadow.ts:135, and
  webgl2/passes/ceil-shadow.ts:164 rebuild instance data every frame by scanning
  visible chunks/tile grids. For mostly static terrain, build per-chunk render
  batches and only regenerate dirty chunks.

- webgl2/programs/index.ts:74 and webgl2/programs/index.ts:178 call
  gl.getUniformLocation during every setGlobals. Cache uniform locations at
  program init. Also runPasses calls useProgram, then each setGlobals calls
  useProgram again.

- webgl2/render-loop.ts:219 builds streaming keys and a string fingerprint every
  frame. Cache the current camera chunk bounds and only rebuild streaming state
  when chunk bounds, zoom, viewport, or viewZ changes.

Best Performance Roadmap

1. Fix dirtiness first: stop topmost rebuilds on camera-follow frames,
   single-own FOV recompute, and update streaming only on chunk-boundary
   changes.

2. Make startup playable: create placeholder textures, prewarm spawn chunks
   before full asset readiness, and render/move as soon as minimal terrain
   around the player exists.

3. Move chunk generation off-thread: use worker-generated Uint8Array chunks and
   transfer buffers back to main.
4. Replace string tile/chunk keys in hot paths: use numeric keys, dense typed
   arrays, bitsets, or chunk-local indices.
5. Cache terrain render batches per chunk: floor, edge shadow, ceiling shadow,
   fog/visibility overlays should regenerate only when their inputs change.

6. Move FOV/topmost to Rust WASM or worker: avoid per-cell JS/WASM calls; pass
   large typed buffers in and out.
7. Add instrumentation before deeper GPU work: CPU timings per stage, pass
   instance counts, draw call counts, and GPU timing via
   EXT_disjoint_timer_query_webgl2 where available.

WASM/Worker Guidance Rust WASM is a good fit for:

- World/chunk generation.
- FOV/LOS.
- Topmost surface extraction.
- Visibility/memory bitsets.
- Building instance buffers for floor/shadow/fog passes.

Avoid:

- Calling WASM once per tile from JS.
- Keeping game sim in WASM but copying large state into JS every frame.
- Running heavy WASM on the main thread if the goal is no render hitching.

Best shape:

- Rust owns chunk/sim data in linear memory.
- JS asks for dirty chunk outputs or a ready-made instance buffer slice.
- Worker runs WASM for chunk/FOV/topmost jobs.
- Main thread only uploads typed arrays to WebGL and handles immediate
  input/render.

Bottom Line The WebGL2 pass architecture is directionally good. The urgent
performance work is not “more WebGL tricks”; it is removing CPU spikes and
hot-path allocation from the main render loop. Fix dirty invalidation, workerize
chunk/FOV/topmost work, switch hot data to typed arrays, and cache per-chunk
render batches before considering more advanced GPU techniques.
