# Vision Implementation Plan

Goal: make the game world render like the provided reference image, with
readable depth, unknown terrain, layered shadows, and observer-dependent
visibility.

## 1. Separate the concepts

Keep these as distinct data concepts:

- `block state`: what the world physically contains.
- `exploration state`: whether the player has ever uncovered a tile.
- `visibility state`: whether a tile or entity is visible to a given observer
  right now.
- `exposure mask`: which edges, corners, or diagonals of a tile are exposed and
  should receive a shadow overlay.
- `depth band`: whether a tile/entity is on the current layer, below it, or
  deeper.

Do not encode shadow orientation into a single enum. Orientation is geometry,
not gameplay state.

## 2. Expand `world_sim` with visibility data

The authoritative sim should own visibility rules, because AI and replay need
the same answers the player sees.

Add a visibility payload to the world snapshot or a parallel visibility
snapshot:

- `explored: bool`
- `visible: bool`
- `opaque: bool`
- `exposure_mask: u8`
- `surface_z` or `depth_delta`
- optional `entity_visible: bool` for observer-specific entity culling

Update the snapshot path in:

- `game_library/world_sim/src/world_api.rs`
- `game_library/world_sim/src/world_core.rs`

Keep the block grid separate from exploration and visibility. Unknown terrain is
not a different block type.

## 3. Compute FOV with shadow casting

Use shadow-cast FOV as the primary visibility system.

Recommended behavior:

- Recompute on observer movement.
- Recompute when nearby blockers or open tiles change.
- Use a bounded radius first, such as 10 tiles.
- Run at the sim tick rate, not continuously.

This should support:

- player vision
- patrol NPC vision
- entity-vs-entity detection

If an entity moves in and out of a field of view between ticks, accept tick
granularity unless the entity is important enough to need a higher-priority
update.

## 4. Use a dirty/invalidation model

Do not recompute FOV for every entity every tick if it is not necessary.

Use invalidation when:

- the observer moved
- the observer changed level
- a blocker changed nearby terrain
- the observer started or stopped moving

Useful scheduling tiers:

- player: always current
- active NPCs: current while near the player or making decisions
- background NPCs: cached or lower frequency

## 5. Render with layered tile passes

The visual system in `game_library/src/domain/simulation.rs` should become a
layered renderer instead of a single flat floor pass.

Current code paths to extend:

- `project_world_to_tilemap`
- `build_chunk_tile_data`
- `project_world_entities_to_sprites`

Render layers:

- base surface: normal sprite coloring
- unknown tiles: fill with `#383137`
- below-current-layer tiles: tint with black at 25 percent opacity, or blue-gray
  plus black as needed
- edge shadows: overlay a mask tile or second pass with 50 percent black
  followed by 25 percent black
- deeper layers: repeat the same pattern with stronger depth tint

## 6. Build a shadow mask atlas

Because Bevy tilemap chunks do not support per-tile rotation or mirroring, the
atlas should contain pre-baked variants.

The atlas should be:

- white silhouette shapes on transparent background
- pixel-aligned to the tile size
- separate variants for:
  - edge-only
  - corner-only
  - edge plus corner blend
  - full fill
- optionally duplicated in rotated or mirrored versions if symmetry is needed

The runtime chooses the correct atlas tile by mask index. The atlas does not
store color; color comes from the renderer.

## 7. Add exposure masks for terrain edges

Compute an `exposure_mask` per tile from local neighborhood state.

Possible inputs:

- cardinal neighbors
- diagonal neighbors
- above/below layer occupancy
- whether the tile is at a hole boundary

Use that mask to choose which shadow sprite to draw.

This is what makes the silhouette read like the reference image instead of
looking like a flat grid.

## 8. Support depth below the current layer

The current config already supports a 16-voxel vertical span when
`world_chunks.z == 1`, but deeper worlds require more z chunks.

Update the vertical world model as needed:

- increase `world_chunks.z` if deeper than 16 voxels is needed
- expand world generation beyond the single seeded floor layer
- keep streaming and render logic aware of z

When a hole opens into a lower layer:

- draw the new lower layer
- apply a darker depth tint
- apply a hole-edge shadow mask

## 9. Make entity visibility observer-dependent

Entities should use the same visibility map, but they only need a binary result
for rendering:

- visible
- hidden

Do not try to render half-visible entities unless that is a deliberate gameplay
rule.

For the player view:

- if an entity is fully shadowed, hide it
- if it is visible, render it normally
- if it is on a lower layer, tint it to match the depth band

## 10. Implement in this order

1. Add `explored`, `visible`, and `exposure_mask` data structures in
   `world_sim`.
2. Wire shadow-cast FOV for the player only.
3. Extend the render snapshot to carry visibility.
4. Add the mask atlas and a shadow overlay pass.
5. Render unknown tiles and below-layer tiles.
6. Add NPC FOV and entity culling.
7. Tune radius, update frequency, and mask variants.

## 11. Acceptance criteria

The implementation is correct when:

- unknown tiles render as `#383137`
- exposed edges get a 2 pixel shadow band
- tiles below the current layer get a darker depth tint
- fully shadowed entities disappear
- nearby patrolling entities react on the next sim tick
- the player can read floor depth and cavities at a glance
