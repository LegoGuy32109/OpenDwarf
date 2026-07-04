# Text & FontMetrics

Design decisions for text measurement, wrapping, and the font-metrics
abstraction in `od_ui` (Phase 1). The solver calls this to size and wrap text;
the emitter calls it to place glyphs.

Companion docs: [`layout-solver.md`](layout-solver.md) (where measure/wrap are
invoked) and [`imgui-core.md`](imgui-core.md) (the `text` / `text_runs`
widgets). Glyph instance format:
[`render-command-abi.md`](render-command-abi.md).

## 1. FontMetrics trait

Font-agnostic and **per-glyph**, so the wrap/measure code in the solver never
assumes fixed width — MSDF or proportional fonts drop in later as a new impl
with **zero solver changes**. Font size is a requested **pixel height**
(`px: f32`); the impl is free to snap it internally and report the actual
snapped metrics.

```rust
trait FontMetrics {
    fn line_height(&self, px: f32) -> f32;          // full line advance (device px)
    fn ascent(&self, px: f32) -> f32;               // baseline distance from line top
    fn descent(&self, px: f32) -> f32;              // baseline to line bottom
    fn advance(&self, ch: char, px: f32) -> f32;    // horizontal advance for one glyph

    /// Width+height of a single (already unwrapped) line. Default sums advances;
    /// monospace overrides with a fast path.
    fn measure_line(&self, s: &str, px: f32) -> Vec2 {
        let w = s.chars().map(|c| self.advance(c, px)).sum();
        Vec2 { x: w, y: self.line_height(px) }
    }

    /// UV rect + pixel cell for a glyph in the atlas, for emit. None => not in
    /// atlas (caller substitutes the fallback glyph).
    fn glyph(&self, ch: char, px: f32) -> Option<Glyph>;
}

struct Glyph { uv: [f32; 4], size: Vec2, advance: f32 } // uv = [u0,v0,u1,v1]
```

`px` passed in is the **already-scaled device-px** font height (logical font_px
× per-Category scale, computed by the solver).

## 2. MonospaceVga impl (Phase 1)

The existing VGA bitmap font (`/assets/ui/JoshPerfectDosVga.png`), matching the
current `webgl2/ui-text.ts` conventions:

- Atlas: **8×16 px cells, 32 columns**, printable chars **33..=126**.
- Space (`32`) is a blank advance (no quad emitted).
- Chars outside `33..=126` (and control chars other than the ones handled in §3)
  render the **fallback glyph** — a blank cell of one advance width (no visible
  box) in Phase 1.
- **px → integer scale:** `scale = max(1, round(px / 16.0))`. Then:
  - `line_height = 16 · scale`
  - `advance(_) = 8 · scale` (constant — monospace)
  - `ascent = line_height`, `descent = 0` (bitmap font is top-aligned; there is
    no meaningful sub-cell baseline). Real ascent/descent arrive with a
    proportional/MSDF impl.
- `measure_line` overridden to `char_count · advance` (with tab handling, §3).
- NEAREST sampling, integer scale only — pixel-crisp, consistent with the
  current renderer. (Per-instance non-integer scaling is a future, per the ABI
  scale decision; the trait already accommodates it since callers pass an
  arbitrary `px`.)

## 3. Text runs & config

Text is **run-based** to support inline multi-color (chosen in the interview).
`text()` is the single-run convenience over the same path.

```rust
struct TextRun<'a> { text: &'a str, color: Color }

struct Text {              // per-widget config; resolves against theme
    px:    Option<f32>,    // logical; default = theme.font_px
    color: Option<Color>,  // default single color = theme.text
    align: TextAlign,      // Left (default) | Center | Right (within the text box)
    wrap:  bool,           // default true (Phase 1 solver supports wrap)
}
```

- `ui.text("Paused", Text::default())` → one run in `theme.text`.
- `ui.text_runs(&[("Urist", GOLD), (" cancels", theme.text)], Text::wrap())` →
  one wrapping paragraph, colors per run.

## 4. Wrap algorithm

Greedy word wrapping over the concatenated run sequence, at the node's resolved
inner width `W` (device px, from solver pass 2):

1. Split into **words** (maximal runs of non-space, non-`\n`) and **breaks**
   (spaces, `\n`). Track each character's originating run so color is preserved.
2. Accumulate words onto the current line. If adding the next word would exceed
   `W`, start a new line. The single space between words contributes its advance
   only when the word stays on the line.
3. **Long words:** a single word wider than `W` is **hard-broken at a character
   boundary** (fills to `W`, continues on the next line). Prevents overflow.
4. `\n` forces a line break (and is not rendered).
5. `\t` advances to the next multiple of **4 cells** (`4 · advance`) from line
   start; no quad emitted.
6. **Trailing spaces at a wrap point are dropped** (do not count toward the next
   line's start or the line's measured width).

Output: a `Vec<Line>`, each `Line` a sequence of positioned glyphs
`(char, run_color, x_offset)` plus the line's measured width. Line count ×
`line_height` is the node's text height (solver pass 4).

## 5. Horizontal alignment & emit

- Within the text box of inner width `W`, each line is offset by `align`: `Left`
  → 0, `Center` → `(W − line_width)/2`, `Right` → `W − line_width`.
- Vertical: line `i` sits at `y + i · line_height`; glyphs are top-aligned
  within the line (bitmap `ascent = line_height`).
- Emit: one `GlyphInstance` per glyph (`pos`, `size`, `uv` from
  `FontMetrics::glyph`, `tint` = run color), integer-snapped to device px at
  emit-time only.

## 6. MSDF — future direction (not implemented)

If crisp fractional scaling / true typography is wanted later, add an `MsdfFont`
impl of `FontMetrics` and an MSDF text program. No solver or wrap changes are
needed because:

- `advance(ch, px)` already returns per-glyph fractional advances (kerning can
  be folded in or added as an optional `kern(prev, ch, px)` method later).
- `ascent`/`descent`/`line_height` already exist for real baseline layout.
- `px` is already an arbitrary float; MSDF renders at fractional scale natively.

Only the atlas source, the `glyph` UVs (from an MSDF atlas), and the fragment
shader (median-of-3 + screen-px-range) differ. This is why the trait was made
per-glyph in Phase 1 rather than monospace-specialized.
