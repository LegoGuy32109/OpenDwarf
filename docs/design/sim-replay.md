# Sim Replay — `WorldReplay` v1 & `world_state_hash`

**Status:** Implemented — 2026-07-11 (interview-locked design)
**Parent:** [`game-testing-harness.md`](./game-testing-harness.md) §3 / §6 / §7
Increment 2; [`../GAME_ENGINE_ARCHITECTURE.md`](../GAME_ENGINE_ARCHITECTURE.md)
**Companion:** [`od-world.md`](./od-world.md) — `WorldSim`, type placement, port
map

This document defines the **authoritative sim/server replay** contract for the
new engine: what is recorded, what a snapshot contains, how
`world_state_hash` is computed, and which native goldens Increment 2 must pass.
It is intentionally separate from [`od-world.md`](./od-world.md) so the file
format and hash layout can evolve without rewriting the sim narrative.

---

## 0. North star vs Increment 2 MVP

### Long-term (harness dual layer — not implemented yet)

```
Scenario (intent-level, authored)
    │  run on WorldSim while recording
    ▼
WorldReplay (command-level, recorded)  ←── deterministic proof artifact
```

- **Scenario** — human/agent-authored program at intent/semantic level; browser
  will later *lower* input-bearing steps to real DOM keys.
- **WorldReplay** — observed **server/sim** command log + proof snapshots.
  Produced by **recording** a run (not by naïvely compiling intents without
  executing sim policy).

### Increment 2 MVP (this doc)

| Build now | Defer |
| --- | --- |
| `WorldReplay` v1 format + I/O | Intent-level Scenario API / step enum |
| `WorldReplayRecorder` | Browser `importReplay` |
| `world_state_hash` + canonical encode | Client-view replay format |
| Command-driven native goldens | ScenarioBuilder port |

**Do not** freeze Scenario authoring types in this increment. Keep
`od_core::scenario` as the docs-only home from Increment 1 until a dedicated
Scenario interview.

---

## 1. What `WorldReplay` is (and is not)

### Is

- An **authoritative sim / game-server** log for a single `WorldSim` instance.
- Enough to **re-execute** the same command stream and obtain the same
  `world_state_hash` / final snapshot on native.
- The substrate for future Scenario recording and (later) cross-checks against
  in-wasm sim.

### Is not

- A **client** replay (player inputs + `ClientView` / fog-limited state). That
  is a different format when Phase 5 `ClientView` exists.
- A demo tape of DOM events or draw commands (`draw_hash` / harness checkpoints
  remain the UI/browser concern).
- Compatible with legacy `game_library/world_sim` **ReplayFile v5** bytes.
  Inspiration only; new system starts at **v1**.

### Naming

| Name | Role |
| --- | --- |
| `WorldReplay` | The versioned file / in-memory document |
| `WorldReplayRecorder` | Appends commands & checkpoints while a sim runs |
| `WorldReplayEvent` | `Command` \| `Checkpoint` |
| `world_state_hash` | FNV `StateHash` over the canonical snapshot encoding |

Avoid bare `ReplayFile` in new code — it invited client/server confusion.

---

## 2. Format overview — `WorldReplay` v1

```rust
pub const WORLD_REPLAY_FORMAT_VERSION: u32 = 1;

pub struct WorldReplayMetadata {
    pub format_version: u32,          // == 1
    pub name: String,                 // free-form label (test name, etc.)
    pub world_config: WorldConfig,
    pub spawn_default_player: bool,
}

pub enum WorldReplayEvent {
    Command {
        tick_before: u64,
        command: WorldCommand,
    },
    Checkpoint {
        snapshot: WorldSnapshot,
        /// Same digest as world_state_hash(&snapshot); stored for cheap compare.
        state_hash: StateHash,
    },
}

pub struct WorldReplay {
    pub metadata: WorldReplayMetadata,
    pub events: Vec<WorldReplayEvent>,
    pub final_snapshot: WorldSnapshot,
    pub final_state_hash: StateHash,
}
```

### Event policy

| Include in v1 | Exclude |
| --- | --- |
| `Command` — every `WorldCommand` applied, with sim tick **before** apply | Live `Update` / delta stream (regenerate by replaying) |
| `Checkpoint` — periodic full v1 snapshots + hash | FOV / visibility blobs |
| `final_snapshot` + `final_state_hash` | Client input events |

**Initial checkpoint:** recorder should emit a checkpoint of the post-`new`
snapshot (tick 0 / boot) before commands, so boot hash is in-file.

### Serialization (on disk)

- **bincode** (standard config, same family as legacy) for `save` / `load`.
- File serialization is **independent** of `world_state_hash` encoding (hash
  must not be “bincode then FNV”).
- No back-compat with v5; refuse load if `format_version != 1`.

### Recorder options

```rust
pub struct WorldReplayRecorderOptions {
    /// Default: 128 (legacy default). Overridable per test.
    pub checkpoint_interval_ticks: u64,
}
```

Checkpoints fire when `snapshot.tick >= next_checkpoint_tick`, then
`next += interval` (same cadence idea as legacy).

---

## 3. `WorldSnapshot` — v1 logic-essential subset

Snapshotted and hashed state proves movement, streaming, and tick identity
without dragging FOV sets into every digest.

```rust
pub struct WorldSnapshot {
    pub tick: u64,
    pub chunk_edge: u32,
    pub world_chunks: Vec3u,
    /// Only blocks in currently loaded chunks (sparse map).
    pub terrain_blocks: BTreeMap<Vec3i, BlockType>, // or equivalent; must sort for hash
    pub loaded_chunks: BTreeSet<Vec3i>,             // explicit load set
    pub entities: Vec<EntitySnapshot>,              // sorted by id for hash
    // NO visibility / FOV fields in v1
}

pub struct EntitySnapshot {
    pub id: u64,
    pub position: Vec3i,
    pub facing_left: bool,
    pub is_prone: bool,
    pub movement: Option<EntityMovementSnapshot>,
}

pub struct EntityMovementSnapshot {
    pub origin: Vec3i,
    pub target: Vec3i,
    pub start_position: [f32; 3], // canonicalize -0.0 → 0.0 before hash
    pub progress_percent: u8,
    pub occupies_origin: bool,
    pub occupies_target: bool,
}
```

Notes:

- Prefer **ordered** maps/sets (`BTreeMap`/`BTreeSet`) in the snapshot type used
  for hashing so iteration order is definitional. If `HashMap` is kept
  internally in the sim, convert to sorted form at snapshot/hash time.
- `chunk_edge` / `world_chunks` are duplicated from config so a snapshot is
  self-describing for hash and debug.
- Legacy `visibility: Option<VisibilitySnapshot>` is **omitted** from v1 (not
  merely set to `None`).

---

## 4. Commands in the log

Identical to [`od-world.md`](./od-world.md) §4:

```rust
pub enum WorldCommand {
    MoveEntity { id: u64, direction: Vec3i },
    AdvanceTicks { count: u32 },
    SetChunkLoaded { chunk: Vec3i, loaded: bool },
}
```

Recording rules:

1. `record_command(tick_before, command)` **before** applying, or immediately
   with the tick sampled before mutate — but be consistent; goldens depend on
   it.
2. After apply + any automatic ticks the API does **not** insert hidden
   commands. If a test calls `step_until_idle`, that helper must record explicit
   `AdvanceTicks` (or N times `step_ticks(1)` folded into counted advances) so
   the log remains a honest server transcript.
3. `SetChunkLoaded` is a first-class command (native streaming control). Future
   Scenario may mark it native-only; for now it is a normal `WorldCommand`.

---

## 5. `world_state_hash` — canonical encode → FNV

Reuse Increment 1 machinery: `od_core::FnvHasher`, `format_state_hash` →
`"fnv1a64:<16hex>"`.

### Algorithm

1. Build a **canonical byte string** from the v1 snapshot (below).
2. `digest = FNV-1a-64(bytes)`.
3. `StateHash = format_state_hash(digest)`.

**Do not** hash serde/bincode output.

### Canonical layout (normative)

All multi-byte integers **little-endian**. Floats: write `canonicalize_f32`
bits as LE `u32` (`-0.0` → `+0.0`).

```
u32   encoding_version        # = 1 for this layout
u64   tick
u32   chunk_edge
u32   world_chunks.x
u32   world_chunks.y
u32   world_chunks.z

u32   loaded_chunk_count
# then loaded_chunks sorted lexicographically by (x,y,z):
  i32 x, i32 y, i32 z          # × loaded_chunk_count

u32   terrain_count
# then terrain_blocks sorted by key (x,y,z):
  i32 x, i32 y, i32 z
  u8  block_type               # 0=Air, 1=SolidStone (v1)
                               # × terrain_count

u32   entity_count
# then entities sorted by id ascending:
  u64 id
  i32 pos.x, i32 pos.y, i32 pos.z
  u8  facing_left              # 0/1
  u8  is_prone                 # 0/1
  u8  has_movement             # 0/1
  # if has_movement:
    i32 origin.x/y/z
    i32 target.x/y/z
    f32 start_position[3]      # canonicalized
    u8  progress_percent
    u8  occupies_origin        # 0/1
    u8  occupies_target        # 0/1
```

Bump `encoding_version` if the layout changes; do not silently reinterpret.

### API

```rust
pub fn world_state_hash(snapshot: &WorldSnapshot) -> StateHash;
pub fn encode_world_snapshot_canonical(snapshot: &WorldSnapshot) -> Vec<u8>; // testable
```

Checkpoints store `state_hash` alongside the snapshot so failures can print
expected vs actual without re-encoding ambiguity.

---

## 6. Determinism callouts

### Required (Increment 2)

- Sim stepping is a pure function of config + command stream (no wall clock, no
  hidden RNG beyond terrain seed).
- Native **record → `replay_commands_to_snapshot` → hash** must match
  `final_state_hash`.
- Signed-zero canonicalization on movement floats in the hash path.

### Terrain noise (accepted risk)

Legacy/port path uses **f64** Perlin-like cave noise. Harness §4’s
native↔wasm bit-identity goal is **not** guaranteed for that noise under this
MVP.

**Increment 2 decision:** port noise as-is; include terrain in snapshot/hash;
prove **native↔native** replay. Document that when an in-wasm sim or
cross-target hash compare is required, prefer introducing a **dedicated noise
crate / isolated module** rather than rewriting the algorithm inline ad hoc.

### Out of hash (v1)

- FOV / visibility / tile memory
- UI/`draw_hash` / DOM
- Wall-clock timestamps

---

## 7. Replay APIs

```rust
pub fn save_world_replay(path: impl AsRef<Path>, replay: &WorldReplay) -> Result<()>;
pub fn load_world_replay(path: impl AsRef<Path>) -> Result<WorldReplay>;

/// Re-apply Command events only onto a fresh WorldSim built from metadata;
/// ignore checkpoint payloads except for optional mid-run asserts in tests.
pub fn replay_commands_to_snapshot(replay: &WorldReplay) -> Result<WorldSnapshot>;
```

`replay_commands_to_snapshot`:

1. `WorldSim::new(metadata.world_config, metadata.spawn_default_player)`.
2. For each `Command { tick_before, command }` in order: optionally assert
   `sim.snapshot().tick == tick_before` in debug/tests; `send_command`; for
   `AdvanceTicks`, prefer trusting the command body (and/or `step_ticks`)
   consistently with how the recorder wrote it.
3. Return final `snapshot()`; caller compares `world_state_hash` to
   `final_state_hash`.

Exact tick alignment rules for `AdvanceTicks` vs `step_ticks` must match the
recorder implementation — document them in code comments next to the recorder
and keep one shared helper used by both record and replay paths.

---

## 8. Native golden suite (Increment 2 bar)

Command-driven (no ScenarioBuilder). Suggested location:
`od_world` integration tests and/or `od_core` hash unit tests for the encoder.

| Golden | Proves |
| --- | --- |
| **Boot hash stability** | `new` → snapshot → `world_state_hash` stable across runs |
| **Record → replay** | Drive moves/ticks with recorder; `replay_commands_to_snapshot` hash equals `final_state_hash` |
| **Chunk load gate** | Move into unloaded chunk fails; after `SetChunkLoaded`, move succeeds; hashes differ appropriately |
| **Multi-chunk stream** | Load adjacent chunk, cross boundary, record/replay hash match |

Port the *intent* of legacy `scenario_regression` cases; do not require the old
Scenario DSL.

Blessing: plain `cargo test` never rewrites fixtures; if checked-in expected
hashes are used, provide an explicit env flag (e.g. `OD_BLESS_WORLD_GOLDENS=1`)
analogous to Increment 1 UI bless tasks — wire a deno task when useful.

---

## 9. Future seams (do not implement now)

| Seam | Use later |
| --- | --- |
| Intent `Scenario` → record → `WorldReplay` | Dual-layer harness §3 |
| Browser lowers Scenario to DOM; compares `world_state_hash` | `importReplay` |
| Worker: commands in / snapshots out | Same `WorldCommand` / `WorldSnapshot` types |
| `ClientReplay` | Separate format over `ClientView` |
| Integer/noise-crate terrain | If wasm hash parity is required |
| FOV in snapshot / secondary hash | When fog/render needs it |

---

## 10. Acceptance checklist

- [ ] `WORLD_REPLAY_FORMAT_VERSION == 1`; reject other versions on load
- [ ] Events are only `Command` and `Checkpoint` (+ final snapshot/hash)
- [ ] Snapshot type has no visibility fields
- [ ] `world_state_hash` uses documented canonical layout + FNV `StateHash`
- [ ] Default checkpoint interval 128 (overridable)
- [ ] Core golden suite green on native
- [ ] No Scenario authoring types shipped
- [ ] Noise wasm risk documented in code module docs as well as here
