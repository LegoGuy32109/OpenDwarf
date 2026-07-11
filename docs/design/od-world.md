# `od_world` — Bevy-free World Simulation (Increment 2)

**Status:** Implemented — 2026-07-11 (interview-locked design)
**Parent:** [`../GAME_ENGINE_ARCHITECTURE.md`](../GAME_ENGINE_ARCHITECTURE.md) →
parallel `od_world` track; harness
[`game-testing-harness.md`](./game-testing-harness.md) §6 / §7 Increment 2
**Companion:** [`sim-replay.md`](./sim-replay.md) — `WorldReplay` v1,
`WorldSnapshot` subset, `world_state_hash`, native goldens;
[`scenario.md`](./scenario.md) — intent-level Scenario dual-layer (design)

This document is the decision record for the **first `od_world` implementation
slice**: a headless, Bevy-free, in-process world simulator that can be driven by
commands, snapshotted, and recorded into an authoritative sim replay (see
companion). Intent-level Scenario authoring is designed separately in
[`scenario.md`](./scenario.md). This doc does **not** cover browser
`runScenario`/`importReplay`, world rendering on `/engine`, or the worker
protocol.

---

## 0. Goal

Port the proven Bevy-free logic in `game_library/world_sim/` (`world_core`, FOV
module kept available but out of v1 snapshot/hash) into `game_engine/od_world`,
behind a small synchronous `WorldSim` handle, so native tests and agents can
**fast-forward the authoritative sim** with no wall clock and no Bevy.

Downstream consumers of the wire types (`WorldCommand`, `WorldSnapshot`,
`WorldConfig`, `Vec3i`, …) and of `WorldReplay` live in **`od_core`** so
server/wasm/tests share one schema with zero later moves.

---

## 1. Scope boundary (Increment 2)

### In scope

| Item | Notes |
| --- | --- |
| Bevy-free `WorldSim` in `od_world` | In-process, single-threaded |
| Port `world_core` behavior | Terrain gen, chunk load/unload, entities, movement interpolation |
| Wire types in `od_core` | `Vec3i`, `Vec3u`, `BlockType`, `WorldConfig`, `WorldCommand`, `WorldSnapshot` (v1 subset), movement/entity snapshot structs |
| FOV code port (optional colocated) | May land as `od_world::fov` for future use; **not** in v1 snapshot/hash |
| Native tests driving commands | See companion golden suite |
| Integration with `WorldReplay` recorder | Companion doc |

### Explicit non-goals (this increment)

| Deferred | Why / where |
| --- | --- |
| Intent-level `Scenario` authoring API | Design locked: [`scenario.md`](./scenario.md); impl is Stage A/B |
| Browser `runScenario` / `importReplay` / `stepSimTick` | [`scenario.md`](./scenario.md) Stage B + wasm sim surface |
| `/engine` world rendering / draw-hash of tiles | Separate render/`ClientView` work (Phase 5+) |
| Worker / multi-instance protocol | Separate architecture track; in-process only now |
| `drain_updates` / live delta bus | No consumer in Increment 2 |
| Client-view replay format | Different artifact; needs `ClientView` |
| Rewriting terrain noise for wasm float parity | Port f64 as-is; call out risk (companion §6) |
| Extending `SessionIntent` with movement | `WorldIntent` designed in [`scenario.md`](./scenario.md); live game loop may adopt later |

---

## 2. Crate & module layout

### Placement rules (architecture)

- **`od_core`** — networkable / shared wire types and replay/hash contracts.
- **`od_world`** — sim implementation only; **native tests** are the primary
  validation surface (crate is not wasm-bound in Increment 2).
- **`od_wasm`** — unchanged for this slice (no world exports required yet).
- **`od_ui`** — unchanged; still chat/shell only.

### Proposed `od_core` modules (world/replay-related)

```
od_core/
  hash.rs          # existing StateHash / FNV / draw_hash
  scenario.rs      # docs-only home (Increment 1); still no Scenario types
  world/
    mod.rs         # re-exports
    vec.rs         # Vec3i, Vec3u
    block.rs       # BlockType
    config.rs      # WorldConfig, TerrainConfig
    command.rs     # WorldCommand
    snapshot.rs    # Entity*, WorldSnapshot (v1 fields)
  replay/
    mod.rs         # WorldReplay, events, metadata, version
    hash.rs        # world_state_hash + canonical encode
    record.rs      # WorldReplayRecorder (+ options)
    io.rs          # save/load (bincode), replay_commands_to_snapshot
```

Exact file split may vary; the **public modules** must be discoverable as
`od_core::world::*` and `od_core::replay::*` (or equivalent re-exports from
`od_core`).

### Proposed `od_world` modules

```
od_world/
  lib.rs           # re-export WorldSim
  sim.rs           # WorldSim handle (API §4)
  state.rs         # internal WorldState (ported from world_core)
  terrain.rs       # chunk gen / noise sampling (ported)
  movement.rs      # entity movement tick advancement (ported)
  fov.rs           # optional port; unused by v1 snapshot/hash
  test_util.rs     # #[cfg(test)] step_until_idle, etc.
```

**Port map** (from `game_library/world_sim/`):

| Legacy | Destination |
| --- | --- |
| `world_api.rs` (`Vec3i`, commands, snapshots, …) | `od_core::world` (reshape snapshot per companion) |
| `world_core.rs` | `od_world::{state,terrain,movement}` |
| `fov.rs` | `od_world::fov` (optional this increment) |
| `bevy_app.rs` | **Deleted for new path** — replaced by `WorldSim` |
| `scenario.rs` | **Not ported** (Scenario API deferred) |
| `replay.rs` | Replaced by `od_core::replay` (`WorldReplay` v1) — inspired by, not compatible with, legacy v5 |

Legacy `game_library/world_sim` remains in-tree until cutover; new code must not
add Bevy dependencies.

---

## 3. Domain model (behavioral)

Authoritative single-player / future-server sim:

- **Config** — `WorldConfig` { `chunk_edge`, `world_chunks`,
  `movement_ticks_per_tile`, `terrain: TerrainConfig` }. Defaults match legacy
  (`chunk_edge=16`, `1×1×1` chunks, `10` ticks/tile, seed `"opendwarf"`, …).
- **Chunks** — generated on load; unloaded chunks reject entry (movement fails
  closed). `SetChunkLoaded` is the streaming control surface.
- **Entities** — id, grid position, facing, prone, optional in-progress
  movement (origin/target/progress).
- **Ticks** — discrete; `AdvanceTicks { count }` and per-command stepping via
  `step_ticks` advance movement and any tick-scoped logic.
- **Terrain** — `BlockType::{Air, SolidStone}` for v1 (legacy set). Generated
  with the existing **f64** cave noise; see companion determinism callout.

FOV (3D DDA, legacy radius 5) may be ported for later observer/fog work but is
**out of the v1 snapshot and `world_state_hash`**.

---

## 4. `WorldSim` public API

Synchronous, in-process handle. No callbacks, no channels, no Bevy `App`.

```rust
pub struct WorldSim { /* od_world private state */ }

impl WorldSim {
    pub fn new(config: WorldConfig, spawn_default_player: bool) -> Self;

    /// Enqueue/apply a command against the current tick.
    /// Returns Err on illegal moves (e.g. into unloaded chunk) without
    /// mutating movement state — match legacy fail-closed semantics.
    pub fn send_command(&mut self, command: WorldCommand) -> Result<(), WorldCommandError>;

    /// Advance the sim `n` ticks with no wall clock (fast-forward).
    pub fn step_ticks(&mut self, n: u32);

    /// Logic-essential v1 snapshot (see sim-replay.md).
    pub fn snapshot(&self) -> WorldSnapshot;

    pub fn primary_entity_id(&self) -> Option<u64>;

    // Recorder is constructed alongside / attached by tests — see companion.
}
```

### Commands (v1)

```rust
pub enum WorldCommand {
    MoveEntity { id: u64, direction: Vec3i },
    AdvanceTicks { count: u32 },
    SetChunkLoaded { chunk: Vec3i, loaded: bool },
}
```

**Raw movement:** `MoveEntity` *starts* interpolation toward an adjacent cell
(subject to collision/load rules). Completing the move requires enough
subsequent ticks (`movement_ticks_per_tile`). The command stream in
`WorldReplay` records exactly what was sent — no hidden “wait until idle”
command.

### Test-only helper

```rust
// od_world::test_util (cfg(test)) or tests/
fn step_until_idle(sim: &mut WorldSim, entity_id: u64, max_ticks: u32) -> u32;
```

Advances with `step_ticks(1)` (and records `AdvanceTicks` if a recorder is
attached) until the entity has no in-progress movement or `max_ticks` is hit.
Legacy scenario runner used a 256-tick cap; keep a similar safety bound.

### Not in v1 API

- `drain_updates()` / `WorldUpdate` bus
- Async/worker handles
- Intent/`SessionIntent` application
- Rendering hooks

---

## 5. Relationship to other tracks

```
Increment 1 (done)
  StateHash, draw_hash, empty scenario module, harness v2
        │
        ▼
Increment 2 (this doc + sim-replay.md)
  WorldSim + WorldReplay + world_state_hash + native goldens
        │
        ├─► Future: intent Scenario API (author) ──record──► WorldReplay
        ├─► Future: browser importReplay / stepSimTick
        ├─► Future: worker protocol (same Command/Snapshot seam)
        └─► Future: ClientView + client replay (different format)
```

Shell/session UI (`od_ui`) continues to run without a world. When the world is
later wired under `/engine`, shell-open still must not freeze the sim (existing
domain rule); that wiring is out of scope here.

---

## 6. Implementation notes for agents

1. Prefer **behavioral parity** with `world_core` over line-by-line copy; strip
   Bevy resources/`WorldSimApp` entirely.
2. Put every type that appears in `WorldReplay` bytes or hashes in **`od_core`**
   first; `od_world` depends on `od_core`, never the reverse.
3. Do not invent Scenario step enums in this PR.
4. Native goldens: see [`sim-replay.md`](./sim-replay.md) §7.
5. Keep `game_library/world_sim` compiling until an explicit cutover PR; do not
   delete it in the first port PR unless planned separately.

---

## 7. Acceptance checklist

- [ ] `WorldSim` constructs with default config and optional default player
- [ ] `MoveEntity` / `AdvanceTicks` / `SetChunkLoaded` match legacy semantics
      on the ported core
- [ ] `snapshot()` returns the v1 field set only (no visibility)
- [ ] No Bevy dependency in `od_world` / new `od_core` world modules
- [ ] Companion `WorldReplay` round-trip goldens green (see sim-replay.md)
- [ ] Design non-goals remain unimplemented (Scenario API, browser import,
      worker, world render)
