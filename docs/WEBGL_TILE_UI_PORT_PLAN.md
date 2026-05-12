# WebGL Tile UI Test Plan

## Purpose

Build a deterministic WebGL-first game UI experiment before porting the Rust
simulation/runtime. The immediate goal is not to preserve the current Bevy
implementation. The goal is to prove that the browser renderer can display
OpenDwarf assets, stream chunks accurately from the visual viewport, process
low-latency input, and render pixelated menus/text with deterministic behavior.

For this phase, skip wasm entirely:

- world simulation is TypeScript/JavaScript
- chunk generation is deterministic from a seed
- rendering is WebGL2
- UI and text are rendered inside WebGL
- HTML is only the host shell around the canvas

## Scope

This testing effort is a browser-renderer experiment, not a full game rewrite.

In scope now:

- route boot and fullscreen behavior
- deterministic JS world generation
- viewport-only chunk streaming
- WebGL tile/atlas rendering
- pixel-font UI text
- screenshot and replay baselines
- perf telemetry for the browser renderer

In scope later, after the renderer proves itself:

- player-centered traversal and movement prediction
- z-layer parity with the existing native renderer
- richer menu systems
- binary replay/data streaming
- IME, mobile, and paste correctness
- wasm or Rust runtime integration

Out of scope for the first pass:

- Bevy rendering work
- wasm integration
- multiplayer/runtime protocol migration
- production-quality settings and rebinding UI
- visual parity outside the tested layer stack and atlas fixtures

## Decided Defaults

- Route: `/webgl`
- Chunk coordinates: simpler origin-based chunks for the JS experiment
- Camera feel: pixel-smooth movement
- Zoom: keep the first implementation simple; fixed 1x is acceptable, with a
  simple debug zoom added only when useful
- World shape: infinite X/Y from deterministic chunk generation
- First asset smoke test: `static/assets/sprites/SingleRock.png`
- Biome/variety test asset: `static/assets/sprites/StackedTextures.png`
- Pixel font: `game_library/assets/ui/TinyPixie2.ttf`, copied or served into the
  web experiment asset path before the UI/text step
- Canvas resolution: native device-pixel-ratio framebuffer resolution. A 4k
  display should get a 4k framebuffer, while assets stay pixelated through
  nearest-neighbor sampling and pixel-scale controls.
- Fullscreen: required for the best input experience. Windowed mode can work,
  but it is not the target interaction model.
- Streaming policy: visible viewport only for the first implementation.
- Z/shadow goal: not part of the first smoke test, but the renderer must
  eventually reproduce the current native floor, edge shadow, ceiling shadow,
  fog/shadow overlay ordering.
- Stacked atlas behavior: mimic `StackedTextures.png` tile-id behavior closely
  enough that the visual result can match the existing native renderer.
- UI text scale: independent from world zoom.
- Menu style: translucent, matching the current Bevy chat/menu direction.
- Controls: physical `KeyboardEvent.code` bindings, initially `ESDF` and `IJKL`.
  Future settings UI can remap these.
- Text input: basic ASCII is enough for v0.
- Paste: not required in the first custom text field.
- Browser shortcuts: preserve browser shortcuts generally. In fullscreen, only
  `Escape` is expected to exit fullscreen.
- Primary browser: Chrome
- Interactive target: stable 60 Hz
- Benchmark target: include an uncapped/synthetic throughput mode to discover
  renderer limits beyond normal display-vsynced interaction
- Compatibility target: capture browser/GPU capability from `navigator` and
  WebGL context diagnostics in every perf/debug report.
- First stress target: one chunk radius around the visible window.
- Visual regression: screenshot testing is worth adding early.
- Replay format: JSON metadata first, with compact binary payloads later for
  large streamed data. Long term, support both.
- Manual validation: every meaningful experiment should export a replay/debug
  report so regressions and performance changes can be compared later.

## Product Constraints

- The renderer must be deterministic from:
  - seed
  - viewport size
  - device pixel ratio
  - input event log
  - fixed simulation step count
  - asset versions
- Visual output should be replayable. The same replay log should produce the
  same chunk keys, camera path, UI state, and draw order.
- Main-thread work must stay predictable. Simulation can be simple, but renderer
  timing and chunk upload behavior must be measured from the beginning.
- Pixel art must stay crisp. All asset sampling uses nearest-neighbor behavior.
- The experiment should make it cheap to throw away implementation details while
  preserving tests and fixtures.
- Normal interactive rendering should use `requestAnimationFrame`; uncapped
  performance exploration should be an explicit benchmark mode so it does not
  distort input-feel testing.

## Initial Non-Goals

- No wasm.
- No Bevy integration.
- No network multiplayer.
- No procedural cave correctness beyond deterministic test terrain.
- No full IME/mobile text input correctness in v1.
- No generic UI framework. Build only the primitives needed to test game menus.

## Proposed Files

These are suggested paths, not mandatory names.

- `islands/WebGlGameCanvas.tsx`
  - Fresh island that mounts the WebGL canvas.
  - Owns canvas focus, resize observation, and browser event collection.
- `routes/webgl.tsx`
  - Dedicated experiment route.
- `static/webgl_game/main.ts`
  - Experiment entry point.
- `static/webgl_game/input.ts`
  - Keyboard/event collection and deterministic input log.
- `static/webgl_game/sim.ts`
  - JS world simulation and deterministic chunk generator.
- `static/webgl_game/renderer.ts`
  - WebGL2 renderer, shaders, atlas loading, chunk texture uploads.
- `static/webgl_game/ui.ts`
  - Pixel font rendering, menu widgets, text buffer/caret.
- `static/webgl_game/replay.ts`
  - Replay recording/playback and assertions.
- `static/webgl_game/fixtures/`
  - Seeds, viewport/input traces, expected chunk windows, perf baselines.

## Determinism Rules

### Time

Use two clocks:

- `real_time_ms`: browser timestamp used only for telemetry.
- `sim_tick`: fixed-step game time used for movement, world state, animations
  that must replay deterministically, and tests.

Default:

```text
sim_hz = 60
sim_dt_ms = 16.6666667
```

Render may run at browser refresh rate, but all game state changes are applied
through fixed simulation ticks.

### Randomness

All world generation uses a local seeded PRNG. Never use `Math.random()` inside
the simulation or renderer.

Required test:

- Given `seed = "rocks-aabb-v1"` and `chunk = (3, -2, 0)`, generated tile ids
  are byte-identical across reloads.

### Input

Store raw input as an append-only event log:

```ts
type InputLogEvent =
  | {
    type: "key_down";
    code: string;
    key: string;
    repeat: boolean;
    tick: number;
  }
  | { type: "key_up"; code: string; key: string; tick: number }
  | { type: "text"; value: string; tick: number }
  | { type: "paste"; value: string; tick: number }
  | { type: "fullscreen"; active: boolean; tick: number }
  | {
    type: "resize";
    width: number;
    height: number;
    dpr: number;
    tick: number;
  };
```

Rules:

- Use `KeyboardEvent.code` for game controls.
- Use `KeyboardEvent.key`, `beforeinput`, `input`, or paste data for text.
- Initial physical control bindings are `ESDF` and `IJKL`.
- Do not push raw browser events into game state directly. Normalize first.
- During replay, consume the log instead of browser events.
- In fullscreen, capture game bindings aggressively and allow `Escape` to exit
  fullscreen. Outside fullscreen, preserve normal browser shortcuts.

### Floating Point

Renderer transforms can use floats. Simulation decisions should prefer integer
tile/chunk coordinates. Camera can be float, but the chunk AABB calculation must
be deterministic and separately tested.

## Coordinate Model

The JS experiment should use simpler origin-based chunks. This deliberately does
not preserve the current centered chunk mapping from the Bevy/Rust path.

Definitions:

```text
tile_size_px = 64
chunk_edge_tiles = 16
chunk_size_px = tile_size_px * chunk_edge_tiles
```

Origin-based chunk mapping:

```text
chunk_of_tile(tile_x, tile_y):
  chunk_x = floor_div(tile_x, chunk_edge_tiles)
  chunk_y = floor_div(tile_y, chunk_edge_tiles)

chunk_origin_tile(chunk_x, chunk_y):
  tile_x = chunk_x * chunk_edge_tiles
  tile_y = chunk_y * chunk_edge_tiles
```

Visual viewport AABB:

```text
zoom = 1 for the first implementation unless debug zoom is enabled
framebuffer_width_px = round(css_width_px * device_pixel_ratio)
framebuffer_height_px = round(css_height_px * device_pixel_ratio)
world_min_x_px = camera_x_px - framebuffer_width_px / (2 * zoom)
world_max_x_px = camera_x_px + framebuffer_width_px / (2 * zoom)
world_min_y_px = camera_y_px - framebuffer_height_px / (2 * zoom)
world_max_y_px = camera_y_px + framebuffer_height_px / (2 * zoom)
```

Streaming chunk window:

```text
visible_chunks = chunks_intersecting(world_viewport_aabb)
streaming_chunks = visible_chunks + padding_chunks
```

Default padding:

```text
padding_chunks = 1
```

## Renderer Architecture Under Test

The terrain renderer should draw chunk layers, not one sprite per tile.

Chunk layer key:

```ts
type ChunkLayerKey = {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
  renderZ: number;
  layer: "floor" | "edgeShadow" | "ceilingShadow" | "fog";
  revision: number;
};
```

Chunk payload:

```ts
type ChunkLayerPatch = {
  key: ChunkLayerKey;
  tileIds?: Uint16Array;
  shadowIds?: Uint8Array;
  fog?: Uint8Array;
};
```

Expected draw path:

1. Load `SingleRock.png` for the earliest smoke test.
2. Load `StackedTextures.png` for varied biome chunk tests.
3. Later load `ShadowAtlas.png` and `ObscureAtlas.png` for depth/ceiling tests.
4. Upload chunk-layer tile/state data to GPU textures.
5. Draw one quad per visible chunk layer.
6. In the fragment shader, map the fragment to local tile coordinate.
7. Fetch tile id/state from the chunk texture.
8. Sample the atlas with nearest-neighbor filtering.
9. Draw UI/text after world layers.

Required renderer counters:

- frame number
- draw calls
- visible chunks
- resident chunks
- uploaded chunk layers this frame
- bytes uploaded this frame
- CPU frame time
- GPU frame time if available
- input-to-present latency estimate

## Test Steps

Each step should be independently shippable. Do not move to the next step until
the pass/fail checks are easy to run.

### Step 0: WebGL Experiment Route Boots

Goal:

Create a separate WebGL experiment route without touching the Bevy canvas path.

Build:

- Add `/webgl` as a dedicated route.
- Mount a canvas with WebGL2 context.
- Clear to a fixed color.
- Resize canvas to CSS size times `devicePixelRatio`.
- Record `navigator` and WebGL capability diagnostics.

Manual test:

- Open the route.
- Resize the browser.
- Enter fullscreen.
- Canvas stays sharp and fills the expected visual region.

Programmatic test:

- Resize events produce deterministic `resize` log events.
- Fullscreen entry/exit produces deterministic `fullscreen` log events.
- Internal framebuffer size equals `round(css_size * dpr)`.
- Capability report includes browser user agent, device pixel ratio, renderer
  string when available, max texture size, and key WebGL2 support flags.

Pass criteria:

- No wasm artifacts loaded.
- No Bevy script loaded.
- WebGL2 context initializes or the page shows a clear unsupported message.
- On a 4k display/window, the framebuffer can use native 4k-scale resolution.

### Step 1: Asset Sampling and Pixel Scale

Goal:

Prove that a single pixel-art sprite renders crisply through WebGL before
introducing atlas complexity.

Build:

- Load `static/assets/sprites/SingleRock.png`.
- Render a fixed grid of repeated rock sprites.
- Use nearest-neighbor sampling.
- Keep zoom fixed at 1x unless a tiny debug zoom is trivial.

Manual test:

- Rock tiles are crisp at 1x.
- No blurred edges or texture bleeding.

Programmatic test:

- Renderer reports texture dimensions.
- Sampling mode is nearest for sprite and chunk data textures.

Pass criteria:

- A fixed screenshot at 1x zoom should be visually stable across reloads.
- Sprite edges remain pixel-sharp.

### Step 1b: Stacked Atlas Biome Sampling

Goal:

Move from one repeated rock sprite to a varied deterministic biome using the
current stacked tile atlas.

Build:

- Load `static/assets/sprites/StackedTextures.png`.
- Define the atlas frame layout explicitly.
- Render a fixed grid with varied tile ids from the deterministic generator.

Manual test:

- The terrain has visible variation.
- Atlas frames do not bleed into one another.
- The biome still looks pixelated, not smoothed.

Programmatic test:

- Renderer reports atlas dimensions and derived frame count.
- A fixed seed produces the same sequence of tile ids.

Pass criteria:

- The renderer can switch from `SingleRock.png` to `StackedTextures.png` without
  changing the chunk streaming logic.

### Step 2: Deterministic JS Rock World

Goal:

Generate an infinite rock/biome field in JS with deterministic chunk payloads.

Build:

- Implement seeded chunk generation.
- Generate floor tile ids for `chunk_edge_tiles * chunk_edge_tiles`.
- Keep generation independent from camera and render frame timing.
- Use `SingleRock.png` tile id first, then varied `StackedTextures.png` tile ids
  after Step 1b.

Manual test:

- Reloading the same seed shows the same rocks.
- Changing the seed changes the pattern.

Programmatic test:

- Snapshot generated chunks for fixed keys.
- Assert identical tile arrays for repeated generation.
- Assert different tile arrays for different seeds.

Pass criteria:

- `generateChunk(seed, key)` is pure and byte-stable.

### Step 3: Camera AABB Chunk Streaming

Goal:

Move the camera over rock tiles and stream tiles into an accurate AABB window
that responds to browser viewport size.

Build:

- Track camera center in world pixels.
- Move camera pixel-smoothly, not tile-snapped.
- Calculate visual world AABB from canvas size and zoom.
- Convert that AABB into visible chunk keys.
- Add one chunk of padding.
- Initial stress/padding target is one chunk radius around the visible window.
- Generate/load newly visible chunks.
- Evict chunks outside warm range.
- Render only visible chunk layers.

Manual test:

- Pan with keyboard.
- Camera motion feels pixel-smooth.
- Chunks appear before entering the visible viewport.
- No blank tiles at chunk boundaries.
- Resize the browser; the streaming window changes immediately and accurately.

Programmatic test:

- Fixture: camera positions, viewport sizes, device pixel ratios, zooms.
- Expected: exact sorted visible chunk keys and streaming chunk keys.
- Assert no generated chunks outside expected streaming keys.

Pass criteria:

- AABB/chunk-window tests pass for positive and negative coordinates.
- Crossing chunk boundaries does not stutter or flash blank terrain.
- Chunk cache counters match expected visible/resident counts.

### Step 4: Draw Order and Depth Stack

Goal:

Test the top-down 3D presentation without requiring full terrain simulation,
then use this step as the bridge toward visual parity with the existing native
floor/shadow/fog stack.

Build:

- Add `renderZ` and multiple z layers.
- Render lower z levels with deterministic tint.
- Add fixed edge shadow and ceiling shadow test layers.
- Add fog/shadow overlay fixtures after edge and ceiling alignment is stable.

Manual test:

- Switching z-level changes the visible stack predictably.
- Lower layers are tinted consistently.
- Shadow layers align to the floor grid.
- The layer stack can be visually compared against the existing native renderer
  for equivalent fixtures.

Programmatic test:

- Given a known stack fixture, emitted draw order is stable.
- Layer sort keys are deterministic.

Pass criteria:

- No z-fighting, unstable ordering, or random layer flicker.

### Step 5: Low-Latency Game Input

Goal:

Make movement and camera controls feel responsive while staying replayable.

Build:

- Capture `keydown` and `keyup` on the canvas/window while game focus is active.
- Normalize to input log events.
- Update camera/player state on fixed ticks.
- Keep controls outside Preact state.
- Prevent browser defaults only for captured game keys.
- Use physical `KeyboardEvent.code` bindings.
- Add initial `ESDF` and `IJKL` movement/navigation bindings.
- Require fullscreen as the primary input test mode.

Manual test:

- Press and hold movement keys.
- Movement starts on the next frame or next fixed tick.
- Browser page does not scroll while game focus is active.
- Browser shortcuts are not hijacked when game focus is inactive.
- In fullscreen, `Escape` exits fullscreen and game bindings do not leak to the
  browser.

Programmatic test:

- Replay a recorded key log and assert final camera/player position.
- Assert key repeat does not generate extra `justPressed` transitions.

Pass criteria:

- Input-to-present p95 is visible in telemetry.
- A replayed input log produces the same final state.

### Step 6: WebGL Text Buffer v0

Goal:

Recreate the current simple chat/menu typing behavior inside WebGL.

Build:

- Add a pixel font atlas generated from `game_library/assets/ui/TinyPixie2.ttf`
  or copy/serve that font into a web-visible asset path.
- Render a text box, placeholder, caret, and buffer text.
- Implement:
  - open chat
  - append printable text
  - space
  - backspace
  - delete last word
  - submit with enter
  - cancel with escape or configured command
- Keep text state deterministic and replayable.
- Keep v0 scoped to basic ASCII.
- Do not support paste in the first implementation.

Manual test:

- Open chat.
- Type a message.
- Backspace and delete word.
- Submit and render a visible confirmation or chat bubble placeholder.

Programmatic test:

- Replay text input logs and assert final buffer/submitted messages.
- Assert caret blink is based on `sim_tick`, not wall-clock drift.

Pass criteria:

- The WebGL chat v0 can replace the behavior currently handled by the Bevy chat
  menu for basic ASCII input.

Known limitation:

- Full IME/mobile/autocorrect text correctness likely needs a hidden `textarea`
  or `contenteditable` bridge later. The visible UI can still remain fully
  WebGL-rendered.
- Paste support is intentionally deferred until the base editor is stable.

### Step 7: Menu Primitives

Goal:

Build enough UI to test pixelated game menus without HTML widgets.

Build:

- Panel rectangles.
- Text labels.
- Highlight/selection state.
- Keyboard navigation.
- Confirm/cancel commands.
- Modal stack/focus state.
- Independent UI scale separate from world zoom.
- Translucent panel styling aligned with the current Bevy chat/menu look.

Manual test:

- Open/close menus.
- Navigate menu items with keyboard.
- Type in chat while menu focus suppresses world movement.

Programmatic test:

- Replay menu input logs and assert focused item/menu stack.

Pass criteria:

- Menu behavior is deterministic and does not depend on DOM focus except for the
  canvas owning keyboard focus.

### Step 8: Worker-Free Stress Test

Goal:

Find renderer limits before adding a worker or porting simulation.

Build:

- Artificially increase visible chunk count.
- Add telemetry overlay.
- Add replay that sweeps camera across an infinite rock/biome field.
- Add a normal interactive mode using `requestAnimationFrame`.
- Add an explicit benchmark mode that runs as much renderer work as practical to
  estimate throughput beyond the 60 Hz interactive target.
- Start with one chunk radius around the visible window.
- Include browser/GPU compatibility diagnostics in every exported report.

Manual test:

- Run the sweep at common browser sizes.
- Observe frame pacing and chunk uploads.

Programmatic test:

- Perf replay records p50/p95/max frame time, upload bytes, visible chunk count,
  and resident chunk count.

Pass criteria:

- Define an explicit budget after observing real numbers. Initial target: Chrome
  interactive p95 frame CPU time under 8 ms for the rock-field sweep on the
  primary dev machine.

### Step 9: JS Sim Player Traversal

Goal:

Move from camera-only streaming to player-centered adventure-mode traversal.

Build:

- Add a player entity with integer tile position.
- Resolve movement at fixed ticks.
- Center/follow camera on player.
- Add movement-direction prefetch.
- Keep movement validation chunk-aware.
- Keep initial streaming policy viewport-only until the explicit traversal test
  proves it needs movement prediction.

Manual test:

- Walk across chunk boundaries.
- Camera follows smoothly.
- Target chunks are loaded before movement reaches them.

Programmatic test:

- Replay a movement path crossing positive and negative chunk boundaries.
- Assert final player tile, loaded chunks, visible chunks, and camera center.

Pass criteria:

- No valid movement is rejected because the target chunk was missing.
- Streaming leads movement instead of following it.

## Test Harness Requirements

The artifact format and run lifecycle are defined in
[WEBGL_TEST_ARTIFACT_SPEC.md](/home/josh/Projects/OpenDwarf/docs/WEBGL_TEST_ARTIFACT_SPEC.md).
Screenshot baselines are optional for now; CI can supply a baseline manifest
later without changing the step1 harness contract. The review flow is frame-dump
based: screenshots at semantic checkpoints are the canonical review frames, and
any stitched video is optional.

Add a debug overlay from the first working route:

- seed
- sim tick
- camera center
- zoom
- css canvas size
- device pixel ratio
- framebuffer size
- viewport AABB
- visible chunk keys
- streaming chunk keys
- resident chunk count
- uploaded chunk layers this frame
- frame CPU p50/p95/max
- input latency p50/p95/max
- current mode: interactive or benchmark
- benchmark frames per second / chunks per second when benchmark mode is active
- browser/GPU compatibility summary

Add replay controls:

- record input log
- stop recording
- replay log
- export JSON
- import JSON
- run deterministic assertions
- capture screenshot baseline
- compare screenshot against baseline
- export compact binary payloads later for high-volume chunk/replay data
- export a deterministic frame-dump review bundle for `step1-single-rock-review`

## Deferred Decisions

- Key remapping belongs in a future settings UI. The experiment starts with
  physical `ESDF` and `IJKL`.
- Movement-direction prefetch should wait until viewport-only streaming is
  measured and visibly insufficient.
- Compact binary replay/chunk payloads should be added once JSON metadata proves
  the debug workflow.
- IME/mobile/autocorrect and paste should wait until the ASCII WebGL text buffer
  is stable.

## First Concrete Experiment

Build Step 1 as one narrow vertical slice:

```text
open /webgl
load SingleRock.png
capture semantic checkpoints
export replay JSON + manifest JSON
emit frame-dump PNGs for review
keep screenshot baselines optional for CI
```

This answers the most important near-term question: can the new renderer display
the single-rock smoke test, capture deterministic artifacts, and keep the
artifact contract readable enough for CI to adopt later without rewriting the
flow?
