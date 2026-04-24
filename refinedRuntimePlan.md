# Path A: Finish the Runtime Cutover (Real Phase 5)

## Context

The "completed" WORLD_RUNTIME_PERFORMANCE_PLAN declared Phases 0–9 done, but Phase 5 — "replace the visible chunk render path" — was never actually done. The repo has two parallel simulations:

- **Main thread**: `WorldSimulationPlugin` owns the authoritative `WorldState`. Input flows through `WorldCommandQueue`; `run_simulation_tick` updates `WorldView`; `sync_render_world_from_snapshot` copies the snapshot into `TerrainData`/`FogData`; `project_world_to_tilemap` rebuilds `TilemapChunk` entities from those. This is still the hot path and still the thing the `Tilemap rebuild slow: 14972us across 474 chunks` warning is complaining about.
- **Runtime thread / web worker**: `world_runtime::RuntimeCore` owns a second `WorldState`, ticks it, calls `snapshot()`, bincode-serializes the **entire world** into a single synthetic `ChunkKey(0,0,0)` patch payload, and stuffs it into `ChunkLayerCacheMap`. Confirmed: **no code outside `runtime_bridge.rs` reads `ChunkLayerCacheMap`.** It's a write-only accumulator.

Net effect: duplicate sim work on every platform, duplicate FOV, main thread still paying the full broad-dirty rebuild, and on web an extra worker sim + per-frame bincode of the whole world snapshot on top. Nothing the runtime produces is used.

This plan finishes the cutover: runtime becomes the sole sim owner, patches carry actual per-chunk tile data, and `project_world_to_tilemap` is replaced by a patch consumer. After this, the main-thread sim is deleted.

Intended outcome: main-thread frame does only input + patch apply + rendering. Tile generation and FOV happen on the runtime thread (native) or worker (web). Per-chunk dirty patches replace the 474-chunk-per-move flood. The `Tilemap rebuild slow` warning goes away; `/?perf` stops being laggy under movement.

## Current state (evidence)

Key files and what they do today:

- `game_library/world_sim/src/world_core.rs:164..260` — `WorldState` with flat `blocks: Vec<BlockType>` indexed by `iz*sx*sy + iy*sx + ix`; `terrain_blocks: Arc<HashMap<Vec3i, BlockType>>` cache; **no dirty tracking anywhere**.
- `game_library/world_sim/src/world_core.rs:629, 489` — `apply_command`, `advance_active_movements_one_tick`; return a single `WorldDelta` with no chunk-affinity info.
- `game_library/world_sim/src/bevy_app.rs:100..262` — `WorldSimulationPlugin` adds `run_simulation_tick` in `FixedUpdate`; line 261 clones full snapshot into `WorldView` every tick.
- `game_library/world_sim/src/fov.rs:7..68` — FOV over full `&[BlockType]`; entity-global, no chunk partition.
- `game_library/src/domain/mod.rs:66..101` — main-thread sim plugin added; schedule: `sync_render_world_from_snapshot` → `(stream_chunks_around_player, project_world_to_tilemap)` → `(draw_depth_labels, draw_chunk_borders)`.
- `game_library/src/domain/simulation.rs:328..361` — `sync_render_world_from_snapshot` pulls `WorldView.snapshot()` → `apply_snapshot` (line 1533) → sets `fog.full_rebuild = true` on any visibility change (line 1579) → next `project_world_to_tilemap` nukes all `FogShadow` cache entries.
- `game_library/src/domain/simulation.rs:541..1014` — `project_world_to_tilemap`: reads `TerrainData.blocks / source_blocks`, `FogData`, iterates `active_chunks_xy × rendered_z_levels × 4 layers`, calls `build_chunk_layer_tile_data` per chunk, stamps `TilemapChunkTileData`. Tile vec length = `chunk_edge²`, index = `local_y * chunk_edge + local_x` (lines 490..498).
- `game_library/src/domain/simulation.rs:500..539` — `build_chunk_layer_tile_data` dispatch by `TileLayer`. Four builders: `build_chunk_tile_data` (Floor), `build_edge_shadow_tile_data`, `build_ceiling_shadow_tile_data`, `build_fog_tile_data`.
- `game_library/world_runtime/src/runtime_handle.rs:119..140` — `snapshot_to_patch`: bincode-encodes whole `WorldSnapshot` into `tile_data` of `ChunkKey(0,0,0)`. Every frame. Never per-chunk.
- `game_library/src/domain/runtime_cache.rs:188..220` — `ChunkLayerCacheMap::apply_patch` stores those opaque payloads; `grep` confirms no external consumer.

## Approach

Five phases, each landable as a green commit. The tree stays buildable and the game stays runnable after every phase. Phase 1–2 add the real per-chunk infrastructure. Phase 3 runs runtime in "real patch" mode alongside the existing renderer (just to verify patches are correct) — no perf win yet. Phase 4 flips the renderer onto patches and turns off the main-thread sim; this is where the perf win lands. Phase 5 deletes the dead code.

### Design decision: runtime produces tile data, not raw blocks

The runtime emits fully-baked `Vec<Option<TileData>>` per `(ChunkKey, LayerId, z)`. This matches the plan's intent ("off-load sim/FOV/patch generation") and keeps main-thread apply trivial — just deserialize and stamp into `TilemapChunkTileData`. The tile-data type and its builders have to live somewhere both `world_runtime` and the render client can see them. We extract them into a new small crate so `world_runtime` doesn't depend on the main `game_library` crate.

### Phase 1: Shared tile-data crate + dirty tracking in `world_sim`

Goal: produce the pieces needed to make per-chunk patches possible. Nothing changes on the hot path yet.

- **New crate** `game_library/world_tiles/` with:
  - `TileData` (move from whatever visuals file currently owns it — it lives in `domain/visuals/mod.rs` per the grep; confirm and move the struct + any tile-index constants).
  - `TileLayer` enum (move from `simulation.rs:154`; re-export for back-compat).
  - Pure builders: `build_floor_layer`, `build_edge_shadow_layer`, `build_ceiling_shadow_layer`, `build_fog_layer`. Each takes `(chunk_coord: Vec3i, chunk_edge: u32, z: i32, view_z_current: i32, blocks: &dyn BlockLookup, visibility: Option<&VisibilitySet>, view_mode, render_depth_stack) -> Vec<Option<TileData>>` of length `chunk_edge²`.
  - `BlockLookup` trait abstracts the "get block at world position" so both the main crate (which currently passes `&HashMap<Vec3i, BlockType>`) and `world_sim` (which has a flat `Vec`) can implement it.
  - Contains **only** the exact logic currently in `build_chunk_tile_data`, `build_edge_shadow_tile_data`, `build_ceiling_shadow_tile_data`, `build_fog_tile_data`. No rewrite; a move.
- **`world_sim` gets chunk-level accessors**:
  - Add `WorldState::chunk_edge() -> u32`, `world_chunks() -> Vec3u`, `block_at(Vec3i) -> BlockType` (already exists in some form — confirm and expose), and `chunks_intersecting(min: Vec3i, max: Vec3i, z_min: i32, z_max: i32) -> impl Iterator<Item=Vec3i>`.
  - Add **dirty tracking**:
    - `terrain_dirty_chunks: HashSet<Vec3i>` — set by `apply_command` for the chunk containing any block that changed. Cleared by `take_dirty_chunks()`.
    - `entity_dirty_chunks: HashSet<Vec3i>` — set when entity occupancy changes chunk; cleared by `take_dirty_entity_chunks()`.
    - `visibility_dirty_chunks: HashSet<Vec3i>` — after FOV recompute, diff old vs new visible sets and mark the chunks containing any changed visibility tile. Cleared by `take_dirty_visibility_chunks()`.
  - Add `blocks_arc() -> Arc<Vec<BlockType>>` (or an `&[BlockType]` accessor) so `world_tiles` can read blocks without copying.
- **Make `world_runtime` depend on `world_tiles`** (and keep its `world_sim` dep for now). Main crate also depends on `world_tiles`.

Files touched:
- `game_library/world_tiles/Cargo.toml` (new), `game_library/world_tiles/src/lib.rs` (new).
- `game_library/Cargo.toml`, `game_library/world_runtime/Cargo.toml`.
- `game_library/world_sim/src/world_core.rs` (new accessors + dirty sets).
- `game_library/src/domain/simulation.rs` (move the four builders out; keep thin re-export wrappers for the brief overlap period).
- `game_library/src/domain/visuals/mod.rs` (or wherever `TileData` lives — confirm on first read).

Verification: `cargo check` both targets. Existing render path keeps using the moved builders via re-exports; perf unchanged.

### Phase 2: Runtime emits real per-chunk patches

Goal: runtime starts producing per-chunk `ChunkLayerPatch` with real tile-data payloads. No main-thread consumer yet — still dead-end into `ChunkLayerCacheMap`. But patches are now the right shape.

- Replace `runtime_handle.rs::snapshot_to_patch` with `build_chunk_layer_patch(chunk_coord, layer, z, viewport)`:
  - Calls `world_tiles::build_*_layer(...)` with `WorldState` as the `BlockLookup`.
  - Serializes the `Vec<Option<TileData>>` with bincode (small payload: `chunk_edge² × ~3 bytes`).
  - Sets `revision = world_state.tick << N | chunk_hash`, `full_chunk = true`, `worker_frame_id` as today.
- Rewrite `RuntimeCore::step`:
  1. Drain `pending_commands` → `apply_command`; record `terrain_dirty_chunks`.
  2. `advance_active_movements_one_tick`; record `entity_dirty_chunks`.
  3. If visibility dirty: `compute_fov`; record `visibility_dirty_chunks` from the FOV diff.
  4. If `pending_initial_snapshot`: enumerate chunks in `viewport.desired_bounds × relevant_z_range × active_layers`, emit near-first (sort by manhattan distance from `viewport.camera_center`), chunk by chunk; emit `InitialSnapshotProgress` every N chunks.
  5. If `pending_layer_snapshots` non-empty: for each layer, enumerate chunks in bounds and emit `ChunkLayerPatch` per chunk (carries `LayerSnapshotStarted/Progress/Complete` around it as today).
  6. Steady state: union `(terrain ∪ entity ∪ visibility) dirty chunks`, filter to `desired_bounds × relevant_z × active_layers`, emit one patch per (chunk, layer, z) that's actually dirty for that layer. (Floor only needs terrain dirty; EdgeShadow/CeilingShadow need terrain; FogShadow needs visibility.) Near-first sort.
  7. Emit `EntityPatchBatch` with actual deltas, not a full snapshot.
- Delete `snapshot_with_visibility` calls on the emit path; keep one initial `compute_fov` for the starting snapshot and on visibility-dirty frames only.
- `ChunkLayerPatch.tile_data` type stays `Vec<u8>` (bincode). No protocol renumber.

Files touched:
- `game_library/world_runtime/src/runtime_handle.rs` (large rewrite of `RuntimeCore`).
- `game_library/world_runtime/src/protocol.rs` (no field changes; doc comments for the new payload shape).

Verification: `cargo check` both targets. Add a debug log in `runtime_bridge.rs`' ingestion loop that counts patches per frame and logs peak payload bytes; confirm patch count scales with dirty area (single chunk when idle, a ring when moving) and payload ≪ current 20+ KB of bincode snapshot.

### Phase 3: Renderer learns to consume patches (dark-launch)

Goal: render client can apply patches to `TilemapChunk` entities. Gate it behind a dev flag so we can A/B against the old path. Old path still runs authoritatively.

- New system `apply_runtime_chunk_patches` in a new file `game_library/src/domain/render_patches.rs`:
  - Resource `ChunkLayerRenderEntities: HashMap<(ChunkKey, LayerId, i32), Entity>`.
  - Each frame: for every `ChunkLayerCacheMap.entries` entry with `dirty=true` whose `(chunk, layer, z)` is in the active layer mask × `rendered_z_levels`:
    - Deserialize `payload` → `Vec<Option<TileData>>`.
    - Look up or spawn the `(ChunkKey, LayerId, z)` entity with the same component bundle `project_world_to_tilemap` uses (`TilemapChunk`, `TilemapChunkTileData`, `Transform`, visibility).
    - Mutate `TilemapChunkTileData.0` in place; update `Transform` only if z changed.
    - Set `entry.dirty = false`, `entry.materialized = true`.
  - On viewport change that shrinks `desired_bounds` or flips a layer off: despawn entities whose key falls outside. No broad `.entries.clear()`.
- Gate: new `CutoverFlag` resource, `false` by default. When `false`, `apply_runtime_chunk_patches` runs but writes to a throwaway set of entities marked `Hidden` so we can verify correctness without visible interference. When `true`, the old `project_world_to_tilemap` skips.
- Add a one-key toggle (F9 or similar) to flip `CutoverFlag` for A/B testing.

Files touched:
- `game_library/src/domain/render_patches.rs` (new).
- `game_library/src/domain/mod.rs` (schedule registration; both systems run, gated).
- `game_library/src/domain/runtime_cache.rs` (expose `entries` iterator helpers; possibly change `ChunkLayerKey` to include z).

Verification: run native with flag off, confirm no regression. Flip flag: world should still render correctly. F1 telemetry should show tile data materializing from patches. A/B frame time.

### Phase 4: Flip the default; retire the main-thread sim

Goal: `CutoverFlag = true` by default. Remove `WorldSimulationPlugin`. Delete `sync_render_world_from_snapshot`, `TerrainData.blocks`, `TerrainData.source_blocks`, `FogData.visible`, `FogData.memory`, `VisibleChunkLayerCache`, `stream_chunks_around_player`, `project_world_to_tilemap`.

- Input path: `queue_world_commands_from_input` → `RuntimeInputQueue` (already exists); remove the `WorldCommandQueue` branch.
- Entity rendering (`project_world_entities_to_sprites` and friends): switch to reading a new resource `RenderEntityState` that the bridge populates from `EntityPatchBatch` events. The existing `RenderEntityData` resource stays, populated by the bridge instead of `apply_snapshot`.
- Debug overlays (`draw_depth_labels`, `draw_chunk_borders`): reroute to read `ChunkLayerCacheMap` shape (hot/warm/cold residency) and the runtime's `chunk_edge` from `RuntimeViewportIntentState` + `ChunkCacheState`.
- `ReplayPlayback` (native-only): it currently calls `apply_snapshot`/`apply_update` directly. For this phase, scope replay out — gate it behind a `cfg(feature = "replay")` or mark it `unimplemented!()` with a TODO. It's not on the hot path and can be retargeted later to feed the runtime instead of the render state.

Files touched:
- `game_library/src/domain/mod.rs` (drop plugin, reorder schedule).
- `game_library/src/domain/simulation.rs` (large deletions).
- `game_library/src/domain/runtime_bridge.rs` (populate `RenderEntityData` from entity patches; wire `chunk_edge` and streaming state from `RuntimeViewportIntentState`).
- `game_library/src/domain/runtime_cache.rs` (minor tidy).

Verification: **this is the payoff phase.**
- Native: move around for 30s. Confirm the `Tilemap rebuild slow:` warning is gone. Inspect `.perf_sessions/native/*/long.txt`: `frame_ms p95` should drop meaningfully; `patch_apply_ms p95` should be single-digit ms; per-move dirty-chunk count should reflect a small ring (≤ ~8 chunks for movement + FOV ring), not 474.
- Web `/?perf`: move around; main thread should stay responsive; `worker_sim_ms` visible in telemetry; report overfetch factor at 1.0 (no pressure).
- Compare `short_report` before/after the flip.

### Phase 5: Delete dead code and retire the cutover flag

- Remove `CutoverFlag`; keep only the patch-driven path.
- Delete dead imports in `simulation.rs`; shrink that file dramatically (expected to go from ~1800 lines to ~400).
- Drop `world_runtime`'s dep on `world_sim` iff we've moved the tile builders to `world_tiles` and the runtime only needs `WorldState` through a thin interface. (May still need `world_sim` for `WorldState` itself — that's fine; the concern is that the main `game_library` crate no longer needs `world_sim` as a runtime dep at all once the main-thread sim is gone.)
- Update `WORLD_RUNTIME_PERFORMANCE_PLAN.md` — mark Phase 5 and 9 actually done, with honest notes on what shipped.

Verification: `cargo check` + `cargo clippy` both targets, clean. Run the game; sanity check.

## Critical files to modify

- `game_library/world_tiles/**` — new crate (Phase 1).
- `game_library/world_sim/src/world_core.rs` — dirty sets + chunk accessors (Phase 1).
- `game_library/world_runtime/src/runtime_handle.rs` — per-chunk patch emission (Phase 2).
- `game_library/src/domain/render_patches.rs` — patch consumer (Phase 3, new).
- `game_library/src/domain/mod.rs` — schedule surgery (Phases 3, 4).
- `game_library/src/domain/simulation.rs` — big deletions (Phases 4, 5).
- `game_library/src/domain/runtime_bridge.rs` — entity-state population (Phase 4).

## Reusable pieces

- `world_tiles` builders = exact moves of `build_chunk_tile_data`, `build_edge_shadow_tile_data`, `build_ceiling_shadow_tile_data`, `build_fog_tile_data` (`simulation.rs:500..539` and callees). No semantic change.
- `RuntimePatchApplyQueue::drain_ordered_by_camera` (already in `runtime_cache.rs:60`) is already the right drain shape for Phase 3's consumer.
- `ChunkLayerCacheMap::apply_patch` already coalesces by revision — no protocol change needed.
- `RuntimeBackpressureState` already scales `desired_bounds` radius by pressure — Phase 2's chunk enumeration uses that scaled radius, so backpressure becomes meaningful.

## Verification end-to-end

After Phase 4 lands:

1. **Native**: `cargo run --bin open_dwarf_native` (or the project's usual entry). Move the player for ~30 seconds, change view_z, toggle a layer, change view mode. Watch `stderr`: the `Tilemap rebuild slow` warning must not appear. Open `.perf_sessions/native/<latest>/long.txt`: `frame_ms p95` should be < 5 ms at rest, < 16 ms under movement; `hot_chunks` roughly matches visible chunks; `dropped_superseded` and `coalesced` should show nonzero activity under rapid movement.
2. **Web**: `deno task web-perf`, load `/?perf`, do the same movement. F1 telemetry should be live; copy Long Report. `worker_sim_ms p95` should be < 20 ms; main-thread `frame_ms p95` < 16 ms; `active_layers` reflects toggle state.
3. **Correctness**: visible terrain, FOV, entity positions, edge/ceiling shadows all match pre-cutover behavior. Checklist: move to a pillar (ceiling shadow above), move under an overhang (edge shadow below), toggle Fog (layer snapshot event visible in log), resync via a debug key (patch counts spike then settle).
4. **Unit check**: `cargo check --no-default-features --features native` and `cargo check --lib --no-default-features --features web --target wasm32-unknown-unknown` both clean.

## Known risks / deferred

- **Replay playback** is shelved during Phase 4. Re-enabling it requires routing replay events into the runtime (or the runtime into a replay mode). Not in scope here.
- **`chunk_edge` dynamic changes** during a session would currently break the renderer's entity keying. `WorldConfig.chunk_edge` is set once at start; we document the assumption and assert it.
- **FOV diffing** for `visibility_dirty_chunks` is new code; needs careful test with movement that reveals large areas. If diffing is slow, fall back to marking the FOV bounding box dirty (still a ring, not the world).
- **Tile-data payload size**: `chunk_edge²` `Option<TileData>` slots. If `TileData` is ~3 bytes and `chunk_edge=16`, payload is ~1 KB bincode — well below the current whole-world serialization. If `chunk_edge` is 32, ~4 KB. Budget OK.
