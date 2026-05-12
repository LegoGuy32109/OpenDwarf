use bevy::platform::collections::HashSet;
use bevy::prelude::*;
use std::sync::Arc;

use super::coords::render_movement_state;
use super::{
    FogData, RenderEntityData, RenderEntityState, ReplayMode, TerrainConfig, TerrainData,
    TileDataCache, TileLayerDebugState,
};
use crate::resources::render_viewport::RenderViewport;
use crate::resources::view_mode::ViewMode;
use crate::resources::view_z_level::ViewZLevel;
use world_sim::bevy_app::WorldView;
use world_sim::world_api::{BlockType, Vec3i, WorldSnapshot, WorldUpdate};

pub fn sync_render_world_from_snapshot(
    replay_mode: Res<ReplayMode>,
    world_view: Res<WorldView>,
    view_mode: Res<ViewMode>,
    view_z: Res<ViewZLevel>,
    viewport: Res<RenderViewport>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    mut config: ResMut<TerrainConfig>,
    mut terrain: ResMut<TerrainData>,
    mut entity_data: ResMut<RenderEntityData>,
    mut fog_data: ResMut<FogData>,
    mut invalidation: ResMut<crate::domain::tilemap_invalidation::TilemapInvalidation>,
    mut tile_cache: ResMut<TileDataCache>,
) {
    if replay_mode.active {
        return;
    }

    let snapshot = world_view.snapshot();
    let visibility_changed = snapshot_visibility_changed(*view_mode, &fog_data, snapshot);
    if entity_data.tick == snapshot.tick
        && config.chunk_edge == snapshot.chunk_edge
        && config.world_chunks == snapshot.world_chunks
        && !visibility_changed
        && !view_mode.is_changed()
        && !view_z.is_changed()
    {
        return;
    }

    apply_snapshot(
        *view_mode,
        *view_z,
        &mut config,
        &mut terrain,
        &mut entity_data,
        &mut fog_data,
        snapshot,
        &viewport,
        &tile_layer_debug_state,
        &mut invalidation,
        &mut tile_cache,
    );
}

pub(super) fn snapshot_visibility_changed(
    view_mode: ViewMode,
    fog: &FogData,
    snapshot: &WorldSnapshot,
) -> bool {
    if view_mode != ViewMode::Entity {
        return false;
    }

    let Some(visibility) = snapshot.visibility.as_ref() else {
        return !fog.visible.is_empty() || !fog.memory.is_empty();
    };

    fog.visible.len() != visibility.visible.len()
        || visibility
            .visible
            .iter()
            .any(|position| !fog.visible.contains(position))
        || fog.memory != visibility.memory
}

pub(super) fn apply_snapshot(
    view_mode: ViewMode,
    _view_z: ViewZLevel,
    config: &mut TerrainConfig,
    terrain: &mut TerrainData,
    entities: &mut RenderEntityData,
    fog: &mut FogData,
    snapshot: &WorldSnapshot,
    viewport: &crate::resources::render_viewport::RenderViewport,
    tile_layer_debug_state: &TileLayerDebugState,
    invalidation: &mut crate::domain::tilemap_invalidation::TilemapInvalidation,
    tile_cache: &mut TileDataCache,
) {
    let terrain_changed = config.chunk_edge != snapshot.chunk_edge
        || config.world_chunks != snapshot.world_chunks
        || !Arc::ptr_eq(&terrain.source_blocks, &snapshot.terrain_blocks);

    entities.tick = snapshot.tick;
    config.chunk_edge = snapshot.chunk_edge;
    config.world_chunks = snapshot.world_chunks;
    if terrain_changed {
        terrain.source_blocks = snapshot.terrain_blocks.clone();
    }
    entities.entities = snapshot
        .entities
        .iter()
        .map(|entity| {
            (
                entity.id,
                RenderEntityState {
                    position: entity.position,
                    facing_left: entity.facing_left,
                    is_prone: entity.is_prone,
                    movement: entity.movement.clone().map(render_movement_state),
                },
            )
        })
        .collect();

    let visibility_snapshot = snapshot.visibility.as_ref();
    if view_mode == ViewMode::Entity {
        if let Some(vis) = visibility_snapshot {
            let new_visible: HashSet<Vec3i> = vis.visible.iter().copied().collect();
            let new_memory = vis.memory.clone();
            let visibility_changed = fog.visible != new_visible || fog.memory != new_memory;

            if visibility_changed || terrain_changed {
                let prev_visible = std::mem::replace(&mut fog.visible, new_visible.clone());
                let prev_memory = std::mem::replace(&mut fog.memory, new_memory.clone());

                let prev_all: HashSet<Vec3i> = prev_visible
                    .iter()
                    .chain(prev_memory.keys())
                    .copied()
                    .collect();
                let new_all: HashSet<Vec3i> = new_visible
                    .iter()
                    .chain(new_memory.keys())
                    .copied()
                    .collect();
                let all_visibility_positions: HashSet<Vec3i> =
                    prev_all.union(&new_all).copied().collect();

                // Positions no longer visible or remembered: remove from render blocks.
                for p in prev_all.difference(&new_all).copied() {
                    terrain.blocks.remove(&p);
                    tile_cache.invalidate_block(p, config.chunk_edge);
                    invalidation.mark_block_change(
                        p,
                        config.chunk_edge,
                        view_mode,
                        tile_layer_debug_state,
                    );
                }

                // Positions that are new, transitioned between visible/memory, or whose
                // source_blocks may have changed (terrain_changed): check and update.
                for p in &new_all {
                    let expected = if new_visible.contains(p) {
                        terrain
                            .source_blocks
                            .get(p)
                            .copied()
                            .unwrap_or(BlockType::Air)
                    } else {
                        new_memory[p].block
                    };
                    let is_new = !prev_all.contains(p);
                    let source_maybe_changed = terrain_changed && new_visible.contains(p);
                    if is_new
                        || source_maybe_changed
                        || terrain.blocks.get(p).copied() != Some(expected)
                    {
                        terrain.blocks.insert(*p, expected);
                        tile_cache.invalidate_block(*p, config.chunk_edge);
                        invalidation.mark_block_change(
                            *p,
                            config.chunk_edge,
                            view_mode,
                            tile_layer_debug_state,
                        );
                    }
                }

                // Fog overlay depends on visibility state, not block geometry.
                // Only mark FogShadow — Floor/EdgeShadow/CeilingShadow are pure geometry
                // and do not change when visibility transitions between visible/remembered/unknown.
                for p in all_visibility_positions {
                    let was_visible = prev_visible.contains(&p);
                    let is_visible = new_visible.contains(&p);
                    let prev_memory_tile = prev_memory.get(&p);
                    let new_memory_tile = new_memory.get(&p);
                    if was_visible != is_visible || prev_memory_tile != new_memory_tile {
                        tile_cache.invalidate_fog(p, config.chunk_edge);
                        invalidation.mark_fog_change(p, config.chunk_edge);
                    }
                }
            }
        } else if terrain_changed || !fog.visible.is_empty() || !fog.memory.is_empty() {
            // No visibility snapshot — clear render blocks and fog state (nothing to show).
            fog.visible.clear();
            fog.memory.clear();
            terrain.blocks.clear();
            invalidation.mark_all_visible_layers(viewport, tile_layer_debug_state);
        }
    } else {
        // Master mode: skip visibility delta + terrain.blocks rebuild.
        // Master uses source_blocks directly; fog is not rendered.
        if terrain_changed {
            invalidation.mark_all_visible_layers(viewport, tile_layer_debug_state);
        }
    }
    entities.dirty = true;
}

pub(super) fn apply_update(
    view_mode: ViewMode,
    view_z: ViewZLevel,
    config: &mut TerrainConfig,
    terrain: &mut TerrainData,
    entities: &mut RenderEntityData,
    fog: &mut FogData,
    update: WorldUpdate,
    viewport: &crate::resources::render_viewport::RenderViewport,
    tile_layer_debug_state: &crate::domain::simulation::TileLayerDebugState,
    invalidation: &mut crate::domain::tilemap_invalidation::TilemapInvalidation,
    tile_cache: &mut TileDataCache,
) {
    match update {
        WorldUpdate::Snapshot(snapshot) => apply_snapshot(
            view_mode,
            view_z,
            config,
            terrain,
            entities,
            fog,
            &snapshot,
            viewport,
            tile_layer_debug_state,
            invalidation,
            tile_cache,
        ),
        WorldUpdate::Delta(delta) => {
            entities.tick = delta.tick;
            for movement in delta.moved_entities {
                entities.entities.insert(
                    movement.id,
                    RenderEntityState {
                        position: movement.to,
                        facing_left: movement.facing_left_after,
                        is_prone: movement.is_prone_after,
                        movement: movement.movement_after.map(render_movement_state),
                    },
                );
            }
            entities.dirty = true;

            for change in delta.block_changes {
                match change.to {
                    BlockType::SolidStone => {
                        Arc::make_mut(&mut terrain.source_blocks)
                            .insert(change.position, change.to);
                        if terrain.blocks.contains_key(&change.position) {
                            terrain.blocks.insert(change.position, change.to);
                        }
                    }
                    BlockType::Air => {
                        Arc::make_mut(&mut terrain.source_blocks).remove(&change.position);
                        terrain.blocks.remove(&change.position);
                    }
                }
                tile_cache.invalidate_block(change.position, config.chunk_edge);
                invalidation.mark_block_change(
                    change.position,
                    config.chunk_edge,
                    view_mode,
                    tile_layer_debug_state,
                );
            }
        }
    }
}
