# Layout Model & Solver

Design decisions for the `od_ui` layout engine (Phase 1). This is the geometry
core: it turns a declared element tree into positioned, sized rectangles in
device pixels, then hands them to the draw-list emitter. It is a focused port of
[Clay](https://github.com/nicbarker/clay)'s multi-pass solver.

Companion docs: [`imgui-core.md`](imgui-core.md) (authoring API, identity,
focus, widgets, theme) and [`text-and-font-metrics.md`](text-and-font-metrics.md)
(text measurement + wrap). Byte-level output format:
[`render-command-abi.md`](render-command-abi.md).

## 1. Scope

**In Phase 1:**

- Sizing: `Fit { min, max }`, `Grow { min, max }`, `Fixed(px)`, `Percent(f32)`
- Direction (row / column), padding (per-side), gap, alignment (main + cross)
- Text measurement and **word wrapping** to a resolved width

**Deferred (do not build in Phase 1):**

- **Floating / attach** — needs surfaces + `world_to_screen`. → Phase 5.
- **Scroll + clipping** — needs the scissor path (ABI §9). → when scissor lands.

The node struct reserves space for both (see §3) so adding them later is
non-structural.

## 2. Coordinate space & the frame model

- **Authoring is in logical pixels.** Every `Fixed`, padding, gap, and font size
  the developer writes is logical. The solver multiplies these by the surface's
  resolved **per-Category scale** (`snap(dpr × settings.scale[category])`, see
  the ABI doc) to produce **device pixels**. The solver computes in device-px
  `f32`; final positions/sizes are integer-snapped only at draw-list emit
  (§7), never mid-solve (snapping mid-solve accumulates error).
- **Deferred solve.** The closure-based authoring API (see `imgui-core.md`)
  builds the full element tree into an arena during declaration. Layout runs
  **once, after the root closure returns.** Widget interaction (`focused`,
  `activated`) is resolved from the *previous* frame's state, not from geometry
  computed this frame — so the solver never has to run mid-declaration.
- Per-frame pipeline: `build tree → solve (§4) → emit draw-list + store rects
  into the retained table → prune`.

## 3. Node model

The tree lives in a per-frame arena (`Vec<LayoutNode>`, indices not pointers;
cleared and reused each frame — no per-frame allocation after warmup).

```rust
struct LayoutNode {
    // ---- config (from the authoring call) ----
    direction: Axis,          // Row | Column (ignored for leaves)
    sizing:    [Sizing; 2],   // [width, height]
    padding:   Padding,       // per-side, logical px (scaled on entry)
    gap:       f32,           // between children, logical px (scaled)
    align:     Align,         // { main: Alignment, cross: Alignment }
    kind:      NodeKind,      // Container | Text(TextHandle) | Spacer

    // ---- tree links (arena indices) ----
    parent:       Option<u32>,
    first_child:  Option<u32>,
    last_child:   Option<u32>,
    next_sibling: Option<u32>,
    child_count:  u32,

    // ---- computed by the solver ----
    size: Vec2,   // resolved device px
    pos:  Vec2,   // resolved top-left, device px, relative to surface origin

    // ---- identity + style ----
    id:    Id,        // see imgui-core.md
    style: StyleRef,  // resolved bg/border/etc. index into a per-frame style pool

    // ---- reserved for deferred features (unused in Phase 1) ----
    // floating: Option<FloatConfig>,
    // scroll:   Option<ScrollConfig>,
}
```

Shared primitives (defined here, reused across the UI crate):

```rust
struct Vec2 { x: f32, y: f32 }
struct Rect { x: f32, y: f32, w: f32, h: f32 }   // device px
struct Color { r: u8, g: u8, b: u8, a: u8 }
struct Padding { top: f32, right: f32, bottom: f32, left: f32 } // + ::all(n), ::xy(x,y)

enum Axis { Row, Column }
enum Alignment { Start, Center, End }   // cross-axis Stretch is achieved via a Grow child
struct Align { main: Alignment, cross: Alignment }

enum Sizing {
    Fit  { min: f32, max: f32 },  // shrink-wrap content, clamped
    Grow { min: f32, max: f32 },  // expand into remaining parent space, clamped
    Fixed(f32),                   // exact logical px
    Percent(f32),                 // fraction (0.0..=1.0) of parent's inner size on this axis
}
```

### Defaults

- Default sizing on both axes: `Fit { min: 0, max: INFINITY }` (shrink-wrap).
- Text nodes default to `Fit` width (measure content) and `Fit` height.
- Default alignment: `{ main: Start, cross: Start }`.
- Default padding: `Padding::all(0)`; default gap: `0`. (The **theme** supplies
  non-zero defaults for `panel`; see `imgui-core.md`.)

## 4. Solver passes

A faithful Clay port. Width is fully resolved before height because text
wrapping (a height-affecting operation) depends on final width. Axis `0` = width,
axis `1` = height.

1. **Fit widths — bottom-up (post-order).** Leaf content widths first:
   - `Text`: width = `FontMetrics::measure_line` of the widest hard-line if no
     wrap; if wrapping, the *fit* width is the longest single word (the minimum
     the text can shrink to). Preferred width = full unwrapped width.
   - `Spacer`: 0.
   Containers combine children: **Row** → `padding.x + Σ child.w + gap·(n−1)`;
   **Column** → `padding.x + max(child.w)`. Then apply this node's own `Sizing`:
   `Fixed` overrides exactly; `Fit` keeps the computed value; `Grow`/`Percent`
   defer to pass 2 but seed their `min`. Clamp to `[min, max]`.

2. **Grow / shrink widths — top-down (pre-order).** For each container, compute
   `remaining = inner_width − Σ children base widths on the main axis`
   (`inner_width = node.w − padding.x`).
   - **Row (main axis = width):** distribute `remaining` across `Grow` children
     using Clay's algorithm — repeatedly add to the *smallest* grow child(ren)
     until they equal the next-smallest, respecting each child's `max`, until
     `remaining` is exhausted or all are capped. If `remaining < 0`, shrink the
     *largest* children symmetrically (respecting `min`).
   - **Column (cross axis = width):** a `Grow` child's width = `inner_width`; a
     `Fit` child keeps its width; `Percent` = `fraction · inner_width`.
   `Percent` on either axis resolves here against the parent's inner size. Clamp
   all results to `[min, max]`.

3. **Wrap text — after widths are final.** For each `Text` node, break its runs
   into lines at the node's resolved inner width (algorithm in
   `text-and-font-metrics.md`). Records line count + per-line glyph layout for
   pass 4 and emit.

4. **Fit heights — bottom-up.** `Text` height = `line_count · line_height`.
   Containers: **Column** → `padding.y + Σ child.h + gap·(n−1)`; **Row** →
   `padding.y + max(child.h)`. Apply own `Sizing`/clamp as in pass 1.

5. **Grow / shrink heights — top-down.** Mirror of pass 2 with axis = height
   (Column distributes along main axis; Row grows children to inner height).

6. **Position + align — top-down.** For each container, lay children along the
   main axis starting at `pos + padding_start`, advancing by `child.size_main +
   gap`. `align.main` shifts the whole run within leftover main-axis space
   (`Start`/`Center`/`End`); `align.cross` positions each child within the
   cross-axis extent. Each child's `pos` is set absolute (surface-relative).

## 5. Grow distribution (detail)

Clay's "grow the smallest first" keeps growth even and respects caps:

```
grow = children with Grow sizing on the axis, not yet at max
while remaining > EPS and grow not empty:
    smallest        = min current size among grow
    next_smallest   = smallest next distinct size (or +inf)
    headroom        = min(next_smallest, min max-cap among the smallest set) - smallest
    n               = count at smallest
    step            = min(headroom, remaining / n)
    add step to every child at `smallest`; remaining -= step * n
    drop children that hit their max from `grow`
```

Shrink (`remaining < 0`) is the mirror: subtract from the *largest* children
down toward `min`. Both must terminate (each iteration either exhausts
`remaining` or removes a child from the working set).

## 6. Determinism

The solver is a pure function of `(tree, theme, category scale, FontMetrics)`.
No wall-clock, no RNG, no floating-point nondeterminism beyond IEEE `f32` (all
platforms agree). This is what makes the golden-snapshot tests (ABI §8)
faithful: the same tree always produces the same rects and draw-list.

## 7. Output / emit

After pass 6, walk the tree in **pre-order** (parents before children, so
children paint on top) and emit into the ABI arenas:

- For each `Container`/`Spacer` with a visible style: one `RectInstance` for the
  background, plus border rects (flat borders — four inset rects, no radius).
- For each `Text` node: one `GlyphInstance` per glyph from the wrapped layout.
- Positions/sizes are `round()`-snapped to integer device px **here only**.
- Each node's final device-px `Rect` is written into the retained table keyed by
  `id` (for next-frame focus-highlight rendering and future mouse hit-testing).

Paint order is declaration order; there is no z-index in Phase 1 (floating,
which introduces z-ordering, is deferred).
