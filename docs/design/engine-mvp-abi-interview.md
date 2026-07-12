# Engine MVP — ABI / Input / View Interview (Round 2)

**Status:** Round 2 locked — 2026-07-12
**Parent:** [`engine-webgl-parity-cutover.md`](./engine-webgl-parity-cutover.md)
**Also touches:** [`render-command-abi.md`](./render-command-abi.md),
[`input-arena.md`](./input-arena.md),
[`domains-and-shell-router.md`](./domains-and-shell-router.md)

---

## Locked this round (complete)

| # | Lock |
| --- | --- |
| **Q5** | **D** — `WorldAtlasQuad` + `WorldSolidQuad` (+ UI `Rect`/`Text`). Visual layers stay paint-ordered `DrawCmd` batches; `texture_id` via `DrawCmd.reserved`. Floor emits Rust-computed UVs (not a forever Frame-index ProgramId). |
| **Q6** | **A2** — `LocalWorldView` → ABI **view globals** block, laid out for **UBO** bind (`std140`-friendly). MVP may `uniform*` upload the same bytes; flip to `bindBufferBase` without relayout. |
| **Q7** | **`LocalWorldView`** in `od_core` (beside `SessionModel`). Expand to other view kinds later. |
| **Q8** | One **`frame()`**: world emit then UI. World instance builders in **`od_world::render`**. |
| **Q9** | TS dumps physical keys only; **Rust** context keymap (shell / inventory / menu / world / chat). Extend KeyCode dump list; no TS gameplay policy. |
| **Q10** | Minimal **`/master` + `/entity`** on `SubmitChat`. |
| **Q11** | **MVP delete-verify requires depth + remembered floor tints** (FOV/memory by then). May trail first floor pixels in the impl sequence. Fog/shadow overlays still optional at that gate. |
| **Q12** | Keep **`/webgl` + `/engine` live** for A/B; delete only after your explicit OK. |

---

## Implementation contract (from locks)

### Programs / arenas

| ProgramId | Stride (f32) | Texture | Used for (MVP → later) |
| --- | --- | --- | --- |
| `Rect` (0) | 8 | white | UI |
| `Text` (1) | 12 | font | UI |
| `WorldAtlasQuad` (2) | 12 (`pos, size, uv_rect, tint, alpha`) | `texture_id` | Floor + player (MVP); ceil shadow / atlas overlays later |
| `WorldSolidQuad` (3) | 8 (`pos, size, tint, alpha`) | white / `texture_id` | Edge bands + fog later; unused in first floor+player slice OK |

Paint order for MVP verify: floor atlas batches → player atlas batch → UI. Depth/remembered = tint on floor instances.

### View globals (A2)

Fixed wasm block written each `frame()` from `LocalWorldView` (at least: camera xy, zoom, canvas size, sim tick). Same bytes consumed as uniforms first, UBO later. UI draws keep identity camera/zoom.

### Input

Forward all gameplay KeyCodes (incl. R/V/U/M, digits as needed). Rust: shell open → nav; world → ESDF move + held IJKL camera; chat → text field; `/master` `/entity` on submit.

### Crate flow

`od_wasm::frame` → tick `WorldSim` + update `LocalWorldView` → `od_world::render` emit world cmds → `od_ui` session/shell append UI cmds → TS walks draw-list + applies view globals to world programs.

---

## Context: what `/webgl` “layers” actually are

They are **not** one multipass FBO effect. They are a **paint-ordered compositor**: each pass binds a different GL program (+ texture unit + blend mode), writes instances, draws, then the next pass draws on top.

Current order (`webgl2/passes/index.ts`):

1. **Floor** — atlas, blend **off**, stride **7** (`pos, frame, tint, alpha`); depth tint + remembered tint are **per-instance tint colors** chosen while emitting
2. **Edge shadow** — geometric bands, blend **on**, stride **5** (`pos, size, alpha`); often no atlas sample beyond white/solid shading
3. **Ceil shadow** — shadow atlas frames, blend on, stride **4**
4. **Fog** — darken quads, white texture, stride **3** (`pos, alpha`), entity mode only
5. **Player** — sprite atlas, UV/flip, stride **12** (same shape family as UI glyphs)
6. **Chat / HUD** — UI rect/text (screen-space)

Fixed texture units today (`texture-units.ts`): floor=0, edge=1, ceil=2, sprite=3, font=4, white=5.

The look you want = **that stack in order**, with floor tints (depth/remembered) + shadow/fog overlays. Architecture already locked the same idea for the new engine: **draw-list paint order** = compositing (`render-command-abi` §6.2; domains doc: world → session → shell).

So “program per effect layer” is one way to preserve that stack. It is not the only way — see Q5.

Shared camera math is already identical across world programs (`u_camera`, `u_zoom`, `u_canvas_size`, `u_sim_tick` in `_chunks.ts`). UI programs force camera=0, zoom=1. Comment there: if globals grow or program count ≳10, migrate to a **UBO**.

---

## Q5 — Arena / program layout (expanded)

### What must stay true long-term

- Rust emits GL-ready instances; TS only binds + draws (round-1 Q1).
- Homogeneous strides per arena (ABI rule) — no mixed-stride float soup.
- Paint order via `DrawCmd` list (compositor).
- Layer toggles / future overlays (designations, blood, cursors, stockpile washes) must stay cheap to add.
- Different **blend modes** and **textures** across the stack.

### Options

#### Option A — ProgramId per current pass (mirror `/webgl`)

`Floor`, `EdgeShadow`, `CeilShadow`, `Fog`, `Sprite`, plus existing `Rect`/`Text`.

| | |
| --- | --- |
| **Pros** | 1:1 with shaders you already like; no shader rewrite; toggles map 1:1; MVP can add Floor+Sprite first |
| **Cons** | Arena count grows with every effect; many similar “textured quad” programs; DF will grow lots of overlays → ProgramId sprawl |
| **Fit** | Fastest parity port |

#### Option B — Pad everything to one max stride / one arena

| | |
| --- | --- |
| **Pros** | One pointer |
| **Cons** | Wasted memory; VAOs still differ per shader so TS still switches programs; fights ABI homogeneity discipline |
| **Fit** | Poor — reject for long-term |

#### Option C — One uber-shader (branches on a `kind` attribute)

| | |
| --- | --- |
| **Pros** | Single program |
| **Cons** | Branchy GPU code; awkward blend (floor wants blend off, shadows on); hard to reason about; rewrite everything |
| **Fit** | Poor for DF overlays |

#### Option D — **Small generic world program set** (recommended long-term)

Collapse the *shader family*, not the *visual stack*:

| ProgramId | Role | Covers today’s |
| --- | --- | --- |
| `WorldAtlasQuad` | `pos, size, uv_rect, tint, alpha` + `texture_id` in `DrawCmd.reserved` | Floor (Rust emits UVs instead of frame index), ceil shadow, player, most overlays |
| `WorldSolidQuad` | `pos, size, tint, alpha` (white/`texture_id`) | Edge shadow bands, fog, washes, designation fills |
| `Rect` / `Text` | unchanged | UI |

Visual layers remain **separate `DrawCmd` batches in paint order** (floor cmds, then edge cmds, …). You still get the combined look. You do **not** need a GL program per aesthetic layer forever — only per *vertex format / shading family*.

| | |
| --- | --- |
| **Pros** | Scales to DF overlays without ProgramId explosion; uses existing ABI `reserved`→`texture_id` seam; one atlas-quad VAO; matches “dumb TS”; draw-list still owns compositing |
| **Cons** | Floor shader changes from `frame` index → Rust-computed `uv_rect` (one-time port); must assign texture ids; slightly more Rust emit logic |
| **Fit** | Best long-term for a browser DF |

#### Option E — Hybrid timeline (A now → D)

Ship MVP with `Floor`+`Sprite` ProgramIds copying current shaders; migrate to D when shadows/fog/overlays land.

| | |
| --- | --- |
| **Pros** | Fastest first pixels |
| **Cons** | Two migrations; throwaway Floor-specific ABI |

### Recommendation

**Long-term: Option D** — **LOCKED 2026-07-12.**

MVP implements D’s two world programs immediately (floor+player as
`WorldAtlasQuad` with different `texture_id`s).

---

## Q6 — Camera / view uniforms (expanded)

World shaders need the same 4 uniforms every world draw. UI ignores camera (identity). DF will keep one main world camera for a long time (plus maybe a minimap later).

### Options

#### Option A — Per-frame **view globals block** in wasm memory

Rust writes `LocalWorldView` (and derived GPU floats) into a fixed ABI region each `frame()`. TS reads once, then `setGlobals(...)` when drawing world `DrawCmd`s; UI cmds keep screen-space globals.

| | |
| --- | --- |
| **Pros** | Symmetric with input arena; Rust-authoritative; tiny TS; easy harness inspection; works today with `uniform` uploads |
| **Cons** | Still N `uniform` calls as program binds change (mitigate: only update when program family changes) |
| **Fit** | Strong near-term |

#### Option A2 — Same block, bound as a **UBO** (WebGL2)

Layout the globals block `std140`-friendly now; later TS `bindBufferBase` instead of `uniform*` calls. `_chunks.ts` already anticipates this.

| | |
| --- | --- |
| **Pros** | Best when many programs / overlays share one camera; fewer GL calls; still Rust-authored bytes |
| **Cons** | Slightly more GL setup; alignment rules; overkill while only 2 world programs |
| **Fit** | Best **long-term evolution of A** |

#### Option B — Put camera in every `DrawCmd` / expand cmd

| | |
| --- | --- |
| **Pros** | Self-contained batches |
| **Cons** | Huge redundancy (thousands of floor batches × same camera); bloated draw-list; worse cache |
| **Fit** | Bad for DF tile volume |

#### Option C — TS mirrors camera from JSON snapshot

| | |
| --- | --- |
| **Pros** | Quick hack |
| **Cons** | Second source of truth; hot-path JSON; drifts from Rust-authoritative ABI |
| **Fit** | Debug only |

#### Option F — Camera baked into instance positions (pre-transform in Rust)

Rust emits **screen-space** quads already multiplied by camera/zoom.

| | |
| --- | --- |
| **Pros** | World programs become screen-space like UI; TS always `setGlobals` identity |
| **Cons** | Any camera pan invalidates all instances (you already rebuild per frame today, so OK); minimap / multi-camera harder; loses world-space shader simplicity |
| **Fit** | Possible, but fights current shaders and multi-view later |

### Recommendation

**A now, designed as A2** — **LOCKED as A2 (2026-07-12):** ABI view-globals
block from `LocalWorldView`, `std140`-friendly for UBO; uniform upload acceptable
until overlay count hurts.

---

## Q9 — Input: your model vs current code

### What you want

> TS passes `KeyK`. Rust decides if that is menu nav, camera, etc., from player context (shell, inventory, menu, world).

### What we already have

This is **exactly** the locked architecture:

- [`input-arena.md`](./input-arena.md): *“TS is a dumb capture layer… Rust owns the keymap.”*
- `engine/input.ts` already maps `event.code` → `KeyCode` and appends arena events; it does **not** choose camera vs focus.
- Router already: Escape → shell before keymap; chat capture → `TextField` mode.

So we are **not** proposing “narrow UI focus intents on the TS side.” Round-2 Q9 option A was meant as **Rust** behavior when shell open vs closed.

### Gaps / small refactors (Rust + KeyCode surface, not a new TS brain)

1. **Gameplay keymap incomplete** — `gameplay_binding_for` maps I/K → `FocusPrev`/`FocusNext` even in world; no ESDF→move, no held IJKL→camera, no R/V/U/M yet. Fix: Rust context table + `HeldSet` sampling for continuous move/look.
2. **Missing KeyCodes in the dump map** — Digits, `KeyR`/`KeyV`/`KeyU`/`KeyM`, etc. are absent from `CODE_TO_KEYCODE`, so TS **drops** them before Rust sees them. Extending the enum + map is still dump-only.
3. **Minor TS smell** — `lastOpenCommand` for T/`/` helps focus the hidden `<input>`; that’s host text-capture plumbing, not gameplay policy. Keep it host-local.

**Locked 2026-07-12:** Q9 = Rust context keymap (architecture as-is); extend
KeyCode dump list; no TS semantic filtering for gameplay.

---

## Q11 — Rephrased (locked)

**Question was muddy.** Clearer statement:

- **Depth tint** and **remembered tint** are colors applied when emitting **floor** (and player) instances — see `DEPTH_TINTS` / `REMEMBERED_TINT` in `webgl2/passes/floor.ts`. They are **not** extra GL programs.
- **Remembered** requires FOV + tile memory (or equivalent) so unseen/remembered/visible is known.
- **Depth** requires topmost / z-below selection (already part of floor emit).

**Locked 2026-07-12:** delete-verify requires depth+remembered floor tints;
fog/shadows optional at that gate. Impl may show untinted floor first, then add
tint policy + FOV/memory before you verify.

---

## Q12 — Locked

Keep **`/webgl` and `/engine` both live** while you A/B. Deletion PR only after your explicit OK.

---

## Round 2 complete

All Q5–Q12 locked. Next: ABI addendum (programs + view globals) and Slice 1
implementation per [`engine-webgl-parity-cutover.md`](./engine-webgl-parity-cutover.md).

Tradeoff writeups for Q5/Q6 are retained above under those headings.
