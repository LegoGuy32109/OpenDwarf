# Scenario — Dual-Layer Authoring Contract

**Status:** Design locked — 2026-07-11 (interview); **not implemented**
**Parent:** [`game-testing-harness.md`](./game-testing-harness.md) §3 / §7
**Companions:** [`sim-replay.md`](./sim-replay.md) (`WorldReplay` proof),
[`od-world.md`](./od-world.md) (`WorldSim`)

This document is the decision record for the **intent-level Scenario** layer:
authoring surface, step vocabulary, crate placement, lowering rules, harness
APIs (`runScenario` / `importReplay`), and staged delivery with verifiable exit
gates. It does **not** implement code.

---

## 0. North star

```
Scenario (intent / semantic, authored)
    │  native: apply WorldIntent → WorldCommand while recording
    │  browser: lower Session/Shell/Input → real DOM keys; World → stepSimTick
    ▼
WorldReplay (command-level, recorded)  ←── deterministic proof artifact
```

| Layer | Role |
| --- | --- |
| **Scenario** | Human/agent-authored program. Wraps **real** intents (`WorldIntent`, session/UI semantics), not a parallel toy language. |
| **WorldReplay** | Observed sim/server command log + checkpoints + hashes. Produced by **recording** a run (Increment 2). |

Browser e2e and native goldens share one Scenario schema. Browser never injects
`WorldCommand` behind the input path for Session/Shell steps; it lowers to DOM.
World steps drive the sim clock (`stepSimTick` / native tick), not `stepFrame`.

---

## 1. Scope & staging

### In scope (this design)

- Full dual-layer **contract** (types, lowering, harness shape, gates).
- New **`od_scenario`** crate + **`WorldIntent` in `od_core`**.
- Stage A (native) and Stage B (browser) with **fail-closed** rules and named
  exit criteria.

### Explicit non-goals (until a later interview / stage)

| Deferred | Notes |
| --- | --- |
| Implementation of `od_scenario` / harness v3 | Design only in this PR |
| Browser-controllable `Engine` escapes | Stage rule: fail-closed; revisit with a real allowlist |
| Client-view / FOV replay | Separate from Scenario → `WorldReplay` |
| Deleting legacy `world_sim` Scenario DSL | Inspiration only |
| Production gameplay wiring of `WorldIntent` | Types live in `od_core` early; game loop may adopt later |

### Staging rule

**Impl may stage; the contract does not.** Session/Shell exist in the schema
from day one even if Stage A refuses to execute them. Each stage ships
**verifiable artifacts or commands** that prove it complete (§8).

---

## 2. Crate & type placement

### Fifth workspace crate: `od_scenario`

Architecture’s four-crate table gains a row (amend
[`../GAME_ENGINE_ARCHITECTURE.md`](../GAME_ENGINE_ARCHITECTURE.md) Part 2 when
implementing):

| Crate | Role |
| --- | --- |
| `od_core` | Wire / shared contracts: `WorldIntent`, existing `WorldCommand` / `WorldReplay` / hashes |
| `od_ui` | Session/shell UI models (unchanged ownership) |
| `od_world` | `WorldSim` + recording helpers used by the native runner |
| **`od_scenario`** | Scenario document, step enums (Session/World/Engine/Assert/Shell/Input), builders, JSON I/O, keymap profiles, lowering, native runner, goldens/bless helpers |
| `od_wasm` | Thin wasm glue; **must not** pull Scenario builders into production release builds unless an explicit harness feature needs them |

**Why not stuff Scenario into `od_core` or `od_world`:** a full runner depends on
**both** `od_ui` and `od_world`. `od_core` cannot. `od_world` must not own UI/Shell
scenarios. Scenario volume is **harness-supplemental**, not game TCB.

### `WorldIntent` in `od_core` from day one

`WorldIntent` is likely future gameplay / network surface (same reason
`SessionIntent` / `WorldCommand` live in core). Sugar and runners stay in
`od_scenario`.

### Retire docs-only `od_core::scenario`

Increment 1’s empty `od_core::scenario` module is replaced: delete or turn into
a short `doc(inline)` pointer to this design / `od_scenario` once the crate
exists.

---

## 3. Intents vs steps

### Separate intent families

| Family | Home | Scenario role |
| --- | --- | --- |
| `WorldIntent` | `od_core` | World steps wrap these |
| `SessionIntent` (existing / evolving) | `od_core` | Session steps wrap real session intents |
| Shell | **Not** a `ShellIntent` in `od_core` | `ScenarioStep::Shell` is **semantic sugar** that lowers to keys |
| Engine | Scenario-only escape | Not a gameplay intent |

Scenario wraps **real** intents where they exist. It does not invent a second
movement ontology for the live game.

### `WorldIntent` v1 (sketch)

```rust
// od_core — illustrative; exact derives/serde tags settled at impl
pub enum WorldIntent {
    MovePlayer { direction: Dir }, // abstract cardinal/ordinal as needed
    WaitTicks { ticks: u32 },      // synonym AdvanceSimTicks — pick one name at impl
}
```

- **`SetChunkLoaded` is not a `WorldIntent`.** It is an **`Engine`** step
  (native escape), mapping to the existing `WorldCommand::SetChunkLoaded`.
- Movement sugar (`MovePlayerExact`, `wait_until_idle`) lives in `od_scenario`
  and **expands** into raw intents / recorded `WorldCommand`s. Interruptions
  (attack/effects) are why raw `MovePlayer` + `WaitTicks` stay first-class.

### Direction & keymap

- Scenario authors use **abstract directions** (not raw key codes).
- Browser lowering uses a **keymap profile** (default `"esdf"`).
- Shell sugar (OpenShell, OpenSettings, …) uses the **same** profile for key
  chords.
- One-off keys that are not worth a Shell variant stay as **`Input`** steps.

---

## 4. `ScenarioStep` vocabulary

Illustrative enum (serde-stable names matter more than Rust spelling):

```text
ScenarioStep:
  Session(...)           # real SessionIntent wrappers
  World(WorldIntent)     # or World-specific wrappers including sugar forms
  Engine(...)            # e.g. SetChunkLoaded — native escape
  Assert(...)            # world-core + session-UI allowlist
  Shell(...)             # OpenShell, OpenSettings, … → keys via keymap profile
  Input(...)             # one-off key/text for cases Shell does not cover
  RecordCheckpoint(name) # optional; aligns with harness / WorldReplay checkpoints
```

### Clocks (decoupled)

| Step kind | Advances |
| --- | --- |
| `WaitTicks` / sim waits | **Sim clock** — native ticks / browser `stepSimTick` |
| Session / Shell / Input | **Frame / input path** — browser `stepFrame` (+ key events) as needed |
| Engine | Native sim side-effects; not lowered to keys |

Do **not** conflate `stepFrame` with sim advancement.

### Asserts

- Allowlisted predicates over **world core** (e.g. `world_state_hash`, entity
  position) and **session UI** (e.g. draw-hash / shell flags as the UI model
  exposes).
- Bless path for hash goldens (same spirit as Increment 1 / world goldens):
  explicit env or `deno task`, never silent rewrite in normal `cargo test`.

### Shell vs Input

- **`Shell`:** named semantic actions → key sequences via keymap profile.
- **`Input`:** explicit one-offs.
- **No `ShellIntent` in `od_core`** for Scenario purposes.

---

## 5. Authoring surface

### Dual authoring, one schema (locked)

1. **Rust builders primary** — type-checked scenarios in tests / helpers;
   preferred for checked-in goldens.
2. **Portable JSON schema** — same document both runners load; for agents and
   on-the-fly custom scenarios.

Minimize hand-written JSON in-repo; builders may **emit** JSON fixtures for
browser e2e. Agents may inject JSON at runtime via `runScenario`.

### Pure Rust e2e?

| Layer | Pure Rust? |
| --- | --- |
| Native Scenario goldens | **Yes** (`cargo test` / `engine:test-scenario`) |
| Browser DOM proof | **No** — thin Playwright (or equivalent) must own the page |

Browser TS stays a **boot + `runScenario` + assert** shell, not a second
lowering implementation.

---

## 6. Lowering & runners

### Native (Stage A+)

- Apply `WorldIntent` → sim policy → record successful commands into
  `WorldReplay` (same recorder rules as Increment 2: **do not** record failed
  moves).
- Execute `Engine` steps against `WorldSim`.
- Evaluate `Assert` / `RecordCheckpoint`.
- **Session / Shell / Input:** present in schema; Stage A runner **rejects**
  them (fail-closed). No ignore/skip that could false-green.

### Browser (Stage B+)

- `runScenario(scenario)` inside the page/wasm (or TS that shares one lowering
  table with the contract — prefer one implementation).
- Lower Session/Shell/Input → real harness `keyDown` / `typeText` / etc.
- World waits → `stepSimTick`.
- **Any `Engine` step → fail-closed** (reject up front or at first Engine step;
  no partial success). This is a **stage rule**, not a forever ban on
  browser-controllable engine escapes.
- Playwright: start `/engine?harness=1`, feed Scenario, read hashes/checkpoints.

### `WorldReplay` path

Recording remains the proof path. Scenario sugar expands such that a recorded
`WorldReplay` contains only real `WorldCommand`s (+ checkpoints), never sugar
opcodes.

---

## 7. Browser harness API (v3 contract)

Reserve both entry points (names locked; Stage B may implement
`runScenario` before `importReplay`):

```ts
// Illustrative — version bump when landing (harness v3)
type EngineHarness = {
  version: number; // 3 when Scenario APIs ship

  // ... existing v2: stepFrame, input.*, snapshot, captureCheckpoint, exportBundle

  stepSimTick?(n?: number): Promise<void>;

  /** Author path — intent/semantic Scenario document (JSON-compatible). */
  runScenario(scenario: ScenarioDocument): Promise<RunScenarioResult>;

  /**
   * Proof path — recorded WorldReplay.
   * Must not silently no-op: implement against wasm world surface, or stub as
   * explicit unimplemented with a failing test that documents the gap.
   */
  importReplay(worldReplay: WorldReplayDocument): Promise<ImportReplayResult>;
};
```

| API | Accepts | Role |
| --- | --- | --- |
| `runScenario` | Scenario document | Author / agent path |
| `importReplay` | `WorldReplay` document | Proof / CI dump path |

Do **not** overload one method with a tagged union that hides the layer split.
Do **not** name `importReplay`’s argument `Scenario` (Increment 1 sketch was
wrong once dual-layer was locked).

---

## 8. Stage exit gates (verifiable)

A stage is **not done** until the named commands/artifacts pass.

### Stage A — native Scenario

Done when:

- [ ] `od_scenario` crate + `WorldIntent` in `od_core` compile.
- [ ] Scenario JSON schema serde round-trips (builder ↔ JSON).
- [ ] Native golden(s): Scenario → record → `WorldReplay` verify (hash match).
- [ ] ≥1 Scenario using **Engine** (e.g. chunk gate) and ≥1 **Assert** on
      `world_state_hash`.
- [ ] Fixture with Session/Shell steps **fail-closed** on Stage A runner.
- [ ] Task green: e.g. `engine:test-scenario` (or folded into `engine:test`) in
      CI.

**Artifacts:** checked-in fixtures (Rust-emitted JSON ok), golden hashes, and/or
exported `WorldReplay` under a known path; bless via explicit flag/task.

### Stage B — browser

Done when:

- [ ] Harness v3: `runScenario` landed; `importReplay` reserved and either
      implemented or **explicit** unimplemented + failing doc test (no silent
      no-op).
- [ ] Engine-containing Scenario **fail-closed** in browser.
- [ ] Thin Playwright: load Scenario → `runScenario` → assert
      hashes/checkpoints.
- [ ] Named `deno task` e2e target green.

---

## 9. Relationship to prior docs

| Doc | Change of meaning |
| --- | --- |
| [`game-testing-harness.md`](./game-testing-harness.md) §3 | Scenario contract lives here; harness doc points here |
| [`sim-replay.md`](./sim-replay.md) | `WorldReplay` remains proof format; Scenario authoring no longer “deferred forever” — deferred only until Stage A impl |
| [`od-world.md`](./od-world.md) | Sim unchanged; Scenario runner consumes `WorldSim` from `od_scenario` |
| Increment 1 `od_core::scenario` stub | Superseded by `od_scenario` + this doc |

---

## 10. Acceptance checklist (design)

- [x] Dual-layer Scenario → record → `WorldReplay` locked
- [x] `WorldIntent` in `od_core`; Scenario bulk in `od_scenario`
- [x] Step kinds: Session / World / Engine / Assert / Shell / Input /
      RecordCheckpoint
- [x] Engine ≠ WorldIntent; browser Engine fail-closed (stage rule)
- [x] Rust builders + JSON schema; Rust-primary goldens
- [x] `runScenario` + `importReplay` both reserved
- [x] Stage A/B gates with verifiable tasks/artifacts
- [ ] Implementation PRs follow Stage A then Stage B (out of scope here)
