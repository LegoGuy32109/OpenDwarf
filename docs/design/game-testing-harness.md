# Game Testing Harness

**Status:** Approved design — 2026-07-11 (supersedes the earlier
`browser-test-harness.md` draft) **Parent:**
[`../GAME_ENGINE_ARCHITECTURE.md`](../GAME_ENGINE_ARCHITECTURE.md) → Phase 4+
validation

This is the decision record from the testing-harness interview. It defines the
whole test stack for the new `game_engine/` (`/engine`) — from fast native Rust
simulation validation up through full browser end-to-end "golden" runs of
exactly what a player sees — and how those layers share one deterministic
contract.

The old `game_library/` (Bevy) and the `/webgl` TS reference engine are being
deprecated; this document targets the new engine and treats `/webgl` only as a
throwaway manual visual-parity reference (see §7).

---

## 0. Goal & guiding principles

The harness exists to let both humans and coding agents **validate engine
behavior deterministically and produce replayable, human-viewable artifacts**,
so remote/cloud-agent development is reliable.

Principles (locked in the interview):

- **Confirmable cross-environment determinism > performance.** We accept
  performance leakage or missed optimization in exchange for byte-identical,
  reproducible results in any environment (native and wasm). Every hash and
  scenario is deterministic or it does not ship.
- **The game is keyboard-controlled.** No mouse/pointer input path exists by
  design; the harness is keyboard-first. Pointer/wheel helpers are out of scope
  unless a mouse path is ever deliberately added.
- **Test the shipped binary.** The harness drives the same wasm/browser paths
  users exercise; we do not build a separate "test-only" binary (§5.1).
- **No throwaway / no dead paths.** One canonical definition per concern
  (hashing, scenario format), shared across layers, designed once against the
  real model rather than guessed.

---

## 1. Test architecture — layers

Four complementary layers, from fastest/lowest to most end-to-end:

- **Native Rust unit tests** — `od_core`/`od_ui`/`od_world` pure logic: layout
  solver, focus, keymap, text editing, and (once ported) world sim, FOV,
  pathfinding, movement. Millisecond-fast, no wasm.
- **Native world-core sim harness** — a headless, deterministic,
  **fast-forward** (≫20 TPS, no wall clock) `Scenario` runner over the Bevy-free
  `od_world` core, asserting `WorldSnapshot` + a **world-state-hash**. Agents
  use this to validate world logic _before_ touching wasm (§6).
- **Browser e2e "golden" harness** — the real `/engine` route: real DOM input →
  input arena → wasm `frame()` → WebGL2 submission, verified by semantic
  `snapshot()` + a **draw-hash** + screenshots ("exactly what players see")
  (§5).
- **Golden / replay** — a shared, deterministic `Scenario`/replay drives both
  the native sim harness and the browser harness, tying logic validation to the
  rendered result (§3).

Deep game logic stays tested in the native layers; the browser layer covers what
only a browser can: DOM input, focus, hidden-text capture, canvas sizing, WebGL
draw submission, persistence, and runtime orchestration.

---

## 2. The two harnesses — a deliberate split

The native sim harness and the browser e2e harness are **separate runtimes**
because they observe fundamentally different things. They are _not_ merged into
one harness; the split is worth maintaining. What they share is the **input
language** and the **world-state-hash**, both in `od_core`.

|             | Native sim harness (`od_world`)                            | Browser e2e "golden" harness (`/engine`)                                                 |
| ----------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Runtime     | Pure Rust, headless, fast-forward ≫20 TPS                  | Real wasm + real input path + real WebGL2                                                |
| Drives from | **Shared `Scenario`**, intents applied directly to the sim | **Shared `Scenario`**, input steps **lowered to real DOM key events**                    |
| Verifies    | `WorldSnapshot` asserts + **world-state-hash**             | **world-state-hash** (parity w/ native) + **draw-hash** (render truth) + **screenshots** |
| Purpose     | Validate world logic fast, pre-wasm                        | Prove the deployed browser path reproduces that logic _and_ renders correctly            |

The browser is a **superset on the output side**: it adds the render-layer
observables (draw-hash + screenshots) that do not exist natively. A scenario
proven green natively can be dropped into the browser golden path; if the
in-wasm world-state-hash matches native **and** the draw-hash matches its golden
**and** the screenshot looks right, we have full confidence in both logic and
"what players see," including the wasm/input/render path.

---

## 3. Shared contract

Authored once, consumed by every layer:

- **`Scenario` (intent/semantic authoring)** — full dual-layer contract is
  locked in [`scenario.md`](./scenario.md): `od_scenario` crate, `WorldIntent`
  in `od_core`, step kinds (Session / World / Engine / Assert / Shell / Input),
  Rust builders + JSON schema, Stage A/B gates. Native applies world intents
  and records `WorldReplay`; browser lowers Session/Shell/Input to real DOM
  keys via a keymap profile.
- **`WorldReplay` (command-level proof)** — see [`sim-replay.md`](./sim-replay.md).
  Produced by recording a Scenario (or command-driven) run; not a second
  authoring DSL.
- **`StateHash` convention** — a **tagged hex string** (`"fnv1a64:<16hex>"`)
  used by both the render **draw-hash** (§5.2) and **world-state-hash**, so
  algorithms can evolve unambiguously. FNV-1a 64-bit, reusing the `FnvHasher`
  already in `od_ui::id` / `od_core`.

---

## 4. Determinism invariants

These are what make cross-environment parity real (and what let a native golden
value equal a browser-reported hash):

- **Pure functions of explicit input.** `od_ui` layout and `od_world` stepping
  take no internal clock or RNG; any time/animation value is passed in (frame
  timestamp / `dt_ms`). Identical inputs ⇒ identical output.
- **IEEE-basic arithmetic only** in any hashed path — `+ - * / round max`, no
  transcendentals, no FMA/`mul_add` — so native (x86-64) and wasm32 agree
  bit-for-bit. `draw.rs` currently satisfies this; it is a documented invariant
  on `draw_hash`.
- **Signed-zero canonicalization.** Normalize `-0.0 → 0.0` (e.g. from `round`)
  before hashing.
- **Fixed harness environment.** Hashes are only meaningful at a known state:
  the browser harness pins viewport/dpr/UI-scale/settings; `stepFrame` advances
  a **synthetic clock** (`+16 ms`/step, no RAF), so held-key repeat and any
  timing are reproducible.

---

## 5. Browser e2e harness (v2) — the reliable `/engine` surface

Version 1 (chat/shell smoke: `press`/`typeText`/`paste`/`stepFrame`/`snapshot`)
is implemented. Version 2 adds the reliability backbone below. Bump the harness
`version` field to `2`.

### 5.1 Activation & gating

- Exposed only under `/engine?harness=1`, as
  `globalThis.__openDwarfEngineHarness` (versioned). Production loads never
  expose it.
- The debug/hash surface is a **normal wasm export computed on-call**
  (`debug_draw_hash()`); the RAF render path never pays for it. **No** Cargo
  feature / `debug_assertions` / separate artifact gating — we do not complicate
  compiles or risk testing a binary nobody ships. (If the _shipped lean core_
  wasm size ever demands it, the fallback is a `debug_assertions` gate,
  accepting the small fidelity caveat.)

### 5.2 Draw-hash (the automated reliability backbone)

The reliability gate is a **Rust-side deterministic hash of the frame's draw
output** — GPU-independent, so it cannot flake on swiftshader/headless — plus
the semantic `snapshot()`. Screenshots are **non-gating** artifacts (§5.5);
pixel parity is judged by eye (§7). Native Rust golden tests still own layout
truth (ABI doc §8).

- **Canonical function in `od_core`:**
  `draw_hash(&[DrawCmd], &[RectInstance], &[GlyphInstance]) -> u64`, called by
  **both** native golden tests and the wasm `debug_draw_hash()` export → one
  value, cross-checkable across layers.
- **Coverage:** the used prefixes of `draw_cmds` + `rects` + `glyphs` (the whole
  `FrameOutput` minus `responses`), in order, including full `DrawCmd` fields
  (program, offsets, counts, **and** scissor — clipping is visual truth).
- **Form:** FNV-1a 64-bit over the `#[repr(C)]`/`bytemuck` bytes, surfaced as
  `"fnv1a64:<16hex>"` (the §3 `StateHash` convention). Appears as
  `snapshot().frame.drawHash` and in `captureCheckpoint`.

### 5.3 Snapshot

Structured, intentional state (not raw private Rust). Current shape (`frame`,
`shell`, `session`, `input`, `render`) plus `frame.drawHash`. Grows with
`od_world` (seed, tick, camera, selection, …) but only with **stable state worth
recording**.

### 5.4 Input (keyboard-first)

- **Now:** `press`, `keyDown`, `keyUp` (held-key + `dt_ms` auto-repeat under the
  synthetic clock — coverage `press` alone cannot give), `typeText`, `paste`,
  `blur`, `focus` (arena `Blur`/`Resync` + canvas focus), `stepFrame`.
- **Out of scope:** `pointerMove`/`pointerDown`/`pointerUp`/`wheel` (keyboard
  game; no engine mouse path). **Deferred:** IME/composition.

### 5.5 Checkpoints, screenshots, and artifacts

- `captureCheckpoint(name)` →
  `{ name, ordinal, frame, drawHash, snapshot,
  screenshot? }`. Lean now; grows
  with `od_world`.
- **Screenshots via `gl.readPixels`**, not `toDataURL`/Playwright screenshot:
  because `stepFrame` renders synchronously (no RAF, no compositor between
  render and capture), reading the framebuffer directly → Y-flip → 2D-canvas
  `toDataURL('image/png')` is fully deterministic and headless-safe, and needs
  no `preserveDrawingBuffer`. Screenshots are **opt-in, default off** so the
  hash/snapshot hot path pays no readback/encode cost.
- `exportBundle()` returns `{ manifest, checkpoints[], screenshots[] }` as
  **plain data**; the Playwright/Deno side writes files (the harness never
  touches `fs`).
- **Artifacts:** write to git-ignored `exports/` (works local + CI); when
  running as a cloud agent, copy only the human-facing artifacts (parity
  screenshots, failing-frame captures, demo videos) into `/opt/cursor/artifacts`
  so they render inline in the run/PR. No repo bloat.

### 5.6 `/webgl` harness retirement

Canonicalize on the `/engine` harness. The `/webgl` `__openDwarfWebGlHarness`
tests are already red (the global is not wired into the live `webgl2-entry.ts`)
and `/webgl` is slated for deletion at cutover, so re-wiring it is throwaway.
Retire, in Increment 1:

- Delete `tests/webgl-step1.test.ts`, `webgl-step2.test.ts`,
  `webgl-step3.test.ts`, `webgl-step3-slow.test.ts`,
  `webgl-step4-parity.test.ts`; `tests/helpers/harness.ts`;
  `tests/flows/webgl-step1-single-rock.ts`.
- Remove or repoint `scripts/webgl_review.ts` (the `ui-test` task) and
  `lib/webgl-harness-types.ts` — both depend on the retired global and are
  otherwise dead. Prefer removal; repoint at `/engine` only if a use remains.
- **Keep** the `/webgl` route + `webgl2/` engine intact as a manual
  visual-parity reference, and keep `tests/unit/webgl-world-sim.test.ts` (sim
  units still pass).

No automated `/webgl`↔`/engine` parity is built; parity is confirmed manually by
eye until cutover.

---

## 6. Native world-core sim harness (`od_world`) — see dedicated design

`od_world` Increment 2 design is locked in:

- [`od-world.md`](./od-world.md) — Bevy-free `WorldSim`
- [`sim-replay.md`](./sim-replay.md) — `WorldReplay` v1 + `world_state_hash`

Summary: authoritative **sim/server** replay (not client view); command-level
`WorldReplay` recorded from `WorldSim`. Intent-level Scenario authoring is
designed in [`scenario.md`](./scenario.md) (not implemented yet). Port target
remains the Bevy-free core in `game_library/world_sim/` (`world_core`, API
types), without `WorldSimApp`/plugin. Wire types live in `od_core`; stepping
lives in `od_world`; Scenario DSL/runners in `od_scenario`.


---

## 7. Increments

**Increment 1 — done** (see
[`game-testing-harness-increment-1-plan.md`](./game-testing-harness-increment-1-plan.md)):

- `draw_hash()` in `od_core` (+ the §4 invariants) and `debug_draw_hash()`
  compute-on-call export.
- Browser harness v2: `snapshot().frame.drawHash`, `captureCheckpoint`,
  `readPixels` screenshots (opt-in), `exportBundle` (test-side writes to
  `exports/`, cloud copies to `/opt/cursor/artifacts`), input
  `keyDown`/`keyUp`/`blur`/`focus`.
- E2e golden path for **what `/engine` renders today** — shell/ESC menu, chat,
  focus nav, text field — via draw-hash goldens + screenshot artifacts. Proves
  the full DOM→arena→wasm→GL path end-to-end now, without a world.
- Retire the `/webgl` harness surface (§5.6).
- **Thin `od_core` seam:** land only the `StateHash` string convention (shared
  by `draw_hash` and the future `world_state_hash`) and a documented home for
  `Scenario` — zero world-specific types until `od_world` exists.

**Increment 2 — `od_world` replay substrate (design locked 2026-07-11):**

Decision records:

- [`od-world.md`](./od-world.md) — Bevy-free in-process `WorldSim`, module
  layout, command API, port map.
- [`sim-replay.md`](./sim-replay.md) — authoritative **sim/server**
  `WorldReplay` v1, v1 `WorldSnapshot` subset, `world_state_hash`, native
  goldens.

**MVP (Increment 2):** `WorldSim` + `WorldReplay` (record/replay) +
`world_state_hash` + command-driven native goldens — **implemented**.

**Next — Scenario dual layer** (design locked in [`scenario.md`](./scenario.md);
impl staged):

- Stage A: `od_scenario` + native runner (World / Engine / Assert) → record →
  `WorldReplay`.
- Stage B: harness `runScenario` + thin Playwright; `importReplay` reserved;
  Engine steps fail-closed in browser.

Still deferred outside Scenario: world render, worker protocol, client-view
replay.


---

## 8. Deferred / out of scope (with the enabling seam)

| Deferred                                                     | Seam that keeps it cheap                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Native Scenario runner / `od_scenario` impl                  | Design locked: [`scenario.md`](./scenario.md) Stage A gates                |
| Browser `runScenario` / `importReplay`                       | Design locked: [`scenario.md`](./scenario.md) Stage B gates                |
| Pointer/wheel input                                          | Keyboard-only by design; add only with a deliberate mouse path             |
| IME / composition                                            | ASCII font prunes CJK; `Composition` event kind reserved                   |
| Pixel-diff golden gating                                     | Draw-hash is the gate; screenshots stay non-gating, parity by eye          |
| Stripping the hash from release wasm                         | `debug_assertions` gate as a later fallback if lean-core size demands it   |
| Browser-controllable `Engine` escapes                        | Fail-closed for now; revisit with an explicit allowlist                    |

---

## 9. Ideal complete shape (reference)

The long-term browser-harness surface, versioned via
`globalThis.__openDwarfEngineHarness.version`:

```ts
type EngineHarness = {
  version: number;

  stepFrame(n?: number): Promise<void>;
  stepSimTick(n?: number): Promise<void>; // with od_world
  flush(): Promise<void>;

  input: {
    keyDown(code: string, modifiers?: number): Promise<void>;
    keyUp(code: string, modifiers?: number): Promise<void>;
    press(code: string, modifiers?: number): Promise<void>;
    typeText(text: string): Promise<void>;
    paste(text: string): Promise<void>;
    blur(): Promise<void>;
    focus(): Promise<void>;
    // pointer/wheel intentionally omitted (keyboard-only game)
  };

  snapshot(): EngineSnapshot; // includes frame.drawHash
  captureCheckpoint(name: string): Promise<EngineCheckpoint>;
  exportBundle(): EngineBundle;
  runScenario(scenario: ScenarioDocument): Promise<RunScenarioResult>; // v3
  importReplay(worldReplay: WorldReplayDocument): Promise<ImportReplayResult>; // v3
  reset(config?: unknown): Promise<void>;
};
```

Harness v3 Scenario APIs are specified in [`scenario.md`](./scenario.md) §7
(`runScenario` = author path, `importReplay` = `WorldReplay` proof path).
`stepSimTick` / richer world snapshot land with the wasm world surface.
