# Domains, Intents & the Shell Router (Phase 3)

**Status:** Approved design — 2026-07-04
**Parent:** [`../GAME_ENGINE_ARCHITECTURE.md`](../GAME_ENGINE_ARCHITECTURE.md) → Phase 3
**Scope:** The two structurally-isolated trust domains (**shell** and **session**),
the intent enums and how intents leave the UI, the **shell router** (Escape as the
secure-attention key, intercepted pre-keymap), modal input capture and compositing,
the minimal Settings vertical slice, and the settings-persistence seam. This is the
"Domains, intents & the sovereign router" deliverable; meant to be implementable by
a straightforward coding agent.

> Naming note: the architecture doc (§1.6, §3.10) calls the local-only, never-networked
> control domain **sovereign**. This design renames it **shell** (the application
> shell around the game). Every "sovereign" in the parent doc = **shell** here. Its
> counterpart stays **session**.

Companion docs: [`imgui-core.md`](imgui-core.md) (`UiIntent`, focus scopes, `frame()`
lifecycle, retained state, `Theme`), [`input-arena.md`](input-arena.md) (the event
queue, the keymap, the Escape seam in §4), [`render-command-abi.md`](render-command-abi.md)
(the arena discipline this reuses).

---

## 0. Overview

Phase 3 turns the single-domain Phase-0/1/2 engine into a **two-domain** engine and
proves the full trust boundary end-to-end: an ESC menu (shell) composited over a live
session HUD, a Settings page that changes UI scale, and settings that survive a reload.

Design invariants:

- **The trust boundary is in the type system, not by convention.** Shell and session
  are *distinct Rust types*; no network-reachable code path can borrow the shell store
  or construct a shell intent.
- **The UI is a pure function; intents are applied after the frame** (imgui-core §3.8).
  The router is a pure translator of reserved keys → shell intents, not a mutator.
- **Rust owns all trust-sensitive routing** (input-arena §1). The router lives in
  `od_ui` and is native-tested; `od_wasm` is glue + the outbound host callbacks only.

---

## 1. Domains — distinct types

Two domains, each a **distinct struct** (not two instances of one generic type), so
misrouting is a *compile error*:

```rust
struct ShellDomain {
    retained: Retained,        // ID-keyed side-table (imgui-core §6)
    focus:    Option<Id>,
    open:     bool,            // is the ESC menu up
    nav:      ShellNav,        // current page + back-stack (§5)
}
struct SessionDomain {
    retained: Retained,
    focus:    Option<Id>,
}
```

- **Shared machinery is generic, not duplicated.** `Retained`, focus resolution, and
  the closure-scoped builder are shared code parameterized over the intent type:
  `Ui<ShellIntent>` vs `Ui<SessionIntent>`. Only the domain wrapper structs and the
  intent enums are distinct. A `fn apply(&mut ShellDomain, SessionIntent)` simply does
  not compile.
- **Structural isolation is the security property.** The only network entry point
  (future MP / GM track) is typed to produce `SessionIntent` and to borrow
  `&mut SessionDomain` — it has no name for `ShellDomain` and cannot construct a
  `ShellIntent`. Phase 3 has no network yet; the *shape* is what Phase 3 establishes.

```rust
struct UiEngine {
    shell:    ShellDomain,
    session:  SessionDomain,
    router:   Router,
    settings: Settings,        // §5; shell-owned, read by the solver for scale
    // per-domain typed intent buffers, drained end-of-frame (§4):
    shell_out:   Vec<ShellIntent>,
    session_out: Vec<SessionIntent>,
}
```

---

## 2. Intents — two kinds, do not conflate

Two *different* things flow each frame:

1. **`UiIntent`** (imgui-core §4: `FocusNext/Prev`, `GridMove`, `Activate`, `Cancel`) —
   produced by the keymap, drives *focus and activation during build*. Routed to the
   **active domain only** (§3).
2. **Domain intents** (`ShellIntent` / `SessionIntent`) — commands *applied
   end-of-frame*. Produced by activated widgets **and** by the router (Escape → Back/Open,
   §3). These are the "intents-out" of imgui-core §3.8.

```rust
enum ShellIntent {
    Open,                        // closed -> open (router, on Escape)
    Back,                        // pop nav; at Root -> close  (router Escape / Cancel / buttons)
    OpenSettings,                // Root -> Settings page
    ChangeSetting(SettingChange),
    LeaveGame,                   // HOST effect (JS callback)
    // reserved (MP track): Disconnect
}

enum SettingChange {
    UiScale(u8),                 // clamped to 1..=4 on apply
    // Phase 5: ThemeId, per-Category scale, keybinds, repeat timing...
}

enum SessionIntent {
    // Phase 3: no real variants. The session domain builds a placeholder HUD and
    // emits nothing. Real gameplay/session intents land in Phase 4 / the od_world track.
}
```

- **Activation → intent.** A focused shell button that receives `Activate` sets its
  `Response.activated`; the shell builder pushes the corresponding `ShellIntent`
  (e.g. `"settings"` button → `OpenSettings`).
- **`Cancel` maps to `Back` in the shell.** A `Cancel` UiIntent (KeyQ) not consumed by
  a widget becomes `ShellIntent::Back` — redundant with the router's Escape→Back,
  consistent result. (This realizes imgui-core §4's "Cancel — routing per Phase 3".)

---

## 3. The shell router (secure-attention key + modal capture)

The router runs **inside `frame()`, before the keymap**, and is the trust-critical
piece. It is a *pure translator*: it consumes reserved keys and pushes the right
`ShellIntent`; it does **not** mutate `shell.open`/`nav` directly (that happens in the
end-of-frame apply, §4, keeping a single mutation point).

```
router.pre_keymap(events, shell_open) -> pushes into shell_out, returns events_minus_reserved:
  for each event in the raw queue:
    if event is KeyDown(Escape):          # the secure-attention key
        push ShellIntent::Open  if !shell_open
        push ShellIntent::Back  if  shell_open
        DROP the event (keymap never sees Escape; never fires an in-scope Cancel)
    else:
        keep the event
  # reserved-key set is a structured field: Phase 3 = { Escape }.
  # MP "disconnect chord" is added later as DATA in this set, not new structure.
```

- **Escape is consumed pre-keymap** so it can never also fire `Cancel` in a focus scope.
  `KeyQ` stays the in-scope Cancel/back (input-arena §4) — the two never fight.
- **Escape backs one level** (chosen UX): closed → open at Root; Settings → Root;
  Root → closed. Effect depends on nav depth; the secure-attention guarantee (Escape
  *always* reaches the shell, unsuppressable) holds at every depth.

**Active-domain selection & modal capture** (decided by `shell.open` at *frame start*,
before the apply step):

- `shell.open == true` ⇒ **shell is modal**: the keymap resolves against the shell's
  active focus scope; `UiIntent`s route to the shell; the **session domain is frozen**
  (keeps its `focus`, receives no `UiIntent`s). The session still *builds and renders*
  (live HUD) — "the world keeps running; the menu owns your local input."
- `shell.open == false` ⇒ session is active; `UiIntent`s route to the session.
- **No auto-repeat across a domain switch.** The `HeldSet` is global (physical keys),
  but a key already held when a domain becomes active does **not** repeat until a fresh
  `KeyDown` in the new domain — so holding K to move doesn't scroll the menu the instant
  Escape opens it. (Implementation: on a domain-active transition, clear the repeat
  timers; require a new `KeyDown` transition to arm them.)
- **Focus default:** when the shell opens and its focus is `None`, it defaults to the
  first focusable (Resume), per imgui-core §4.

---

## 4. Frame lifecycle & intent application

`frame() -> u32` keeps its Phase-0/2 signature (draw_list_count; input already in
memory). The two-domain orchestration:

```
frame():
  read InputSampled (dt_ms, framebuffer, dpr, window_focused)     (input-arena §2a)
  shell_open := shell.open                                        # snapshot at frame start

  # --- routing (trust-critical, pre-keymap) ---
  events := router.pre_keymap(raw_queue, shell_open)              # consumes Escape -> shell_out (§3)
  active := if shell_open { Shell } else { Session }
  ui_intents := keymap.run(events, HeldSet, dt_ms, active_focus_scope)   (input-arena §4-5)

  # --- build (compositing = append order; session first, shell last) ---
  build session tree (ALWAYS):                                    # placeholder HUD in Phase 3
    resolve focus/activation from ui_intents IFF active == Session
    solve; emit draws; widgets push into session_out
  if shell_open:
    build shell tree: scrim rect + centered menu panel (§5)
    resolve focus/activation from ui_intents IFF active == Shell
    solve; emit draws (APPENDED after session -> paints on top);  widgets push into shell_out

  # --- apply intents (end-of-frame; §3.8 "applied after the frame") ---
  apply_shell(shell_out):
    Open        -> shell.open = true;  shell.nav = Root
    Back        -> shell.nav.pop(); if was Root { shell.open = false }
    OpenSettings-> shell.nav.push(Settings)
    ChangeSetting(UiScale(v)) -> settings.ui_scale = clamp(v,1,4); host_persist_settings(...)
    LeaveGame   -> host_leave_game()                              # extern JS callback
  apply_session(session_out):                                     # Phase 3: no-op stub

  reset queue count = 0; clear overflow                           (input-arena §2b)
  prune shell.retained; prune session.retained                   (imgui-core §6)
  return draw_list_count
```

- **New values visible next frame.** A `ChangeSetting` applied at end-of-frame N is read
  by the solver on frame N+1 (one-frame lag on scale; imperceptible).
- **One-frame open latency.** Escape on frame N pushes `Open`; the shell builds on N+1.
  Session was active on N (shell not yet open), so N's input went to the game — correct.
- **Compositing order** (§3.10): world → session world-anchored (Phase 5) → session HUD
  → shell. In Phase 3: session HUD, then the shell scrim + menu appended last. Single
  shared arenas (rects/glyphs/draw-list) as Phase 0 — paint order *is* append order; no
  per-domain arenas.

### Intent-out channel — wasm-bindgen JS callbacks

Host-side effects (`LeaveGame`, `PersistSettings`, future `Disconnect`) cross to JS via
imported functions, called during the end-of-frame apply step (inside the `frame()`
FFI call, after build/solve/emit — never scattered mid-build):

```rust
// od_wasm only, behind #[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    fn host_leave_game();
    fn host_persist_settings(ptr: u32, len: u32);   // opaque settings bytes over linear memory
    // reserved (MP): fn host_disconnect();
}
```

- **Layering keeps `od_ui` pure.** `od_ui` *produces* `ShellIntent`s (native-testable);
  `od_wasm`'s apply step *dispatches* the host-effecting ones to these externs. Off-wasm
  (native tests), the extern calls are cfg'd out / stubbed — tests assert the emitted
  intents, not the host effect.
- **JS must supply the imports.** `runtime.ts` provides `host_leave_game` /
  `host_persist_settings` in the import object the `--target web` glue expects.
- Tradeoff accepted: this breaks the strict "one crossing, everything through arenas"
  discipline (an outbound host-command arena was the alternative). Justified because host
  effects are rare and low-frequency; the callbacks read as ordinary function calls.

---

## 5. Shell content & the Settings vertical slice

Widgets are the Phase-1 lean set only (**button / text / panel / row / column** — no
slider/toggle/stepper until Phase 5). Shell nav is a small back-stack:

```rust
enum ShellPage { Root, Settings }
struct ShellNav { stack: Vec<ShellPage> }   // top = current; Root is always the base
```

**Root page:** `Resume` (→ `Back` from Root ⇒ close), `Settings` (→ `OpenSettings`),
`Leave Game` (→ `LeaveGame`). MP `Disconnect` is deferred (reserved in the enum).

**Settings page:** a single **UI-scale stepper** built from buttons — the most
load-bearing single setting, because it drives the ABI per-Category scale resolution and
thus exercises settings→render, the one-frame lag, and persistence in one control:

```rust
ui.row(cfg, |ui| {
    ui.text("UI Scale", Text::default());
    if ui.button("scale_dec", "-").activated { shell_out.push(ChangeSetting(UiScale(cur.saturating_sub(1)))); }
    ui.text(&cur.to_string(), Text::default());
    if ui.button("scale_inc", "+").activated { shell_out.push(ChangeSetting(UiScale(cur + 1))); }
});
```

- **Shell build draws:** full-screen **scrim** rect (`theme.scrim`, e.g. rgba(0,0,0,0.5))
  over the still-live session HUD, then the centered menu panel on top.
- **Settings model** is shell-owned and read by the solver for the effective scale.
  Phase 3 = single global `ui_scale`; the struct is shaped to grow into the Phase-5
  per-Category scale table:

```rust
struct Settings {
    version:  u8,     // encoding version for forward-compat
    ui_scale: u8,     // 1..=4; effective device scale = f(dpr, ui_scale)
}                     // Phase 5: theme, per-Category scale, keybinds, repeat timing
```

- **Session HUD (Phase 3)** is a minimal placeholder (a panel + text) so backdrop and
  compositing are demonstrable — not the Phase-0 ABI-proof demo, and not yet fed by
  `od_world`.

---

## 6. Settings persistence seam

Full WAL / seed+delta / OPFS world-save is the **Phase-5 persistence track**. Phase 3
only proves the boot→restore path for the tiny settings blob.

- **Backend: `localStorage`** — synchronous, main-thread, zero ceremony for a few bytes
  on the shell's main-thread domain. (The Phase-5 track owns the OPFS/WAL *world* save via
  worker sync-access-handles; settings can stay in localStorage or migrate then.)
- **Blob is opaque to JS.** Consistent with "TS attaches no meaning" — JS stores and
  returns bytes; wasm owns the encoding (`version` byte + fields, forward-compatible).
  A minimal hand-rolled encoding (no bincode in the wasm path; it's a couple of bytes).
- **Boot hydration:** `engine.hydrate_settings(&[u8])` (wasm-bindgen method) called once
  at startup with the stored blob (empty → defaults). Mirrors the pragmatic callback
  boundary chosen in §4 rather than adding a second inbound arena.
- **Persist on change:** the `ChangeSetting` apply calls `host_persist_settings(ptr,len)`;
  JS reads the slice and writes it to `localStorage["od.settings"]`.

```js
// boot
const b64 = localStorage.getItem("od.settings");
engine.hydrate_settings(b64 ? base64ToBytes(b64) : new Uint8Array());

// import supplied to the wasm glue
function host_persist_settings(ptr, len) {
  const bytes = new Uint8Array(memory.buffer, ptr, len);
  localStorage.setItem("od.settings", bytesToBase64(bytes));
}
function host_leave_game() { /* navigate away / tear down the /engine session */ }
```

---

## 7. Done when

- Escape on `/engine` opens a dimmed ESC menu over a live session-HUD placeholder;
  Escape/KeyQ back out one level (Settings → Root → closed); the session HUD keeps
  rendering underneath while the menu owns local input (session focus frozen).
- The Settings page's `-`/`+` change UI scale and the whole UI re-solves at the new scale
  the next frame.
- The scale survives a page reload (persisted to localStorage, hydrated on boot).
- `Leave Game` fires the `host_leave_game()` callback.
- Native `od_ui` tests assert: router consumes Escape and emits `Open`/`Back`; shell
  buttons emit the right `ShellIntent`s; a session-typed value cannot be applied to the
  shell store (compile-fail test / doc); modal capture freezes session focus.

---

## 8. Deferred (with the enabling seam)

| Deferred | Seam kept here |
|---|---|
| MP `Disconnect` / GM intents | `Disconnect` reserved in `ShellIntent`; reserved-key set is structured; network ingestion typed to `SessionIntent` + `&mut SessionDomain` only |
| Real session UI / intents | `SessionIntent` enum + `session_out` + placeholder HUD; filled in Phase 4 / od_world |
| Theme swap, per-Category scale, keybind rebinding, repeat-timing settings | `SettingChange` enum + `Settings` struct grow; Phase-5 sovereign-settings interview |
| OPFS / WAL world save | settings blob is opaque + a `host_persist_settings` seam; Phase-5 persistence track owns the world path |
| World-anchored shell/session surfaces | domains are placement-agnostic here; Phase-5 surfaces interview |
