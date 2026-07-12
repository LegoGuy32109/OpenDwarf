# Engine MVP — ABI / Input / View Interview (Round 2)

**Status:** Partially locked — 2026-07-12 (awaiting Q5 / Q6 after expanded brief)
**Parent:** [`engine-webgl-parity-cutover.md`](./engine-webgl-parity-cutover.md)
**Also touches:** [`render-command-abi.md`](./render-command-abi.md),
[`input-arena.md`](./input-arena.md),
[`domains-and-shell-router.md`](./domains-and-shell-router.md)

---

## Locked this round

| # | Lock |
| --- | --- |
| **Q7** | **`LocalWorldView`** in `od_core` (beside `SessionModel`). Expand to other view kinds later. |
| **Q8** | One **`frame()`**: world emit then UI. World instance builders live in **`od_world::render`** for now. |
| **Q9** | **Confirmed intent** (see §Q9): TS dumps physical keys only; **Rust** maps key→meaning from context (shell / inventory / menu / world / chat). Matches architecture; Rust keymap needs extension, not a TS policy layer. |
| **Q10** | **A** — minimal `/master` + `/entity` on `SubmitChat`; match existing UX. |
| **Q11** | **Depth tint + remembered tint are required before delete-verify**, not day-one of first floor pixels. They are floor **tint policy**, not separate GL programs. FOV/memory must exist by then for “remembered.” Fog overlay / shadows remain post-first-pixels as before. |
| **Q12** | **A** — you spot-check **`/webgl` vs `/engine` live**; agent does **not** delete until you explicitly approve. |

Still open after the briefs below: **Q5**, **Q6**.

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

**Long-term: Option D** (`WorldAtlasQuad` + `WorldSolidQuad` + UI Rect/Text).

**MVP coding:** implement D’s two world programs immediately (floor+player both as `WorldAtlasQuad` with different `texture_id`s), rather than E — avoids a dead Floor ProgramId. First slice can still draw **only** floor+player batches; shadows/fog add more `DrawCmd`s later, same programs.

*Need from you:* **D**, **A**, or **E** (A-now→D-later). If D: confirm texture_id via `DrawCmd.reserved` is OK for MVP.

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

**A now, designed as A2:** lock a `ViewGlobals` / `LocalWorldView` GPU prefix in the ABI (camera xy, zoom, canvas size, sim tick, maybe viewZ/mode for HUD—not all need to be uniforms). TS uniform-uploads for MVP; flip to UBO when overlay count hurts. **Reject B and C** for production.

*Need from you:* **A→A2**, or **F**, or something else.

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

**No redesign of the TS capture model is required** for your intent. Implementation work is: richer Rust contexts + more KeyCodes forwarded.

If you want this locked formally: **Q9 = Rust context keymap (architecture as-is); extend KeyCode dump list; no TS semantic filtering for gameplay.**

---

## Q11 — Rephrased (locked)

**Question was muddy.** Clearer statement:

- **Depth tint** and **remembered tint** are colors applied when emitting **floor** (and player) instances — see `DEPTH_TINTS` / `REMEMBERED_TINT` in `webgl2/passes/floor.ts`. They are **not** extra GL programs.
- **Remembered** requires FOV + tile memory (or equivalent) so unseen/remembered/visible is known.
- **Depth** requires topmost / z-below selection (already part of floor emit).

**Your lock:** both tints are part of the **parity bar before you approve delete**, but the impl plan may show floor+player without them first, then add tint policy (+ FOV/memory) before verify. Shadows/fog overlays can still trail that if you want — say if tints-without-fog is enough for your spot-check.

Confirm only if wrong: *delete-verify requires depth+remembered floor tints; fog/shadows optional at that gate.*

---

## Q12 — Locked

Keep **`/webgl` and `/engine` both live** while you A/B. Deletion PR only after your explicit OK.

---

## Still need from you

1. **Q5:** D (generic world quads, recommended) / A (program per pass) / E (A then D)?  
2. **Q6:** A→A2 (globals block → UBO, recommended) / F (pre-transform to screen space) / other?  
3. **Q11 confirm:** depth+remembered required at delete-verify; fog/shadows optional then — yes/no?  
4. **Q9 confirm:** lock as “architecture as-is, extend Rust contexts + KeyCode dump” — yes/no?
