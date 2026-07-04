# Input Arena & Event Model

Design decisions for `od_ui` input (Phase 2). Defines how raw browser input
crosses into the wasm engine, how Rust turns it into the `UiIntent` stream that
Phase 1's focus system consumes, and the concrete byte layout of the input
arena. This is the deferred ABI §9 "input arena layout" item.

Companion docs: [`render-command-abi.md`](render-command-abi.md) (the
mirror-image output arena + the `abi:gen` codegen this reuses),
[`imgui-core.md`](imgui-core.md) (`UiIntent`, focus scopes, `frame()`
lifecycle).

## 1. Model overview

- **Transport: a zero-copy input arena.** TS writes input into a fixed region of
  wasm linear memory (via `DataView`), the mirror of the render ABI. Rust drains
  it inside the single `frame()` call — no per-event FFI, one entry point.
- **TS is a dumb capture layer.** It records physical keys and window state; it
  attaches **no meaning**. All semantics live in Rust.
- **Rust owns the keymap.** `frame()` reads raw events + sampled state,
  reconstructs held-state, runs the context-aware keymap + repeat timers, and
  produces the `UiIntent` stream that drives focus (imgui-core §4). This keeps
  trust-sensitive routing in the wasm TCB, ready for Phase 3's sovereign/session
  split.
- **Deterministic + replayable.** The arena bytes (including `dt_ms`) are a
  complete, ordered input log — replay reproduces a session exactly and golden
  tests can drive input by writing arena bytes.
- **Main-thread instance only.** The world worker (`od_world`) does not read
  this arena; it receives intents via `postMessage` (parallel track).

## 2. Arena regions

Two regions in wasm linear memory, each exposed by `UiEngine` getters (`ptr` +
`len`/`capacity`), with offsets codegen'd into `abi.generated.ts` alongside the
render ABI consts.

### 2a. Sampled block (fixed struct, overwritten in place)

TS overwrites fields as they change (or each frame); Rust reads once per frame.
`#[repr(C)]`, `bytemuck`, `offset_of!` self-asserts (same discipline as the
render records).

```rust
#[repr(C)]
struct InputSampled {
    framebuffer_w: u32,   // device px (canvas.width)
    framebuffer_h: u32,   // device px (canvas.height)
    dpr:           f32,   // devicePixelRatio
    dt_ms:         f32,   // frame delta TS computed; drives Rust repeat timer
    window_focused: u32,  // 0/1 (bool as u32 for alignment)
    // --- reserved, written-or-zero, unconsumed in Phase 2 ---
    pointer_x: f32,       // mouse deferred
    pointer_y: f32,
    buttons:   u32,       // pointer button bitmask
}
```

Reserving the mouse fields now avoids ABI churn when pointer support lands.

### 2b. Event queue (bounded, reset per frame)

Because DOM handlers and the `rAF`-driven `frame()` run on the **same JS
thread** and cannot interleave, no wrap-around ring or atomics are needed. TS
appends records between frames; `frame()` drains `[0, count)` and resets
`count = 0`.

```rust
#[repr(C)]
struct InputQueueHeader {
    count:    u32,   // TS-owned write count; Rust resets to 0 after draining
    overflow: u32,   // TS sets 1 if an event was dropped (queue full)
}
// followed by: [InputEvent; CAPACITY]     CAPACITY = 1024
```

```rust
#[repr(C)]
struct InputEvent {
    kind:      u8,   // EventKind
    modifiers: u8,   // bit0 Shift, bit1 Ctrl, bit2 Alt, bit3 Meta
    code:      u16,  // KeyCode (physical); 0 for non-key events
    value:     u32,  // reserved: wheel delta / text codepoint (Phase 4)
}                    // 8 bytes, naturally aligned

enum EventKind {           // u8
    KeyDown = 1,
    KeyUp   = 2,
    Blur    = 3,   // window/focus lost -> Rust clears held-state
    Resync  = 4,   // TS pushes on overflow -> Rust clears held-state (safe fallback)
    // reserved: Wheel, PointerMove, PointerButton, Text
}
```

**Overflow policy:** if `count == CAPACITY`, TS drops the event and sets
`overflow = 1`. On seeing `overflow`, Rust treats it as a `Resync` (clears
held-state) so a dropped key-up can never leave a stuck key. 1024 events/frame
is far beyond any real frame's input.

## 3. KeyCode

Physical, layout-independent identity from `KeyboardEvent.code` (see the
key-source decision). A numeric `KeyCode` enum is the single source of truth in
`od_core`, codegen'd into `abi.generated.ts`; TS maps `event.code` → `KeyCode`
via a lookup table (`"KeyK"` → `KeyCode::KeyK`), unknown →
`KeyCode::Unknown(0)`.

```rust
enum KeyCode {            // u16; extend freely, Unknown must stay 0
    Unknown = 0,
    Enter, Escape, Space,
    KeyI, KeyJ, KeyK, KeyL,      // nav cluster (also camera in gameplay)
    KeyQ,                        // cancel
    KeyE, KeyS, KeyD, KeyF,      // gameplay move (session domain)
    // ... grows as needed
}
```

Rust matches on named variants (exhaustive, readable); the enum is only
representation/sync — layout-independence comes from using `event.code`.

## 4. Keymap (Rust, context-aware)

Resolved against the active focus scope (imgui-core §4). Same physical key can
mean different things per scope.

| Key(s)           | Linear scope | Grid scope      | Any scope |
| ---------------- | ------------ | --------------- | --------- |
| `KeyI`           | FocusPrev    | GridMove(Up)    |           |
| `KeyK`           | FocusNext    | GridMove(Down)  |           |
| `KeyJ`           | —            | GridMove(Left)  |           |
| `KeyL`           | —            | GridMove(Right) |           |
| `Enter`, `Space` |              |                 | Activate  |
| `Escape`, `KeyQ` |              |                 | Cancel    |

- **No Tab, no arrow keys** (deliberate).
- All bindings are **rebindable later** (rebind UI = Phase 5 settings); this
  table is the shipped default in the Rust keymap.
- **Escape seam:** in Phase 2, Escape → `Cancel` via the keymap (stub). In Phase
  3 the router intercepts Escape **before** the keymap as the sovereign
  secure-attention key (open ESC menu, unsuppressable). `KeyQ` stays the
  in-scope Cancel/back, so the two never fight.

## 5. Held-state reconstruction & repeat

No held-key bitset is stored in the arena; Rust reconstructs it from the event
stream (chosen in the interview).

- Rust maintains a `HeldSet` (bitset over `KeyCode`): `KeyDown` sets, `KeyUp`
  clears, `Blur`/`Resync` clears all. `is_held(code)` is available for gameplay
  sampling later.
- **Repeat:** directional intents (`FocusNext`/`Prev`, `GridMove`) auto-repeat.
  On the `KeyDown` transition, emit once and start a repeat timer; while the key
  stays in `HeldSet`, the timer (driven by `dt_ms` from the sampled block) emits
  further intents after an initial delay, then at a steady interval.
  - Defaults (Rust consts, tunable via settings later): `REPEAT_DELAY_MS = 400`,
    `REPEAT_INTERVAL_MS = 60`.
- **Non-repeating:** `Activate` and `Cancel` fire once per `KeyDown` transition
  only (never repeat).

## 6. `frame()` integration

`frame() -> u32` (draw_list_count) keeps its Phase-0 signature — input is
already in memory, `dt_ms` is in the sampled block, so no arguments are added.

```
frame():
  read InputSampled (dt_ms, framebuffer, dpr, focus)
  drain event queue [0, count):
    fold KeyDown/KeyUp/Blur/Resync into HeldSet
    run keymap (context = active focus scope) -> push UiIntents
  advance repeat timers over held directional keys -> push UiIntents
  reset queue count = 0, clear overflow
  feed the UiIntent stream into focus/activation resolution   (imgui-core §4)
  run user root closure -> solve -> emit draw-list -> prune   (imgui-core §9)
```

This reconciles Phase 1's `frame(intents)` test seam: in production the keymap
**produces** the `UiIntent` stream; a test hook can still inject a `UiIntent`
slice directly (bypassing the arena) for deterministic focus/nav unit tests.

## 7. TS capture module (`/engine`)

A new capture module for the `/engine` route (analogous to `webgl2/input.ts`,
but writing the arena instead of mutating a JS state object):

- `keydown`/`keyup` (window, `passive:false`): map `event.code` → `KeyCode`,
  read modifier flags, append a `KeyDown`/`KeyUp` record; `preventDefault` for
  captured keys.
- `blur`: append a `Blur` record (replaces the old `keysHeld.clear()`).
- `resize`/`focus`: update `InputSampled` (framebuffer, dpr, `window_focused`).
- Each frame before `engine.frame()`: write `dt_ms` (and refresh framebuffer/dpr
  if changed) into `InputSampled`.
- No hit-testing, no meaning, no intent construction — all in Rust.

## 8. Deferred (reserved, not built in Phase 2)

- **Mouse / pointer** — `InputSampled` pointer fields + `PointerMove`/
  `PointerButton` event kinds reserved; hit-testing and hot/active resolution
  land when mouse is added.
- **Wheel** — `Wheel` event kind + `value` reserved.
- **Text / IME** — `Text` event kind + `value` (codepoint) reserved; the hidden
  DOM `<input>` mirror path lands with the text field in Phase 4.
- **Rebinding UI** and **repeat-timing settings** — Phase 5 sovereign settings.
- **Worker input** — the world worker receives intents via `postMessage`, not
  this arena (parallel `od_world` track).

## 9. Module layout

Build one module at a time (`engine:check`/`engine:test` after each); never a
`phase2.rs`. All input **semantics** (keymap, held-state, repeat) live in
`od_ui` and are **native-tested**; `od_wasm` only owns the arena memory and
hands `od_ui` a byte slice.

- **`od_core/src/`**
  - `keycode.rs` — the `KeyCode` enum (single source of truth; codegen'd into
    `abi.generated.ts`, grows freely, `Unknown` stays 0).
  - `input.rs` — `InputSampled`, `InputEvent`, `InputQueueHeader`, `EventKind`
    (`#[repr(C)]` + `bytemuck` + `offset_of!` self-asserts; offsets folded into
    `abi.generated.ts` via `abi:gen`, replacing the Phase-0 placeholder region).
- **`od_ui/src/input/`**
  - `decode.rs` — `bytemuck`-cast the arena byte slice → `&[InputEvent]`; read
    `InputSampled`.
  - `held.rs` — `HeldSet` reconstruction + the `dt_ms`-driven repeat timer.
  - `keymap.rs` — the context-aware table → `UiIntent` stream (per active focus
    scope); the test hook that injects `UiIntent`s directly bypasses this (§6).
- **`od_wasm/src/`** — expose the input-arena `ptr`/`capacity` getters; in
  `frame()`, hand the arena slice to `od_ui`. Thin glue only.
- **TS (`engine/`)** — `input.ts`: the dumb capture layer (`event.code` →
  `KeyCode`, `Blur`/`Resync`, sampled-state writes). No meaning.
