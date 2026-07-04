# OpenDwarf Game Engine Architecture & UI Engine Plan

**Status:** Approved direction — 2026-07-03
**Scope:** The new `game_engine/` Rust workspace, and the Clay-inspired immediate-mode UI engine (`od_ui`) that replaces the current TypeScript WebGL UI. The existing `game_library/` (Bevy) is being deprecated.

This document is the decision record from the architecture interview plus the phased build plan. Each decision lists the choice, the rationale, and — where relevant — the deferred alternative and the seam that keeps it cheap to add later.

---

## Part 1 — Strategic decisions (context for the UI work)

### 1.1 Deprecate Bevy; ship a lean Rust core
The current browser build is a **27 MB raw / 4.2 MB brotli** Bevy wasm. The pure-Rust simulation core (`world_core`, `fov`, `world_api`, `world_bus`) is already **Bevy-free**. The new engine compiles only that lean core to wasm — plausibly sub-100 KB brotli — and drops Bevy from the browser entirely. The same Bevy-free core also runs native server-side for multiplayer.

### 1.2 WASM loading
- Precompress wasm at **brotli q11**, serve with `Content-Encoding: br` **and** `Content-Type: application/wasm`, load via `WebAssembly.instantiateStreaming`.
- Browser decodes brotli transparently (~100% evergreen support), compiles during download, and **code-caches the compiled module across reloads/restarts** for modules ≥128 KB — `Content-Encoding` does not break this.
- **Do not** hand-roll brotli in JS (`DecompressionStream('br')` is missing in Firefox; loses streaming compile). Do not persist compiled modules to IndexedDB (that API is being removed).
- A lean ~200 KB core instantiates in tens of ms → effectively instant time-to-interactive. The code cache is half of the "no resume button" reload story (see 1.5).

### 1.3 Threading — defer rayon
- Ship **single-threaded wasm in a worker** on **stable Rust**. Use **manual workers + transferable typed arrays** for embarrassingly-parallel worldgen (no cross-origin isolation, stable toolchain).
- `wasm-bindgen-rayon` requires **nightly** (`-Z build-std`, `+atomics`) and **SharedArrayBuffer → COOP/COEP cross-origin isolation** (which constrains third-party assets/OAuth/payments). The FOV/chunk workload (~33k cells @ 20 TPS) is small; rayon is a **later, profiled optimization**, not a day-one foundation.

### 1.4 Module topology — one binary, two instances
- **One wasm binary, two runtime instances:** a **main-thread instance** (UI + interaction/session model, frame-rate) and a **worker instance** (world: worldgen, FOV, chunkgen, topmost). Message-passing via transferable buffers — no shared memory, no COOP/COEP.
- Source is **crate-split** (see Part 2) so splitting into two binaries later (lazy-load the world module) is a mechanical change, not a rewrite.

### 1.5 Persistence — instant crash-resilient resume ("no resume button")
- **World = seed + append-only delta log.** Never persist generated chunks; regenerate deterministically from the seed and replay only player-caused divergences.
- **Write-ahead log + periodic compacted snapshot** (A/B double-buffer or write-temp-rename for atomicity) so a crash mid-write never corrupts the last good save.
- **Storage: OPFS** via the worker's sync access handles (fast, off-main-thread, large quota); IndexedDB as compat fallback.
- **Cadence:** session blob (pos, view, UI) debounced ~1–2 s and on `visibilitychange → hidden`; world deltas appended per edit. State is tiny, so flush often for free.
- **Boot path:** code-cached wasm (no recompile) → read last valid snapshot → regen world from seed (prewarm spawn ring) → apply deltas → drop player in. Straight into the action; ESC menu one keypress away.
- **Multiplayer:** server is authoritative; local cache is instant-paint, then reconcile from the server snapshot.

### 1.6 Trust model — sovereign vs session (multiplayer / GM)
- **Trusted computing base = your own client code (JS glue + wasm).** The GM/peer is **network messages**, which are untrusted.
- **Rule:** network messages can only ever enter the **session** domain. The **sovereign** domain (ESC menu, settings, disconnect) listens only to local DOM events via a trusted router — a *secure attention key* the peer can never reach or suppress.
- Input flows as **intents** into an authoritative model; GM override is just another intent source targeting the session domain. Sovereign is never networked, never overridable.
- Text capture uses a **hidden DOM `<input>`** (real IME/mobile/paste) mirrored into the session model per keystroke (so the GM sees typing) while the glyphs are rendered by our own UI.

---

## Part 2 — The `game_engine/` workspace (Q1)

A new Cargo workspace at `game_engine/`, **four crates**, `od_` prefix. Only one touches wasm.

| Crate | Role | wasm-bindgen? | Tested |
|---|---|---|---|
| `od_core` | Shared types (`Vec3i`, world_api), **render-command ABI structs**, intent/snapshot types (`ClientView`), `serde`/`bincode` | No | native |
| `od_ui` | Clay-like immediate-mode UI: layout solver, widgets, render-command emission, `FontMetrics` | No | **native (fast)** |
| `od_world` | Sim: worldgen, FOV, chunkgen, topmost | No | native |
| `od_wasm` | The **only** `cdylib` + `wasm-bindgen` crate; thin boundary glue (`ui_frame`, `world_*`); instantiated on both main thread and worker | Yes | via harness |

**Why:** `wasm-bindgen` quarantined to one crate → `od_ui`/`od_world`/`od_core` are plain Rust with millisecond native unit tests. One `cdylib` = "one binary now." Independent lib crates = "two binaries later" is mechanical. Native server reuses `od_core` + `od_world` directly.

**Build pipeline** (mirror `game_library`'s wasm steps):
- `cargo build --target wasm32-unknown-unknown --release --features web` → `wasm-bindgen --target web --out-dir static/engine` → `wasm-opt -O4` → `brotli -q11`.
- `.cargo/config.toml`: `target-feature=+simd128` (**not** `+atomics` — threads deferred).
- Output to `static/engine/` (keep separate from the old `static/game/` Bevy artifacts).

**Dev loop — `deno task` commands, not `bacon`.** One canonical command per action so agents and devs run the same thing (bacon can be re-added later if a watch loop is wanted). Wrap the multi-step builds in `scripts/bash/` (mirroring the existing `web-release.sh`) and expose via `deno.json` tasks:
- `engine:build` — release: cargo (wasm32) → wasm-bindgen → `wasm-opt -O4` → `brotli -q11` → `static/engine/`.
- `engine:dev` — debug: cargo (wasm32) → wasm-bindgen → `static/engine/` (skip wasm-opt/brotli for speed).
- `engine:check` — `cargo check` + `cargo check --target wasm32-unknown-unknown`.
- `engine:test` — `cargo test` for `od_core`/`od_ui`/`od_world` (native, fast).

The wasm-bindgen JS glue is imported by the TS side and served through the Fresh/vite route.

---

## Part 3 — The UI engine (`od_ui`)

### 3.1 Render-command ABI (Q2) — Option B: GL-ready buffers + draw-list
> Full byte-level design: [`design/render-command-abi.md`](design/render-command-abi.md).

Rust does **everything including glyph layout** and writes the exact instance buffers the existing GL programs consume:
- **Rect** instance stride **8 floats**: `[pos.xy, size.xy, tint.rgb, alpha]` (+ shared unit-quad corner buffer).
- **Text** instance stride **12 floats**: `[pos.xy, size.xy, uv_rect.xyzw, tint.rgb, alpha]`.
- **Draw-list**: a **paint-ordered** array of batch records `{ program: rect|text|sprite, instance_offset, instance_count, scissor: [x,y,w,h] | none, texture_id }`.

TS is reduced to: walk the draw-list → set scissor, bind program+texture, `drawArraysInstanced` over the range. TS never understands a "widget." The draw-list (not raw buffers) is what preserves clipping, layering, and paint order.

### 3.2 Boundary mechanics (Q3) — zero-copy + fixed arena
- **Zero-copy:** TS uploads directly from `Float32Array` views over wasm linear memory. No copies.
- **Fixed-capacity arenas:** allocated once (e.g. rects `16k×8`, glyphs `32k×12`, plus draw-list); overflow drops extras + bumps a debug counter. No per-frame allocation, deterministic.
- **Stable base pointers:** derived once at init; `ui_frame(...)` returns only the **counts**. JS keeps a one-line grow-guard: `if (memory.buffer !== cachedBuffer) rederiveViews()`.
- Input side is symmetric (see 3.7).

### 3.3 Authoring API (Q4) — closures (egui-style)
```rust
ui.row(Layout::new().padding(8).gap(4), |ui| {
    ui.text("Health");
    if ui.button("ok", "OK").clicked { /* ... */ }
});
```
Nesting via closures gives compiler-enforced tree structure (no begin/end balancing bugs) and full tooling. A Clay-style declarative **macro is optional later sugar over this API**, never the foundation.

### 3.4 Layout model (Q5) — port Clay's full solver
Port the whole solver: **fit / grow / fixed / percent** sizing, direction, padding, child-gap, alignment, **floating elements**, **scroll containers**, text wrapping. The sizing algorithm is a coupled whole — porting Clay's proven math beats growing a partial solver.
- **Deferred:** corner radius (rounded rects) — pixel aesthetic doesn't need it.
- **In scope:** flat colored borders (color + width) — needed for panels/tooltips/bubbles.
- Floating elements are the tooltip/dropdown primitive and the basis for world-anchored UI (see 3.9).

### 3.5 Text (Q6) — bitmap now, behind a `FontMetrics` interface
- **Bitmap + integer-scale + NEAREST** (matches the existing pixel-perfect discipline; MSDF buys nothing when scaling is integer).
- Text sits behind a **`FontMetrics` interface**; layout measures through it and never assumes monospace. First (and only, for now) impl is the **monospace VGA font** (`JoshPerfectDosVga`, ASCII 33–126), metrics baked into `od_ui` via consts/`include_bytes!` so first paint never waits on a fetch. The atlas PNG still loads async TS-side (text lays out immediately, glyphs render once the texture lands).
- Because text is modular behind the interface, proportional fonts, CP437, and MSDF are drop-in later.

### 3.6 Identity & retained state (Q7) — Option A: explicit scoped ids
- **Explicit raw-string ids on interactive/stateful elements only** (buttons, fields, sliders, scroll areas, floating anchors); pure layout/text need none.
- **Hierarchical ID stack** → ids need only be locally (sibling) unique; full id = `hash(parent_scope, salt)` as `u64`.
- **Dynamic lists fold a stable data key into the id** (`id!("row", item.id)`) — identity tracks *data, not position*, so insert/reorder/filter never scrambles focus/scroll.
- **Retained state** (hot/active/focus, scroll, caret, anim) lives in an ID-keyed side-table, pruned each frame of untouched entries.
- **Dev-mode duplicate detector:** a per-frame `HashSet<Id>` under `#[cfg(debug_assertions)]` — complete sibling-uniqueness check, zero false positives, compiled out in release. (Compile-time uniqueness is impossible: the tree is runtime control flow.)
- **Deferred:** typed const/enum id namespace — reintroduce as a convention once the UI has enough surface to be worth a registry.

### 3.7 Input transport (Q8) — Option A: fixed input arena
- **Event model (required):** sampled **continuous state** (pointer pos, held buttons, modifiers, canvas CSS size, DPR, UI scale) + an **ordered discrete-event queue** (pointer down/up, wheel, key down/up, text/IME commits). The queue is mandatory — multiple events can land in one 60 fps frame.
- **Transport:** JS writes into a **fixed wasm-memory region** via a `DataView` created once (primitives into fixed offsets + event records into a ring), then **one** `ui_frame()` call drains it. Zero allocation, one boundary crossing — mirror image of the output side.
- Pointer coords pre-transformed by JS into UI space (CSS px × integer UI scale). Text arrives from the hidden `<input>` as queued events.

### 3.8 Reading state (Q9) — direct read + intents-out
The UI is a pure function:
```
fn ui(view: &ClientView, input: &Input) -> (DrawBuffers, Vec<Intent>)
```
- Reads the local model by **immutable reference** (same wasm instance — no boundary to cross, no per-frame copy).
- **Never mutates state**; interactive widgets emit **intents** applied by the app shell after the frame. This one-way flow is what makes GM-override, undo/replay, and native testing clean.

### 3.9 `ClientView` — the network/render boundary (Q9)
Two boundaries, not one:
- **Network replication (server → remote client):** a **per-recipient, need-to-know filtered snapshot** (only what the entity can see/know; GM gets an elevated view). Serialized (`bincode`), **tick cadence (~20 TPS)**, delta-encoded. This is anti-cheat + fog-of-war + bandwidth — the client literally never receives hidden data.
- **UI read (local model → render):** always a **direct local reference** (3.8), any mode. A remote client's local model simply *is* the filtered `ClientView` it received.
- **`ClientView` is a first-class type**: the wire format for remote clients, and the type the UI renders from everywhere. Produced by server-side filtering for remotes, and by a **cheap local projection over full `GameState`** (borrows/indices, computed with FOV each tick) for the host — so single-player pays no copy.
- Render at 60 fps by **interpolating** between the last two tick snapshots (existing pattern).

### 3.10 Domains & surfaces / compositing (Q10) — Option A
- **Trust domains (2):** sovereign and session — structurally isolated retained-state stores. **Network/GM intents reach session only**; there is no wire into the sovereign store. This is the trust boundary in the type system, not by convention.
- **Surfaces (N):** each an IMGUI root with its own ID/retained store and a **placement**:
  - *Screen* placement — sovereign menu(s), session HUD.
  - *World-anchored (billboarded)* placement — tooltips, chat bubbles, nameplates: **full IMGUI subtrees** (panels, flat borders, text colors) whose origin is `world_to_screen(anchor)`. This is Clay's **floating-attach** feature (3.4) pointed at a projected world position; Rust emits screen-space quads, so TS stays dumb. Integer/fixed screen scale keeps the bitmap font crisp.
  - *World-embedded (continuous scale)* — deferred; needs the MSDF `FontMetrics` impl for crispness at non-integer zoom.
  - Surfaces belong to a domain (world-anchored bubbles are **session-domain** — GM-observable, part of `ClientView`).
- **Compositing order:** world render → session world-anchored surfaces → session screen HUD → **sovereign (last, on top)**.
- **Input routing (trusted local router):** reserved keys (ESC, disconnect chord) → **always sovereign**; sovereign surface open+modal → local input → sovereign; else → session; **network/GM intents → session only**.
- **Intent routing:** sovereign intents (`LeaveGame`, `ChangeSetting`, `Disconnect`) applied locally/immediately; session intents → model/network. The world keeps running while your ESC menu is open — sovereign guarantees *your* exit, not a global pause.

---

## Part 4 — Explicitly deferred (with the enabling seam)

| Deferred | Seam that keeps it cheap |
|---|---|
| rayon / wasm threads | worker protocol is internal; flip on COOP/COEP + nightly later |
| Two separate wasm binaries | crate-split source; split `od_wasm` when world compile time hurts TTI |
| Corner radius | render-config only; solver untouched |
| MSDF / continuous-zoom world text | alternate `FontMetrics` impl behind the interface |
| Proportional fonts / CP437 | new `FontMetrics` impl + metrics data |
| Typed id namespace | consts over the existing string API; no engine change |
| Clay-style authoring macro | pure sugar over the closure API |

---

## Part 5 — Action items (during the build)

- **Remove the unused MSDF logic** (`scripts/generate_vga_msdf.ts` and any dangling references) once the new text path lands.
- **Leave a doc-comment on the `FontMetrics` impl** describing the MSDF direction: an alternate implementation backed by an MSDF atlas + median-of-3 shader, used for the non-integer / world-embedded scaling cases, with the monospace bitmap impl staying default for crisp pixel UI.

---

## Part 6 — Phased implementation plan

### Migration & parity

The new engine is built **alongside** the existing `webgl2/` TS engine, not in place. It gets its own route (e.g. `/engine`), entry/island, and canvas; the existing `/webgl` route stays fully intact and playable as a live parity reference throughout. Phase 0's reuse of `ui-rect`/`ui-text` is a **read-only import** that does not disturb the old engine. The old engine is retired in **one clean cutover** once the new engine reaches parity — not deleted incrementally — so the reference survives the whole build. The deterministic golden-snapshot tests (ABI doc §8) are the durable parity check.

### Design-doc process

Each "Define"/"Decide" point in the phases is nailed down via a decision interview and saved under `docs/design/`, then linked from its phase. Completed: [`design/render-command-abi.md`](design/render-command-abi.md) (Phase 0); [`design/layout-solver.md`](design/layout-solver.md), [`design/imgui-core.md`](design/imgui-core.md), [`design/text-and-font-metrics.md`](design/text-and-font-metrics.md) (Phase 1); [`design/input-arena.md`](design/input-arena.md) (Phase 2); [`design/domains-and-shell-router.md`](design/domains-and-shell-router.md) (Phase 3).

**Phase 0 — Foundation & ABI proof (walking skeleton).**
Scaffold `game_engine/` + four crates + `deno task` build scripts (output `static/engine/`), on a **new `/engine` route** (existing `/webgl` untouched). Implement the render-command ABI per [`design/render-command-abi.md`](design/render-command-abi.md): the `#[repr(C)]`+`bytemuck` records (`DrawCmd`, `RectInstance`, `GlyphInstance`) with `offset_of!` self-asserts in `od_core`, the `abi:gen` codegen → `abi.generated.ts`, and the `UiEngine` handle (`new` / ptr+capacity getters / `frame() -> draw_list_count`). `frame()` fills the fixed arenas with one bordered rect + a line of text. TS instantiates the main-thread module, derives views once, per frame calls `frame()`, walks the draw-list, and uploads per-batch through the **existing** `ui-rect`/`ui-text` programs with the grow-guard.
*Done when:* a bordered rect + "hello" render through the real Rust→wasm→GL zero-copy pipeline on `/engine`, with `abi.generated.ts` driving the TS consts.

**Phase 1 — IMGUI core (`od_ui`).**
Design nailed in three docs: [`design/layout-solver.md`](design/layout-solver.md), [`design/imgui-core.md`](design/imgui-core.md), [`design/text-and-font-metrics.md`](design/text-and-font-metrics.md).
Port Clay's solver — **core + text wrap** (fit/grow/fixed/percent, direction, padding, gap, alignment); **floating deferred to Phase 5, scroll/clip deferred until scissor** — with native unit tests. **Closure-scoped builder** API; hash-chained ids (FNV-1a, explicit keys for interactive widgets, `scope()` for lists, dev-mode dup detector); minimal retained-state side-table (last-rect + `frame_touched` + extension slot, immediate prune). Per-glyph `FontMetrics` trait + monospace VGA impl. Central `Theme` + per-call overrides. **Keyboard-focus-first, mouse deferred**: `ctx.focus` + `UiIntent` seam (input source is Phase 2), Linear-default focus scopes with opt-in Grid. Run-based text (`text` / `text_runs` inline color). Emit GL-ready buffers + draw-list (flat borders). Lean core widgets: column, row, grid, panel, spacer, text, button. (Toggle/slider/stepper → Phase 5 settings; text field/caret → Phase 4.)

**Phase 2 — Input.**
Design nailed in [`design/input-arena.md`](design/input-arena.md).
Zero-copy input arena in wasm memory: a sampled-state block (framebuffer/dpr/`dt_ms`/focus, reserved mouse) + a bounded per-frame event queue. TS is a **dumb capture layer** (`event.code` → codegen'd `KeyCode` enum → arena; `Blur`/`Resync` events; no meaning). **Rust owns the keymap**: `frame()` drains the queue, reconstructs held-state (events-only) + runs a `dt_ms`-driven repeat timer, and produces the `UiIntent` stream (`FocusNext/Prev`, `GridMove`, `Activate`, `Cancel`) that drives Phase 1 focus/nav. Default binds: **IJKL** nav (I/K prev/next, I/J/K/L grid dirs), Enter/Space Activate, Escape/Q Cancel — no Tab/arrows, rebindable in Phase 5. Escape becomes the sovereign key (router pre-keymap) in Phase 3. Mouse (pointer hit-testing, hot/active), wheel, and the hidden `<input>` text/IME path are reserved but deferred (text field → Phase 4). Widgets interactive; intents-out.
*Phase 0 carry-over:* Phase 0 shipped a **placeholder input region** (framebuffer w/h + dpr at hardcoded offsets, duplicated by hand in `od_wasm/src/lib.rs` and `engine/runtime.ts`). Phase 2 must **replace it** with the `InputSampled` struct + bounded event queue from [`design/input-arena.md`](design/input-arena.md) and **fold its offsets into `abi.generated.ts`** (via `od_core` + `abi:gen`) so nothing is hand-duplicated across the boundary.

**Phase 3 — Shell ESC menu (vertical slice + trust boundary).**
Design nailed in [`design/domains-and-shell-router.md`](design/domains-and-shell-router.md).
Two structurally-isolated domains as **distinct Rust types** (`ShellDomain`/`SessionDomain`; the "sovereign" domain is renamed **shell**), sharing generic store/builder machinery over the intent type — misrouting is a compile error. Shell context: ESC → settings + leave-game; composited last over a dimmed scrim atop the still-live session HUD; the **shell router** intercepts Escape **pre-keymap** as the secure-attention key (backs one level: Settings → Root → closed) and translates it to a `ShellIntent`; shell is modal when open (session focus frozen, world keeps rendering). Two intent kinds kept distinct: `UiIntent` (focus, active domain only) vs domain intents (`ShellIntent`/`SessionIntent`, applied end-of-frame). Host effects (`LeaveGame`, `PersistSettings`) cross via **wasm-bindgen JS callbacks** (`od_wasm` only; `od_ui` stays pure). Settings vertical slice = a buttons-only **UI-scale stepper** driving the ABI scale; settings persisted as an **opaque blob to `localStorage`** (`hydrate_settings(&[u8])` in, `host_persist_settings(ptr,len)` out). Proves the full trust boundary + compositing + persistence.

**Phase 4 — Port session game UI (old engine still the reference).**
HUD, chat (DOM-input mirror, GM-visible buffer), game menus into the session domain, on `/engine`. The existing `webgl2/` engine stays intact as the parity reference — do **not** delete its UI incrementally. Retirement is a single cutover (below) once parity is reached.
*Design interview (pending, before implementation):* **Text input (DOM `<input>` mirror) & chat** — the hidden `<input>` capture, IME/caret handling, text-field widget + retained caret state (imgui-core extension slot), mirroring keystrokes into the session model (GM-visible buffer), and the `Text` event path reserved in [`design/input-arena.md`](design/input-arena.md) §8. → new `docs/design/*.md`.

**Phase 5 — Surfaces, world-anchored UI, data + persistence integration.**
Generalize contexts → surfaces with placement; world-anchored session surfaces (tooltips, chat bubbles, nameplates) via floating-attach → `world_to_screen`, billboarded integer scale. `ClientView` type wired; UI renders from it; host projection vs remote snapshot; 60 fps interpolation. Persistence hooks (WAL seed+delta on OPFS) for session resume + sovereign settings.
*Design interviews (pending, each before its slice → separate `docs/design/*.md`):*
- **Surfaces & placement** — the surface abstraction, `Placement` variants (screen / world-anchored / world-embedded), and floating-attach → `world_to_screen` (activates the layout-solver floating feature deferred from Phase 1).
- **`ClientView` & replication boundary** — the filtered snapshot type, host projection vs remote snapshot, `bincode` wire format, tick cadence (~20 TPS) + delta encoding + 60 fps interpolation. (Shared foundation the multiplayer track builds on.)
- **Sovereign settings model** — the persisted settings schema incl. the per-`Category` scale table that drives the ABI scale resolution and the `Theme` swap; rebindable keymap storage (from Phase 2).
- **Persistence: WAL, seed+delta, OPFS** — save format, append-only delta log, snapshot cadence + A/B atomicity, OPFS layout with IndexedDB fallback, and the boot/resume path.

**Cutover — retire the old engine.** Once `/engine` reaches parity with `/webgl` (visual A/B + golden tests), remove the `webgl2/` TS engine and old route wholesale, and move any still-shared GL modules into the new engine's ownership. This is the single point where the two-implementation maintenance burden ends.

**Parallel tracks — each needs its own design interview + `docs/design/*.md` when its track begins (not gating the UI phases until integration):**
- **Lean core extraction & module topology** — carve the Bevy-free `od_world` core out of the deprecating `world_sim`; the one-binary / two-instance (main-thread + worker) runtime wiring.
- **`od_world` worker & offload protocol** — the worker message protocol (intents up, typed-array snapshots down), FOV/chunkgen/topmost offload, transferables, and how the main-thread session model consumes worker output.
- **WASM load pipeline** — brotli/`Content-Encoding`/`instantiateStreaming`, Fresh header config, code-caching, and the lean `cdylib` (Part 1.2). *Phase 0 carry-over:* `engine:build` already emits `od_wasm_bg.wasm.br`, but `engine/runtime.ts` currently loads the **bundled wasm-bindgen glue directly** (vite import of the committed `engine/generated/` artifacts) — the streaming/`Content-Encoding: br` fetch path is **not yet exercised**. This track wires it (and decides whether the generated glue/wasm stay committed or move to a build-only artifact).
- **Multiplayer / netcode** — server authority, WebRTC/transport, `ClientView` replication at tick cadence, GM authorization/override, tick sync + interpolation. Builds on the Phase 5 **`ClientView`** interview.

---

## Appendix — Research citations (2026)

- **Brotli/wasm loading:** MDN *Loading and running Wasm*; V8 *Liftoff* (v8.dev/blog/liftoff) & *wasm code caching* (v8.dev/blog/wasm-code-caching); caniuse *brotli*; MDN *DecompressionStream* (Firefox lacks `'br'`); WebAssembly/spec#821 (IndexedDB Module serialization removal). Native `Content-Encoding: br` decode ~300–500 MB/s; code cache for modules ≥128 KB across reloads.
- **rayon in wasm:** `wasm-bindgen-rayon` README + docs.rs v1.3.0; web.dev *Using WebAssembly threads* & *COOP/COEP* & *Scaling multithreaded WebAssembly*; rustc `wasm32-wasip1-threads`; rust-lang/rust #140971/#145101 (2025 atomics build regressions). ~1.5–3× typical (up to ~8× ideal batch); nightly + SharedArrayBuffer/COOP-COEP required; negative scaling past ~4 threads on some hardware.
