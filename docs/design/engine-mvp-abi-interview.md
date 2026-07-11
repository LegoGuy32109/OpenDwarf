# Engine MVP — ABI / Input / View Interview (Round 2)

**Status:** Open interview — 2026-07-11
**Parent:** [`engine-webgl-parity-cutover.md`](./engine-webgl-parity-cutover.md)
(round-1 locks: Rust-authoritative ABI, playable-MVP delete gate, `od_world`
terrain, Bevy same milestone)
**Also touches:** [`render-command-abi.md`](./render-command-abi.md),
[`input-arena.md`](./input-arena.md),
[`domains-and-shell-router.md`](./domains-and-shell-router.md),
[`od-world.md`](./od-world.md)

Answer these before coding Slices 1–3. Each item below was checked against the
repo; only unresolved product/architecture choices remain.

---

## Already answered (do not re-litigate)

| Topic | Source |
| --- | --- |
| TS stays dumb; Rust emits instances | Round 1 Q1 + architecture §3.1 |
| MVP = floor + player + move + camera/z/zoom + chat/shell/HUD | Round 1 Q2 |
| Shadows/fog/bubbles post-MVP | Round 1 Q2 |
| `od_world` terrain OK if controls/feel right | Round 1 Q3 |
| Bevy deleted with `/webgl` after your MVP verify | Round 1 Q4 |
| UI atlases may load async in TS; Rust owns layout/UVs | architecture §3.5 / ABI |
| `HeldSet` / `is_held` exists for gameplay sampling | input-arena §5 |
| IJKL dual-use noted (“nav … also camera in gameplay”) | input-arena §3 |
| Shell modal when open → session frozen | domains-and-shell-router |
| `WorldSnapshot` has entities + terrain + loaded chunks; no FOV | od_core snapshot / od-world |
| Existing strides (reference only): floor 7, edge 5, ceil 4, fog 3, sprite 12, UI rect 8, glyph 12 | `webgl2/programs/*` |
| ABI reserves `program=2` Sprite; `reserved` → future `texture_id` | render-command-abi §2 |
| Harness must not silently no-op `stepSimTick` / `importReplay` | scenario.md Stage B |

---

## Q5 — World program IDs & arena layout (MVP)

UI today: two homogeneous arenas (rect×8, glyph×12) + draw-list. World shaders
use **different** strides. MVP needs **floor** and **player sprite** only.

**A.** One `ProgramId` per GL program, each with its own fixed-stride arena
(e.g. `Floor=2` stride 7, `Sprite=3` stride 12). Draw-list `program` selects
arena. Later shadows/fog add `4…n` the same way.

**B.** Pad/unify everything into one “sprite-like” stride (waste + shader churn).

**C.** Something else (describe).

Recommendation if unspecified: **A** (matches current ABI homogeneity rule;
matches how `webgl2` already separates programs).

*Need from you:* A / B / C, and whether MVP floor stride should **copy** the
current 7-float webgl2 floor layout bit-for-bit or may be redesigned in Rust as
long as it looks right.

---

## Q6 — Camera / view uniforms into GL

World shaders need `camera`, `zoom`, `canvasSize`, `simTick` every draw. UI
programs are screen-space (zoom=1). With Rust-authoritative instances:

**A.** Per-frame **view globals block** in wasm memory (camera xy, zoom, viewZ,
viewMode, simTick, …); TS reads once and calls `setGlobals` before world
batches. UI batches keep screen-space globals.

**B.** Stuff globals into every `DrawCmd.reserved` / expand `DrawCmd` (heavier
wire format).

**C.** TS reads camera only from `debug_snapshot_json()` / harness snapshot
(fine for debug, bad for the hot path).

Recommendation: **A**.

*Need from you:* A / B / C.

---

## Q7 — Where does “local view” state live?

MVP needs camera, look offset, viewZ, zoom, view mode, maybe HUD counters.
Full Phase-5 `ClientView` (replication/FOV filter) is post-MVP.

**A.** Extend `SessionModel` in `od_core` with local view fields now (same struct
grows into / projects into `ClientView` later).

**B.** New `od_core::LocalView` (or `ClientView` v0 without FOV) beside
`SessionModel`; UI + world emit read it by ref.

**C.** Keep view state only inside `od_wasm` / engine runtime (not in `od_core`)
until Phase 5 — fastest, weakest shared testing story.

Recommendation: **B** (keeps chat model small; gives harness a stable snapshot
shape; avoids pretending full `ClientView` exists).

*Need from you:* A / B / C.

---

## Q8 — Who calls world emit vs UI emit?

Today `DomainEngine::frame` → session UI + shell → UI arenas only.

**A.** Same `frame()`: after sim tick + view update, a world emitter writes
floor/sprite instances + world `DrawCmd`s **first**, then UI appends (compositor
order locked in architecture).

**B.** Separate `world_frame()` export; TS calls world then UI and concatenates /
uses two draw-lists.

**C.** World emission lives in `od_world` (sim crate grows render deps) vs
`od_ui` / new `od_render` crate.

Recommendation: **A** for the call shape; world mesh/build helpers in a small
module that is **not** `od_ui` widgets (either `od_world::render` feature-gated
or new `od_render`) so `od_ui` stays pure UI. Exact crate split is the
sub-choice under C.

*Need from you:* Prefer A or B for the wasm export shape; and whether world
instance builders may live in `od_world` or must be a new crate.

---

## Q9 — Gameplay keymap vs shell nav (IJKL / ESDF)

Facts: when shell is open, IJKL must remain focus nav. When shell is closed,
`/webgl` uses IJKL for camera and ESDF for move. `HeldSet` is already the right
primitive for continuous move/look. Today `gameplay_binding_for` still emits
`FocusPrev`/`FocusNext` on I/K even with no session buttons.

**A.** Shell open → IJKL = UI nav only. Shell closed + not chatting → IJKL
sampled as camera (no UI focus intents); ESDF sampled as move. Chat capture
suppresses both (already true for most keys via `InputMode::TextField`).

**B.** Always emit UI focus intents from IJKL; **also** sample held IJKL for
camera when shell closed (redundant Focus intents when nothing focusable).

**C.** Remap camera to different keys so IJKL stays UI-only forever.

Recommendation: **A** (matches `/webgl` feel; matches input-arena dual-use
note; avoids useless focus churn).

*Need from you:* A / B / C.

---

## Q10 — View-mode switching without full slash-command framework

MVP needs entity vs master camera. Phase 4 deferred slash parsing.

**A.** Minimal slash dispatch now: only `/master` and `/entity` on `SubmitChat`
(ignore unknown `/…`); non-slash still pushes `ChatMsg`.

**B.** Dedicated keys (e.g. toggle) instead of slash for MVP; slash later.

**C.** Full command table now (over-scope).

Recommendation: **A** (matches `/webgl` UX you already know).

*Need from you:* A / B / C.

---

## Q11 — MVP floor visual bar

Without fog/shadows, floor can still be “wrong” if topmost/depth/remembered
logic is skipped.

**A.** Port topmost-floor selection from loaded solids only (no remembered tint,
no depth tint) — simplest honest floor under the player.

**B.** Also port depth tint + remembered tint from webgl2 floor pass (more code,
closer look, still no fog).

**C.** Solid flat-color quads first (no atlas) just to prove ABI — replace with
atlas in the same slice before you verify.

Recommendation: **A** (+ real floor atlas, not C) so your verify sees the game.

*Need from you:* A / B / C.

---

## Q12 — Delete confirmation ritual

When MVP is ready for your eyes:

**A.** Agent stages a “ready to delete” PR (or commit) but **does not** remove
`webgl2/` / Bevy until you explicitly reply to verify / approve delete.

**B.** Agent deletes in the same PR once automated gates are green (you only
spot-check after).

Recommendation: **A** (matches “delete when I verify”).

*Need from you:* A / B.

---

## Out of scope for this round

- Full `ClientView` replication / FOV filter (post-MVP)
- Shadow/fog program ABI details (add with those slices)
- Worker protocol, OPFS, netcode
- Pixel-diff golden gating
- Rebinding UI

---

## After you answer

Lock answers into:

1. An ABI addendum (or amended [`render-command-abi.md`](./render-command-abi.md))
   for Floor/Sprite + view globals
2. A short keymap/view note in this folder (or amend input-arena / session docs)
3. Then implement Slice 1 → 2 → 3 per the cutover plan
