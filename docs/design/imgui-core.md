# IMGUI Core: Authoring API, Identity, Focus, Retained State, Widgets, Theme

Design decisions for the immediate-mode UI core of `od_ui` (Phase 1). Covers how
a developer declares UI, how elements are identified, how keyboard focus moves,
how per-widget state persists across frames, the Phase 1 widget set, and
theming.

Companion docs: [`layout-solver.md`](layout-solver.md) (geometry) and
[`text-and-font-metrics.md`](text-and-font-metrics.md) (text).

## 1. Interaction model: keyboard-focus-first

Phase 1 is **keyboard/focus driven. Mouse (pointer hit-testing, hover, click) is
deferred.** Consequences:

- Interaction does not depend on this-frame geometry. Focus traversal uses
  **declaration order**, not rect positions (for `Linear` scopes).
- The world-tile "look/designate" cursor is a **separate** game-domain concern
  over the `ClientView` (Phase 4/5), not part of the widget-focus system.

## 2. Authoring API: closure-scoped builders

The UI tree is declared with nested closures. Opening a container takes its
config plus a closure that declares its children; the closure body **is** the
node's scope, so the ID stack and tree nesting open/close automatically and can
never be mismatched.

```rust
ui.column(Layout::new().grow().gap(4), |ui| {
    ui.text("Paused", Text::default());
    ui.row(Layout::new().gap(8), |ui| {
        if ui.button("resume", "Resume").activated { /* ... */ }
        ui.button("quit", "Quit");
    });
});
```

- `ui` is `&mut Ui` re-borrowed into each child closure.
- Container methods: `column`, `row`, `grid`, `panel` — each `(config, closure)`.
- Leaf methods: `spacer`, `text`, `text_runs`, `button`.
- `Layout::new()` is the sizing/direction/padding/gap/align builder that lowers
  to the solver's config (see `layout-solver.md`). Convenience: `.grow()`,
  `.fixed(w,h)`, `.percent(..)`, `.pad(..)`, `.gap(..)`, `.align(..)`.

## 3. Identity

Every node has an `Id: u64`. Ids are produced by **hash-chaining through the ID
stack**: `child_id = hash(parent_id, local_key)`. Global uniqueness comes from
the *path*; a local key need only be unique **among its siblings**.

- **Hash:** FNV-1a 64-bit (trivial, dependency-free, stable across platforms and
  compiler versions — important for reproducible golden tests). Seed each child
  with the parent's id.
- **Keys:**
  - Interactive / stateful widgets (`button`, later toggle/slider/text field)
    **require an explicit `&str` key** (first arg above, e.g. `"resume"`).
  - Layout-only nodes (`column`/`row`/`panel`/`spacer`/`text`) get an
    **automatic key = sibling index**. No collision risk because it is chained
    with the parent path.
- **Dynamic lists:** `ui.scope(key, |ui| { .. })` pushes an extra frame onto the
  ID stack. Use it in loops so repeated widgets get distinct ids:
  ```rust
  for (i, row) in rows.iter().enumerate() {
      ui.scope(i, |ui| { ui.button("open", "Open"); });
  }
  ```
  `key` is any `Hash` (index, entity id, string).
- **Dev-mode duplicate detector:** in debug builds, opening a scope records
  sibling keys; a duplicate sibling key panics with the offending path. Compiled
  out in release.

## 4. Focus & navigation

`ctx.focus: Option<Id>` — at most one focused widget. Focus movement is fed by an
abstract intent stream (the **seam** to input; Phase 2 wires the input arena to
it, Phase 1 tests inject it directly):

```rust
enum UiIntent {
    FocusNext,          // Linear: next in ring
    FocusPrev,          // Linear: prev in ring
    GridMove(Dir),      // Grid scope: spatial step (Up/Down/Left/Right)
    Activate,           // fire focused widget (Enter/Space)
    Cancel,             // Back/Escape within a scope (routing per Phase 3)
}
```

**Focus scopes.** Containers declare a focus mode:

```rust
enum Focus { Linear, Grid { cols: u32 } }
```

- **Linear (default):** focusable descendants form a ring in **declaration
  order**. `FocusNext`/`FocusPrev` step the ring, **wrapping** around and
  **skipping disabled** widgets. Geometry-free and fully deterministic.
- **Grid (opt-in):** `GridMove(Dir)` moves spatially within the scope using the
  stored last-frame rects. Ships in Phase 1, but its spatial traversal may be
  finished as scoped work; `Linear` is the fully-supported baseline.

**One-frame resolution (matches the deferred-solve model):**

1. At frame begin, the engine holds `ctx.focus` and the **focusable ordering
   captured last frame**. Incoming intents are applied against that ordering to
   pick the new `ctx.focus` and whether an `Activate` fired.
2. During this frame's declaration, each interactive widget checks
   `id == ctx.focus` for `focused`, and `activated = focused && activate_fired`.
3. As widgets are declared, this frame's focusable order is recorded for use
   next frame.
4. If `ctx.focus` is `None` after a frame that had focusables, default it to the
   first focusable (so the first meaningful frame lands focus somewhere).

## 5. Response

Interactive widgets return:

```rust
struct Response {
    id:        Id,
    rect:      Rect,   // last-frame solved rect (highlight render, grid nav, future mouse)
    focused:   bool,   // id == ctx.focus this frame
    activated: bool,   // Activate intent fired on the focused widget this frame
}
```

Mouse fields (`hovered`, `pressed`, `held`, `released`, `clicked`) are
intentionally omitted; they arrive with mouse input.

## 6. Retained state

One side-table, keyed by `Id`, holding at minimum each widget's last-frame rect.

```rust
struct Entry {
    last_rect:     Rect,
    frame_touched: u64,
    state:         Option<Box<dyn Any>>, // filled by widgets that need persistence
}
struct Retained { map: HashMap<Id, Entry>, frame: u64 }
```

- `get_or_insert(id)` stamps `frame_touched = self.frame`.
- **Prune immediately:** at frame end, `map.retain(|_, e| e.frame_touched ==
  frame)`. Entries not touched this frame are dropped.
- The `state` slot is `None` in Phase 1 (button/text/panel need no persistent
  state). Scroll offsets (deferred) and the text-field caret (Phase 4) downcast
  this slot when they land. A widget wanting sticky-across-hidden state (e.g. a
  scroll position that survives a hidden panel) is a later concern; note it when
  scroll is implemented.

## 7. Widget set (Phase 1)

All keyboard-focus-driven. **Lean core only** — form controls
(toggle/slider/stepper) arrive with the settings UI (Phase 5).

| Widget | Focusable | Notes |
|---|---|---|
| `column(cfg, f)` | scope | vertical container; `Focus::Linear` default |
| `row(cfg, f)` | scope | horizontal container |
| `grid(cfg, f)` | scope | `Focus::Grid { cols }`; spatial nav within |
| `panel(style, f)` | no | container with theme background + flat border |
| `spacer(size)` | no | flexible/empty gap (use `Grow` to push siblings) |
| `text(s, cfg)` | no | single-color label; wraps to width |
| `text_runs(&[(s,color)], cfg)` | no | inline multi-color paragraph; wraps as one flow |
| `button(key, label)` | yes | returns `Response`; `activated` on Enter/Space when focused |

Focused focusable widgets render the theme's `focus_ring`/`focus_bg`.

## 8. Theme

A central `Theme` in the context supplies visual + metric defaults; any call may
override specific fields via its `Style`/`Text` builder. Sovereign settings can
swap the whole `Theme` later.

```rust
struct Theme {
    panel_bg: Color, border: Color, border_px: f32,
    text: Color, text_disabled: Color,
    focus_ring: Color, focus_bg: Color,
    pad: Padding, gap: f32,
    font_px: f32,       // default logical font height
}
ctx.theme = Theme::dwarf_dark();
```

- `Style::default()` / `Text::default()` resolve against `ctx.theme`.
- Per-call overrides: `Text::color(RED)`, `Style::bordered()`, etc.
- All metric fields (`border_px`, `pad`, `gap`, `font_px`) are **logical px**,
  scaled to device px by the solver's per-Category scale.

## 9. Frame lifecycle

```
frame(intents: &[UiIntent]) -> u32 (draw_list_count):
  ctx.frame += 1
  resolve focus/activation from intents + last frame's focusable order   (§4)
  run the user's root closure -> builds the arena tree                    (layout-solver §3)
  record this frame's focusable order                                     (§4)
  solve layout                                                            (layout-solver §4)
  emit draw-list + write node rects into Retained                         (layout-solver §7)
  prune Retained                                                          (§6)
  return draw_list_count
```
