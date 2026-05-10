use bevy::prelude::*;

use super::coords::desired_streaming_window;
use super::{
    ChunkStreamingState, FogData, ReplayMode, RenderEntityData, TerrainConfig,
};
use crate::resources::input_state::InputState;
use crate::resources::render_viewport::RenderViewport;
use crate::resources::view_mode::ViewMode;
use crate::resources::view_z_level::ViewZLevel;
use crate::domain::visuals::Player;
use world_sim::bevy_app::{PrimarySimulationEntityId, WorldCommandQueue, WorldView};
use world_sim::world_api::Vec3i;

pub fn stream_chunks_around_player(
    replay_mode: Res<ReplayMode>,
    config: Res<TerrainConfig>,
    mut chunk_streaming_state: ResMut<ChunkStreamingState>,
    mut world_command_queue: ResMut<WorldCommandQueue>,
    viewport: Res<RenderViewport>,
    mut invalidation: ResMut<crate::domain::tilemap_invalidation::TilemapInvalidation>,
) {
    if replay_mode.active {
        return;
    }

    if config.chunk_edge == 0 {
        return;
    }

    // Phase 4: Use viewport-derived rectangular streaming window instead of radius
    let desired = desired_streaming_window(&viewport, config.world_chunks);

    if chunk_streaming_state.loaded_chunks.is_empty() {
        chunk_streaming_state.loaded_chunks = desired.clone();
        return;
    }

    let mut new_chunks_loaded = false;

    // Load new chunks that entered the window
    for chunk in desired.difference(&chunk_streaming_state.loaded_chunks) {
        world_command_queue.set_chunk_loaded(*chunk, true);
        new_chunks_loaded = true;
    }

    // Unload chunks that left the window
    let to_unload: Vec<Vec3i> = chunk_streaming_state
        .loaded_chunks
        .difference(&desired)
        .copied()
        .collect();
    for &chunk in &to_unload {
        world_command_queue.set_chunk_loaded(chunk, false);
        chunk_streaming_state.loaded_chunks.remove(&chunk);
    }

    chunk_streaming_state.loaded_chunks.extend(desired);

    // Only invalidate view when new chunks load, not on unload-only deltas
    if new_chunks_loaded {
        invalidation.invalidate_view();
    }
}

pub fn sync_camera_z_to_player(
    mut view_z: ResMut<ViewZLevel>,
    entity_data: Res<RenderEntityData>,
    primary_entity: Option<Res<PrimarySimulationEntityId>>,
    mut invalidation: ResMut<crate::domain::tilemap_invalidation::TilemapInvalidation>,
) {
    let Some(primary_res) = primary_entity else {
        return;
    };
    let Some(primary_id) = primary_res.0 else {
        return;
    };
    let Some(entity) = entity_data.entities.get(&primary_id) else {
        return;
    };
    if !view_z.initialized {
        view_z.current = entity.position.z;
        view_z.initialized = true;
        view_z.last_player_z = Some(entity.position.z);
        invalidation.invalidate_view();
        return;
    }

    if view_z.last_player_z != Some(entity.position.z) {
        view_z.current = entity.position.z;
        view_z.last_player_z = Some(entity.position.z);
        invalidation.invalidate_view();
    }
}

pub fn sync_viewport_to_invalidation(
    viewport: Res<RenderViewport>,
    mut invalidation: ResMut<crate::domain::tilemap_invalidation::TilemapInvalidation>,
) {
    invalidation.visible_chunks_xy = viewport.visible_chunks_xy.clone();
    invalidation.visible_z_levels = viewport.visible_z_levels.clone();
    invalidation.viewport_changed = viewport.viewport_changed;
    invalidation.newly_visible_chunks_xy = viewport.newly_visible_chunks_xy.clone();
}

pub fn follow_player_camera(
    input_state: Res<InputState>,
    player_query: Query<&Transform, With<Player>>,
    mut camera_query: Query<(&mut Transform, &mut Projection), (With<Camera2d>, Without<Player>)>,
) {
    let Ok(player_transform) = player_query.single() else {
        return;
    };
    let Ok((mut camera_transform, mut projection)) = camera_query.single_mut() else {
        return;
    };

    camera_transform.translation.x = player_transform.translation.x;
    camera_transform.translation.y = player_transform.translation.y;

    let zoom_in_pressed = input_state.just_pressed_key(KeyCode::Equal)
        || input_state.just_pressed_key(KeyCode::NumpadAdd);
    let zoom_out_pressed = input_state.just_pressed_key(KeyCode::Minus)
        || input_state.just_pressed_key(KeyCode::NumpadSubtract);

    if let Projection::Orthographic(ref mut orthographic) = *projection {
        if zoom_in_pressed {
            orthographic.scale = (orthographic.scale * 0.9).clamp(0.25, 4.0);
        }
        if zoom_out_pressed {
            orthographic.scale = (orthographic.scale * 1.1).clamp(0.25, 4.0);
        }
    }
}

pub fn update_view_z_level(
    input_state: Res<InputState>,
    world_view: Res<WorldView>,
    view_mode: Res<ViewMode>,
    primary_entity_id: Res<PrimarySimulationEntityId>,
    fog: Res<FogData>,
    _terrain_config: Res<TerrainConfig>,
    mut view_z: ResMut<ViewZLevel>,
    mut entity_data: ResMut<RenderEntityData>,
    mut invalidation: ResMut<crate::domain::tilemap_invalidation::TilemapInvalidation>,
) {
    let world_snapshot = &world_view.snapshot();
    let world_size_z = world_snapshot
        .chunk_edge
        .checked_mul(world_snapshot.world_chunks.z)
        .expect("world z-size overflowed");
    let world_min_z = -(i32::try_from(world_size_z).expect("world z-size does not fit in i32") / 2);
    let world_max_z =
        world_min_z + i32::try_from(world_size_z).expect("world z-size does not fit in i32") - 1;

    // In Entity mode, allow scrolling through every z-level the entity has ever seen
    // (visible + memory), plus one level below the lowest so the floor is reachable.
    let (effective_min_z, effective_max_z) = if *view_mode == ViewMode::Entity {
        if primary_entity_id.0.is_some() {
            let known_min = fog
                .visible
                .iter()
                .chain(fog.memory.keys())
                .map(|p| p.z)
                .min()
                .unwrap_or(world_min_z);
            let known_max = fog
                .visible
                .iter()
                .chain(fog.memory.keys())
                .map(|p| p.z)
                .max()
                .unwrap_or(world_max_z);
            (known_min.max(world_min_z), known_max.min(world_max_z))
        } else {
            (world_min_z, world_max_z)
        }
    } else {
        (world_min_z, world_max_z)
    };

    let z_up_pressed = input_state.just_pressed(&input_state.z_level_up);
    let z_down_pressed = input_state.just_pressed(&input_state.z_level_down);

    if z_up_pressed {
        view_z.current = (view_z.current + 1).min(effective_max_z);
        entity_data.dirty = true;
        invalidation.invalidate_view();
    }
    if z_down_pressed {
        view_z.current = (view_z.current - 1).max(effective_min_z);
        entity_data.dirty = true;
        invalidation.invalidate_view();
    }
    // Clamp current view z in case the entity moved to a different level
    let clamped = view_z.current.clamp(effective_min_z, effective_max_z);
    if clamped != view_z.current {
        view_z.current = clamped;
        entity_data.dirty = true;
        invalidation.invalidate_view();
    }
}
