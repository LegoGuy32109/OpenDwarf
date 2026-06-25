# WebGL2 Rewrite Plan

A clean-room rewrite of the WebGL rendering layer, designed to scale to a Dwarf
Fortress–level game. Built in parallel with the existing renderer; the existing
code is the visual oracle until cutover.

This document is the contract for v1. If a decision here contradicts what's
being implemented, fix the implementation or update this doc — don't drift.

---

## Goal & scope

**Build a new WebGL2 renderer with the abstractions needed to scale, shipping
at visual parity with the current renderer.**

In:

- All current visuals: floor stack, edge shadows, ceiling shadows, FOV fog,
  player sprite, chat bubbles, FPS/TPS readout, status text.
- Entity view-mode and free view-mode.
- Smooth player position interpolation, occlusion check against rock above,
  z-range gate.
- Chunk streaming, FOV recompute, depth-tinted floor.

Out (deferred to v2+):

- Replay/checkpoint harness — `globalThis.__openDwarfWebGlHarness` does not
  exist in v1. No state hashes, no scene snapshots, no replay JSON, no
  baseline manifests, no checkpoint capture.
- Event log panel.
- Capability info dump on canvas (it logs to `console.info` at phase 1 done
  instead).
- UI overlay toggle key.
- Canvas2D fallback path.
- FBO infrastructure.
- UBO infrastructure.
- Hot-reload of shaders.
- Multi-entity rendering — player is hardcoded; future NPCs add a new pass.
- `dev`-only GL wrapper with per-call `getError()`.

---

## Top-level decisions

| # | Decision | Notes |
|---|---|---|
| 1 | Parallel development on a new route | `/webgl2` → `WebGlGameCanvas2.tsx`. Old code untouched until cutover. |
| 2 | Visual parity only for v1 | No new features. Side-by-side compare against old code is the test. |
| 3 | Pass-registry of free-function modules | One file per pass; `passes/index.ts` exports `ALL_PASSES` in draw order. |
| 4 | Each pass: optional `prepare()` + required `draw()` | Runner walks all `prepare`s then all `draw`s per frame. |
| 5 | Caches live as their own modules, not on `ctx` | Module-level singletons; pass files import them. Re-evaluate if a second renderer instance is ever needed. |
| 6 | Single-layer file structure | `islands/webgl2/*`. Engine-vs-game distinction is a mental model only. |
| 7 | Seven shader programs, one per pass family | `floor`, `edge-shadow`, `ceil-shadow`, `fog`, `sprite`, `ui-text`, `ui-rect`. No `u_render_mode` branching. |
| 8 | Per-pass instance schema (stride-per-pass) | Each program has its own attribute layout sized to what varies. |
| 9 | Per-instance alpha on all textured passes | Per the design discussion. Note: on `floor`, alpha is uploaded but inert while `blend: "off"`. |
| 10 | Permanent named texture units | Each texture gets a `TEXTURE_UNITS.<name>` slot, bound once at load. No per-frame rebinding. |
| 11 | GLSL inline as TS template literals | One file per program: `programs/<name>.ts` exports `{ vert, frag, attribs, sampler }`. Shared chunks in `_chunks.ts`. |
| 12 | Per-program uniform writes (no UBO) | `setGlobals(camera, zoom, canvasSize, simTick)` per program. UBO is a future optimization (note in `_chunks.ts`). |
| 13 | One shared static vertex buffer + one shared dynamic instance buffer + seven VAOs | Each VAO interprets the shared instance buffer at its own stride. |
| 14 | Declarative `PassState.blend` enforced by the runner | `"off"` or `"alpha"` for v1. Pass code doesn't call `gl.enable`/`gl.disable` directly. |
| 15 | Critical-point `gl.getError()` only | Shader compile, program link, end-of-init. No hot-path checks. No dev wrapper. |
| 16 | Three-phase boot, no canvas2d fallback | Sync init → async asset load → steady state. Phase boundaries logged to console. |
| 17 | Hardcoded player pass; entity collection deferred | `passes/player.ts` emits one instance. NPCs land later in `passes/entities.ts`. |
| 18 | No harness, no replay, no checkpoints | Hundreds of LoC drop. Restored when game and visual systems stabilize. |
| 19 | Minimal UI in v1 | Chat bubbles, chat input bar, FPS/TPS, status text. No log panel, no capability overlay, no toggle. |

---

## Core abstractions

### `Pass<TCtx>`

```ts
type BlendMode = "off" | "alpha";

type PassState = {
  blend?: BlendMode;
};

type Pass<TCtx> = {
  name: string;
  program: keyof Programs;
  state?: PassState;
  enabled?: (ctx: TCtx) => boolean;
  prepare?: (ctx: TCtx) => void;
  draw: (ctx: TCtx) => void;
};
```

### `FrameContext`

Slim. Game-shaped, lives in `frame-context.ts`. Built once per frame by
`frame-builder.ts`.

```ts
type FrameContext = {
  // mechanical
  gl: WebGL2RenderingContext;
  programs: Programs;            // { floor, edgeShadow, ... }
  scratch: Float32Array;
  instanceBuffer: WebGLBuffer;
  maxInstances: number;
  batchStats: { drawCalls: number; instances: number };

  // frame snapshot — universal, minimal
  frame: {
    camera: { x: number; y: number; zoom: number };
    viewport: {
      cssWidth: number; cssHeight: number; dpr: number;
      fbWidth: number; fbHeight: number;
    };
    viewZ: number;
    dtSeconds: number;
    simTick: number;
    frameNumber: number;
    visibleTileBounds: { minX: number; minY: number; maxX: number; maxY: number };
    visibleChunkKeys: ChunkKey[];
    world: WorldSimState;        // read-only by convention
  };

  // render policy — how to display
  policy: {
    viewMode: "entity" | "free";
    layers: { floor: boolean; edgeShadow: boolean; ceilShadow: boolean; depthTint: boolean };
  };
};
```

Caches (`caches/topmost.ts`, `caches/fov.ts`, `caches/visible-region.ts`) are
not on `ctx`. Pass files import them directly.

### Frame loop

```
1. simulate(ctx)         // advance sim tick(s), smooth player, move camera
2. buildFrameContext()   // populate ctx.frame
3. for each pass:        // if enabled, pass.prepare?.(ctx)
4. for each pass:        // if enabled, set blend, bind VAO+program+globals, pass.draw(ctx)
5. scheduleNextFrame()
```

`pass-runner.ts`:

```ts
export function runPasses(ctx: FrameContext, passes: Pass<FrameContext>[]) {
  for (const p of passes) {
    if (!p.enabled || p.enabled(ctx)) p.prepare?.(ctx);
  }
  let currentBlend: BlendMode = "off";
  for (const p of passes) {
    if (p.enabled && !p.enabled(ctx)) continue;
    const desired = p.state?.blend ?? "off";
    if (desired !== currentBlend) {
      applyBlend(ctx.gl, desired);
      currentBlend = desired;
    }
    const prog = ctx.programs[p.program];
    ctx.gl.bindVertexArray(prog.vao);
    ctx.gl.useProgram(prog.handle);
    prog.setGlobals(ctx.frame.camera, ctx.frame.camera.zoom, /* canvasSize */, ctx.frame.simTick);
    p.draw(ctx);
  }
}
```

---

## Shader programs

Seven programs, each with its own VAO and per-instance schema.

| Program | Stride (floats) | Layout | Blend | Sampler unit |
|---|---|---|---|---|
| `floor` | 7 | `[x, y, frame, tintR, tintG, tintB, alpha]` | off | `floor` |
| `edge-shadow` | 5 | `[x, y, w, h, alpha]` | alpha | `edgeShadow` |
| `ceil-shadow` | 4 | `[x, y, frame, alpha]` | alpha | `ceilShadow` |
| `fog` | 3 | `[x, y, alpha]` | alpha | `white` (or none) |
| `sprite` | 12 | `[x, y, w, h, uvX, uvY, uvW, uvH, tintR, tintG, tintB, alpha]` | alpha | `sprite` |
| `ui-text` | 12 | same as sprite (screen-space) | alpha | `font` |
| `ui-rect` | 8 | `[sx, sy, w, h, tintR, tintG, tintB, alpha]` | alpha | `white` |

**Convention:** first two floats are always position (world or screen). Vertex
shaders standardize on `a_pos` for slot 0.

**Frame index → UV shortcut:** for uniform-grid atlases (`floor`,
`ceil-shadow`), the vertex shader computes UV from a single `frame` float
plus a compile-time `NUM_FRAMES` constant. Sprite/text use full uv rects because
their atlases aren't uniform grids.

**Globals (uniforms set per frame via `setGlobals`):**

- `u_camera: vec2` (world-space programs only)
- `u_zoom: float` (world-space programs only)
- `u_canvas_size: vec2` (all programs — for NDC conversion)
- `u_sim_tick: float` (all programs — for future animation; unused in v1)

Each program file declares which globals it needs. `getUniformLocation`
returning null is a no-op in `setGlobals`.

**Note in `programs/_chunks.ts`:** "If program count exceeds ~10 or per-frame
global data grows beyond a handful of floats, migrate to a UBO. The migration
is mechanical and isolated to this file plus the program loader."

---

## Texture units

```ts
export const TEXTURE_UNITS = {
  floor: 0,
  edgeShadow: 1,
  ceilShadow: 2,
  sprite: 3,
  font: 4,
  white: 5,
} as const;
```

Bound once at load. Programs' sampler uniforms set once at program init. Zero
per-frame `bindTexture` calls.

Helper: `bindTextureToUnit(gl, unit, tex)` — does both `activeTexture` and
`bindTexture`. Use at load time; never call raw `gl.activeTexture` elsewhere.

---

## Boot (three phases)

### Phase 1 — synchronous

```
console.info("[webgl2] phase 1 start: sync boot");
const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false,
                                         stencil: false, premultipliedAlpha: false,
                                         powerPreference: "high-performance" });
if (!gl) {
  draw2dErrorMessage(canvas, "WebGL2 required to play");
  return;
}
const programs = compilePrograms(gl);
const { vertexBuffer, instanceBuffer } = createBuffers(gl);
attachVaosToPrograms(gl, programs, vertexBuffer, instanceBuffer);
const textures = createTextureSlots(gl); // 1×1 transparent placeholders
attachEventListeners(canvas, window);
scheduleNextFrame(); // RAF starts; render gated on sceneReady
const t = Math.round(performance.now() - t0);
console.info(`[webgl2] phase 1 done: sync boot (${t}ms) — 7 programs, 7 VAOs`);
console.info("[webgl2] capability:", { renderer, vendor, maxTextureSize, ... });
```

`preserveDrawingBuffer: true` is **not** set — there's no `canvas.toBlob`
capture path in v1.

### Phase 2 — async asset load

```
console.info("[webgl2] phase 2 start: loading assets");
await Promise.all([
  loadAtlasInto(gl, TEXTURE_UNITS.floor,      "/assets/sprites/StackedTextures.png"),
  loadAtlasInto(gl, TEXTURE_UNITS.edgeShadow, "/assets/sprites/ShadowAtlas.png"),
  loadAtlasInto(gl, TEXTURE_UNITS.ceilShadow, "/assets/sprites/ObscureAtlas.png"),
  loadAtlasInto(gl, TEXTURE_UNITS.sprite,     "/assets/sprites/Dwarf_16x16.png"),
  loadAtlasInto(gl, TEXTURE_UNITS.font,       "/assets/sprites/JoshPerfectDosVga.png"),
  uploadWhiteTo(gl, TEXTURE_UNITS.white),
]);
populateInitialChunkCache(viewZ);
sceneReady = true;
const t = Math.round(performance.now() - tPhase2);
console.info(`[webgl2] phase 2 done: loading assets (${t}ms) — 5 textures, font ready`);
console.info("[webgl2] phase 3 start: steady state (sceneReady=true)");
```

### Phase 3 — steady state

RAF loop runs every frame. Input handlers and resize handlers run regardless
of `sceneReady`. The render path checks the flag and early-exits with a clear
to background color while false.

---

## File layout

```
routes/
  webgl2.tsx                          # new route

islands/
  WebGlGameCanvas2.tsx                # ~150 lines

islands/webgl2/
  gpu-init.ts                         # phase 1 sync boot
  gpu-types.ts                        # Pass<TCtx>, PassState, BlendMode
  pass-runner.ts                      # runPasses() + applyBlend()
  instance-batch.ts                   # flushInstanceBatch()
  texture-units.ts                    # TEXTURE_UNITS, bindTextureToUnit, loadAtlasInto
  gl-errors.ts                        # error-name lookup + critical-point checks
  frame-context.ts                    # FrameContext type
  frame-builder.ts                    # populates ctx.frame per frame
  render-loop.ts                      # simulate → prepare → draw
  input.ts                            # createInputHandlers(deps)

  programs/_chunks.ts                 # GLOBALS_UNIFORMS, CAMERA_TRANSFORM + UBO note
  programs/floor.ts
  programs/edge-shadow.ts
  programs/ceil-shadow.ts
  programs/fog.ts
  programs/sprite.ts
  programs/ui-text.ts
  programs/ui-rect.ts
  programs/index.ts                   # compilePrograms(gl)

  passes/floor.ts
  passes/edge-shadow.ts
  passes/ceil-shadow.ts
  passes/fog.ts
  passes/player.ts
  passes/chat.ts
  passes/hud.ts
  passes/index.ts                     # ALL_PASSES in draw order

  caches/topmost.ts
  caches/fov.ts
  caches/visible-region.ts            # game-side culling
```

Notes:

- No `engine/` directory. Mental separation only.
- `lib/webgl-chunk-gen.ts`, `lib/webgl-world-sim.ts` are reused as-is.
- No central `webgl-core.ts` junk-drawer. Constants live with what uses them
  (e.g. `SHADOW_ALPHA_MULTIPLIER` belongs in `passes/ceil-shadow.ts`).
- No `.glsl` / `.vert` / `.frag` files. All shader text is TS template
  literals.

---

## Draw order (final pass registry)

```ts
// passes/index.ts
export const ALL_PASSES: Pass<FrameContext>[] = [
  FloorPass,         // blend: off
  EdgeShadowPass,    // blend: alpha
  CeilShadowPass,    // blend: alpha
  FogPass,           // blend: alpha; enabled: ctx => ctx.policy.viewMode === "entity"
  PlayerPass,        // blend: alpha
  ChatPass,          // blend: alpha — bubbles above player + active input bar bg
  HudPass,           // blend: alpha — fps/tps + status text
];
```

Blend transitions per frame: `off → alpha` (after floor). One transition.

---

## Implementation order (eight slices)

Each slice is shippable to localhost and visually verifiable.

### Slice 1 — skeleton

- `routes/webgl2.tsx`, `WebGlGameCanvas2.tsx`
- `gpu-init.ts` (context, error fallback, phase 1 console log)
- Empty `pass-runner.ts`, `frame-context.ts`, `render-loop.ts`
- RAF loop clears to background color

**Verifies:** new route works, parallel dev confirmed, phase 1 prints.

### Slice 2 — floor end-to-end

- `programs/_chunks.ts`, `programs/floor.ts`, `programs/index.ts` (floor only)
- `instance-batch.ts`, `texture-units.ts`, `gl-errors.ts`
- `caches/visible-region.ts`, `caches/topmost.ts` (basic)
- `passes/floor.ts`, `passes/index.ts`
- `frame-builder.ts`
- Phase 2 async load for floor atlas only

**Verifies:** the entire program / VAO / pass / cache pipeline works end-to-end
with one program.

### Slice 3 — shadows

- `programs/edge-shadow.ts`, `programs/ceil-shadow.ts`
- `passes/edge-shadow.ts`, `passes/ceil-shadow.ts`
- Blend mode transitions exercised

**Verifies:** multi-pass, multi-program, declarative blend.

### Slice 4 — FOV + fog + view-mode policy

- `caches/fov.ts`
- `programs/fog.ts`, `passes/fog.ts`
- `policy.viewMode` wired through input controller
- Floor pass learns visible/remembered/unseen branching

**Verifies:** policy split, cross-pass cache sharing, view-mode toggle.

### Slice 5 — player

- `programs/sprite.ts`, `passes/player.ts`
- Smooth player position interp
- Occlusion check against rock above
- Z-range gate via `enabled()`

**Verifies:** sprite program flow. First stable playable build.

### Slice 6 — UI

- `programs/ui-text.ts`, `programs/ui-rect.ts`
- VGA font atlas loaded in phase 2
- `passes/chat.ts` (bubbles + input bar bg)
- `passes/hud.ts` (FPS/TPS + status)

**Verifies:** screen-space program, full text rendering, UI parity.

### Slice 7 — parity polish

- Side-by-side compare against `/` (old route)
- Any remaining visual diffs resolved
- Resize/fullscreen fully wired
- Clean up phase logs / verify timing

**Verifies:** new route is visually indistinguishable from the old.

### Slice 8 — cutover

- Repoint main route at the new code
- Delete `islands/WebGlGameCanvas.tsx`, all of `islands/webgl/`
- Delete `.vert`/`.frag` files and any build step that processed them
- Delete `shaders.ts`, `shaders.d.ts` in the old tree
- (No harness rename — there is no harness in v1)

**Verifies:** everything still works without the old code.

---

## Things explicitly NOT in v1

These are real things we discussed and chose to defer. Each has a known trigger
for when to revisit.

| Deferred | Revisit when |
|---|---|
| Harness / replay / checkpoints | Game and visual systems stabilize |
| FBO infrastructure | First feature that needs offscreen rendering (lighting, minimap, post-FX) |
| UBO for globals | Program count exceeds ~10 or per-frame global data grows substantially |
| Entity collection (multi-entity rendering) | Sim adds `world.entities[]` |
| Hot-reload of shaders | Iteration speed becomes painful |
| Dev-only per-call `gl.getError()` wrapper | Hard-to-debug per-frame GL bug appears |
| Canvas2D fallback | Never. WebGL2 is universal in current browsers |
| Log panel + capability overlay + UI toggle | Game-level config UI needs them |
| `preserveDrawingBuffer: true` | FBO-based capture replaces canvas.toBlob path |
| Cache factory pattern (per-renderer instances) | Second renderer instance (split-screen, minimap-as-renderer) |

---

## What this rewrite is intentionally *not* solving

- **Sim/render decoupling.** The renderer drives sim ticks via RAF, same as
  today. Decoupling (fixed-step sim with render interpolation) is a separate
  project.
- **Animation system.** `u_sim_tick` is uploaded but no shader uses it in v1.
- **Lighting.** No shader has light contributions. No light caches.
- **Particles.** No transform feedback, no compute paths.
- **Multiple tilesets / hot-swap.** One floor atlas, one shadow atlas, one
  player sprite sheet. Hot-swap is a one-`bindTexture` call when needed —
  add later.

---

## Open conventions

- **GLSL syntax highlighting:** tag template literals with `/* glsl */` so
  the `glsl-literal` VS Code extension highlights them.
- **Shader compile error printing:** the program loader, on failure, prints
  the full concatenated source with 1-indexed line numbers so GL's "error on
  line N" maps to a visual location.
- **Constants for magic numbers:** every depth tint, edge segment width,
  shadow alpha lives next to the pass that uses it. No central constants
  file.
- **No emoji in code or logs.** Match existing project style.

---

## Quick-reference: per-frame work

For a frame with all passes enabled and ~1500 visible tiles:

1. Input poll (event handlers ran via DOM, state already in refs).
2. `simulate()` — 0–3 sim ticks (20Hz target, capped at 3/frame).
3. `buildFrameContext()` — recompute camera, viewport, visible bounds.
4. `prepare()` for each pass — topmost cache, FOV cache, etc. (cached; cheap
   when clean).
5. `draw()` for each pass — write scratch, `bufferSubData`, `drawArraysInstanced`.
6. Total draw calls: roughly 7 (one per pass; sometimes more if a pass
   needs split-flushes).
7. Total program switches: up to 7. Total VAO binds: up to 7. Total texture
   binds: 0.
8. `scheduleNextFrame()`.

Target: <16ms per frame at 60Hz on mid-range hardware.

---

## Cutover checklist

When slice 7 reaches parity and you're ready for slice 8:

- [ ] Side-by-side visual compare on `/` vs `/webgl2` shows no diffs at
      identical seed/camera/viewZ.
- [ ] Resize works on both routes identically.
- [ ] Fullscreen works on both routes identically.
- [ ] All input keys behave identically.
- [ ] FPS on `/webgl2` is ≥ FPS on `/` on the same hardware.
- [ ] Console phase logs appear cleanly at boot.

Then in one commit:

- [ ] Repoint main route.
- [ ] Delete old island, old `islands/webgl/`, `.vert`/`.frag` files.
- [ ] Delete `routes/webgl2.tsx` (or rename it to the main route's filename).
- [ ] Rename `islands/webgl2/` to `islands/webgl/` (or leave as-is if you
      prefer the explicit name).
- [ ] Update README if it references the old code paths.

---

## Status

Design phase complete (this document). Implementation starts at slice 1.
