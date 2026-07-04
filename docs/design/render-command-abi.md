# Render-Command ABI (Phase 0)

**Status:** Approved design — 2026-07-03 **Parent:**
[`../GAME_ENGINE_ARCHITECTURE.md`](../GAME_ENGINE_ARCHITECTURE.md) → Phase 0
**Scope:** The exact byte-level contract by which `od_wasm` (main-thread
instance) hands a rendered UI frame to the TS consumer each frame, and how TS
turns it into WebGL2 draw calls. This is the "Define the render-command ABI"
deliverable; it is meant to be implementable by a straightforward coding agent.

---

## 0. Overview

Each frame, TS writes input into one region of wasm memory, calls
`UiEngine::frame()`, and reads back **GL-ready instance buffers + a
paint-ordered draw-list** by zero-copy views. Rust makes every visual decision
(layout, glyph placement, colors, clip rects); TS is a faithful executor that
adds _no_ visual decisions — only a lossless coordinate flip (deferred, see §4)
and GPU upload.

Design invariants (from the architecture interview):

- **Zero-copy + fixed arenas.** Arenas allocated once at a fixed capacity;
  overflow drops + bumps a debug counter; never reallocated mid-run.
- **Rust is the source of truth** for all layout and for the ABI constants
  themselves (§7).
- **Deterministic layout** over explicit inputs (§8) so native golden tests
  match the client exactly.

---

## 1. Artifact set & arena organization

Three arenas in wasm linear memory + one returned count:

1. **Rect instance arena** — `f32`, homogeneous stride **8** (§6.1). Matches
   `ui-rect`.
2. **Glyph instance arena** — `f32`, homogeneous stride **12** (§6.1). Matches
   `ui-text`.
3. **Draw-list arena** — packed `DrawCmd` records (§2) in **paint order**, each
   referencing an instance arena.
4. **`frame()` returns `draw_list_count`** — the number of `DrawCmd`s this
   frame. Instance ranges are self-described by each `DrawCmd`, so no other
   counts are returned.

Rendering = walk the draw-list in order; for each cmd, pick the arena by
`program`, upload its instance slice, draw. Interleaving of rects and glyphs is
preserved by draw-list order while each arena stays homogeneous. A future 4th
arena (UI sprite/icon atlas) is an additive change, not a re-encode.

---

## 2. `DrawCmd` record layout

Fixed **32-byte** record, all full-width fields (no bit-packing),
**little-endian** (wasm memory is LE; every `DataView` read passes
`littleEndian = true`).

| Byte | Type  | Field             | Notes                                                                                         |
| ---- | ----- | ----------------- | --------------------------------------------------------------------------------------------- |
| 0    | `u32` | `program`         | `0 = Rect`, `1 = Text` (future `2 = Sprite`); selects arena + GL program + fixed texture unit |
| 4    | `u32` | `instance_offset` | index **in instances** into that program's arena                                              |
| 8    | `u32` | `instance_count`  | instances to draw                                                                             |
| 12   | `i32` | `scissor_x`       | UI-space px, top-left origin (§3, §4)                                                         |
| 16   | `i32` | `scissor_y`       |                                                                                               |
| 20   | `i32` | `scissor_w`       | **`< 0` ⇒ no clip** (sentinel)                                                                |
| 24   | `i32` | `scissor_h`       |                                                                                               |
| 28   | `u32` | `reserved`        | forward-compat: future `texture_id` / flags                                                   |

- **Offset units = instances.** TS uploads
  `arena.subarray(offset*stride, (offset+count)*stride)`.
- **Per-batch, self-contained scissor** (not push/pop). Each cmd carries its
  _effective_ (already-intersected) clip; `scissor_w < 0` means unclipped, so no
  separate flag is needed.
- **`reserved`** absorbs `texture_id` later (multi-atlas UI icons) without
  changing record size. For now `program` implies the texture (Rect→`white`,
  Text→`font`).
- `program` enum values are shared consts from `od_core`, surfaced to TS via
  generated consts (§7).

---

## 3. Coordinate space & units

- **Arenas carry device pixels, integer-snapped.** `pos`/`size` are device px,
  matching `canvas.width/height` (= `clientWidth × dpr`), the `gl.viewport`, and
  the `canvasSize` uniform. Rust owns the integer snap (the
  `Math.round`/`snap()` the old TS did). Pixel snapping must be in device px —
  the only space where a "pixel" is a real pixel.
- **Rust receives per frame:** `framebuffer_w`, `framebuffer_h` (device px) and
  `dpr` (`f32`). These live in the input arena (§5, input layout defined in the
  Input design round).
- **UI authored in logical units**; Rust multiplies by an integer scale at emit.
- **Scale is per-`Category`, resolved in Rust from sovereign settings × dpr,
  snapped.** _Not_ a single global scale.

### `Category` (locked, in `od_core`)

Each surface declares a `Category`; Rust resolves
`ui_scale(cat) = snap(dpr × settings.scale[cat])` (integer for crisp bitmap
categories; continuous later for world-embedded/MSDF). The settings screen
exposes one scale slider per category.

| Category     | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `MainMenu`   | Sovereign-domain screens: title/main menu, pause/ESC menu, settings        |
| `Menu`       | In-session game panels: inventory, dialogs, context menus                  |
| `Hud`        | Always-on in-game overlay: status, minimap, hotbar                         |
| `WorldEvent` | World-anchored annotations: chat bubbles, nameplates, floating combat text |
| `Tooltip`    | Hover popups (screen or world-anchored)                                    |
| `Debug`      | Developer overlay: FPS, diagnostics                                        |

`Menu` (in-game) and `MainMenu` (sovereign screens) are intentionally distinct
scale buckets. Category also implies the snap policy (integer now; a future
continuous-zoom world-embedded category skips the snap and uses the MSDF
`FontMetrics` impl).

Scale resolution and category are **internal to `od_ui`**; the ABI wire format
(arenas) is unaffected — it always carries final device px.

---

## 4. Scissor semantics

The single y-flip between UI space (top-left, y-down) and WebGL's raster stage
(bottom-left, y-up) is **irreducible** — geometry already handles it invisibly
via the vertex shader's `* vec2(1.0, -1.0)`; scissor can't go through the shader
(`gl.scissor` and `gl_FragCoord` are both bottom-left), so it needs the same
flip in the consumer.

Decisions:

- **Rust stays 100% top-left device px.** `od_ui` never touches GL conventions.
- **Rust owns clip intersection.** Because scissor is per-batch and
  self-contained, Rust emits the _effective_ (intersected) clip for nested
  scroll containers; TS never intersects.
- **Clipping is deferred until scroll containers land.** Through Phase 0 the
  `scissor_*` fields are inert (`scissor_w < 0`, no clip). TS just checks the
  sentinel and keeps `SCISSOR_TEST` disabled.
- **When scroll arrives**, the one-line flip goes in the TS draw loop:
  ```
  y_gl = framebuffer_h - (scissor_y + scissor_h)
  gl.scissor(scissor_x, y_gl, scissor_w, scissor_h)   // after clamping to [0, framebuffer]
  ```
  toggling `SCISSOR_TEST` on the `w < 0` sentinel with redundant-state skipping.
  GL-coordinate handling lives on the consumer side, where the shader flip
  already lives.

---

## 5. wasm export surface

A `#[wasm_bindgen]` `UiEngine` handle:

- `UiEngine::new(...)` — allocates the fixed-cap arenas (rect, glyph, draw-list,
  input) once. TS holds the handle.
- **One-time getters** (stable for the engine's lifetime; arenas never
  reallocate):
  - `rect_ptr() -> *const f32`, `glyph_ptr() -> *const f32`,
    `drawlist_ptr() -> *const u8`, `input_ptr() -> *mut u8` — addresses into the
    exported `WebAssembly.Memory`.
  - `rect_capacity()`, `glyph_capacity()`, `drawlist_capacity()`,
    `input_capacity()`.
- **`frame() -> u32`** — reads the input arena (holds pointer/keys/events
  **and** `framebuffer_w/h`/`dpr`), runs layout, fills the output arenas,
  returns `draw_list_count`. Takes no arguments (single input region; symmetric
  with single-call output).
- **ABI-const getters** for the dev backstop (§7): `abi_drawcmd_stride()`,
  `abi_program_text()`, `abi_rect_stride()`, `abi_glyph_stride()`, etc.

TS derives its three output views once from the getters, re-deriving only when
the grow-guard trips: `if (memory.buffer !== cachedBuffer) rederiveViews()`.

---

## 6. Consumer (TS) upload strategy

### 6.1 Instance record layouts (must match the existing VAOs exactly)

**RectInstance — 8 f32 / 32 B** (matches `ui-rect` VAO):

| Float | Byte | Field      |
| ----- | ---- | ---------- |
| 0–1   | 0    | `pos.xy`   |
| 2–3   | 8    | `size.xy`  |
| 4–6   | 16   | `tint.rgb` |
| 7     | 28   | `alpha`    |

**GlyphInstance — 12 f32 / 48 B** (matches `ui-text` VAO):

| Float | Byte | Field          |
| ----- | ---- | -------------- |
| 0–1   | 0    | `pos.xy`       |
| 2–3   | 8    | `size.xy`      |
| 4–7   | 16   | `uv_rect.xyzw` |
| 8–10  | 32   | `tint.rgb`     |
| 11    | 44   | `alpha`        |

The shared unit-quad `corner` attribute (`[0,0, 1,0, 0,1, 1,1]`,
`TRIANGLE_STRIP`) is provided by the existing vertex buffer, divisor 0.

### 6.2 Draw loop

- **One `frame()` → one unified, paint-ordered draw-list → one loop.** `frame()`
  runs all surfaces (session first, sovereign last), domain isolation internal
  to Rust. The UI loop runs _after_ the world pipeline (world → UI on top).
- **Per-batch upload to offset 0** (reuse `flushInstanceBatch` semantics). For
  each `DrawCmd`: read the slice from the arena view (zero-copy),
  `bufferSubData(buffer, 0, slice)`,
  `drawArraysInstanced(TRIANGLE_STRIP, 0, 4, instance_count)`.
- **Phase 0 reuses the existing shared instance buffer + `ui-rect`/`ui-text`
  programs/VAOs.** Caveat: shared buffer caps one batch at
  `MAX_INSTANCES = 8192`; a later step gives the UI its own larger GL buffers.
- **Bind program/VAO only on change**; `setGlobals(canvasSize, simTick)` once
  per program per frame (screen-space; no camera/zoom).
- **Textures:** none per batch — `ui-rect`→`white`, `ui-text`→`font` are fixed
  sampler units; atlases uploaded once (font async).
- **Blend:** non-premultiplied alpha (`SRC_ALPHA`, `ONE_MINUS_SRC_ALPHA`)
  enabled once for the UI phase (`loadUiFontAtlas` uses
  `UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0`).
- **Scissor:** inert (§4).

Rejected alternative: "upload each arena once + draw sub-ranges." WebGL2 lacks
`baseInstance` without the non-guaranteed
`WEBGL_draw_instanced_base_vertex_base_instance` extension, so sub-range draws
would require per-batch `vertexAttribPointer` re-binding — _more_ GL calls than
a `bufferSubData`. Kept as a back-pocket optimization (with dedicated buffers)
if batch/upload volume ever profiles hot.

---

## 7. Constant sync mechanism (Rust ↔ TS)

Rust `od_core` is the single source of truth. **TS cannot read wasm exports at
compile time** (the binary is a runtime artifact), so compile-time TS consts
require codegen.

- **Rust self-verification (mandatory pattern for every ABI record):**
  `#[repr(C)]` + `bytemuck::{Pod, Zeroable}` + compile-time assertions tying
  consts to the real layout:
  ```rust
  #[repr(C)]
  #[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
  pub struct DrawCmd { /* fields from §2 */ }
  pub const DRAWCMD_STRIDE: u32 = 32;
  const _: () = assert!(core::mem::size_of::<DrawCmd>() == DRAWCMD_STRIDE as usize);
  const _: () = assert!(core::mem::offset_of!(DrawCmd, instance_count) == 8);
  const _: () = assert!(core::mem::offset_of!(DrawCmd, scissor_w) == 20);
  ```
  Same treatment for `RectInstance`/`GlyphInstance` (their `offset_of!` values
  double-check the GL `vertexAttribPointer` offsets in §6.1). Rust writes typed
  structs straight into arenas via `bytemuck::cast_slice`, so the self-verified
  struct _is_ the emitter.
- **Codegen (Option A):** a dedicated `xtask`/bin target, run via
  `deno task abi:gen`, emits `abi.generated.ts` (strides, field offsets,
  `program` enum values, record size). TS imports it as compile-time consts.
  Wired into `engine:build`; CI fails on a dirty generated file
  (`git diff --exit-code`). Not `build.rs` (source-tree writes cause rebuild
  loops).
- **Dev-only runtime backstop (recommended):** `UiEngine` exports the canonical
  values (§5 ABI-const getters); in debug builds TS asserts its generated consts
  equal the exports at init and throws loudly on mismatch. Catches stale
  artifacts / hand edits.

---

## 8. Testability contract

The arenas + draw-list are a **complete, self-contained description of the
frame**; TS makes no visual decisions. Therefore:

- **`od_ui` layout is a pure deterministic function of explicit inputs** — no
  internal clocks, no RNG. Any animation time is **passed in** as a frame
  timestamp. Given identical inputs, Rust emits an identical draw-list, so
  native tests match the client.
- **`od_ui` exposes a structured frame output** (typed draw-list + typed
  instances) for native golden-snapshot tests to assert on (positions, sizes,
  colors, clip rects). Byte-packing into arenas is a thin, separately-tested
  layer.
- The draw-list is the authoritative visual truth; the existing TS engine can
  serve as a parity reference during development (see parent plan's migration
  strategy), but the golden tests are the durable check.

---

## 9. Deferred / out of scope here

- **Input arena byte layout** — defined in the Input design round (Phase 2); §5
  only fixes that `frame()` reads it and that it carries
  `framebuffer_w/h`/`dpr` + pointer/keys/events.
- **Scissor flip implementation** — lands with scroll containers (§4).
- **`texture_id`** (multi-atlas UI icons) — the `reserved` word holds its place.
- **Dedicated UI GL buffers** — optimization past Phase 0 (§6.2).
