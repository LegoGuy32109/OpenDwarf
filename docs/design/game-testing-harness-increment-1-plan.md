# Game Testing Harness — Increment 1 Implementation Plan

**Status:** Implemented (interview-locked 2026-07-11) **Parent:**
[`game-testing-harness.md`](./game-testing-harness.md) §7 Increment 1 **Out of
scope:** Increment 2 / `od_world` (separate interview after this lands)

This is the build plan for Increment 1 only. One PR. After merge, interview
Increment 2 + `od_world` design.

---

## 1. Delivery

- **One PR** covering Rust hash/seam + wasm rebuild + harness v2 +
  goldens/smokes
  - `/webgl` harness retirement.
- Clear internal commits for review.
- Install `wasm32-unknown-unknown` + `wasm-bindgen` / `wasm-opt` / `brotli` as
  needed; rebuild and **commit** updated `engine/generated/` artifacts.

---

## 2. Rust — `od_core` seam + hash contract

- Move/share **FNV-1a** hasher into `od_core` (`od_ui` consumes it; crate graph
  forbids the reverse).
- Land **`StateHash`** tagged form `"fnv1a64:<16hex>"`.
- Land **`draw_hash(&[DrawCmd], &[RectInstance], &[GlyphInstance]) -> u64`**
  over used prefixes (incl. scissor); IEEE-basic + signed-zero (`-0.0 → 0.0`)
  invariants from the parent doc.
- **`od_core::scenario`**: empty docs-only module home — **no** typed skeleton /
  world types.
- **`od_core` smokes** (not goldens): empty inputs, scissor affects hash,
  signed-zero canonicalization, `StateHash` formatting.

---

## 3. Rust — `od_ui` native goldens (no screenshots)

Mirror all **seven** browser checkpoints as small direct-setup unit goldens
(construct state → one frame → assert `drawHash`). No PNG / raster path.

Checkpoints:

1. `boot_idle`
2. `chat_open_empty`
3. `chat_typed`
4. `chat_submitted`
5. `shell_root`
6. `shell_settings`
7. `shell_settings_scale`

Native fixtures live with the Rust tests (committed expected `StateHash`
strings). Screenshots remain **browser-only** (parent doc: native has no
framebuffer readback).

---

## 4. Wasm + snapshot

- Export **`debug_draw_hash()`** compute-on-call (not on the RAF path).
- Add `snapshot().frame.drawHash` (`StateHash` string).
- Bump harness / snapshot **version to `2`** where versioned today.
- Under `?harness=1`, boot from **`Settings::default()`** — ignore
  `localStorage` hydration so UI-scale/layout stay pinned.

---

## 5. Browser harness v2

Extend `globalThis.__openDwarfEngineHarness` (`/engine?harness=1`):

| API                                                 | Notes                                        |
| --------------------------------------------------- | -------------------------------------------- |
| `version: 2`                                        |                                              |
| `input.keyDown` / `keyUp`                           | Held-key + synthetic-clock repeat            |
| `input.press` / `typeText` / `paste`                | Keep; `press` may compose down+up            |
| `input.blur` / `focus`                              | Arena blur/resync + canvas focus             |
| `stepFrame` / `snapshot`                            | `snapshot.frame.drawHash` present            |
| `captureCheckpoint(name, { screenshot?: boolean })` | **Per-call** screenshot opt-in; default off  |
| `exportBundle()`                                    | Plain data only; **test helper** writes `fs` |

Pinned env (unchanged): Playwright 1920×1080, DPR 1; harness synthetic
`+16ms`/step, no RAF.

---

## 6. Tests — golden vs smoke

### Golden (hash-gated)

**Class**, not cardinality. Increment 1 ships:

- **Native:** seven small `od_ui` unit goldens (above).
- **Browser:** **one** e2e scenario walking the same seven checkpoints.

Browser golden fixture: `tests/goldens/engine/*.json` per checkpoint with:

- `drawHash`
- Allowlisted semantics only:
  - `shell.open`, `shell.page`
  - `session.uiMode`, `session.chatDraft`, `session.chatMessages`
  - `input.textCaptureActive`

Browser golden **always** passes `{ screenshot: true }` at each checkpoint
(non-gating). No pixel asserts.

### Smoke (no committed goldens / no human artifact duty)

- Boot/canvas (`tests/engine.test.ts` or equivalent).
- Paste + blur/resync (behaviors not in the golden checkpoint set); use harness
  `blur`/`focus` rather than ad-hoc DOM where possible.
- Thin **held-key** behavioral smoke (`keyDown` → `stepFrame`s → draft/caret
  change); no `drawHash` golden.

**Promotion rule:** if a smoke flow becomes worth locking, fold it into a golden
scenario and drop the redundant smoke. Don’t duplicate chat/shell walks.

### Artifacts

- Local/CI (gitignored): `exports/engine-golden/<runId>/` with manifest,
  checkpoints, `screenshots/<name>.png`.
- Cloud inline: copy PNGs (optional manifest) to
  `/opt/cursor/artifacts/engine-golden/` with stable names `01-boot_idle.png`, …
  so they render in the Cursor run/PR.

---

## 7. Bless workflow

Three agent-runnable tasks:

| Task                                     | Scope                  |
| ---------------------------------------- | ---------------------- |
| `deno task engine:bless-goldens`         | Native **and** browser |
| `deno task engine:bless-goldens-native`  | Rust / `od_ui` only    |
| `deno task engine:bless-goldens-browser` | Playwright golden only |

Normal `cargo test` / `deno task test` / CI **never** rewrite fixtures. Failure
output prints expected vs actual hashes.

---

## 8. `/webgl` harness retirement

**Delete entirely:**

- `tests/webgl-step1.test.ts`, `webgl-step2.test.ts`, `webgl-step3.test.ts`,
  `webgl-step3-slow.test.ts`, `webgl-step4-parity.test.ts`
- `tests/helpers/harness.ts`
- `tests/flows/webgl-step1-single-rock.ts`
- `scripts/webgl_review.ts` + `deno.json` `ui-test` task
- `lib/webgl-harness-types.ts`

**Keep:** `/webgl` route + `webgl2/` engine (manual eye parity) and
`tests/unit/webgl-world-sim.test.ts`.

No automated `/webgl`↔`/engine` parity.

---

## 9. Suggested commit / build order

1. `od_core`: hasher, `StateHash`, `draw_hash`, `scenario` stub, smokes
2. `od_ui`: consume shared hasher; seven native goldens
3. `od_wasm` + domain snapshot: `debug_draw_hash`, `frame.drawHash`; wasm
   rebuild
4. Harness v2 + settings pin in `engine/runtime.ts` (+ helpers)
5. Browser golden + thinned smokes + bless tasks + artifact helper
6. Delete webgl harness surface; confirm `deno task unit` + `deno task test`
   green
7. Bless goldens once UI is stable; copy cloud artifacts for the PR/run

---

## 10. Explicit non-goals (Increment 1)

- `od_world`, world-state-hash, `WorldSnapshot`, `importReplay`, `stepSimTick`,
  typed `Scenario` steps
- Pointer/wheel, IME
- Pixel-diff gating
- Rust-side screenshots / software rasterizer
- Re-wiring `__openDwarfWebGlHarness`
