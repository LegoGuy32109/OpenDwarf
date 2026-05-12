# Tilemap Viewport Rework Plan

## Context

The current tile render pipeline rebuilds **every chunk in the streaming window
across every visible z-level and every layer** on every player movement. The
warn `Tilemap rebuild slow: ~32ms across 475 chunks` fires each tick because:

- `apply_snapshot` recomputes FOV visibility every move → sets
  `fog.dirty = true` and `terrain.dirty = true`
- `project_world_to_tilemap` treats the dirty bits as global flags and loops
  over `active_chunks_xy` (streaming window) × all rendered z-levels × all
  layers

This plan rewrites the pipeline so work scope is bounded by **what the camera
can see** instead of what's loaded. Streaming becomes viewport-aware
(rectangular, not radial). Master mode skips visibility processing entirely.
Replay benefits automatically.

All file paths are relative to repo root. The main pipeline lives in
`game_library/src/domain/simulation.rs` (despite the name — it's render
projection, not simulation).

## Architectural shape

Three new resources replace today's coarse dirty bits:

1. **`RenderViewport`** — what the camera can see. Computed each frame from
   camera transform + projection + view state. Has
   `visible_chunks_xy: HashSet<IVec2>`, `visible_z_levels: Vec<i32>`,
   `viewport_changed: bool`, `newly_visible_chunks_xy: HashSet<IVec2>`.

2. **`TilemapInvalidation`** — precise per-chunk-layer-z dirty set. Has
   `dirty: HashSet<(IVec2, i32, TileLayer)>` and `view_invalidated: bool`.
   Persists across frames so off-viewport stale chunks rebuild on re-entry.

3. **`StreamingWindow`** (Phase 4) — viewport-derived rectangular streaming
   policy. Replaces `CHUNK_STREAM_RADIUS_XY/Z`.

The consumer (`project_world_to_tilemap`) does:

```
to_rebuild = if view_invalidated:
    visible_chunks × visible_z × enabled_layers
  else:
    invalidation.dirty ∩ (visible_chunks × visible_z)
+ newly_visible_chunks (all layers)
```

That's it. Rebuild only what's both stale and visible. Off-viewport dirty
entries persist until the camera reaches them.

## Constraints

- **WASM single-threaded.** Do not add `par_iter_mut` or rayon. Optimize for
  sequential.
- **Bevy-WASM client only.** This plan touches the render-projection pipeline in
  the Bevy app. The future `world_sim` server split is irrelevant here.
- **Each phase is one PR.** Phases ship independently. The user validates perf +
  UI after each phase before the next starts.
- **Do not rename `simulation.rs`.** It's misnamed but renaming = noise.
- **Do not introduce parallel anything.**

## Out of scope

- Parallel iteration.
- Sim-server FOV gating.
- File renames.
- Per-chunk content hashing.
- Phase 7 (lifecycle/build split) — listed at the end but deferred unless
  something forces it.

---

## Phase 1 — `RenderViewport` resource (scaffolding)

### Goal

Single source of truth for what the camera sees. Nothing reads it yet.

### Files to touch

- **New:** `game_library/src/resources/render_viewport.rs`
- `game_library/src/resources/mod.rs` — add `pub mod render_viewport;` and
  re-export
- The system registration site (search for where `ViewZLevel` / `ViewMode`
  resources are inserted, e.g. `setup_simulation_state` or a plugin builder) —
  insert `RenderViewport::default()` and register `update_render_viewport` in
  `PreUpdate` **before** any render pipeline systems

### Resource shape

```rust
#[derive(Resource, Default, Clone)]
pub struct RenderViewport {
    pub visible_chunks_xy: HashSet<IVec2>,
    pub visible_z_levels: Vec<i32>,
    pub view_mode: ViewMode,
    pub viewport_changed: bool,
    pub newly_visible_chunks_xy: HashSet<IVec2>,
    last_visible_chunks_xy: HashSet<IVec2>,
    last_visible_z_levels: Vec<i32>,
    last_view_mode: ViewMode,
}
```

### Computation

Read these inputs:

- `Query<(&Camera2d, &Transform, &Projection)>` for camera AABB
- `Res<ViewZLevel>` for current z
- `Res<ViewMode>`
- `Res<TileLayerDebugState>` for `show_depth_stack`
- `Res<TerrainConfig>` for `chunk_edge`

Steps:

1. Get the orthographic projection's world-space rect from
   `OrthographicProjection::area` (this accounts for zoom). Add camera position.
   Expand by **1 chunk of padding** on every side.
2. Convert rect corners to chunk-XY coordinates using
   `chunk_edge * f32::from(TILE_SIZE_IN_PX)`. Build the `HashSet<IVec2>` of all
   chunks the rect overlaps.
3. Z-levels: if `tile_layer_debug_state.show_depth_stack` then
   `z_levels_to_render(view_z.current)` (helper exists at `simulation.rs:465`),
   else `vec![view_z.current]`. Move that helper into `RenderViewport` impl or
   keep it where it is and call it.
4. Diff against `last_*` snapshots:
   - `viewport_changed = visible_chunks_xy != last_visible_chunks_xy
     || visible_z_levels != last_visible_z_levels
     || view_mode != last_view_mode`
   - `newly_visible_chunks_xy = &visible_chunks_xy - &last_visible_chunks_xy`
5. Update the `last_*` snapshots at end of system.

### Validation gate

- Add a temporary debug `info!` printing `visible_chunks_xy.len()` and bounds
  when `viewport_changed`.
- Run game. Default zoom Entity mode: ~9–16 chunks. Master mode: similar at
  default zoom, scales up at lower zoom. Wide-aspect window: chunk count higher
  on the wide axis.
- Pan camera: `viewport_changed` fires; `newly_visible_chunks_xy` non-empty in
  the pan direction.
- No frame time change — nothing reads the resource yet.
- Remove the debug `info!` before merging.

### Estimated diff

~140 lines.

### Don'ts

- Don't read this resource anywhere else yet.
- Don't change rendering behavior.
- Don't touch streaming policy.

---

## Phase 2 — `TilemapInvalidation` scaffolding + master-mode visibility gate

### Goal

Add precise invalidation tracking alongside the existing `TerrainData.dirty` /
`FogData.dirty` bools. Producers double-write so the consumer can flip safely in
Phase 3. Stop processing visibility data in Master mode (saves work in
`apply_snapshot`).

### Files to touch

- **New:** `game_library/src/domain/tilemap_invalidation.rs`
- `game_library/src/domain/mod.rs` — add `pub mod tilemap_invalidation;`
- `game_library/src/domain/simulation.rs` — at every `terrain.dirty = true` and
  `fog.dirty = true` site, also call invalidation helpers; gate visibility
  processing in `apply_snapshot` on `ViewMode::Entity`

### Resource shape

```rust
#[derive(Resource, Default)]
pub struct TilemapInvalidation {
    dirty: HashSet<(IVec2, i32, TileLayer)>,
    view_invalidated: bool,
}

impl TilemapInvalidation {
    pub fn mark(&mut self, chunk_xy: IVec2, z: i32, layer: TileLayer);
    pub fn mark_all_layers_at(&mut self, chunk_xy: IVec2, z: i32, /* layer flags */);
    pub fn mark_all_visible_layers(&mut self, viewport: &RenderViewport, layers: &TileLayerDebugState);
    pub fn invalidate_view(&mut self);
    pub fn is_empty(&self) -> bool;
    pub fn drain_visible_into(&mut self, viewport: &RenderViewport, out: &mut HashSet<(IVec2, i32, TileLayer)>);
    pub fn view_invalidated(&self) -> bool;
    pub fn clear_view_invalidated(&mut self);
}
```

`mark_all_visible_layers` enumerates
`viewport.visible_chunks_xy × viewport.visible_z_levels × enabled_layers`
filtered by `TileLayerDebugState`. Same scope as today's "global rebuild," so
the consumer behaves identically when this is called.

### Producer touch sites

Search `simulation.rs` for all `terrain.dirty = true` and `fog.dirty = true` (or
`fog_data.dirty = true`) writes. Current locations (verify with grep — line
numbers may shift):

| Site                                                               | Action                                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `toggle_tile_layers` ~239                                          | also `invalidation.invalidate_view()`                                               |
| `update_view_z_level` ~1355, ~1360, ~1367                          | also `invalidation.invalidate_view()`                                               |
| `apply_snapshot` ~1461, ~1468, ~1470                               | also `invalidation.mark_all_visible_layers(&viewport, &layers)`                     |
| `apply_update` Delta block_changes ~1517                           | also `invalidation.mark_all_visible_layers(...)` (precise marking comes in Phase 5) |
| `stream_chunks_around_player` ~1240                                | also `invalidation.mark_all_visible_layers(...)`                                    |
| `sync_camera_z_to_player` ~1263, ~1270                             | also `invalidation.invalidate_view()`                                               |
| `drive_replay_playback` ~388                                       | also `invalidation.mark_all_visible_layers(...)`                                    |
| `project_world_to_tilemap` view_z/mode/debug `is_changed` ~508–522 | also `invalidation.invalidate_view()`                                               |

Add `Res<RenderViewport>` and `Res<TileLayerDebugState>` to system signatures
where needed.

**Rule:** if the existing trigger represents a view-level change (z-level, mode,
debug toggle) → `invalidate_view()`. Otherwise → `mark_all_visible_layers`.

### Master-mode visibility gate

In `apply_snapshot` (currently around lines 1453–1472), wrap the
visibility-handling branch:

```rust
if view_mode == ViewMode::Entity {
    let visibility_snapshot = snapshot.visibility.as_ref();
    let mut visibility_changed = false;
    if let Some(vis) = visibility_snapshot {
        let new_visible: HashSet<Vec3i> = vis.visible.iter().copied().collect();
        visibility_changed = fog.visible != new_visible || fog.memory != vis.memory;
        if visibility_changed {
            fog.visible = new_visible;
            fog.memory = vis.memory.clone();
            fog.dirty = true;
            // also invalidation.mark_all_visible_layers(...)
        }
    }
    if terrain_changed || visibility_changed {
        terrain.blocks =
            build_render_terrain_blocks(terrain.source_blocks.as_ref(), visibility_snapshot);
        terrain.dirty = true;
        // also invalidation.mark_all_visible_layers(...)
    }
} else {
    // Master mode: skip visibility delta + terrain.blocks rebuild.
    // Master uses source_blocks directly; fog is not rendered.
    // Do NOT compare or clone fog.visible / fog.memory.
    if terrain_changed {
        terrain.dirty = true;
        // also invalidation.mark_all_visible_layers(...)
    }
}
```

This means in Master mode, `apply_snapshot` no longer touches `fog.visible`,
`fog.memory`, or rebuilds `terrain.blocks`. Pure save.

### Validation gate

- Add a debug-build assert at the top of `project_world_to_tilemap`:
  `debug_assert_eq!(invalidation.is_empty() && !invalidation.view_invalidated(), !terrain.dirty && !fog.dirty);`
  Catches missed producer sites.
- Run game in Entity mode: behavior identical to before. Warn still fires (Phase
  3 fixes that). Tests pass.
- Run game in Master mode: behavior identical visually. Frame profiler shows
  `apply_snapshot` no longer in `clone`/`HashMap` rebuild work.
- Run scenario regression: `cargo test -p game_library --lib` (or however tests
  are run; check `mise.toml` / scripts).
- Tests in `game_library/world_sim/tests/` should also pass.

### Estimated diff

~180 lines.

### Don'ts

- Don't change consumer behavior. Producers double-write only.
- Don't rip out the debug assert until Phase 6.
- Don't add `mark_all_visible_layers` calls where there isn't already a matching
  `dirty = true`. The mapping is 1:1 in this phase.
- Don't precision-mark in this phase. Even block changes call
  `mark_all_visible_layers`. Phase 5 makes that precise.

---

## Phase 3 — Viewport-bounded render (the perf cliff)

### Goal

`project_world_to_tilemap` rebuilds only viewport chunks. The
`Tilemap rebuild slow` warn dies. Replay benefits automatically.

### Files to touch

- `game_library/src/domain/simulation.rs` — `project_world_to_tilemap` only
  (~lines 481–899). Plus `draw_depth_labels` (~line 901) for the same viewport
  bounding.

### Changes inside `project_world_to_tilemap`

Add `Res<RenderViewport>` and `ResMut<TilemapInvalidation>` to the system
signature.

1. **Early-return check.** Replace
   `if !terrain.dirty && !fog_data.dirty { return; }` with
   ```rust
   if invalidation.is_empty()
       && !invalidation.view_invalidated()
       && !viewport.viewport_changed {
       return;
   }
   ```
2. **Lifecycle stays as-is for now.** The spawn loop still iterates
   `active_chunks_xy` (streaming window). Off-viewport entities continue to
   exist with stale data — Bevy's renderer culls them. **Don't change
   spawn/despawn iteration in this phase.** Phase 4 reshapes streaming.
3. **Build scope shrinks.** Compute the rebuild set:
   ```rust
   let mut to_rebuild: HashSet<(IVec2, i32, TileLayer)> = HashSet::new();
   if invalidation.view_invalidated() {
       // all visible chunks × layers
       for &chunk_xy in &viewport.visible_chunks_xy {
           for &z in &viewport.visible_z_levels {
               if render_floor { to_rebuild.insert((chunk_xy, z, TileLayer::Floor)); }
               if render_edge_shadow { to_rebuild.insert((chunk_xy, z, TileLayer::EdgeShadow)); }
               if render_ceiling_shadow && z == view_z.current {
                   to_rebuild.insert((chunk_xy, z, TileLayer::CeilingShadow));
               }
               if render_fog_shadow { to_rebuild.insert((chunk_xy, z, TileLayer::FogShadow)); }
           }
       }
   } else {
       invalidation.drain_visible_into(&viewport, &mut to_rebuild);
   }
   // Newly-visible chunks (entered viewport this frame): mark all layers.
   if viewport.viewport_changed {
       for &chunk_xy in &viewport.newly_visible_chunks_xy {
           for &z in &viewport.visible_z_levels {
               // same enabled_layers logic
           }
       }
   }
   ```
4. **Spawn loop (~lines 570–754).** Inside each
   `if !existing_chunks.contains(...)` block, only do the per-tile build
   (`build_chunk_tile_data`, `build_edge_shadow_tile_data`, etc.) when
   `to_rebuild.contains(&key)`. **Always spawn the entity** when missing — but
   if not in `to_rebuild`, spawn with empty `TilemapChunkTileData` (an
   all-`None` Vec of correct length). The chunk will fill in next time it's
   marked dirty.
5. **Update loop (~line 790).** After the existing `layer_needs_update` check,
   add:
   ```rust
   if !to_rebuild.contains(&(world_chunk.chunk_xy, world_chunk.world_z, world_chunk.layer)) {
       continue;
   }
   ```
6. **Drain on rebuild.** As you rebuild a chunk, remove its key from
   `invalidation.dirty` (or do this in bulk after the loop using the
   `drain_visible_into` API).
7. **Clear flags at end.** `invalidation.clear_view_invalidated()`. Keep
   `terrain.dirty = false` and `fog_data.dirty = false` — old flags still
   maintained until Phase 6.

### Changes inside `draw_depth_labels`

Replace `active_chunks_xy(...)` (~line 944) with iteration over
`viewport.visible_chunks_xy`. The depth labels system also gets bounded to
viewport.

### Boundary correctness note

EdgeShadow and CeilingShadow read `wp + 1` in x/y. A chunk's east/north boundary
depends on the next chunk over. Because `terrain.blocks` is a global HashMap
(and Phase 4 ensures the next chunk is loaded via streaming margin), boundary
correctness is independent of which chunks rebuild. **No special handling needed
in this phase.**

### Validation gate

- **Single-tile move in Entity mode:** `last_rebuild_micros` drops from ~32 ms
  to <3 ms. The `Tilemap rebuild slow` warn does not fire.
- **Held movement:** no warn at any point during a long traversal.
- **Z-level toggle (`Z`/`X` or whatever the keys are):** `to_rebuild` size ≈
  visible_chunks × visible_z × enabled_layers. Time scales with zoom, not
  streaming radius.
- **Fast camera pan, especially Master mode at low zoom:** chunks appear filled
  as they enter viewport. No 1-frame flicker. If flicker occurs → bump Phase 1
  viewport padding from 1 → 2 chunks.
- **View-mode toggle Master ↔ Entity:** correct in one frame.
- **Replay mode:** scrubbing through events does not hitch. Open a large replay
  to test.
- **All regression tests pass** (`scenario_regression`,
  `sim_diagnostics_regression`).
- **Frame time profile** in Entity mode at default zoom:
  `project_world_to_tilemap` should be <1 ms in steady state, <3 ms on movement.

### Estimated diff

~100 lines net.

### Don'ts

- Don't change spawn/despawn iteration (still streaming-window). Phase 4.
- Don't change producer behavior. Phase 5.
- Don't precision-mark anything new here.
- Don't delete `terrain.dirty` / `fog.dirty`. Phase 6.

---

## Phase 4 — Viewport-aware streaming policy

### Goal

Streaming follows viewport shape (rectangular AABB) instead of a radius.
Wide-aspect screens stop wasting top/bottom rows and stop missing right-side
columns. Replaces `CHUNK_STREAM_RADIUS_XY/Z`.

### Files to touch

- `game_library/src/domain/simulation.rs` — `stream_chunks_around_player`,
  `chunk_window`, `CHUNK_STREAM_RADIUS_XY`, `CHUNK_STREAM_RADIUS_Z`.

### New policy

```rust
struct StreamingWindow {
    chunks_xy: HashSet<IVec2>,
    z_min: i32,
    z_max: i32,
}

fn desired_streaming_window(
    viewport: &RenderViewport,
    world_chunks: Vec3u,
) -> StreamingWindow {
    // visible_chunks_xy already includes 1-chunk padding from Phase 1.
    // For streaming we want the same set, possibly + 1 more chunk margin.
    let chunks_xy: HashSet<IVec2> = viewport.visible_chunks_xy.clone();

    let z_min = viewport.visible_z_levels.iter().min().copied().unwrap_or(0) - 1;
    let z_max = viewport.visible_z_levels.iter().max().copied().unwrap_or(0) + 1;

    // Clamp to world bounds using world_chunks.
    StreamingWindow { chunks_xy, z_min, z_max }
}
```

Z range extends `±1` because:

- EdgeShadow needs `z - 1` neighbor for `has_edge_above` check
- CeilingShadow at `z` reads `z + 1` for ceiling input

### Rewrite `stream_chunks_around_player`

Rename to `stream_chunks_for_viewport` (or keep the old name; not critical).
Replace radius computation with `desired_streaming_window`. Read
`Res<RenderViewport>` instead of computing chunk_window from player position.

Diff logic stays the same:

```rust
let desired = desired_streaming_window(&viewport, config.world_chunks);
// Convert to HashSet<Vec3i> matching today's loaded_chunks shape.
let desired_3d: HashSet<Vec3i> = desired.chunks_xy.iter()
    .flat_map(|xy| (desired.z_min..=desired.z_max).map(move |z| Vec3i::new(xy.x, xy.y, z)))
    .collect();

// Existing diff:
for chunk in desired_3d.difference(&chunk_streaming_state.loaded_chunks) {
    world_command_queue.set_chunk_loaded(*chunk, true);
}
let to_unload: Vec<Vec3i> = chunk_streaming_state.loaded_chunks
    .difference(&desired_3d).copied().collect();
for &chunk in &to_unload { world_command_queue.set_chunk_loaded(chunk, false); }
```

**Mark `invalidation.invalidate_view()` only when _new chunks load_** (at least
one entry in `desired - loaded`). Unload-only deltas do not need a render
rebuild.

### Delete

- `CHUNK_STREAM_RADIUS_XY` constant
- `CHUNK_STREAM_RADIUS_Z` constant
- `chunk_window` helper if no longer used (check usages — it may be used
  elsewhere; if so, leave it but mark unused)

### Replay mode

Replay loads the entire world at startup and doesn't stream. **Skip this phase
for replay** — it has no effect on replay rendering because Phase 3 already
bounds replay render to viewport. No replay-specific code changes needed.

### Validation gate

- **Resize window to ultra-wide aspect:** streaming covers full visible width.
  Pan to right edge: no missing right-edge chunks.
- **Resize to tall portrait:** streaming covers full height. Pan to top: no
  missing rows.
- **Zoom out in Master mode:** streaming window grows. Zoom back in: shrinks. No
  "missing tile" gaps at any zoom transition.
- **Player movement at default zoom:** behavior matches today (window ~5×5
  around player, since viewport is ~5×5 + margin).
- **Sim diagnostics** (`world_sim_diagnostics.loaded_chunk_count`) reflects new
  policy. Should be approximately
  `viewport.visible_chunks_xy.len() * (z_max - z_min + 1)`.
- **Movement frame time:** unchanged or slightly better.
- **Tests pass.**

### Estimated diff

~120 lines.

### Don'ts

- Don't try to make replay use streaming.
- Don't make viewport ⊃ streaming. Streaming should always ⊇ viewport (with ≥1
  chunk margin) for boundary correctness.
- Don't trigger `invalidate_view` on unload-only deltas.

---

## Phase 5 — Precise producers

### Goal

Producers mark only chunks that actually changed. Movement rebuild drops from
"all visible" to "FOV-affected ∩ visible" (≤ ~20 chunks). Mining drops to 1–4
chunks.

### Files to touch

- `game_library/src/domain/simulation.rs` — `apply_update` Delta path,
  `apply_snapshot` Entity branch.
- `game_library/src/domain/tilemap_invalidation.rs` — add `mark_block_change`
  helper.

Split into three sub-commits **in this order**.

### 5a — Block-change precision

In `tilemap_invalidation.rs`, add:

```rust
impl TilemapInvalidation {
    /// Mark all chunks affected by a block change at world position `p`.
    /// Accounts for boundary tiles where edge/ceiling shadows read +1 in x/y.
    pub fn mark_block_change(
        &mut self,
        p: Vec3i,
        chunk_edge: u32,
        view_mode: ViewMode,
        layers: &TileLayerDebugState,
    ) {
        let c = chunk_of_xy(p, chunk_edge);
        self.mark_layers_for_chunk_z(c, p.z, view_mode, layers);

        // EdgeShadow/CeilingShadow at p.z - 1 also depend on p (has_edge_above
        // reads z+1 from below, ceiling reads z+1 from below).
        self.mark_layers_for_chunk_z(c, p.z - 1, view_mode, layers);

        // Boundary: if any neighbor (±1 x/y) falls in a different chunk,
        // also mark that chunk for the same z-set.
        for (dx, dy) in [(1,0), (-1,0), (0,1), (0,-1), (1,1), (1,-1), (-1,1), (-1,-1)] {
            let neighbor = Vec3i::new(p.x + dx, p.y + dy, p.z);
            let nc = chunk_of_xy(neighbor, chunk_edge);
            if nc != c {
                self.mark_layers_for_chunk_z(nc, p.z, view_mode, layers);
                self.mark_layers_for_chunk_z(nc, p.z - 1, view_mode, layers);
            }
        }
    }

    fn mark_layers_for_chunk_z(
        &mut self,
        c: IVec2, z: i32,
        view_mode: ViewMode,
        layers: &TileLayerDebugState,
    ) {
        if layers.show_floor { self.mark(c, z, TileLayer::Floor); }
        if layers.show_edge_shadow { self.mark(c, z, TileLayer::EdgeShadow); }
        if layers.show_ceiling_shadow { self.mark(c, z, TileLayer::CeilingShadow); }
        if view_mode == ViewMode::Entity && layers.show_fog_shadow {
            self.mark(c, z, TileLayer::FogShadow);
        }
    }
}

fn chunk_of_xy(p: Vec3i, chunk_edge: u32) -> IVec2 {
    let edge = i32::try_from(chunk_edge).expect("chunk_edge fits in i32");
    let half = edge / 2;
    // Chunks are centered: world x ∈ [chunk_x*edge - half, chunk_x*edge - half + edge).
    // Inverse: chunk_x = floor((p.x + half) / edge).
    IVec2::new(
        (p.x + half).div_euclid(edge),
        (p.y + half).div_euclid(edge),
    )
}
```

**Verify `chunk_of_xy` against `world_pos_in_chunk`** (`simulation.rs:1678`) —
they must be inverses. Add a unit test in `tilemap_invalidation.rs` that
round-trips a few positions through both.

In `apply_update` Delta path (~line 1503), for each `change` in
`delta.block_changes`, call
`invalidation.mark_block_change(change.position, config.chunk_edge, view_mode, &layers)`.
Replace the existing `mark_all_visible_layers` call from Phase 2.

### 5b — Visibility delta (Entity mode only)

In `apply_snapshot`, replace the wholesale
`terrain.blocks =
build_render_terrain_blocks(...)` (~line 1466) with a delta:

```rust
// Only inside the ViewMode::Entity branch.
let prev_visible = std::mem::take(&mut fog.visible);
let prev_memory = std::mem::take(&mut fog.memory);

let new_visible: HashSet<Vec3i> = vis.visible.iter().copied().collect();
let new_memory = vis.memory.clone();

// Positions added (became visible or memory'd).
let prev_keys: HashSet<&Vec3i> = prev_visible.iter().chain(prev_memory.keys()).collect();
let new_keys: HashSet<&Vec3i> = new_visible.iter().chain(new_memory.keys()).collect();

let added: Vec<Vec3i> = new_keys.difference(&prev_keys).map(|p| **p).collect();
let removed: Vec<Vec3i> = prev_keys.difference(&new_keys).map(|p| **p).collect();

// Block-changed: position present in both, but memory[p].block differs.
let block_changed: Vec<Vec3i> = new_memory.iter()
    .filter(|(p, m)| prev_memory.get(p).map_or(false, |pm| pm.block != m.block))
    .map(|(p, _)| *p).collect();

for p in added.iter().chain(block_changed.iter()) {
    let block = terrain.source_blocks.get(p).copied()
        .unwrap_or_else(|| new_memory.get(p).map(|m| m.block).unwrap_or(BlockType::Air));
    terrain.blocks.insert(*p, block);
    invalidation.mark_block_change(*p, config.chunk_edge, ViewMode::Entity, &layers);
}
for p in &removed {
    terrain.blocks.remove(p);
    invalidation.mark_block_change(*p, config.chunk_edge, ViewMode::Entity, &layers);
}

fog.visible = new_visible;
fog.memory = new_memory;
fog.dirty = true; // keep until Phase 6
```

Master mode branch is unchanged from Phase 2.

### 5c — View changes stay coarse

`update_view_z_level`, `view_mode` change, and `tile_layer_debug` change keep
using `invalidate_view()`. Correct semantics; no precision benefit because every
visible chunk's depth tint changes when z-level changes.

Phase 2 already wired these as `invalidate_view()`. **Don't change them.**

### Validation gate

- **Entity mode single-tile move:** `to_rebuild.len() ≤ ~20`. Movement rebuild
  micros < 1 ms.
- **Mine a single block:** `to_rebuild.len() ≤ 8` (1 chunk × 4 layers
  - boundary chunks if mined block is on an edge).
- **Boundary mining test:** mine a block exactly at the chunk edge. Verify
  shadows on the neighboring chunk update correctly (no stale shadow geometry).
- **Pan camera to unexplored area in Entity mode:** chunks fill in correctly via
  Phase 3's newly-visible mechanism. Phase 5 doesn't break this.
- **Mode switch Master ↔ Entity:** `invalidate_view` path; correct in one frame.
- **Run scenario_regression, sim_diagnostics_regression.** Pass.
- **Long-running play test:** 5+ minutes of movement and mining. No warns.
  Profile shows tilemap rebuild as a thin sliver.

### Estimated diff

~280 lines. Most subtle PR. Budget review time.

### Don'ts

- Don't skip the boundary-chunk marking in `mark_block_change`. It's the
  most-likely-to-be-wrong piece. Test it.
- Don't rebuild `terrain.blocks` from scratch even on first snapshot — the
  initial `apply_snapshot` should populate it incrementally too (treat the empty
  prev state as `prev_visible/memory = {}`).
- Don't precision-mark in Master mode. Master uses `terrain.source_blocks`
  directly; visibility deltas don't apply.

---

## Phase 6 — Delete `TerrainData.dirty` / `FogData.dirty`

### Goal

Cleanup. Single source of truth.

### Changes

- Remove `pub dirty: bool` from `TerrainData` and `FogData` structs
  (`simulation.rs:67`, `simulation.rs:97`).
- Remove all `terrain.dirty = true`, `terrain.dirty = false`,
  `fog.dirty = true`, `fog.dirty = false`, `fog_data.dirty = ...` writes.
- Remove the debug assert added in Phase 2.
- Remove the early-return reads of these flags (already replaced by invalidation
  reads in Phase 3).

### Validation gate

- `cargo build` clean.
- All tests pass.
- Full play session in both modes: behavior identical to end of Phase 5.
- Replay scrub.

### Estimated diff

~60 lines (mostly removals).

### Don'ts

- Don't merge if any `terrain.dirty` reference remains (grep for it).
- Don't change behavior in this PR. Pure cleanup.

---

## Phase 7 — Lifecycle / build split (deferred, optional)

### Goal

Separate `manage_tilemap_chunk_lifecycle` (spawn/despawn `TilemapChunk`
entities) from `project_world_to_tilemap` (rebuild tile data). Streaming policy
and viewport policy become formally independent in code.

### Changes (sketch)

- New system `manage_tilemap_chunk_lifecycle` runs in `Update` before
  `project_world_to_tilemap`.
- It iterates `(streaming_window × rendered_z_levels × enabled_layers)` and
  spawns missing `TilemapChunk` entities with empty `TilemapChunkTileData`.
  Despawns entities outside the window or with disabled layers.
- New chunks get inserted into `invalidation.dirty` so the build pass fills
  them.
- `project_world_to_tilemap` no longer spawns or despawns. Pure build.

### When to do this

Defer unless something forces it. Phases 1–6 already deliver the perf and
correctness payoff. Track on backlog only.

---

## Reference: today's hot paths

(For agents who need to ground themselves in the current code.)

- `simulation.rs:481` — `project_world_to_tilemap` (the main rebuild)
- `simulation.rs:1702` — `build_chunk_tile_data` (Floor)
- `simulation.rs:1793` — `build_edge_shadow_tile_data`
- `simulation.rs:1856` — `build_ceiling_shadow_tile_data`
- `simulation.rs:1918` — `build_fog_tile_data`
- `simulation.rs:1418` — `apply_snapshot` (visibility delta lives here)
- `simulation.rs:1475` — `apply_update` (block-change Delta lives here)
- `simulation.rs:1161` — `stream_chunks_around_player` (radius streaming)
- `simulation.rs:24–26` — streaming radius constants
- `simulation.rs:434` — `active_chunks_xy` (replaced by viewport reads)
- `simulation.rs:465` — `z_levels_to_render` (helper used by viewport)
- `world_sim/src/fov.rs:7` — `compute_fov` (sim-side; out of scope)

The warn message lives at `simulation.rs:884–891`. After Phase 3 it should
rarely if ever fire. Leave the warn in place — it's a useful canary if a future
change regresses scope.
