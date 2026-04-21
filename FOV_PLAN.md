# FOV Implementation Plan

## Goals

Implement two distinct view modes:

- **Master mode** — the current renderer, all tiles in a z level visible, can
  navigate all z-levels, no fog. Used for development and "god view" navigation.
- **Entity mode** — observer-dependent visibility with FOV, three-state tile
  rendering, and spatial memory that persists across ticks. The player sees only
  what their entity can see or has previously seen.

All visibility computation lives in `world_sim` so it is authoritative, replayed
correctly, and can later be extended to NPCs and shared between clients.

---

## Phase 0 — Shadow Layer Rename

**Commit: "Rename shadow layers to edge/ceiling/fog naming scheme"**

Three distinct shadow concepts now have distinct names. Apply consistently
everywhere in the codebase.

| Old name                   | New name                   | What it renders                               |
| -------------------------- | -------------------------- | --------------------------------------------- |
| `TileLayer::ShadowOverlay` | `TileLayer::EdgeShadow`    | depth-drop bands at tile elevation boundaries |
| `TileLayer::CeilingShadow` | `TileLayer::CeilingShadow` | already correct — no change                   |
| _(new)_                    | `TileLayer::FogShadow`     | three-state exploration overlay               |

### Files to update

**`game_library/src/domain/simulation.rs`**

- `TileLayer::ShadowOverlay` → `TileLayer::EdgeShadow` (enum variant + all match
  arms)
- `build_shadow_tile_data` → `build_edge_shadow_tile_data`
- All variable names `shadow_key`, `shadow_data`, `shadow_sprite_z` → prefix
  with `edge_`
- Comments referencing "shadow overlay" → "edge shadow"

**`game_library/src/domain/visuals/mod.rs`**

- `ShadowAtlasAsset` → `EdgeShadowAtlas`
- `SHADOW_ATLAS_PATH` → `EDGE_SHADOW_ATLAS_PATH`
- `SHADOW_ATLAS_FRAMES` → `EDGE_SHADOW_ATLAS_FRAMES`
- `update_shadow_atlas_image` → `update_edge_shadow_atlas_image`
- `ObscureAtlasAsset` → `CeilingShadowAtlas`
- `OBSCURE_ATLAS_PATH` → `CEILING_SHADOW_ATLAS_PATH`
- `OBSCURE_ATLAS_FRAMES` → `CEILING_SHADOW_ATLAS_FRAMES`
- `update_obscure_atlas_image` → `update_ceiling_shadow_atlas_image`

**`game_library/src/domain/mod.rs`**

- Update all imports to match renamed functions and types above

---

## Phase 1 — Data Structures in `world_sim`

**Commit: "Add TileMemory, EntityFov, and VisibilitySnapshot to world_sim"**

### New types in `world_sim/src/world_api.rs`

```rust
/// What a given observer last saw at a specific position.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TileMemory {
    /// Block type at the time of observation.
    pub block: BlockType,
    /// Sim tick when this tile was last observed (for degradation).
    pub tick_observed: u64,
}

/// Visibility state of a single tile from one observer's perspective.
/// Used to drive the three-state render: visible / remembered / unknown.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TileVisibility {
    /// In the observer's current FOV. Render normally.
    Visible,
    /// Was seen before, no longer in FOV. Render with gray tint.
    Remembered(TileMemory),
    /// Never seen. Render as flat #383137.
    Unknown,
}
```

### New struct in `world_sim/src/world_api.rs`

```rust
/// Visibility snapshot for a single observer entity.
/// Included in WorldSnapshot so the render layer can drive the fog overlay
/// without recomputing FOV on the client.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VisibilitySnapshot {
    pub entity_id: u64,
    /// All positions currently in FOV. Positions absent from this set
    /// and absent from `memory` are Unknown.
    pub visible: Vec<Vec3i>,
    /// Remembered tiles (observed at least once, not currently visible).
    pub memory: HashMap<Vec3i, TileMemory>,
}
```

Extend `WorldSnapshot` with an optional observer payload:

```rust
pub struct WorldSnapshot {
    pub tick: u64,
    pub chunk_edge: u32,
    pub world_chunks: Vec3u,
    pub blocks: Vec<BlockType>,
    pub entities: Vec<EntitySnapshot>,
    /// Present in entity mode, absent in master mode.
    pub visibility: Option<VisibilitySnapshot>,
}
```

### New resource in `world_sim/src/world_core.rs`

```rust
/// Mutable FOV state for the primary observer. Recomputed on the sim tick
/// when the observer moves or nearby terrain changes.
pub struct EntityFov {
    pub entity_id: u64,
    pub visible: HashSet<Vec3i>,
    pub memory: HashMap<Vec3i, TileMemory>,
    pub dirty: bool,
}
```

`EntityFov` is stored as a field inside `WorldState` (not a Bevy resource
directly) so it is replayed correctly.

### Memory degradation

Memory grows as the player explores. To keep it bounded without a hard eviction
rule:

- When a chunk is **streamed out** of the active window, its tile memories are
  **pruned** from the in-memory `HashMap` and can optionally be serialized
  alongside the chunk to disk.
- On next visit the chunk is re-explored from scratch (tiles start as `Unknown`
  again until the player's FOV sweeps them).
- This means per-entity memory scales with the streaming window, not the full
  world size.

> Future: when cross-entity knowledge transfer is needed (e.g., a dwarf tells
> another about a location), copy the relevant `TileMemory` entries into the
> target entity's map with the original `tick_observed`. The receiver "knows"
> but with potentially stale data.

---

## Phase 2 — 3D Shadow Casting FOV

**Commit: "Implement 3D symmetric shadow casting in world_sim"**

### File: `world_sim/src/fov.rs` (new)

#### Visibility volume

The observable region is a hard-bounded cube centered on the entity:

- ±10 tiles in X and Y (21 wide)
- −5 to +5 tiles in Z (11 tall)

Tiles outside this cube are never visible regardless of terrain.

#### Algorithm overview

Symmetric shadow casting (Albert Ford's algorithm) extended to 3D.

The primary pass runs **per Z-slice**, iterating from `entity_z + 5` down to
`entity_z - 5`. For each slice, a modified 2D symmetric shadow cast is run, but
a candidate tile at `(x, y, z)` is only visible if the **vertical line of
sight** from the entity up or down to that Z-level is also unobstructed.

**Step 1 — vertical access map**

Before running per-slice shadow casting, compute which (x, y) columns are
vertically reachable from the entity's position:

```
vertical_open(x, y, z_target):
    For each z between entity_z and z_target (exclusive):
        if block_at(x, y, z) is SolidStone → column is closed
    return open
```

This means looking down into a pit is only possible through continuous open air
directly above the target tile, not around corners at the lower level.

**Step 2 — 2D shadow cast per slice**

For each Z-slice, run symmetric shadow casting across the 21×21 region, treating
tiles as opaque (`SolidStone`) or transparent (`Air`). A tile `(x, y, z_slice)`
is visible only if:

1. It passes the symmetric shadow cast in the 2D slice.
2. `vertical_open(x, y, z_slice)` is true.

**Diagonal occlusion rule**

A ray cannot pass through a diagonal gap where both orthogonal neighbors are
solid. This is the standard roguelike rule: to move from cell A to diagonal cell
B, the two cells sharing an edge with both A and B must not both be solid.

For 3D: the same rule applies to vertical diagonals. A ray cannot pass from
`(x, y, z)` to `(x+1, y, z+1)` if both `(x+1, y, z)` and `(x, y, z+1)` are
solid. This prevents vision up over ledge edges, matching the movement
restriction (see Phase 3).

**Same-level pass**

The entity's own z-level uses the standard 2D shadow cast without the vertical
access check.

#### Public API

```rust
/// Recomputes `fov.visible` for the given entity position.
/// Call once per sim tick when the entity has moved or nearby terrain changed.
pub fn compute_fov(
    fov: &mut EntityFov,
    position: Vec3i,
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
    current_tick: u64,
)
```

After `compute_fov`, any position previously in `fov.visible` that is now absent
gets its block type snapshotted into `fov.memory` with the current tick.

#### Invalidation conditions

Recompute FOV when:

- The observer's position changes.
- The observer's z-level changes.
- A block within the visibility cube changes (covered by Phase 6d delta wiring).

Use a dirty flag on `EntityFov`. Clear it after recomputation.

---

## Phase 3 — Diagonal Movement Blocking

**Commit: "Block movement through diagonal solid tiles"**

### File: `world_sim/src/world_core.rs`

In the movement validation function (wherever `start_entity_move_with_reason`
validates a proposed step), add a check for vertical diagonal moves:

A move from position `from` to position `to` where two axis of movement is
happening at the same time. For such a move, the two cells that "share edges"
with both `from` and `to` must not both be `SolidStone`.

Example: moving from `(x, y, z)` to `(x+1, y, z+1)`:

- Check `(x+1, y, z)` and `(x, y, z+1)`.
- If both are solid → reject the move with reason `BlockedByDiagonal`.

This mirrors the FOV rule and prevents the player clipping through ledge
geometry.

---

## Phase 4 — View Mode Resource

**Commit: "Add ViewMode resource, wire /master and /entity chat commands"**

### New file: `game_library/src/resources/view_mode.rs`

```rust
#[derive(Resource, Default, Clone, Copy, PartialEq, Eq)]
pub enum ViewMode {
    Master,
    #[default]
    Entity,
}
```

### Wire chat commands

In the chat command handler (wherever `/` commands are parsed from the T-chat
input), add:

- `/master` → sets `ViewMode::Master`, keep camera view at current z but use the
  existing render technique
- `/entity` → sets `ViewMode::Entity`, snaps view z to current entity, right now
  just the 'Player' represented by dwarf sprite

### Z-level clamping in entity mode

In `update_view_z_level` (or wherever R/V key input is processed), when
`ViewMode::Entity`:

- Compute `entity_z` from `RenderEntityData`.
- The view z floor is the lowest z-level where there is open vertical access the
  entity can see into
- The view z ceiling is the highest z-level where there is open vertical access
  from the entity's position (i.e., no solid floor directly between entity and
  that level).
- Clamp the player's requested z-level change within this dynamic range.

Transition behavior:

- `Entity → Master`: stay at current view z.
- `Master → Entity`: snap view z back to `entity_z`.

---

## Phase 5 — FOV Wiring in World Sim

**Commit: "Wire EntityFov into WorldState tick and snapshot path"**

### `world_sim/src/world_core.rs`

- Add `entity_fov: Option<EntityFov>` to `WorldState`.
- After each tick that moves the primary entity, call `compute_fov(...)`.
- In `snapshot()`, if `entity_fov` is present, populate
  `WorldSnapshot::visibility`.
- In `apply_command` / `force_advance_ticks`, mark `entity_fov.dirty = true`
  when the entity moves.
- When block changes from a delta are applied (Phase 6d from prior work), if the
  changed position is within the entity's visibility cube, mark
  `entity_fov.dirty = true`.

### Snapshot path

`VisibilitySnapshot::visible` is a `Vec<Vec3i>` of all currently lit positions.
The render layer consults this to decide between the three tile states. The full
`memory` map is only sent on the initial snapshot; subsequent deltas carry only
changes to it.

> Future: when multiplayer is extended, each connected player gets its own
> `EntityFov` keyed by their entity id, and visibility is sent per-client.

---

## Phase 6 — Render: Three-State Fog Overlay

**Commit: "Add FogShadow tile layer, three-state visibility rendering in entity
mode"**

### New render data

In `game_library/src/domain/simulation.rs`, add to `RenderEntityData` (or
parallel resource):

```rust
pub struct FogData {
    pub visible: HashSet<Vec3i>,
    pub memory: HashMap<Vec3i, TileMemory>,
    pub dirty: bool,
}
```

Populated from `WorldSnapshot::visibility` in `apply_snapshot` / `apply_update`.

### `TileLayer::FogShadow`

A new fourth layer rendered above the floor and edge shadow passes. The atlas
for this layer is a solid white full-tile sprite (one frame). Color tinting
drives all three states:

| State      | Color                                                     |
| ---------- | --------------------------------------------------------- |
| Visible    | `Color::NONE` (transparent, no tile spawned)              |
| Remembered | `Color::srgba(0.7, 0.7, 0.75, 0.55)` — grayish white tint |
| Unknown    | `Color::srgba(0.22, 0.20, 0.20, 1.0)` — flat #383137      |

Only spawn `FogShadow` tiles when `ViewMode::Entity`. In master mode, skip this
layer entirely — no fog tiles are spawned or despawned.

### `build_fog_tile_data`

```rust
fn build_fog_tile_data(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    fog: &FogData,
) -> Vec<Option<TileData>>
```

For each tile position in the chunk: look up its world position in `fog.visible`
and `fog.memory`. Return `None` for visible tiles (transparent), a gray tinted
tile for remembered, and an opaque dark tile for unknown.

### Despawn behavior

When `ViewMode` switches from `Entity → Master`, despawn all `FogShadow` chunk
entities. When switching `Master → Entity`, mark `FogData.dirty = true` so they
are rebuilt next tick.

---

## Phase 7 — Entity Mode View Z Restriction

**Commit: "Clamp entity mode z-level to dynamically visible range"**

### Algorithm for dynamic upper bound

From the entity's position `(ex, ey, ez)`, the highest accessible z-level is:

```
max_visible_z(entity_pos, blocks, world_chunks, chunk_edge):
    z = entity_pos.z
    while z < entity_pos.z + 5:
        if every block in the footprint (ex, ey, z+1) is SolidStone:
            break
        z += 1
    return z
```

This means the player can raise the camera above their head only if there is
actually open air above them (a tall cave, a shaft). If they are under a solid
ceiling they cannot raise the view at all.

Wire into `update_view_z_level` gated on `ViewMode::Entity`.

---

## Render Layer Z-Order Summary

After all phases, the layer rendering order per z-slice (front to back):

| Z position (sprite_z) | Layer           | Description                           |
| --------------------- | --------------- | ------------------------------------- |
| base + 2.0            | `FogShadow`     | exploration fog, gated on entity mode |
| base + 0.75           | `CeilingShadow` | ceiling occlusion dual-grid           |
| base + 0.5            | `EdgeShadow`    | depth drop dual-grid                  |
| base + 0.0            | `Floor`         | terrain tiles                         |

Entity sprites sit between `EdgeShadow` and `CeilingShadow` per prior
`calculate_sprite_z` logic.

---

## Implementation Order

1. **Phase 0** — rename shadow layers (pure refactor, no behavior change, run
   `cargo check`)
2. **Phase 1** — data structures in `world_sim` (types only, no logic yet)
3. **Phase 3** — vertical diagonal movement blocking (isolated, testable
   independently)
4. **Phase 2** — 3D FOV algorithm in `fov.rs` with unit tests
5. **Phase 4** — ViewMode resource and /master /entity commands
6. **Phase 5** — wire FOV into WorldState tick and snapshot path
7. **Phase 6** — FogShadow render layer
8. **Phase 7** — entity mode z-level clamping

---

## Critical Files

| File                                      | Change                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `world_sim/src/world_api.rs`              | `TileMemory`, `TileVisibility`, `VisibilitySnapshot`, extend `WorldSnapshot`      |
| `world_sim/src/world_core.rs`             | `EntityFov` in `WorldState`, FOV dirty wiring, vertical diagonal move block       |
| `world_sim/src/fov.rs`                    | _(new)_ 3D shadow casting implementation                                          |
| `game_library/src/domain/simulation.rs`   | Shadow rename, `FogData`, `build_fog_tile_data`, fog layer spawn/despawn, z clamp |
| `game_library/src/domain/visuals/mod.rs`  | Atlas asset renames                                                               |
| `game_library/src/domain/mod.rs`          | Import renames, register `ViewMode` resource                                      |
| `game_library/src/resources/view_mode.rs` | _(new)_ `ViewMode` enum                                                           |

---

## Acceptance Criteria

- [ ] Unknown tiles render as `#383137` in entity mode
- [ ] Previously seen tiles render with a grayish-white tint in entity mode
- [ ] Currently visible tiles render normally
- [ ] Solid blocks occlude sight; diagonal gaps do not allow diagonal vision
- [ ] Vertical diagonal solid pairs block sight over ledges
- [ ] Vertical diagonal movement through solid pairs is rejected
- [ ] Camera z-level in entity mode is clamped to the entity's open vertical
      range
- [ ] `/master` shows all tiles at all z-levels with no fog
- [ ] `/entity` activates fog and z-level restriction
- [ ] Memory is pruned when chunks are streamed out
- [ ] `cargo check` clean, `world_sim` tests pass
