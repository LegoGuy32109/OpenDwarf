# Text Input (hidden `<input>` mirror) & Chat (Phase 4)

**Status:** Approved design — 2026-07-04
**Parent:** [`../GAME_ENGINE_ARCHITECTURE.md`](../GAME_ENGINE_ARCHITECTURE.md) → Phase 4
**Scope:** The text-input path for `od_ui`: how keystrokes/paste/mobile input cross
into wasm, the wasm-authoritative text-field editor (caret, editing ops, retained
state), the text-capture routing (keymap suspension, `<input>` focus sync, Escape
precedence vs the shell), caret rendering, and the chat vertical slice (draft, submit,
the GM-visible buffer seam). This is the "Text input (DOM `<input>` mirror) & chat"
deliverable; meant to be implementable by a straightforward coding agent.

The rest of Phase 4 — porting the HUD and game menus into the session domain — is
**mechanical parity work** over the Phase-1 widget set + this text field, not covered
by design decisions here. Chat **bubbles** (world-anchored) are **Phase 5** (surfaces);
Phase 4 ships the on-screen chat *input bar* + the message store seam.

Companion docs: [`input-arena.md`](input-arena.md) (event queue, keymap, the reserved
`Text` path in §8), [`imgui-core.md`](imgui-core.md) (focus, retained-state extension
slot, `Theme`), [`domains-and-shell-router.md`](domains-and-shell-router.md) (Phase-3
router, session domain, secure-attention invariant), [`render-command-abi.md`](render-command-abi.md)
(scissor in `DrawCmd`).

---

## 0. Overview & decisions

- **Text state is wasm-authoritative** (input-arena §8 path, *not* an `<input>` mirror).
  Rust owns the buffer + caret and applies all edits deterministically; replay stays a
  pure event log.
- **The hidden `<input>` is an event source, not an editor.** It exists (per §1.6) to
  get **mobile virtual keyboards + paste + OS autocorrect** correct; its output is
  forwarded as `Text` events. IME/composition is **deferred** — the font
  (`JoshPerfectDosVga`, ASCII 33–126) can't render CJK/emoji, so a preedit would be
  blank; the `Composition` event kind is reserved for a future richer font.
- **Capture split:** insertion/paste ← hidden `<input>`; caret/deletion ← keymap.
- **One reusable text-field widget**, caret + editing, **no selection** (reserved).
- **Chat draft lives in the session model** (GM-visible seam); caret/blink/scroll are
  widget retained state.

---

## 1. Arena additions (input-arena §2b / §3)

One new event kind; one reserved. No record-size change — the reserved `value: u32`
field (input-arena §2b) now carries a codepoint for `Text`.

```rust
enum EventKind {              // u8
    KeyDown = 1, KeyUp = 2, Blur = 3, Resync = 4,
    Text = 5,                 // value = Unicode scalar (codepoint); from the hidden <input>
    // reserved, NOT wired in Phase 4:
    // Composition = 6,       // IME preedit (run-ref into a future text staging buffer)
}
```

- **Prune at ingestion.** On draining a `Text` event, Rust inserts the codepoint only if
  `font.has_glyph(cp)` (FontMetrics, imgui-core / text-and-font-metrics). Unrenderable
  scalars (CJK, emoji, control) are dropped. So the buffer only ever holds renderable
  glyphs.
- **Paste** is a run of `Text` events (one per scalar). TS **clamps paste to the focused
  field's `max_len`** before emitting, keeping the burst well under the 1024-event queue
  cap (so paste never triggers the overflow→`Resync`).
- `Text` events are only produced while a field is capturing (§4); otherwise none are
  emitted.

---

## 2. TS capture layer (text-capture mode)

Extends the `/engine` capture module (input-arena §7). A single hidden `<input>` element
lives in the DOM:

```html
<input id="od-text-capture" autocomplete="off" autocorrect="off"
       autocapitalize="off" spellcheck="false" inputmode="text"
       style="position:absolute; opacity:0; caret-color:transparent; ...">
```

- Transparent overlay positioned under the visible caret (so a mobile keyboard / any
  future IME candidate window appears in the right place and the page never scrolls it
  into view). Our UI renders the glyphs; the element shows nothing.
- **Insertion / paste** (capture active):
  ```js
  input.addEventListener('beforeinput', e => {
    if (e.inputType === 'insertText' || e.inputType === 'insertFromPaste') {
      for (const cp of clampToMax(e.data)) pushTextEvent(cp);  // Text events
      e.preventDefault();                                      // wasm owns the buffer; keep <input> empty
    }
  });
  // composition* listeners reserved (deferred); on compositionend we'd pushTextEvent(e.data)
  ```
- **Caret / deletion** come through the *normal* `KeyDown` path (Backspace, Delete,
  ArrowLeft/Right, Home, End, Ctrl+Backspace) → the Rust keymap (§3). While capturing, TS
  **does not `preventDefault` printable keys** (they must reach the focused `<input>` to
  produce `beforeinput`); it still forwards the editing-key subset to the arena queue.
- **Focus sync** is driven by wasm via a host callback (§4).

---

## 3. Wasm text editor (od_ui)

### 3.1 State & retained slot

```rust
struct TextState {
    buf:   String,       // NOTE: for chat, the buf is the session model's chat_draft (§6);
                         //       generic fields own their own String here
    caret: usize,        // byte offset == char index (ASCII); always on a char boundary
    max_len: usize,
    // sel_anchor: Option<usize>  // RESERVED — selection is deferred
    scroll_px: f32,      // horizontal scroll offset (scroll-to-caret, §5)
    blink_ms: f32,       // caret blink phase, advanced by dt_ms
}
```

The **caret/scroll/blink** (ephemeral, non-sensitive view state) live in the widget's
retained-state extension slot (imgui-core §6 `state: Option<Box<dyn Any>>`, keyed by the
field Id, downcast by the text-field widget). The chat **draft string** lives in the
session model (§6), not the slot.

### 3.2 Edit intents

While a field is focused the keymap is in a **TextField context** (input-arena §4 is
context-aware). It recognizes *only* these; every other physical key is a keymap no-op
and reaches the `<input>` as `Text`:

```rust
enum TextEdit {          // local session intents, field-focused only
    InsertText(char),    // sourced from a drained Text event (post-prune)
    DeleteBack, DeleteFwd, DeleteWordBack,
    CaretLeft, CaretRight, CaretHome, CaretEnd,
    Submit,              // Enter  -> §6
    Cancel,              // Escape -> handled by the router (§4), not the keymap
}
```

- `DeleteWordBack` = Ctrl+Backspace (matches `webgl2` `deleteChatBufferWord`); word
  boundary = run of non-space then trailing spaces.
- Applied in the end-of-frame intent step (domains-and-shell-router §4): text mutations
  edit the buffer (`chat_draft` for chat), and the retained caret is updated in the same
  step (the apply site holds both). Insert past `max_len` is dropped.
- **No selection** in Phase 4: `InsertText` inserts at caret; caret keys move a single
  position; `sel_anchor` reserved for a later selection pass.

---

## 4. Text-capture routing

### 4.1 Focus ⇒ capture (`host_set_text_capture`)

Edit-mode == the field is focused (chat opens directly into edit; a focus-then-activate
mode for keyboard-navigated fields is deferred). When a text field gains/loses focus,
`od_ui` emits a **`HostEffect`** (the pure `od_ui`→`od_wasm` boundary from
domains-and-shell-router §4 — `od_ui` returns effects, `od_wasm` dispatches):

```rust
// od_ui: add to the HostEffect enum
enum HostEffect { /* LeaveGame, PersistSettings(..), */ SetTextCapture { active: bool, rect: Rect } }

// od_wasm: dispatch -> extern (behind #[cfg(target_arch = "wasm32")])
#[wasm_bindgen] extern "C" {
    fn host_set_text_capture(active: u32, x: f32, y: f32, w: f32, h: f32);
}
// active=1 -> TS .focus()es + positions the hidden <input> at rect [visible caret]
// active=0 -> TS .blur()es it
```

`session.text_capture_active: bool` is **local-only** engine state — set solely by local
UI/keymap intents, **never** by network-originated intents. This is the invariant that
keeps the shell's secure-attention guarantee intact (§4.2).

### 4.2 Escape precedence (vs the Phase-3 shell router)

Escape is still intercepted **pre-keymap** by the shell router. It now prefers cancelling
an active field:

```
router, on Escape KeyDown:
  if session.text_capture_active {   // local-only flag
      emit TextEdit::Cancel          // close chat, blur <input>, discard draft
  } else if shell.open {
      emit ShellIntent::Back
  } else {
      emit ShellIntent::Open
  }
```

**Secure-attention is preserved:** because `text_capture_active` can only be set by local
input (never by a peer/GM intent), a peer cannot trap your Escape; and one further Escape
always reaches the shell (bounded, non-suppressible). `KeyQ` remains the in-scope Cancel
for non-text scopes; inside a text field it is a normal character.

### 4.3 Keymap context while capturing

- Printable keys: keymap no-op → reach the `<input>` → `Text` events (so "ijkl"/"esdf"
  type letters, not navigate/move).
- Editing keys (Backspace/Del/arrows/Home/End/Ctrl+Backspace): → `TextEdit` intents.
- `Enter` → `TextEdit::Submit`. `Escape` → router (§4.2). Nav/gameplay intents are
  suppressed for the capturing field.

---

## 5. Rendering (text-field widget)

- **Caret:** a thin vertical line (I-beam) — a rect of width `1 × ui_scale`, height =
  line height, at `field_x − scroll_px + text_width(buf[..caret])`. Sits *between*
  glyphs → unambiguous insertion point. **Blinks** ~530ms on / ~530ms off
  (`(blink_ms % 1060) < 530`), driven by `dt_ms`.
- **Horizontal scroll-to-caret:** single line; `scroll_px` is adjusted each frame so the
  caret stays within the field rect (clamp caret into `[field_x+pad, field_x+w-pad]`).
- **Clip:** the field **clips its content to its rect via scissor** (`DrawCmd.scissor`,
  render-command-abi §2). This is the **first real consumer of scissor** in `od_ui`
  (Phase 1 deferred scroll *containers* "until scissor"; a single-line field's clip is
  the minimal activation).
- **Chat bar chrome:** a themed semi-transparent background rect + the text + caret
  (session HUD placement), replacing `webgl2/passes/chat.ts`'s bar. Colors from `Theme`.

---

## 6. Chat vertical slice

### 6.1 Session model (minimal, placeholder)

Phase 4 introduces a minimal main-thread session model — a placeholder superseded by
`od_world` / `ClientView` (Phase 5 / netcode track). It lives in **`od_core`**
(session-domain, networkable — the crate the native server reuses; `SessionIntent` is
already there):

```rust
struct SessionModel {
    chat_draft: String,          // the in-progress line; GM-visible seam (§1.6)
    messages:   RingBuf<ChatMsg>,// submitted lines; rendered as bubbles in Phase 5
    // ... future gameplay/ClientView state
}
```

- **`chat_draft` in the model** (not the widget slot) is the "GM sees typing" seam:
  Phase 5 projects it into `ClientView` with **zero refactor**. The text-field widget
  reads it by immutable ref (imgui-core §3.8) and emits `TextEdit` intents; the apply
  step mutates `chat_draft`.

### 6.2 Open / submit / cancel (local session intents)

| Trigger | Intent | Effect |
|---|---|---|
| `KeyT` (gameplay ctx) | `OpenChat { prefill: "" }` | focus chat field, capture on |
| `Slash` (gameplay ctx) | `OpenChat { prefill: "/" }` | focus chat field with `/`, capture on |
| `Enter` (field ctx) | `SubmitChat` | trim; empty → cancel; else push `ChatMsg` to `messages`, clear `chat_draft`, capture off |
| `Escape` (router) | `TextEdit::Cancel` | discard `chat_draft`, capture off |

- These are **local** session intents (never network-producible), so they may set
  `text_capture_active` (§4.1). Rebindable in Phase 5.
- **Slash-command parsing** (`/master`, `/entity`, …) is **deferred**: it mutates
  session/`od_world` state not integrated in Phase 4. `SubmitChat` carries the raw text;
  command dispatch lands with the session model.
- Submitted messages are **stored, not yet rendered** (bubbles = Phase 5). A dev-only
  on-screen log may be added behind a debug flag for Phase-4 visibility.

---

## Module layout

Build one module at a time (`engine:check`/`engine:test` after each); never a `phase4.rs`.

- **`od_core/src/`** — extend `input.rs` with the `Text` (=5) `EventKind` (`Composition`=6
  reserved); extend `session.rs` with `chat_draft` / `messages` / `ChatMsg`; add the
  chat/text edit variants to `SessionIntent`.
- **`od_ui/src/`**
  - `text/state.rs` — `TextState` (buf ref, caret, scroll, blink, `max_len`; `sel_anchor`
    reserved) + the edit ops (`TextEdit` apply over the buffer + caret).
  - `text/field.rs` — the reusable text-field widget: render (I-beam caret, scroll-to-caret,
    scissor clip), focus↔`HostEffect::SetTextCapture`.
  - `keymap.rs` (extend, Phase 2 module) — the **TextField context** (editing keys only;
    others fall through as `Text`).
  - `router.rs` (extend, Phase 3 module) — Escape prefers field-cancel when
    `text_capture_active` (§4.2); add `SetTextCapture` to `HostEffect`.
  - `chat.rs` — the chat bar UI + open/submit/cancel intents (§6.2).
- **`od_wasm/src/`** — add the `host_set_text_capture` extern + dispatch the new
  `HostEffect` variant; ingestion pruning (`font.has_glyph`) runs in `od_ui` on drain.
- **TS (`engine/`)** — extend the capture layer: the hidden `<input>`, `beforeinput` →
  `Text` events (clamp paste to `max_len`), no `preventDefault` on printables in capture
  mode, and honor `DrawCmd.scissor` in the draw-list walker (first scissor consumer).

## 7. Done when

- Pressing `T` / `/` on `/engine` opens a themed chat bar; typing inserts glyphs (via the
  hidden `<input>` → `Text` events); unrenderable chars are pruned.
- Backspace / Ctrl+Backspace / Delete / arrows / Home / End edit and move the caret; the
  I-beam caret blinks and the line scrolls to keep it visible, clipped to the bar (scissor).
- Paste inserts (clamped to `max_len`); a mobile keyboard opens on focus.
- `Enter` submits (non-empty) → clears + closes; `Escape` cancels the field (and only
  opens the shell when no field is capturing).
- `chat_draft` reflects every keystroke in the session model (GM-visible seam).
- Native `od_ui` tests: `TextEdit` ops over `TextState` (insert/prune/delete/word-delete/
  caret moves/clamp); keymap TextField-context suppresses nav; router prefers field-cancel
  over shell when `text_capture_active` and never when a network intent is the source.

---

## 8. Deferred (with the enabling seam)

| Deferred | Seam kept here |
|---|---|
| IME / composition | `Composition` (=6) event kind reserved; run-ref staging buffer noted; lands with a CJK-capable `FontMetrics` impl |
| Selection (Shift-select, select-all, cut/copy, replace) | `sel_anchor` reserved in `TextState`; caret model already byte-offset based |
| Chat bubbles / message rendering | `messages` ring stored now; rendered via Phase-5 world-anchored surfaces |
| Slash-command dispatch | `SubmitChat` carries raw text; dispatch with the integrated session model / `od_world` |
| GM-visible replication of `chat_draft` | draft is a session-model field; Phase-5 `ClientView` projects it |
| Focus-then-activate edit mode for navigated fields | Phase 4 is edit-on-focus; add an activate gate later |
| Rebindable text/chat keys | defaults here; rebind UI = Phase 5 settings |
