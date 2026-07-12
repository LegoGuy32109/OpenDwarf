# `/engine` render hot-path plan: projected ClientView + fixed tick/render schedule

**Status:** implementation-ready revision, not yet implemented (reviewed
2026-07-12)\
**Owner:** Josh\
**Priority:** restore real-time play and establish the correct read/write
boundaries before adding shadow/fog layers\
**Baseline:** `/engine` is approximately 400 ms per production RAF callback and
3.0-3.1 s per 20 idle harness frames in the 9x9x1 play world. `/webgl` is the
same-run control, not an absolute timing oracle.\
**Target:** make `/engine` faster than the `/webgl` control while preserving the
Rust-authoritative render ABI and leaving a clean layer seam for shadows.

## 0. Feasibility verdict

The work is feasible without a wasm ABI rewrite, worker, or TypeScript-owned
render policy. The current failure is caused by using a canonical replay
snapshot as the live read model, not by wasm or WebGL itself.

The original draft had four implementation hazards that this revision resolves:

1. The current world-wide x-major `Vec<BlockType>` conflicts with every
   chunk-oriented consumer and requires strided projection copies. Stage 2 makes
   chunk-major `ChunkState` storage authoritative and deletes the duplicate
   sparse `terrain_blocks` map before ClientView is built.
2. A global `terrain_rev` or `fov_rev` invalidates every chunk and contradicts
   the promised chunk-granular caches. Cache dependencies must be tracked per
   source chunk/column.
3. Render-only caches do not belong inside the future client/network data
   contract. `ClientView` contains projected game data; topmost and emission
   caches remain in `od_world::render`.
4. A local camera must not mutate replay-authoritative chunk residency. The
   current world is fully generated and all chunks remain simulation-resident;
   camera/view changes only alter local ClientView projection. A future lazy
   authority may change simulation residency based on entities/world activity,
   never a recipient viewport.

## 1. Current failure and measured path

`UiEngine::frame()` currently calls `WorldSim::snapshot()` four times on an idle
frame and up to seven or more times on a frame that runs a sim tick. Each
snapshot scans the roughly 300,000 solid entries in `terrain_blocks`, filters
loaded chunks, and builds a sorted `BTreeMap` for hashing/serde/replay.

| Runtime caller                              | Snapshot use                                |
| ------------------------------------------- | ------------------------------------------- |
| `update_view_motion` / `write_view_globals` | reads one tick counter                      |
| `primary_entity_position` twice per tick    | reads one entity position                   |
| `process_player_movement`                   | reads one entity movement                   |
| `sync_local_view`                           | reads entity, dimensions, and loaded chunks |
| `render_world`                              | reads terrain and entities                  |

Costs downstream of the snapshot representation:

- FOV checks a 41-cubed candidate volume with DDA rays and ordered-map lookups.
- Topmost floor checks visible columns across six z-levels every frame.
- Floor instances and HUD strings are rebuilt every frame even when unchanged.
- The 3-tick-per-frame cap cannot catch up while each frame takes about 400 ms;
  the live route falls to roughly 7 TPS and accumulates sim lag.

`WorldState` already owns dense terrain and O(1) entity state, but its
world-wide layout and duplicate sparse map are the wrong shape for chunk
projection. The fix is to make fixed chunks authoritative, project bounded
read-optimized state after fixed ticks, and render that projection at frame
rate.

## 2. Non-negotiable invariants

These are review gates, not aspirations.

1. **No canonical snapshots on the frame hot path.** After Stage 4,
   `frame()`/`render()` perform zero `WorldSim::snapshot()` calls. Snapshots
   remain on-demand for replay, hashes, import/export, and harness snapshots.
2. **One authoritative writer.** Normal gameplay mutations of `WorldState` occur
   in `run_fixed_tick()`. Reset/import are explicit lifecycle operations, not
   render operations.
3. **Render cannot reach `WorldState`.** Final `render(alpha)` receives
   `ClientView`, `EntityPerspective`, `LocalWorldView`, and render caches. It
   may mutate render caches/arenas only.
4. **Projection happens after tick mutations.** Chunk copies, entity projection,
   and FOV recomputation observe the final state of the tick.
5. **Cache keys contain every dependency.** View-z, view mode, all terrain
   revisions in the scanned z-slice, and all relevant perspective revisions are
   represented exactly. Do not use a global revision as a fake per-chunk key.
6. **Fixed ABI arenas never reallocate.** Cached segments may allocate
   privately; copying into exported arenas is bounded and increments drop
   counters on overflow. Pointer and capacity tests enforce this.
7. **Chunk edge is fixed at 16 for this engine.** Add a named
   `SUPPORTED_CHUNK_EDGE` contract and reject imported replay/config data with a
   different edge before constructing fixed-size views. Do not expose a
   configurable `chunk_edge` while indexing with shifts and masks.
8. **Deterministic output remains the correctness gate.** Performance work may
   change tick timing only where the stage says so. Draw/hash changes are
   isolated and re-blessed in named stages.
9. **Shadows remain Rust-authoritative.** Future edge/ceiling/fog layers consume
   the same ClientView/perspective inputs and emit paint-ordered ABI batches.
   This work must not introduce new TypeScript pass policy.
10. **Do not delete `webgl2/` in this effort.** `/engine` still imports its GL
    boot, shader/program, texture, canvas, and font utilities. Relocating that
    shared GPU substrate belongs to cutover cleanup.
11. **Chunk-major terrain has one source of truth.** `WorldState::chunks` owns
    every block and per-chunk terrain revision. Delete the authoritative
    world-wide block vector and sparse terrain map; snapshots are derived data.
12. **Cameras never send residency commands.** Production `UiEngine` emits no
    `SetChunkLoaded` in response to camera, zoom, view-z, viewport, or view
    mode. Those inputs select ClientView projection only.

## 3. Ownership and data model

### 3.1 Authoritative, projected, and render-owned state

| Owner                     | Data                                                                | Mutation cadence                              |
| ------------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| `WorldState` / `WorldSim` | chunk-major terrain, entities, tick, authority-owned residency      | fixed tick / explicit authority command       |
| `LocalWorldView`          | camera, zoom, view-z, mode, visible/render window, HUD counters     | frame-local input; sampled by tick projection |
| `ClientView`              | locally projected chunk blocks/revisions and entities               | after fixed tick or lifecycle rebuild         |
| `EntityPerspective`       | visible bitmaps, persistent memory, per-column visibility revisions | tick-exit when dirty                          |
| render caches             | topmost columns and emitted layer segments                          | render; derived data only                     |

`ClientView` uses `HashMap` for local lookup in this increment. It is **not
serialized as the future network wire format**. A later worker/network protocol
can send ordered chunk-delta DTOs built from the same fixed blobs without making
runtime map iteration part of a deterministic wire contract.

### 3.2 Fixed chunk types

```rust
// od_core/src/world/chunk.rs (introduced in Stage 2)
pub const SUPPORTED_CHUNK_EDGE: u32 = 16;
pub const CHUNK_AREA: usize = 16 * 16;
pub const CHUNK_VOLUME: usize = 16 * 16 * 16;
pub const VISIBILITY_WORDS: usize = CHUNK_VOLUME / 64;

// od_core/src/client_view.rs (introduced in Stage 3)
pub struct ChunkView {
    pub blocks: Box<[BlockType; CHUNK_VOLUME]>,
    pub terrain_revision: u64,
}

pub struct EntityView {
    pub id: u64,
    pub prev_xy: [f32; 2],
    pub curr_xy: [f32; 2],
    pub position: Vec3i,
    pub facing_left: bool,
}

pub struct ClientView {
    pub tick: u64,
    pub world_chunks: Vec3u,
    pub chunks: HashMap<Vec3i, ChunkView>,
    pub entities: Vec<EntityView>,
    pub primary_entity_id: Option<u64>,
}

pub struct EntityPerspective {
    pub visible: HashMap<Vec3i, [u64; VISIBILITY_WORDS]>,
    pub memory: HashMap<Vec3i, Box<[u8; CHUNK_VOLUME]>>,
    pub visibility_revision_by_column: HashMap<(i32, i32), u64>,
    pub fov_revision: u64, // observability only; not a broad cache key
    pub fov_dirty: bool,
    pub fov_recompute_count: u64,
}
```

Add `WorldConfigError::UnsupportedChunkEdge { actual, supported }` and
`WorldSim::try_new(config, spawn) -> Result<WorldSim, WorldConfigError>` in
Stage 2. Keep `WorldSim::new` only as a trusted-config convenience wrapper that
calls `try_new(...).expect(...)`. Replay import/application uses `try_new` and
returns the typed/config-mapped error rather than panicking on untrusted JSON.
Extend `WorldCommandError` with `ChunkOutOfBounds { chunk: Vec3i }`;
`SetChunkLoaded` validates through the shared coordinate-to-index helper before
changing `simulation_resident`.

The authoritative storage is private to `od_world`:

```rust
// od_world/src/state.rs
struct ChunkState {
    blocks: Box<[BlockType; CHUNK_VOLUME]>,
    terrain_revision: u64,
    simulation_resident: bool,
}

pub struct WorldState {
    tick: u64,
    world_chunks: Vec3u,
    movement_ticks_per_tile: u32,
    chunks: Vec<ChunkState>, // canonical z-major chunk order, x fastest
    entities: BTreeMap<u64, EntityState>,
    next_entity_id: u64,
}
```

Chunk vector indexing is deterministic:

```text
local_chunk = chunk_coord + floor(world_chunks / 2)
chunk_index = local_chunk_z * world_chunks.y * world_chunks.x
            + local_chunk_y * world_chunks.x
            + local_chunk_x
voxel_index = voxel_z * 16 * 16 + voxel_y * 16 + voxel_x
```

Implement coordinate conversion through the existing centered world minimum,
then non-negative division/remainder. Do not use truncating division directly on
negative world coordinates. Add inverse mapping tests for every world-edge
coordinate and even/odd `world_chunks` dimensions.

Use one implementation of these helpers in `od_core::world::chunk` for
authoritative storage and ClientView lookup:

```rust
pub fn chunk_coord_to_index(chunk: Vec3i, dims: Vec3u) -> Option<usize>;
pub fn chunk_index_to_coord(index: usize, dims: Vec3u) -> Option<Vec3i>;
pub fn world_position_to_chunk_voxel(
    position: Vec3i,
    dims: Vec3u,
) -> Option<(Vec3i, usize)>; // (centered chunk coordinate, voxel index)
```

Do not leave parallel coordinate math in `terrain.rs`, `render.rs`, or
`od_wasm`; WorldState maps the returned coordinate with `chunk_coord_to_index`,
while ClientView uses it as the HashMap key.

`BlockType` is already `#[repr(u8)]` with `Air = 0` and `SolidStone = 1`, but
authoritative and ClientView chunks stay typed as `BlockType`; no unsafe byte
cast is needed. Perspective memory reserves `0` for unknown and stores
`BlockType as u8 + 1`.

### 3.3 World read APIs

Add narrow accessors to `WorldState` and pass-throughs on `WorldSim`:

```rust
pub fn tick_count(&self) -> u64;
pub fn world_chunks(&self) -> Vec3u;
pub fn world_bounds(&self) -> (Vec3i, Vec3i);
pub fn entity_position(&self, id: u64) -> Option<Vec3i>;
pub fn entity_snapshot(&self, id: u64) -> Option<EntitySnapshot>;
pub(crate) fn entity_snapshots(&self) -> impl Iterator<Item = EntitySnapshot> + '_;
pub fn loaded_chunk_coords(&self) -> Vec<Vec3i>; // sorted; temporary Stage 1-3 path
pub fn chunk_terrain_revision(&self, chunk: Vec3i) -> Option<u64>;
pub fn copy_chunk_blocks(
    &self,
    chunk: Vec3i,
    out: &mut [BlockType; CHUNK_VOLUME],
) -> bool;
```

`copy_chunk_blocks` must:

- validate the centered chunk coordinate and fixed edge;
- perform one typed `copy_from_slice` from the authoritative `ChunkState`;
- never allocate and never derive terrain from a snapshot representation;
- have parity tests against `WorldState::block_at` for every cell in center,
  edge, and negative-coordinate chunks.

Stage 2 rewrites terrain generation to fill chunk-local arrays directly from
world coordinates and deletes `blocks: Vec<BlockType>`,
`terrain_blocks: HashMap<Vec3i, BlockType>`, and `build_terrain_blocks_cache`.
`WorldState::snapshot()` iterates resident chunks in canonical chunk/local-voxel
order and constructs the existing snapshot schema on demand, preserving hashes
in Stage 2. Do not keep either old terrain store as a compatibility cache.

Terrain is immutable today, so per-chunk revisions begin at zero. The first
future block mutation API updates that chunk's typed array and revision in one
method. Reset/import rebuild ClientView rather than trying to preserve revisions
across worlds. Add a `#[cfg(test)]` mutation helper in `od_world::test_util`
that changes one block and increments only its chunk revision; it exists solely
to exercise projection/cache invalidation until a replayable terrain-edit
command is designed.

`entity_snapshot` constructs one small existing `EntitySnapshot`; it never scans
terrain or loaded chunks. Projection code converts it to `EntityView` and owns
interpolation history: it shifts the previous ClientView `curr_xy` into
`prev_xy`, then installs the new render position as `curr_xy`. This prevents
authoritative state from acquiring render-history concerns. Delete the temporary
`loaded_chunk_coords` accessor when camera-derived authoritative streaming is
removed in Stage 4.

`project_entities` consumes the crate-visible snapshot iterator, preserves
existing interpolation history by entity id, drops despawned entities, and sorts
the final `ClientView.entities` by id. Render must never depend on ClientView
`HashMap` iteration order; chunk/column emission follows the BTreeSet-derived
visible order.

### 3.4 Projection window

Use two concepts rather than overloading `loaded_chunks`:

- **Visible window:** camera/view-z chunks whose columns may emit this frame.
- **Projection-resident window:** visible window plus one render padding ring
  plus, in entity mode, every chunk intersecting the primary entity's 3D FOV
  sphere. Master mode does not retain an unused player-FOV ring.

Concrete projection API:

```rust
// od_world/src/project.rs
pub struct ProjectionWindow {
    pub visible: BTreeSet<Vec3i>,
    pub resident: BTreeSet<Vec3i>,
}

#[derive(Default, Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProjectionSyncStats {
    pub inserted: u32,
    pub recopied: u32,
    pub removed: u32,
    pub unchanged: u32,
    pub authority_missing: u32,
}

pub fn compute_projection_window(
    view: &LocalWorldView,
    world_chunks: Vec3u,
    primary_position: Option<Vec3i>,
    framebuffer: (u32, u32),
) -> ProjectionWindow;

pub fn sync_view_chunks(
    client: &mut ClientView,
    world: &WorldState,
    desired: &BTreeSet<Vec3i>,
) -> ProjectionSyncStats;

pub fn project_entities(
    client: &mut ClientView,
    world: &WorldState,
    primary_entity_id: Option<u64>,
);
```

`ProjectionSyncStats` reports inserted, recopied, removed, unchanged, and
authority-missing counts so tests can prove why work occurred. Iteration over
the `BTreeSet` fixes projection/debug ordering even though ClientView lookup
uses `HashMap`. A desired chunk that is no longer simulation-resident is removed
from ClientView in the same sync and counted as `authority_missing` (and
`removed` when previously present); stale authoritative data must never remain
renderable.

The FOV union is required because radius 20 can span up to 4 chunks per axis.
The desired set is clipped to world bounds. `sync_view_chunks` drops chunks no
longer resident, inserts missing chunks, and recopies only when that chunk's
terrain revision changed. It only copies chunks for which
`WorldState::is_chunk_loaded` is true. In the current fully generated world all
chunks start simulation-resident and production `UiEngine` never changes that
residency from view input.

ClientView lookup returns `Option<BlockType>`: render skips missing terrain and
LOS treats an unexpectedly missing required chunk as opaque. Reference fixtures
must have the complete FOV-support window resident, so this fail-closed rule
does not silently change their draw hashes.

`SetChunkLoaded` remains an explicit authority/test/replay command so chunk-gate
tests remain meaningful. It may be driven by a future server residency policy,
but camera, zoom, view-z, viewport, fullscreen, and view mode never emit it.
Stage 4 removes `apply_streaming_chunks`, `streaming_fingerprint`, and every
production call site that derives a `WorldCommand` from `LocalWorldView`.

Projection-window changes are sampled on fixed ticks, so a fast camera pan may
show an entering edge as absent for at most one 50 ms tick. Render treats it as
missing rather than reading WorldState or synchronously copying during RAF. Add
a test for that bound; revisit with worker prefetch later only if it is visually
objectionable.

### 3.5 Tick and render schedule

```rust
impl UiEngine {
    fn run_fixed_tick(&mut self) {
        // 1. Apply queued gameplay intents. View input emits no WorldCommand.
        // 2. Advance WorldSim exactly one tick.
        // 3. Compute visible + projection-resident windows from final state.
        // 4. Sync ClientView chunks, then project entities (prev <- curr).
        // 5. Mark/recompute EntityPerspective if entity, mode, or resident terrain changed.
    }

    fn render(&mut self, alpha: f32) -> u32 {
        // 1. Emit world layers from ClientView/perspective into fixed arenas.
        // 2. Build the session HUD and run DomainEngine::frame(input_bytes).
        // 3. Append UI DrawCmds after world DrawCmds.
        // 4. Apply submitted chat/view-mode effects for the following frame/tick.
        // Mutates no WorldState; only local UI/view state, render caches, and arenas.
    }

    pub fn frame(&mut self) -> u32 {
        self.ingest_input_and_update_local_view();
        self.accumulator_ms = (self.accumulator_ms + self.clamped_dt_ms())
            .min(MAX_ACCUMULATED_MS);
        let mut ticks = 0;
        while self.accumulator_ms >= SIM_TICK_MS && ticks < MAX_TICKS_PER_FRAME {
            self.run_fixed_tick();
            self.accumulator_ms -= SIM_TICK_MS;
            ticks += 1;
        }
        self.render((self.accumulator_ms / SIM_TICK_MS).clamp(0.0, 1.0))
    }
}
```

Use `MAX_TICKS_PER_FRAME = 3`, clamp a single frame delta, cap accumulated lag
to the same three-tick budget, and count discarded lag as `droppedSimTimeMs`.
This prevents a tab restore or current 400 ms frame from creating an unbounded
catch-up spiral. Harness `stepFrame` remains deterministic at synthetic 16 ms
increments.

`step_sim_ticks(n)` ingests pending input once, calls the same
`run_fixed_tick()` exactly `n` times, and ends with `render(0.0)`. Import/reset
clear the accumulator, set entity `prev_xy == curr_xy`, fully rebuild projection
and perspective state, then render once.

### 3.6 Topmost and emission caches

Render caches live in `od_world::render`, owned by `UiEngine`:

```rust
pub struct RenderCaches {
    pub topmost: TopmostCache,
    pub floor_emission: EmissionCache,
}

pub struct RenderInput<'a> {
    pub local_view: &'a LocalWorldView,
    pub client: &'a ClientView,
    pub alpha: f32,
}

pub fn render(
    input: RenderInput<'_>,
    perspective: &EntityPerspective,
    caches: &mut RenderCaches,
    atlas_quads: &mut Vec<WorldAtlasQuadInstance>,
    draw_cmds: &mut Vec<DrawCmd>,
) -> RenderOutput;
```

The signature above is the Stage 5+ target. During Stage 4 only, keep the
existing `&mut VisibilityState` parameter while moving all of its terrain reads
to ClientView; Stage 5 replaces it with immutable `&EntityPerspective` and moves
recomputation to tick exit.

Topmost entries are keyed by XY chunk column and must invalidate when `view_z`
or **any source chunk revision intersecting
`[view_z - Z_LEVELS_BELOW, view_z]`** changes. That slice spans at most two
z-chunks with a fixed edge of 16; store the exact source `(chunk_z, revision)`
tuple rather than a lossy global epoch.

Entity-mode emission also depends on the perspective revision for the affected
XY column. During FOV recompute, diff old/new visible and memory blobs and bump
only columns whose paint result changed. Master-mode floor emission has no FOV
dependency.

Cached segments are copied into the exported contiguous atlas arena every frame
for the current ABI. Use a bounded append helper; `Vec::extend_from_slice` must
not be allowed to grow an exported arena. Player output remains one fresh quad.

## 4. Staged implementation and checkpoints

Every stage must be independently compilable and reviewable. An agent stops at
the stage acceptance gate and records results before starting the next stage. Do
not combine golden-changing stages.

| Stage | Requires         | Durable output                                      | Golden policy                               |
| ----- | ---------------- | --------------------------------------------------- | ------------------------------------------- |
| 0     | current baseline | portable artifacts, perf/counter harness            | unchanged                                   |
| 1     | Stage 0 counters | scalar/entity accessors; one hot snapshot           | unchanged                                   |
| 2     | Stage 1          | single chunk-major WorldState                       | unchanged                                   |
| 3     | Stage 2          | fixed scheduler + verified shadow ClientView        | unchanged                                   |
| 4     | Stage 3          | ClientView renderer; camera no longer authoritative | re-bless residency/view terminology changes |
| 5     | Stage 4          | bitmap perspective; tick-time FOV                   | unchanged from Stage 4                      |
| 6     | Stage 5          | fixed-tick entity interpolation                     | re-bless visual interpolation               |
| 7     | Stage 6          | keyed emission cache and final hot-path budget      | unchanged from Stage 6                      |
| 8     | Stage 7          | cleanup, release artifact, final records            | no unexplained changes                      |

### Stage 0 - trustworthy baseline and test prerequisites

1. Keep local artifacts under `exports/engine-golden/` required. Mirror to
   `/opt/cursor/artifacts/engine-golden/` only as an awaited best-effort copy;
   absent/unwritable Cursor paths warn and do not fail the test.
2. Change `scripts/bash/engine-test.sh` to run `cargo test --workspace` so
   `od_wasm` unit tests are not silently omitted.
3. Add `tests/engine-perf.test.ts`, serial with a generous timeout:
   - reset the play world;
   - warm up 5 frames;
   - collect at least 5 samples of `stepFrame(20)`;
   - report median and p95, not one measurement;
   - assert semantic counters and zero dropped arenas;
   - start with a 6,000 ms median regression ceiling so the known-bad baseline
     passes and later stages can tighten it. Gate the file on
     `ENGINE_PERF_TEST=1` so the normal 16-worker full suite does not distort
     it. Add `engine:test-perf-browser` to run that file alone with
     `--workers=1`; this isolated task is the CI regression gate.
4. Add `scripts/engine-perf-profile.ts` plus an `engine:perf` task. It launches
   `/webgl` and production `/engine` sequentially in the same browser, installs
   the same pre-navigation RAF callback-duration probe, warms both routes, and
   writes median/p95 plus environment metadata to `exports/engine-perf/`. This
   profile records results but does not carry a cross-host absolute assertion.
   Reuse the Chromium executable/launch arguments from Playwright config (factor
   a shared helper if necessary), collect at least 20 completed callbacks per
   route with a 30-second route timeout, and fail on page/console/WebGL errors.
   The task is self-contained: reuse a healthy `127.0.0.1:8000` server or spawn
   `deno run -A dev.ts`, wait for readiness, and terminate only the child it
   spawned.
5. Add `worldRender.snapshotCallsLastFrame` observability. Reset a UiEngine
   hot-path counter at frame start and route every temporary RAF-path snapshot
   through one counting helper. On-demand `harness.snapshot()`, replay, and
   import/export work call `WorldSim::snapshot()` directly and are excluded.
6. Record Chromium version, renderer, served wasm artifact/profile, viewport,
   and same-run `/webgl` control numbers in this document. Absolute numbers from
   different machines are not directly comparable.

Files:

- `tests/helpers/engine-harness.ts` (best-effort Cursor mirror already done)
- `scripts/bash/engine-test.sh`
- new `tests/engine-perf.test.ts`
- new `scripts/engine-perf-profile.ts`
- `deno.json`
- `game_engine/od_wasm/src/lib.rs` for hot-path snapshot counters
- `engine/runtime.ts` only if the harness needs additive performance metadata

Acceptance:

- `cargo test --workspace`
- `deno task unit`
- engine Playwright suites with `--workers=1`
- golden test passes when `/opt/cursor` is absent or unwritable
- perf test reproduces the slow route without flaking on a single sample
- `deno task engine:test-perf-browser` passes in isolation
- `deno task engine:perf` writes a same-run comparison artifact

The best-effort Cursor mirror was completed during this plan review; retain its
passing non-Cursor test as a Stage 0 prerequisite rather than rewriting it.

### Stage 1 - remove scalar/entity snapshots

Add the narrow WorldState/WorldSim accessors and rewire view globals, movement,
camera follow, dimensions, and streaming calculations. Only legacy
`render_world` may construct a snapshot.

Files:

- `game_engine/od_world/src/state.rs` and `sim.rs` for narrow reads
- `game_engine/od_wasm/src/lib.rs` for call-site replacement and snapshot count
- focused accessor tests in `od_world` and `od_wasm`

Acceptance:

- `snapshotCallsLastFrame == 1` on idle and tick frames
- draw hashes, screenshots, world hashes, and scenario goldens unchanged
- median performance is no worse than Stage 0 (expected to improve materially,
  but do not encode an unproven `3x` CI requirement)
- accessor tests cover missing entity and active movement

### Stage 2 - make chunk-major WorldState authoritative

Replace the world-wide block vector plus sparse terrain map with canonical
`Vec<ChunkState>` storage from section 3.2. Rewrite terrain generation to fill
chunk-local typed arrays directly. Route `block_at`, movement collision, spawn
search, snapshot construction, and loaded-chunk commands through shared
coordinate/index helpers. Add the one-copy `copy_chunk_blocks` API, but do not
introduce ClientView yet.

Files:

- new `game_engine/od_core/src/world/chunk.rs` plus `world/mod.rs`
- `game_engine/od_core/src/world/config.rs` for config validation/error
- `game_engine/od_core/src/world/command.rs` for an explicit out-of-bounds
  residency-command error
- `game_engine/od_world/src/state.rs`
- `game_engine/od_world/src/terrain.rs`
- `game_engine/od_world/src/sim.rs`
- `game_engine/od_world/src/replay_util.rs` and `game_engine/od_wasm/src/lib.rs`
  for fallible replay construction
- focused `od_world` unit/integration tests

Acceptance:

- `rg "self\\.terrain_blocks|terrain_blocks: HashMap|build_terrain_blocks_cache|blocks: Vec<BlockType>" game_engine/od_world`
  returns no authoritative storage remnants (the local BTreeMap built by
  `snapshot()` is allowed)
- compile-time/test assertion: `size_of::<BlockType>() == 1`
- coordinate round-trip tests cover every chunk coordinate for `1x1x1`, `2x2x2`,
  and `9x9x1` worlds plus min/max voxel positions
- `WorldSim::try_new` and browser/native replay import reject chunk edges other
  than 16 with an error, never a panic
- `copy_chunk_blocks` equals 4,096 `block_at` reads for center, negative, and
  edge chunks; invalid coordinates return `false` without modifying output
- default construction marks every generated chunk simulation-resident
- the test-only block mutation changes snapshot output and increments exactly
  one chunk revision; writing the same value again does not increment it
- out-of-bounds `SetChunkLoaded` returns a typed `WorldCommandError` and changes
  no state; it must never index or insert a phantom chunk
- explicit `SetChunkLoaded(false)` still blocks movement and removes that chunk
  from `WorldSnapshot`; loading it restores the existing behavior
- all existing world-state hashes, replay fixtures, draw hashes, and browser
  goldens remain byte-identical; unexplained changes stop the stage
- `snapshotCallsLastFrame == 1`; 20-frame median is no worse than Stage 1

### Stage 3 - split scheduler and build shadow ClientView

Introduce `run_fixed_tick()` and `render_legacy(alpha)`. The legacy renderer
still consumes one snapshot. Add ClientView types, projection-window
computation, chunk synchronization, and entity projection, but keep them in
**shadow mode**: they are updated after ticks/lifecycle rebuilds and checked by
tests, not used for draw output yet. Preserve the current camera-derived
loaded-chunk calls only as temporary legacy-render support in this stage; Stage
4 deletes them.

Add bounded lag handling and make `step_sim_ticks` share `run_fixed_tick()`.
Normal 16 ms harness timing and draw output must not change.

Files:

- `game_engine/od_core/src/client_view.rs` and `od_core/src/lib.rs`
- new `game_engine/od_world/src/project.rs` and `od_world/src/lib.rs`
- `game_engine/od_wasm/src/lib.rs`
- scheduler/projection tests in the owning crates

Acceptance:

- `snapshotCallsLastFrame == 1`
- a 10-second injected delta runs at most 3 ticks, leaves alpha in `[0,1]`, and
  increments `droppedSimTimeMs`
- synthetic frame tests prove deterministic 20 TPS progression
- `step_sim_ticks(n)` advances exactly `n` ticks and renders once afterward
- shadow ClientView chunk bytes/revisions match authoritative ChunkState for the
  complete desired projection window
- projection sync tests cover add, remove, unchanged-hit, terrain revision, FOV
  support union, bounds clipping, and missing authoritative residency
- entity projection tests cover first sample (`prev == curr`), tick shift, and
  reset/import reinitialization
- add on-demand `worldRender.worldDrawHash` over only the world DrawCmd prefix
  plus world arenas, and record a scripted Stage 3 checkpoint for Stage 4 parity
- draw/world hashes and all goldens unchanged; no re-bless in this stage
- 20-frame median is no worse than Stage 2

### Stage 4 - cut render to ClientView and remove camera authority

Rewrite floor, player, occlusion, topmost, and legacy FOV terrain reads to
consume ClientView. FOV may retain its current HashSet/HashMap storage
temporarily. Rename `render_legacy` to `render` and remove its
WorldState/snapshot access.

In the same change, delete `apply_streaming_chunks`, `streaming_fingerprint`,
and every view-derived `SetChunkLoaded` call. A new/play world retains all
generated chunks as simulation-resident. The camera controls only the local
projection window. Rename `LocalWorldView.streaming_chunks` to
`projected_chunks` and update the HUD/debug snapshot terminology.

Files:

- `game_engine/od_world/src/render.rs`
- `game_engine/od_wasm/src/lib.rs`
- `game_engine/od_core/src/view.rs`
- affected native/browser fixtures and view tests

Acceptance:

- `snapshotCallsLastFrame == 0` for idle, tick, movement, camera, zoom, view-z,
  resize, master/entity, chat, and shell frames
- `rg "apply_streaming_chunks|streaming_fingerprint" game_engine/od_wasm/src`
  returns no matches
- a paired-engine test advances identical tick counts in identical worlds while
  only one side pans/zooms/resizes/switches view mode; final world hashes and
  loaded-chunk sets are equal
- the same paired test proves projected chunk membership differs after the next
  fixed tick while authoritative residency remains equal; before that tick the
  renderer fails closed on newly entering chunks
- an explicit command/replay `SetChunkLoaded` still changes the world hash and
  movement gate, proving authority control was retained
- browser and native hashes match for the same play-world config independent of
  viewport dimensions
- topmost invalidation tests cover view-z and both source z-chunks in the
  scanned slice
- unsupported non-16 config/replay data is rejected before fixed-size indexing
- scripted floor/player `DrawCmd`s and atlas instances match Stage 3 exactly for
  the same camera/entity state (`worldDrawHash` equal); investigate any
  world-layer difference before blessing combined hashes
- re-bless the expected loaded-chunk/view-field/world-hash and draw fixtures in
  this stage only, with the reason recorded
- tighten 20-frame median ceiling to 400 ms; record actual median/p95

### Stage 5 - chunked perspective and tick-time FOV

Replace `VisibilityState` sets with per-chunk bitmaps and persistent memory.
Pre-resolve the at-most-64 FOV chunk slots before ray traversal. Recompute at
tick exit only; render receives `&EntityPerspective`. Diff changed blobs and
bump per-column paint revisions.

Files:

- `game_engine/od_core/src/client_view.rs`
- `game_engine/od_world/src/project.rs` and `render.rs`
- `game_engine/od_wasm/src/lib.rs`
- FOV parity fixtures/tests in `od_world`

Acceptance:

- legacy-set versus bitmap parity for visible and remembered tile sets on fixed
  fixture worlds, including chunk boundaries
- memory survives projection stream-out/in
- idle frames do not recompute FOV
- one fixed tick that changes the entity's discrete FOV origin causes exactly
  one recompute; interpolation-only progress does not
- master mode clears visible state but preserves memory
- draw hash unchanged from Stage 4
- tighten 20-frame median ceiling to 250 ms
- record FOV-recompute sample distribution; do not gate CI on a brittle 1 ms
  single measurement

### Stage 6 - fixed-tick interpolation

Populate `EntityView.prev_xy/curr_xy` at tick boundaries and render
`lerp(prev, curr, alpha)`. Camera follow consumes the same interpolated
position; view-local look-offset smoothing stays frame-rate based. The player
quad uses fixed-tick interpolation directly. Rename/remove the current shared
`smooth_player_world_pos` so exponential camera follow, if retained, cannot add
a second smoothing filter to the player sprite itself.

Files:

- `game_engine/od_world/src/project.rs` and `render.rs`
- `game_engine/od_wasm/src/lib.rs`
- MVP browser goldens/screenshots

Acceptance:

- unit tests for alpha 0, midpoint, and 1; alpha never exceeds bounds
- player render position equals the lerp result exactly; camera smoothing state
  is separate and cannot affect the player quad
- reset/import/teleport initialize `prev == curr`
- synthetic harness alpha/draw output deterministic
- re-bless visual goldens in this stage only
- manual movement check shows no snap, overshoot, or rubber-banding
- 20-frame median/p95 is no worse than Stage 5 beyond normal recorded variance

### Stage 7 - per-column emission cache and frame hygiene

Add cached floor segments with exact topmost/terrain/perspective dependency
keys. Evict entries outside the projection window. Cache HUD strings by their
displayed values. Add `emitColumnRebuilds`, `emitColumnHits`, and
`emissionCacheSize` to `worldRender` debug output.

Files:

- `game_engine/od_world/src/render.rs`
- `game_engine/od_wasm/src/lib.rs`
- render-cache unit tests and browser performance assertions

Acceptance:

- two idle frames perform zero emission rebuilds on the second frame
- movement rebuilds only columns whose perspective paint revision changed
- view-z invalidates all visible columns; master camera pan builds entering and
  evicts leaving columns
- exported arena pointer/capacity remains stable under overflow tests
- every world DrawCmd remains at or below 8,192 instances
- draw hash unchanged from Stage 6
- tighten 20-frame median ceiling to 100 ms; zero dropped instances/cmds in the
  reference viewport

### Stage 8 - final acceptance and cleanup

Remove snapshot-based render helpers, old visibility storage, shadow-projection
assertion scaffolding, and temporary scheduler names. Update
architecture/cutover documents and record final benchmark tables.

Files:

- dead helpers in `od_wasm` and `od_world`
- `docs/GAME_ENGINE_ARCHITECTURE.md`
- `docs/design/engine-webgl-parity-cutover.md`
- final benchmark record in this document

Do **not** reshape `WorldSnapshot` in this sequence. Snapshot modernization is a
separate replay-format change with separate fixtures; mixing it into hot-path
acceptance adds risk without improving RAF performance.

Acceptance:

- the complete matrix in section 7 is green
- `deno task engine:build` regenerates release wasm and the engine browser suite
  passes against it
- `deno task engine:perf` records final `/webgl` and `/engine` median/p95 in
  this document using the same browser/environment
- `rg "render_legacy|smooth_player_world_pos|apply_streaming_chunks|streaming_fingerprint" game_engine`
  returns no obsolete hot-path helpers
- architecture and cutover docs describe chunk-major authority, local projection
  residency, and the zero-snapshot renderer consistently

## 5. Required test matrix

Run after every stage unless the stage explicitly calls for a golden re-bless:

```bash
deno task engine:test
deno task engine:check
deno task engine:dev
deno task unit
npx playwright test tests/engine*.test.ts --workers=1
deno task engine:test-perf-browser
```

`engine:dev` is mandatory after every Rust change: Playwright imports the
committed `engine/generated/od_wasm_bg.wasm`, so skipping the rebuild can
produce a false green run against stale code. Confirm `engine/generated/` and
`static/engine/` changed when Rust behavior changed. If the wasm target or
`wasm-bindgen` is missing, install the documented Rust-to-wasm prerequisites; do
not accept stale-artifact browser results.

At Stage 8, run `deno task engine:build` and repeat the engine
browser/performance suite against the release-generated artifact. Record whether
`wasm-opt` and `brotli` were available; their absence affects artifact size, not
correctness.

Before final acceptance also run `deno task test` and `deno lint`; document any
remaining pre-existing lint findings rather than treating lint output as an
engine performance result.

Correctness coverage must include:

- snapshot call count on idle/tick/movement/chat paths;
- chunk coordinate round trips, generation/hash parity, one-copy projection, and
  out-of-bounds command behavior;
- paired-engine proof that view/camera inputs do not alter world hash or
  simulation residency;
- resident projection add/drop/revision behavior;
- topmost multi-z dependency invalidation;
- FOV bitmap parity, dirty scheduling, and memory persistence;
- interpolation and lifecycle reset behavior;
- emission hit/rebuild/eviction and fixed-arena overflow;
- scenario native/browser world-state hash parity;
- draw hashes and screenshots at existing MVP checkpoints.

## 6. Shadow/fog layer seam after performance work

Shadows are intentionally not implemented in Stages 0-8, but the architecture
must make them additive:

1. Preserve paint order:
   `floor -> edge shadow -> ceiling shadow -> fog -> player -> session UI`.
2. Edge/ceiling builders live in `od_world::render` and consume ClientView plus
   topmost results. TS only selects the ABI program/texture and draws the range.
3. Shadow cache dependencies include neighboring XY chunks because edge masks
   inspect adjacent tiles. Editing/streaming one chunk invalidates its affected
   one-chunk halo, not every world chunk.
4. Fog consumes `EntityPerspective` bitmaps and can use `WorldSolidQuad`; it
   must not rerun LOS in render.
5. Give each layer its own cache/stats while sharing fixed arena append helpers.
   A disabled shadow layer performs no build or upload work.
6. Move the shared GL program/texture utilities out of `webgl2/` only during the
   later cutover; do not combine that file move with renderer optimization.

## 7. Final acceptance matrix

Performance measurements use warmed repeated samples and report median/p95. CI
gates use the harness ceiling; production RAF targets are recorded on a
controlled same-run comparison because browser/GPU timing varies by host.

| Concern                     | Required result                                                          |
| --------------------------- | ------------------------------------------------------------------------ |
| Terrain source              | one chunk-major authoritative store; no duplicate sparse/world vector    |
| Camera authority            | view changes alter projection only, never world hash/residency           |
| Hot-path snapshots          | 0 on all normal frame paths                                              |
| 20-frame play-world harness | median <= 100 ms                                                         |
| Idle emission rebuilds      | 0 after warmup                                                           |
| FOV scheduling              | <= 1 recompute per changed fixed tick; 0 idle                            |
| Dropped output              | 0 at reference viewport/zoom                                             |
| World draw commands         | <= 4 for current floor/player MVP                                        |
| Production RAF              | `/engine` median beats same-run `/webgl` control; stretch target <= 2 ms |
| Sim recovery                | long frame bounded; alpha in range; no unbounded backlog                 |
| Determinism                 | native/browser scenario hashes and draw goldens green                    |
| Visual correctness          | existing MVP checkpoints green; interpolation manually verified          |
| Full regression             | Rust workspace, engine check, unit, Playwright suites green              |

## 8. Risks and stop conditions

- **Stage 1 does not materially improve performance:** continue only after
  confirming the remaining single snapshot dominates; do not guess at wasm/GL.
- **Stage 4 misses its ceiling:** profile dense FOV/topmost separately before
  implementing emission caching early. The stage boundary is diagnostic.
- **Chunk copy dominates tick spikes:** first confirm window churn. If needed,
  budget N entering chunks per tick, but never expose partially initialized
  chunks; missing chunks fail closed for render/FOV.
- **Draw hash changes in a no-visual-change stage:** stop and explain the first
  differing command/instance. Do not bless unexplained output.
- **Cache invalidation becomes ambiguous:** prefer a slightly broader exact
  dependency tuple over an under-specified fast cache. Add the failing fixture
  before optimizing it.
- **Fixed edge conflicts with a real use case:** stop and redesign blob/index
  types. Do not silently accept non-16 configs with 16-based indexing.
- **All-resident snapshots make harness operations too slow:** measure on-demand
  `harness.snapshot()` separately from `stepFrame`. Optimize the snapshot/hash
  representation in a dedicated replay-format change; never reintroduce
  camera-driven authority or put snapshot construction back in RAF.
- **Performance test flakes across hosts:** keep the correctness/counter gates,
  increase only the coarse CI ceiling with recorded evidence, and preserve the
  same-run `/webgl` control.

## 9. Agent checkpoint record

Each implementation PR/stage appends a short record here or to its PR:

```text
Stage:
Commit/artifact:
Environment (Chromium, renderer, wasm profile, viewport):
Snapshot calls last frame:
20-frame median / p95:
FOV sample median / p95 (when applicable):
Emission hits/rebuilds (when applicable):
Commands run:
Golden changes and reason:
Residual risks:
```

An agent must not proceed on a red correctness gate, unexplained draw/hash
change, arena drop, or missing benchmark record.

Stage 0 implementation record (2026-07-12):

```text
Stage: 0 — trustworthy baseline and test prerequisites
Commit/artifact: rebuilt release engine wasm; exports/engine-perf/2026-07-12T22-55-38-714Z.json
Environment: Chromium 148.0.7778.215, WebKit WebGL, production static engine wasm, 1920x1080 @ DPR 1
Snapshot calls last frame: 4 idle-frame snapshots (observability baseline)
20-frame median / p95: 3324.9 ms / 3638.7 ms (isolated play-world harness)
RAF median / p95: /engine 468.6 ms / 482.8 ms; /webgl 13.5 ms / 20.8 ms
Commands run: cargo test --workspace; deno task unit; deno task engine:test-perf-browser; deno task engine:perf
Golden changes and reason: none
Residual risks: this is the intentionally slow baseline; Stage 1 must reduce snapshots without changing render output.
```
