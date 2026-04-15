use std::collections::{BTreeMap, HashSet};

use bevy::math::Isometry2d;
use bevy::prelude::*;
use bevy::sprite_render::{TileData, TilemapChunk, TilemapChunkTileData};

use crate::components::map_coordinates::MapCoordinates;
use crate::resources::input_state::InputState;
use crate::resources::view_z_level::ViewZLevel;
use world_sim::bevy_app::PrimarySimulationEntityId;
use world_sim::bevy_app::WorldCommandQueue;
use world_sim::bevy_app::WorldSimDiagnostics;
use world_sim::bevy_app::WorldView;
#[cfg(not(target_arch = "wasm32"))]
use world_sim::replay::{ReplayEvent, load_replay};
use world_sim::world_api::{
    BlockType, EntityMovementSnapshot, Vec3i, Vec3u, WorldCommand, WorldSnapshot, WorldUpdate,
};

use super::visuals::{Player, PlayerRenderTarget, TILE_SIZE_IN_PX, TilemapAssets};

const CHUNK_STREAM_RADIUS_XY: i32 = 2;
const CHUNK_STREAM_RADIUS_Z: i32 = 0;
#[cfg(not(target_arch = "wasm32"))]
const REPLAY_PATH_ENV: &str = "OPEN_DWARF_REPLAY_PATH";

#[derive(Resource, Default)]
pub struct ReplayMode {
    pub active: bool,
}

#[derive(Resource, Default)]
pub struct HeldMovementState {
    was_moving_last_frame: bool,
}

#[derive(Resource, Default, Clone)]
pub struct ReplayHudState {
    pub active: bool,
    pub playing: bool,
    pub cursor: usize,
    pub total_events: usize,
    pub tick: u64,
    pub show_all_events: bool,
    pub event_labels: Vec<String>,
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Resource)]
pub struct ReplayPlayback {
    events: Vec<ReplayEvent>,
    cursor: usize,
    playing: bool,
}

#[derive(Resource, Default)]
pub struct RenderWorldState {
    pub tick: u64,
    pub chunk_edge: u32,
    pub world_chunks: Vec3u,
    pub blocks: Vec<BlockType>,
    pub entities: BTreeMap<u64, RenderEntityState>,
    terrain_dirty: bool,
    entities_dirty: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RenderEntityState {
    pub position: Vec3i,
    pub facing_left: bool,
    pub is_prone: bool,
    pub movement: Option<RenderEntityMovementState>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RenderEntityMovementState {
    pub start_position: Vec3,
    pub origin: Vec3i,
    pub target: Vec3i,
    pub progress_percent: u8,
}

#[derive(Resource, Default)]
pub struct ChunkStreamingState {
    loaded_chunks: HashSet<Vec3i>,
    last_center_chunk: Option<Vec3i>,
}

#[derive(Resource, Default)]
pub struct ChunkBorderDebugState {
    pub visible: bool,
}

#[derive(Resource, Debug, Default, Clone)]
pub struct TilemapRenderMetrics {
    pub chunk_count: usize,
    pub non_empty_tile_count: usize,
    pub last_rebuild_micros: u128,
    pub rebuild_count: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TileLayer {
    Floor,
    ShadowOverlay,
}

#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorldTileChunk {
    pub chunk_xy: IVec2,
    pub world_z: i32,
    pub layer: TileLayer,
}

#[derive(Component, Debug, Clone, Copy)]
pub struct DepthTintChunk {
    #[allow(dead_code)]
    pub chunk_xy: IVec2,
    #[allow(dead_code)]
    pub z_offset: i32,
}

#[derive(Component)]
pub struct DepthDebugLabel;

impl RenderWorldState {
    fn mark_all_dirty(&mut self) {
        self.terrain_dirty = true;
        self.entities_dirty = true;
    }
}

pub fn setup_simulation_state(mut commands: Commands) {
    let mut replay_mode = ReplayMode::default();
    let mut render_world_state = RenderWorldState::default();

    #[cfg(not(target_arch = "wasm32"))]
    if let Some(mut replay_playback) = try_load_replay_playback() {
        replay_mode.active = true;
        replay_playback.playing = false;
        if !apply_first_checkpoint(&mut replay_playback, &mut render_world_state) {
            warn!("Replay did not contain any checkpoint/snapshot data");
        }
        commands.insert_resource(replay_playback);
    }

    let replay_hud_state = ReplayHudState {
        active: replay_mode.active,
        playing: false,
        cursor: 0,
        total_events: 0,
        tick: render_world_state.tick,
        show_all_events: false,
        event_labels: Vec::new(),
    };

    commands.insert_resource(replay_mode);
    commands.insert_resource(replay_hud_state);
    commands.insert_resource(HeldMovementState::default());
    commands.insert_resource(render_world_state);
    commands.insert_resource(ChunkStreamingState::default());
    commands.insert_resource(ChunkBorderDebugState::default());
    commands.insert_resource(TilemapRenderMetrics::default());
}

pub fn queue_world_commands_from_input(
    input_state: Res<InputState>,
    replay_mode: Res<ReplayMode>,
    primary_entity_id: Res<PrimarySimulationEntityId>,
    render_world_state: Res<RenderWorldState>,
    mut held_movement_state: ResMut<HeldMovementState>,
    mut world_command_queue: ResMut<WorldCommandQueue>,
) {
    if replay_mode.active {
        held_movement_state.was_moving_last_frame = false;
        return;
    }

    let (first_movement_key, second_movement_key) =
        input_state.get_first_two_just_pressed(&input_state.groups.movement);

    let direction = match (first_movement_key, second_movement_key) {
        (Some(first), Some(second)) => {
            input_state.movement_direction(first) + input_state.movement_direction(second)
        }
        (Some(first), None) => input_state.movement_direction(first),
        _ => IVec3::ZERO,
    };

    let Some(entity_id) = primary_entity_id.0 else {
        held_movement_state.was_moving_last_frame = false;
        return;
    };

    let Some(entity) = render_world_state.entities.get(&entity_id) else {
        held_movement_state.was_moving_last_frame = false;
        return;
    };
    let is_moving = entity.movement.is_some();
    let active_direction = entity.movement.map(render_movement_direction);

    let (first_pressed, second_pressed) =
        input_state.get_first_two_pressed(&input_state.groups.movement);
    let held_direction = movement_direction_from_keys(&input_state, first_pressed, second_pressed);
    let should_chain_held = held_movement_state.was_moving_last_frame && !is_moving;
    let active_direction_is_held = active_direction
        .is_some_and(|active_direction| direction_contains(held_direction, active_direction));

    if !is_moving
        && (direction != IVec3::ZERO || (should_chain_held && held_direction != IVec3::ZERO))
    {
        let chosen_direction = if direction != IVec3::ZERO {
            direction
        } else {
            held_direction
        };
        world_command_queue.move_entity(
            entity_id,
            Vec3i::new(chosen_direction.x, chosen_direction.y, chosen_direction.z),
        );
    } else if is_moving
        && direction != IVec3::ZERO
        && active_direction != Some(direction)
        && !active_direction_is_held
    {
        world_command_queue
            .move_entity(entity_id, Vec3i::new(direction.x, direction.y, direction.z));
    }

    held_movement_state.was_moving_last_frame = is_moving;
}

pub fn sync_render_world_from_snapshot(
    replay_mode: Res<ReplayMode>,
    world_view: Res<WorldView>,
    mut render_world_state: ResMut<RenderWorldState>,
) {
    if replay_mode.active {
        return;
    }

    let snapshot = world_view.snapshot();
    if render_world_state.tick == snapshot.tick
        && render_world_state.chunk_edge == snapshot.chunk_edge
        && render_world_state.world_chunks == snapshot.world_chunks
        && render_world_state.entities.len() == snapshot.entities.len()
    {
        return;
    }

    apply_snapshot(&mut render_world_state, snapshot.clone());
}

#[cfg(not(target_arch = "wasm32"))]
pub fn drive_replay_playback(
    replay_mode: Res<ReplayMode>,
    keyboard_input: Res<ButtonInput<KeyCode>>,
    replay_playback: Option<ResMut<ReplayPlayback>>,
    mut replay_hud_state: ResMut<ReplayHudState>,
    mut render_world_state: ResMut<RenderWorldState>,
) {
    if !replay_mode.active {
        replay_hud_state.active = false;
        return;
    }
    let Some(mut replay_playback) = replay_playback else {
        replay_hud_state.active = false;
        return;
    };

    replay_hud_state.active = true;
    replay_hud_state.total_events = replay_playback.events.len();

    if keyboard_input.just_pressed(KeyCode::F6) {
        replay_playback.playing = !replay_playback.playing;
        info!(
            "Replay playback {}",
            if replay_playback.playing {
                "resumed"
            } else {
                "paused"
            }
        );
    }

    if keyboard_input.just_pressed(KeyCode::F8) {
        replay_playback.cursor = 0;
        render_world_state.entities.clear();
        render_world_state.blocks.clear();
        render_world_state.chunk_edge = 0;
        render_world_state.world_chunks = Vec3u::default();
        render_world_state.tick = 0;
        render_world_state.mark_all_dirty();
        let _ = apply_first_checkpoint(&mut replay_playback, &mut render_world_state);
        info!("Replay reset to beginning");
    }

    if keyboard_input.just_pressed(KeyCode::F7) {
        let _ = apply_next_replay_event(&mut replay_playback, &mut render_world_state);
    }

    if keyboard_input.just_pressed(KeyCode::F9) {
        replay_hud_state.show_all_events = !replay_hud_state.show_all_events;
    }

    if replay_playback.playing
        && !apply_next_replay_event(&mut replay_playback, &mut render_world_state)
    {
        replay_playback.playing = false;
        info!("Replay playback reached end");
    }

    replay_hud_state.playing = replay_playback.playing;
    replay_hud_state.cursor = replay_playback.cursor;
    replay_hud_state.tick = render_world_state.tick;
    replay_hud_state.event_labels = replay_playback
        .events
        .iter()
        .map(describe_replay_event)
        .collect();
}

pub fn project_world_to_tilemap(
    mut commands: Commands,
    replay_mode: Res<ReplayMode>,
    chunk_streaming_state: Option<Res<ChunkStreamingState>>,
    view_z: Res<ViewZLevel>,
    tilemap_assets: Res<TilemapAssets>,
    shadow_atlas: Res<super::visuals::ShadowAtlasAsset>,
    mut render_world_state: ResMut<RenderWorldState>,
    mut tilemap_render_metrics: ResMut<TilemapRenderMetrics>,
    mut chunk_query: Query<(
        Entity,
        &WorldTileChunk,
        &TilemapChunk,
        &mut TilemapChunkTileData,
        &mut Transform,
    )>,
) {
    #[cfg(not(target_arch = "wasm32"))]
    let start = std::time::Instant::now();
    if !render_world_state.terrain_dirty {
        return;
    }

    let chunk_edge = render_world_state.chunk_edge;
    if chunk_edge == 0 {
        return;
    }

    let active_chunks_xy: HashSet<IVec2> = if replay_mode.active {
        all_world_chunk_coords(render_world_state.world_chunks)
            .into_iter()
            .map(|c| IVec2::new(c.x, c.y))
            .collect()
    } else if let Some(streaming) = chunk_streaming_state {
        if streaming.loaded_chunks.is_empty() {
            all_world_chunk_coords(render_world_state.world_chunks)
                .into_iter()
                .map(|c| IVec2::new(c.x, c.y))
                .collect()
        } else {
            streaming.loaded_chunks.iter().map(|c| IVec2::new(c.x, c.y)).collect()
        }
    } else {
        all_world_chunk_coords(render_world_state.world_chunks)
            .into_iter()
            .map(|c| IVec2::new(c.x, c.y))
            .collect()
    };

    // Determine which z-levels to render: current level + up to 5 levels below
    let z_levels_to_render: Vec<i32> = (0..=5)
        .map(|offset| view_z.0 - offset)
        .collect();

    // Collect existing chunk keys (chunk_xy, z, layer)
    let existing_chunks: HashSet<(IVec2, i32, TileLayer)> = chunk_query
        .iter()
        .map(|(_, chunk, _, _, _)| (chunk.chunk_xy, chunk.world_z, chunk.layer))
        .collect();

    // Spawn new chunks and update existing ones
    for &chunk_xy in &active_chunks_xy {
        for &world_z in &z_levels_to_render {
            // Spawn floor layer
            let chunk_key = (chunk_xy, world_z, TileLayer::Floor);
            if !existing_chunks.contains(&chunk_key) {
                let tile_data = build_chunk_tile_data(
                    chunk_xy,
                    world_z,
                    chunk_edge,
                    &render_world_state.blocks,
                    render_world_state.world_chunks,
                );

                let sprite_z = calculate_sprite_z(world_z - view_z.0, TileLayer::Floor);
                commands.spawn((
                    WorldTileChunk {
                        chunk_xy,
                        world_z,
                        layer: TileLayer::Floor,
                    },
                    TilemapChunk {
                        chunk_size: UVec2::splat(chunk_edge),
                        tile_display_size: tilemap_assets.tile_display_size,
                        tileset: tilemap_assets.tileset.clone(),
                        alpha_mode: bevy::sprite_render::AlphaMode2d::Opaque,
                    },
                    TilemapChunkTileData(tile_data),
                    Transform::from_translation(chunk_world_translation_xy(chunk_xy, chunk_edge, sprite_z)),
                    GlobalTransform::default(),
                    Visibility::default(),
                    InheritedVisibility::default(),
                    ViewVisibility::default(),
                ));
            }

            // Spawn shadow overlay layer
            let shadow_key = (chunk_xy, world_z, TileLayer::ShadowOverlay);
            if !existing_chunks.contains(&shadow_key) {
                let shadow_data = build_shadow_tile_data(
                    chunk_xy,
                    world_z,
                    chunk_edge,
                    &render_world_state.blocks,
                    render_world_state.world_chunks,
                );

                let shadow_sprite_z = calculate_sprite_z(world_z - view_z.0, TileLayer::ShadowOverlay);
                commands.spawn((
                    WorldTileChunk {
                        chunk_xy,
                        world_z,
                        layer: TileLayer::ShadowOverlay,
                    },
                    TilemapChunk {
                        chunk_size: UVec2::splat(chunk_edge),
                        tile_display_size: UVec2::splat(64),  // Shadow atlas is scaled to 64px display size
                        tileset: shadow_atlas.atlas.clone(),
                        alpha_mode: bevy::sprite_render::AlphaMode2d::Blend,
                    },
                    TilemapChunkTileData(shadow_data),
                    Transform::from_translation(chunk_world_translation_xy(chunk_xy, chunk_edge, shadow_sprite_z)),
                    GlobalTransform::default(),
                    Visibility::default(),
                    InheritedVisibility::default(),
                    ViewVisibility::default(),
                ));
            }
        }
    }

    // Despawn chunks that are no longer active
    for (entity, world_chunk, _, _, _) in &mut chunk_query {
        let should_keep = active_chunks_xy.contains(&world_chunk.chunk_xy)
            && z_levels_to_render.contains(&world_chunk.world_z);
        if !should_keep {
            commands.entity(entity).despawn();
        }
    }

    // Update existing chunks
    let mut non_empty_tile_count = 0usize;
    for (_, world_chunk, _, mut chunk_data, mut transform) in &mut chunk_query {
        let sprite_z = calculate_sprite_z(world_chunk.world_z - view_z.0, world_chunk.layer);
        *transform = Transform::from_translation(chunk_world_translation_xy(world_chunk.chunk_xy, chunk_edge, sprite_z));

        let tile_data = match world_chunk.layer {
            TileLayer::Floor => build_chunk_tile_data(
                world_chunk.chunk_xy,
                world_chunk.world_z,
                chunk_edge,
                &render_world_state.blocks,
                render_world_state.world_chunks,
            ),
            TileLayer::ShadowOverlay => build_shadow_tile_data(
                world_chunk.chunk_xy,
                world_chunk.world_z,
                chunk_edge,
                &render_world_state.blocks,
                render_world_state.world_chunks,
            ),
        };
        non_empty_tile_count = non_empty_tile_count
            .saturating_add(tile_data.iter().filter(|tile| tile.is_some()).count());
        chunk_data.0 = tile_data;
    }

    tilemap_render_metrics.chunk_count = active_chunks_xy.len() * z_levels_to_render.len() * 2; // xy chunks * z levels * 2 layers
    tilemap_render_metrics.non_empty_tile_count = non_empty_tile_count;
    #[cfg(not(target_arch = "wasm32"))]
    {
        tilemap_render_metrics.last_rebuild_micros = start.elapsed().as_micros();
        tilemap_render_metrics.rebuild_count =
            tilemap_render_metrics.rebuild_count.saturating_add(1);
        if tilemap_render_metrics.last_rebuild_micros > 8_000 {
            warn!(
                "Tilemap rebuild slow: {}us across {} chunks and {} non-empty tiles",
                tilemap_render_metrics.last_rebuild_micros,
                tilemap_render_metrics.chunk_count,
                tilemap_render_metrics.non_empty_tile_count
            );
        }
    }
    render_world_state.terrain_dirty = false;
}

pub fn update_depth_tints(
    mut commands: Commands,
    view_z: Res<ViewZLevel>,
    render_world_state: Res<RenderWorldState>,
    replay_mode: Res<ReplayMode>,
    chunk_streaming_state: Option<Res<ChunkStreamingState>>,
    mut depth_tint_query: Query<(Entity, &DepthTintChunk, &mut Transform, &mut Sprite)>,
) {
    if !render_world_state.terrain_dirty {
        // Also check if view_z changed
        if !view_z.is_changed() {
            return;
        }
    }

    let chunk_edge = render_world_state.chunk_edge;

    // Determine z-levels to render
    let z_levels_to_render: Vec<i32> = (0..=5)
        .map(|offset| view_z.0 - offset)
        .collect();

    // Get active chunks using the same logic as project_world_to_tilemap
    let active_chunks_xy: HashSet<IVec2> = if replay_mode.active {
        all_world_chunk_coords(render_world_state.world_chunks)
            .into_iter()
            .map(|c| IVec2::new(c.x, c.y))
            .collect()
    } else if let Some(streaming) = chunk_streaming_state {
        if streaming.loaded_chunks.is_empty() {
            all_world_chunk_coords(render_world_state.world_chunks)
                .into_iter()
                .map(|c| IVec2::new(c.x, c.y))
                .collect()
        } else {
            streaming.loaded_chunks.iter().map(|c| IVec2::new(c.x, c.y)).collect()
        }
    } else {
        all_world_chunk_coords(render_world_state.world_chunks)
            .into_iter()
            .map(|c| IVec2::new(c.x, c.y))
            .collect()
    };

    // For now, despawn all old tints and respawn new ones
    for (entity, _tint, _, _) in &mut depth_tint_query {
        commands.entity(entity).despawn();
    }

    // Spawn new tints for current view configuration
    for &chunk_xy in &active_chunks_xy {
        for &world_z in &z_levels_to_render {
            if world_z < view_z.0 {
                let z_offset = world_z - view_z.0;
                let (color, tint_sprite_z) = get_depth_tint_color(z_offset);
                let chunk_pixel_size = (chunk_edge as f32) * f32::from(TILE_SIZE_IN_PX);

                commands.spawn((
                    Sprite {
                        color,
                        custom_size: Some(Vec2::splat(chunk_pixel_size)),
                        ..default()
                    },
                    Transform::from_translation(chunk_world_translation_xy(
                        chunk_xy,
                        chunk_edge,
                        tint_sprite_z,
                    )),
                    GlobalTransform::default(),
                    Visibility::default(),
                    InheritedVisibility::default(),
                    ViewVisibility::default(),
                    DepthTintChunk { chunk_xy, z_offset },
                ));
            }
        }
    }
}

pub fn draw_depth_labels(
    mut commands: Commands,
    chunk_border_debug_state: Res<ChunkBorderDebugState>,
    view_z: Res<ViewZLevel>,
    render_world_state: Res<RenderWorldState>,
    replay_mode: Res<ReplayMode>,
    chunk_streaming_state: Option<Res<ChunkStreamingState>>,
    existing_labels: Query<Entity, With<DepthDebugLabel>>,
) {
    // Return early if debug labels are disabled
    if !chunk_border_debug_state.visible {
        // Despawn any existing labels
        for entity in &existing_labels {
            commands.entity(entity).despawn();
        }
        return;
    }

    // Only rebuild if something changed
    if !render_world_state.terrain_dirty && !view_z.is_changed() && !chunk_border_debug_state.is_changed() {
        return;
    }

    let chunk_edge = render_world_state.chunk_edge;
    let tile_size = f32::from(TILE_SIZE_IN_PX);

    // Despawn all existing labels
    for entity in &existing_labels {
        commands.entity(entity).despawn();
    }

    // Determine z-levels to render (same as tints)
    let z_levels_to_render: Vec<i32> = (0..=5)
        .map(|offset| view_z.0 - offset)
        .collect();

    // Get active chunks using the same logic as project_world_to_tilemap
    let active_chunks_xy: HashSet<IVec2> = if replay_mode.active {
        all_world_chunk_coords(render_world_state.world_chunks)
            .into_iter()
            .map(|c| IVec2::new(c.x, c.y))
            .collect()
    } else if let Some(streaming) = chunk_streaming_state {
        if streaming.loaded_chunks.is_empty() {
            all_world_chunk_coords(render_world_state.world_chunks)
                .into_iter()
                .map(|c| IVec2::new(c.x, c.y))
                .collect()
        } else {
            streaming.loaded_chunks.iter().map(|c| IVec2::new(c.x, c.y)).collect()
        }
    } else {
        all_world_chunk_coords(render_world_state.world_chunks)
            .into_iter()
            .map(|c| IVec2::new(c.x, c.y))
            .collect()
    };

    // For each chunk and each visible z-level, spawn shadow mask labels on air tiles
    for &chunk_xy in &active_chunks_xy {
        let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);
        for &world_z in &z_levels_to_render {
            for local_y in 0..chunk_edge {
                for local_x in 0..chunk_edge {
                    let world_position =
                        world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);

                    // Only label air tiles that have shadows
                    if matches!(
                        block_at_world_position(
                            &render_world_state.blocks,
                            render_world_state.world_chunks,
                            chunk_edge,
                            world_position
                        ),
                        Some(BlockType::Air) | None
                    ) {
                        let mask = compute_shadow_mask_for_air(
                            world_position.x,
                            world_position.y,
                            world_position.z,
                            &render_world_state.blocks,
                            render_world_state.world_chunks,
                            chunk_edge,
                        );

                        // Only spawn label if there's a shadow
                        if mask != 0 {
                            let mask_text = mask.to_string();
                            let text_position = world_to_pixel_translation(world_position, tile_size);

                            commands.spawn((
                                Text2d::new(mask_text),
                                TextFont {
                                    font_size: 12.0,
                                    ..default()
                                },
                                TextColor(Color::srgba(1.0, 1.0, 0.0, 0.95)),
                                Transform::from_translation(text_position + Vec3::new(0.0, 0.0, 2.0)),
                                DepthDebugLabel,
                            ));
                        }
                    }
                }
            }
        }
    }
}

pub fn toggle_chunk_borders(
    input_state: Res<InputState>,
    mut chunk_border_debug_state: ResMut<ChunkBorderDebugState>,
) {
    if input_state.just_pressed_key(KeyCode::F3) {
        chunk_border_debug_state.visible = !chunk_border_debug_state.visible;
        info!(
            "Chunk borders {}",
            if chunk_border_debug_state.visible {
                "enabled"
            } else {
                "disabled"
            }
        );
    }
}

pub fn draw_chunk_borders(
    chunk_border_debug_state: Res<ChunkBorderDebugState>,
    mut gizmos: Gizmos,
    chunk_query: Query<(&TilemapChunk, &Transform), With<WorldTileChunk>>,
) {
    if !chunk_border_debug_state.visible {
        return;
    }

    let border_color = Color::srgba(1.0, 1.0, 0.0, 0.95);
    for (tilemap_chunk, transform) in &chunk_query {
        let size = Vec2::new(
            tilemap_chunk.chunk_size.x as f32 * tilemap_chunk.tile_display_size.x as f32,
            tilemap_chunk.chunk_size.y as f32 * tilemap_chunk.tile_display_size.y as f32,
        );
        gizmos.rect_2d(
            Isometry2d::from_translation(transform.translation.truncate()),
            size,
            border_color,
        );
    }
}

pub fn draw_entity_occupancy_boxes(
    chunk_border_debug_state: Res<ChunkBorderDebugState>,
    tilemap_assets: Res<TilemapAssets>,
    render_world_state: Res<RenderWorldState>,
    mut gizmos: Gizmos,
) {
    if !chunk_border_debug_state.visible {
        return;
    }

    let tile_size = tilemap_assets.tile_display_size.x as f32;
    let occupancy_color = Color::srgba(1.0, 0.72, 0.16, 0.95);

    for entity in render_world_state.entities.values() {
        let mut occupied_tiles = Vec::new();
        if let Some(movement) = entity.movement {
            if movement.progress_percent < 75 {
                occupied_tiles.push(movement.origin);
            }
            if movement.progress_percent >= 25 {
                occupied_tiles.push(movement.target);
            }
        } else {
            occupied_tiles.push(entity.position);
        }

        for world_position in occupied_tiles {
            gizmos.rect_2d(
                Isometry2d::from_translation(
                    world_to_pixel_translation(world_position, tile_size).truncate(),
                ),
                Vec2::splat(tile_size),
                occupancy_color,
            );
        }
    }
}

pub fn project_world_entities_to_sprites(
    mut render_world_state: ResMut<RenderWorldState>,
    primary_entity_id: Res<PrimarySimulationEntityId>,
    tilemap_assets: Res<TilemapAssets>,
    mut player_query: Query<
        (&mut MapCoordinates, &mut Sprite, &mut PlayerRenderTarget),
        With<Player>,
    >,
) {
    if !render_world_state.entities_dirty {
        return;
    }

    let Some(entity_id) = primary_entity_id.0 else {
        return;
    };

    let Some(player_world_position) = render_world_state.entities.get(&entity_id).copied() else {
        return;
    };

    if let Ok((mut coordinates, mut sprite, mut render_target)) = player_query.single_mut() {
        let world_voxels_x = render_world_state
            .world_chunks
            .x
            .checked_mul(render_world_state.chunk_edge)
            .expect("project_world_entities_to_sprites world x-size overflowed");
        let world_voxels_y = render_world_state
            .world_chunks
            .y
            .checked_mul(render_world_state.chunk_edge)
            .expect("project_world_entities_to_sprites world y-size overflowed");
        let map_size = uvec3(world_voxels_x, world_voxels_y, 1);
        *coordinates = MapCoordinates::new(
            IVec3::new(
                player_world_position.position.x,
                player_world_position.position.y,
                player_world_position.position.z,
            ),
            map_size,
        );
        let tile_size = tilemap_assets.tile_display_size.x as f32;
        let render_world_position = if let Some(movement) = player_world_position.movement {
            let start = world_to_pixel_translation_f32(movement.start_position, tile_size);
            let end = world_to_pixel_translation(movement.target, tile_size);
            start.lerp(end, f32::from(movement.progress_percent) / 100.0)
        } else {
            world_to_pixel_translation(player_world_position.position, tile_size)
        };
        render_target.0 = render_world_position;
        sprite.flip_x = player_world_position.facing_left;
    }

    render_world_state.entities_dirty = false;
}

pub fn smooth_player_render_transform(
    time: Res<Time>,
    mut player_query: Query<(&mut Transform, &PlayerRenderTarget), With<Player>>,
) {
    let Ok((mut transform, render_target)) = player_query.single_mut() else {
        return;
    };

    let target = render_target.0;
    let delta = time.delta_secs();
    let smoothing = 1.0 - (-10.0 * delta).exp();
    let distance = transform.translation.distance(target);

    if distance <= 0.01 || smoothing >= 0.999 {
        transform.translation = target;
        return;
    }

    transform.translation = transform.translation.lerp(target, smoothing);
}

pub fn stream_chunks_around_player(
    replay_mode: Res<ReplayMode>,
    primary_entity_id: Res<PrimarySimulationEntityId>,
    world_sim_diagnostics: Res<WorldSimDiagnostics>,
    mut render_world_state: ResMut<RenderWorldState>,
    mut chunk_streaming_state: ResMut<ChunkStreamingState>,
    mut world_command_queue: ResMut<WorldCommandQueue>,
) {
    if replay_mode.active {
        return;
    }

    let Some(entity_id) = primary_entity_id.0 else {
        return;
    };
    if render_world_state.chunk_edge == 0 {
        return;
    }
    let Some(entity) = render_world_state.entities.get(&entity_id) else {
        return;
    };
    let Some(center_chunk) = world_pos_to_chunk_coord(
        entity.position,
        render_world_state.chunk_edge,
        render_world_state.world_chunks,
    ) else {
        return;
    };

    let desired = chunk_window(center_chunk, render_world_state.world_chunks);

    if chunk_streaming_state.last_center_chunk != Some(center_chunk) {
        info!(
            "Player chunk changed to ({}, {}, {}), loaded_chunks={}, desired_window={}",
            center_chunk.x,
            center_chunk.y,
            center_chunk.z,
            world_sim_diagnostics.loaded_chunk_count,
            desired.len()
        );
        chunk_streaming_state.last_center_chunk = Some(center_chunk);
    }

    if !chunk_streaming_state.loaded_chunks.contains(&center_chunk) {
        warn!(
            "Center chunk ({}, {}, {}) was not tracked as loaded; enqueueing load",
            center_chunk.x, center_chunk.y, center_chunk.z
        );
    }

    let mut tracked_chunk_set_changed = false;
    for chunk in desired.difference(&chunk_streaming_state.loaded_chunks) {
        world_command_queue.set_chunk_loaded(*chunk, true);
        tracked_chunk_set_changed = true;
    }

    chunk_streaming_state.loaded_chunks.extend(desired);
    if tracked_chunk_set_changed {
        render_world_state.terrain_dirty = true;
    }
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
    mut view_z: ResMut<ViewZLevel>,
    mut render_world_state: ResMut<RenderWorldState>,
) {
    let world_snapshot = &world_view.snapshot();
    let world_min_z = -(world_snapshot.chunk_edge as i32);
    let world_max_z = (world_snapshot.chunk_edge as i32) * (world_snapshot.world_chunks.z as i32) - 1;

    let z_up_pressed = input_state.just_pressed(&input_state.z_level_up);
    let z_down_pressed = input_state.just_pressed(&input_state.z_level_down);

    if z_up_pressed {
        view_z.0 = (view_z.0 + 1).min(world_max_z);
        render_world_state.terrain_dirty = true;
    }
    if z_down_pressed {
        view_z.0 = (view_z.0 - 1).max(world_min_z);
        render_world_state.terrain_dirty = true;
    }
}

fn movement_direction_from_keys(
    input_state: &InputState,
    first: Option<KeyCode>,
    second: Option<KeyCode>,
) -> IVec3 {
    match (first, second) {
        (Some(first), Some(second)) => {
            input_state.movement_direction(first) + input_state.movement_direction(second)
        }
        (Some(first), None) => input_state.movement_direction(first),
        _ => IVec3::ZERO,
    }
}

fn direction_contains(container: IVec3, direction: IVec3) -> bool {
    if container == IVec3::ZERO || direction == IVec3::ZERO {
        return false;
    }

    (direction.x == 0 || container.x.signum() == direction.x.signum())
        && (direction.y == 0 || container.y.signum() == direction.y.signum())
        && (direction.z == 0 || container.z.signum() == direction.z.signum())
}

fn apply_snapshot(render_world_state: &mut RenderWorldState, snapshot: WorldSnapshot) {
    render_world_state.tick = snapshot.tick;
    render_world_state.chunk_edge = snapshot.chunk_edge;
    render_world_state.world_chunks = snapshot.world_chunks;
    render_world_state.blocks = snapshot.blocks;
    render_world_state.entities = snapshot
        .entities
        .into_iter()
        .map(|entity| {
            (
                entity.id,
                RenderEntityState {
                    position: entity.position,
                    facing_left: entity.facing_left,
                    is_prone: entity.is_prone,
                    movement: entity.movement.map(render_movement_state),
                },
            )
        })
        .collect();
    render_world_state.mark_all_dirty();
}

fn apply_update(render_world_state: &mut RenderWorldState, update: WorldUpdate) {
    match update {
        WorldUpdate::Snapshot(snapshot) => apply_snapshot(render_world_state, snapshot),
        WorldUpdate::Delta(delta) => {
            render_world_state.tick = delta.tick;
            for movement in delta.moved_entities {
                render_world_state.entities.insert(
                    movement.id,
                    RenderEntityState {
                        position: movement.to,
                        facing_left: movement.facing_left_after,
                        is_prone: movement.is_prone_after,
                        movement: movement.movement_after.map(render_movement_state),
                    },
                );
            }
            render_world_state.entities_dirty = true;
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn describe_replay_event(event: &ReplayEvent) -> String {
    match event {
        ReplayEvent::Command {
            tick_before,
            command,
        } => match command {
            WorldCommand::MoveEntity { id, direction } => {
                format!(
                    "[tick {tick_before}] CMD MoveEntity id={id} dir=({}, {}, {})",
                    direction.x, direction.y, direction.z
                )
            }
            WorldCommand::AdvanceTicks { count } => {
                format!("[tick {tick_before}] CMD AdvanceTicks count={count}")
            }
            WorldCommand::SetChunkLoaded { chunk, loaded } => {
                format!(
                    "[tick {tick_before}] CMD SetChunkLoaded chunk=({}, {}, {}) loaded={}",
                    chunk.x, chunk.y, chunk.z, loaded
                )
            }
        },
        ReplayEvent::Update(WorldUpdate::Snapshot(snapshot)) => {
            format!(
                "UPDATE Snapshot tick={} entities={}",
                snapshot.tick,
                snapshot.entities.len()
            )
        }
        ReplayEvent::Update(WorldUpdate::Delta(delta)) => {
            format!(
                "UPDATE Delta tick={} moved={}",
                delta.tick,
                delta.moved_entities.len()
            )
        }
        ReplayEvent::Checkpoint(snapshot) => {
            format!(
                "CHECKPOINT tick={} entities={}",
                snapshot.tick,
                snapshot.entities.len()
            )
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn try_load_replay_playback() -> Option<ReplayPlayback> {
    let replay_path = std::env::var(REPLAY_PATH_ENV).ok()?;
    match load_replay(std::path::Path::new(&replay_path)) {
        Ok(replay) => {
            info!(
                "Loaded replay from {} with {} events",
                replay_path,
                replay.events.len()
            );
            Some(ReplayPlayback {
                events: replay.events,
                cursor: 0,
                playing: false,
            })
        }
        Err(err) => {
            warn!("Failed to load replay from {replay_path}: {err}");
            None
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn apply_first_checkpoint(
    replay_playback: &mut ReplayPlayback,
    render_world_state: &mut RenderWorldState,
) -> bool {
    while replay_playback.cursor < replay_playback.events.len() {
        let event = replay_playback.events[replay_playback.cursor].clone();
        replay_playback.cursor += 1;
        match event {
            ReplayEvent::Checkpoint(snapshot) => {
                apply_snapshot(render_world_state, snapshot);
                return true;
            }
            ReplayEvent::Update(update) => {
                apply_update(render_world_state, update);
                return true;
            }
            ReplayEvent::Command { .. } => {}
        }
    }
    false
}

#[cfg(not(target_arch = "wasm32"))]
fn apply_next_replay_event(
    replay_playback: &mut ReplayPlayback,
    render_world_state: &mut RenderWorldState,
) -> bool {
    while replay_playback.cursor < replay_playback.events.len() {
        let event = replay_playback.events[replay_playback.cursor].clone();
        replay_playback.cursor += 1;
        match event {
            ReplayEvent::Command { .. } => {}
            ReplayEvent::Update(update) => {
                apply_update(render_world_state, update);
                return true;
            }
            ReplayEvent::Checkpoint(snapshot) => {
                apply_snapshot(render_world_state, snapshot);
                return true;
            }
        }
    }
    false
}

fn world_pos_in_chunk(chunk_coord: Vec3i, chunk_edge: u32, x: u32, y: u32, z: i32) -> Vec3i {
    let edge_i = i32::try_from(chunk_edge).expect("chunk edge does not fit in i32");
    let half = edge_i / 2;
    Vec3i::new(
        chunk_coord
            .x
            .checked_mul(edge_i)
            .and_then(|base| base.checked_add(i32::try_from(x).expect("x does not fit in i32")))
            .and_then(|value| value.checked_sub(half))
            .expect("world x in chunk overflowed"),
        chunk_coord
            .y
            .checked_mul(edge_i)
            .and_then(|base| base.checked_add(i32::try_from(y).expect("y does not fit in i32")))
            .and_then(|value| value.checked_sub(half))
            .expect("world y in chunk overflowed"),
        z,
    )
}

fn stone_tile_index(world_position: Vec3i) -> u16 {
    let pattern = (world_position.x + world_position.y).rem_euclid(6) + 1;
    u16::try_from(pattern).expect("stone tile pattern index should fit in u16")
}

fn build_chunk_tile_data(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    blocks: &[BlockType],
    world_chunks: Vec3u,
) -> Vec<Option<TileData>> {
    let tile_count = chunk_edge
        .checked_mul(chunk_edge)
        .expect("chunk tile count overflowed");
    let mut tile_data = vec![None; usize::try_from(tile_count).expect("tile count too large")];

    // For compatibility with existing code that expects Vec3i chunk coords
    let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);

    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let world_position =
                world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);
            let index_in_slice = usize::try_from(local_y)
                .expect("local_y does not fit in usize")
                .checked_mul(usize::try_from(chunk_edge).expect("chunk edge does not fit in usize"))
                .and_then(|offset| {
                    offset.checked_add(
                        usize::try_from(local_x).expect("local_x does not fit in usize"),
                    )
                })
                .expect("chunk-local tile index overflowed");

            if matches!(
                block_at_world_position(blocks, world_chunks, chunk_edge, world_position),
                Some(BlockType::SolidStone)
            ) {
                let is_perimeter = local_x == 0
                    || local_y == 0
                    || local_x == chunk_edge.saturating_sub(1)
                    || local_y == chunk_edge.saturating_sub(1);
                let tile_index = if is_perimeter {
                    14
                } else {
                    stone_tile_index(world_position)
                };
                tile_data[index_in_slice] = Some(TileData::from_tileset_index(tile_index));
            }
        }
    }

    tile_data
}

fn build_shadow_tile_data(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    blocks: &[BlockType],
    world_chunks: Vec3u,
) -> Vec<Option<TileData>> {
    let tile_count = chunk_edge
        .checked_mul(chunk_edge)
        .expect("chunk tile count overflowed");
    let mut tile_data = vec![None; usize::try_from(tile_count).expect("tile count too large")];

    let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);

    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let world_position =
                world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);
            let index_in_slice = usize::try_from(local_y)
                .expect("local_y does not fit in usize")
                .checked_mul(usize::try_from(chunk_edge).expect("chunk edge does not fit in usize"))
                .and_then(|offset| {
                    offset.checked_add(
                        usize::try_from(local_x).expect("local_x does not fit in usize"),
                    )
                })
                .expect("chunk-local tile index overflowed");

            // Only place shadows on AIR tiles that border solid neighbors
            if matches!(
                block_at_world_position(blocks, world_chunks, chunk_edge, world_position),
                Some(BlockType::Air) | None
            ) {
                let mask = compute_shadow_mask_for_air(
                    world_position.x,
                    world_position.y,
                    world_position.z,
                    blocks,
                    world_chunks,
                    chunk_edge,
                );
                if mask != 0 {
                    tile_data[index_in_slice] = Some(TileData::from_tileset_index((mask - 1) as u16));
                }
            }
        }
    }

    tile_data
}

fn calculate_sprite_z(z_offset: i32, layer: TileLayer) -> f32 {
    let base = match z_offset {
        0 => 0.0,
        -1 => -2.0,
        -2 => -4.0,
        -3 => -6.0,
        -4 => -8.0,
        -5 => -10.0,
        _ => -10.0, // Clamp to deepest level
    };

    match layer {
        TileLayer::Floor => base,
        TileLayer::ShadowOverlay => base + 0.5,
    }
}

fn get_depth_tint_color(z_offset: i32) -> (Color, f32) {
    // z_offset is negative (e.g., -1, -2, etc.)
    match z_offset {
        -1 => (Color::srgba(0.0, 0.0, 0.0, 0.25), -1.0), // 25% black
        -2 => (Color::srgba(0.05, 0.08, 0.18, 0.45), -3.0), // blue-gray 45%
        -3 => (Color::srgba(0.05, 0.08, 0.18, 0.60), -5.0), // blue-gray 60%
        -4 => (Color::srgba(0.05, 0.08, 0.18, 0.72), -7.0), // blue-gray 72%
        -5 => (Color::srgba(0.05, 0.08, 0.18, 0.82), -9.0), // blue-gray 82%
        _ => (Color::srgba(0.05, 0.08, 0.18, 0.82), -9.0), // Default to deepest
    }
}

fn chunk_world_translation_xy(chunk_xy: IVec2, chunk_edge: u32, sprite_z: f32) -> Vec3 {
    let edge = chunk_edge as f32;
    let tile_size = f32::from(TILE_SIZE_IN_PX);
    Vec3::new(
        (chunk_xy.x as f32) * edge * tile_size,
        (chunk_xy.y as f32) * edge * tile_size,
        sprite_z,
    )
}

fn world_to_pixel_translation(world_position: Vec3i, tile_size: f32) -> Vec3 {
    Vec3::new(
        ((world_position.x as f32) + 0.5) * tile_size,
        ((world_position.y as f32) + 0.5) * tile_size,
        1.0,
    )
}

fn world_to_pixel_translation_f32(world_position: Vec3, tile_size: f32) -> Vec3 {
    Vec3::new(
        (world_position.x + 0.5) * tile_size,
        (world_position.y + 0.5) * tile_size,
        1.0,
    )
}

fn render_movement_state(movement: EntityMovementSnapshot) -> RenderEntityMovementState {
    RenderEntityMovementState {
        start_position: Vec3::new(
            movement.start_position[0],
            movement.start_position[1],
            movement.start_position[2],
        ),
        origin: movement.origin,
        target: movement.target,
        progress_percent: movement.progress_percent,
    }
}

fn render_movement_direction(movement: RenderEntityMovementState) -> IVec3 {
    IVec3::new(
        (movement.target.x - movement.origin.x).signum(),
        (movement.target.y - movement.origin.y).signum(),
        (movement.target.z - movement.origin.z).signum(),
    )
}

#[cfg(test)]
mod tests {
    use super::direction_contains;
    use bevy::math::IVec3;

    #[test]
    fn direction_contains_requires_active_direction_to_still_be_held() {
        assert!(direction_contains(
            IVec3::new(1, -1, 0),
            IVec3::new(0, -1, 0)
        ));
        assert!(direction_contains(IVec3::new(1, 1, 0), IVec3::new(1, 0, 0)));
        assert!(!direction_contains(
            IVec3::new(1, 0, 0),
            IVec3::new(0, -1, 0)
        ));
        assert!(!direction_contains(
            IVec3::new(0, -1, 0),
            IVec3::new(0, -1, 1)
        ));
    }
}

fn all_world_chunk_coords(world_chunks: Vec3u) -> HashSet<Vec3i> {
    let mut result = HashSet::new();
    let center_x = i32::try_from(world_chunks.x).expect("world_chunks.x too large") / 2;
    let center_y = i32::try_from(world_chunks.y).expect("world_chunks.y too large") / 2;
    let center_z = i32::try_from(world_chunks.z).expect("world_chunks.z too large") / 2;

    for z in 0..world_chunks.z {
        for y in 0..world_chunks.y {
            for x in 0..world_chunks.x {
                result.insert(Vec3i::new(
                    i32::try_from(x).expect("x too large") - center_x,
                    i32::try_from(y).expect("y too large") - center_y,
                    i32::try_from(z).expect("z too large") - center_z,
                ));
            }
        }
    }

    result
}

fn chunk_window(center_chunk: Vec3i, world_chunks: Vec3u) -> HashSet<Vec3i> {
    let all_chunks = all_world_chunk_coords(world_chunks);
    let mut window = HashSet::new();
    for z in (center_chunk.z - CHUNK_STREAM_RADIUS_Z)..=(center_chunk.z + CHUNK_STREAM_RADIUS_Z) {
        for y in
            (center_chunk.y - CHUNK_STREAM_RADIUS_XY)..=(center_chunk.y + CHUNK_STREAM_RADIUS_XY)
        {
            for x in (center_chunk.x - CHUNK_STREAM_RADIUS_XY)
                ..=(center_chunk.x + CHUNK_STREAM_RADIUS_XY)
            {
                let chunk = Vec3i::new(x, y, z);
                if all_chunks.contains(&chunk) {
                    window.insert(chunk);
                }
            }
        }
    }
    window
}

fn world_pos_to_chunk_coord(
    world_position: Vec3i,
    chunk_edge: u32,
    world_chunks: Vec3u,
) -> Option<Vec3i> {
    let edge = chunk_edge.max(1);
    let world_size = Vec3u::new(
        world_chunks.x.checked_mul(edge)?,
        world_chunks.y.checked_mul(edge)?,
        world_chunks.z.checked_mul(edge)?,
    );
    let min = Vec3i::new(
        -(i32::try_from(world_size.x).ok()? / 2),
        -(i32::try_from(world_size.y).ok()? / 2),
        -(i32::try_from(world_size.z).ok()? / 2),
    );

    let local_x = world_position.x - min.x;
    let local_y = world_position.y - min.y;
    let local_z = world_position.z - min.z;
    if local_x < 0 || local_y < 0 || local_z < 0 {
        return None;
    }

    let local_x_u = u32::try_from(local_x).ok()?;
    let local_y_u = u32::try_from(local_y).ok()?;
    let local_z_u = u32::try_from(local_z).ok()?;
    if local_x_u >= world_size.x || local_y_u >= world_size.y || local_z_u >= world_size.z {
        return None;
    }

    let chunk_local_x = local_x_u / edge;
    let chunk_local_y = local_y_u / edge;
    let chunk_local_z = local_z_u / edge;

    let center_x = i32::try_from(world_chunks.x).ok()? / 2;
    let center_y = i32::try_from(world_chunks.y).ok()? / 2;
    let center_z = i32::try_from(world_chunks.z).ok()? / 2;

    Some(Vec3i::new(
        i32::try_from(chunk_local_x).ok()? - center_x,
        i32::try_from(chunk_local_y).ok()? - center_y,
        i32::try_from(chunk_local_z).ok()? - center_z,
    ))
}

/// Compute which cardinal edges of a tile are exposed (adjacent to air).
/// Returns a 4-bit mask: bit 0 (N), bit 1 (E), bit 2 (S), bit 3 (W)
/// Compute shadow mask for an AIR tile by checking which cardinal neighbors are SOLID.
/// Returns a 4-bit mask: bit 0 (N), bit 1 (E), bit 2 (S), bit 3 (W).
/// Shadows appear on the edges of air tiles that face solid neighbors.
fn compute_shadow_mask_for_air(
    x: i32,
    y: i32,
    z: i32,
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
) -> u8 {
    let mut mask = 0u8;

    // North (y+1): solid neighbor → shadow on top edge of this air tile
    if block_at_world_position(blocks, world_chunks, chunk_edge, Vec3i::new(x, y + 1, z))
        .map(|b| b == BlockType::SolidStone)
        .unwrap_or(false)
    {
        mask |= 1;
    }

    // East (x+1): solid neighbor → shadow on right edge
    if block_at_world_position(blocks, world_chunks, chunk_edge, Vec3i::new(x + 1, y, z))
        .map(|b| b == BlockType::SolidStone)
        .unwrap_or(false)
    {
        mask |= 2;
    }

    // South (y-1): solid neighbor → shadow on bottom edge
    if block_at_world_position(blocks, world_chunks, chunk_edge, Vec3i::new(x, y - 1, z))
        .map(|b| b == BlockType::SolidStone)
        .unwrap_or(false)
    {
        mask |= 4;
    }

    // West (x-1): solid neighbor → shadow on left edge
    if block_at_world_position(blocks, world_chunks, chunk_edge, Vec3i::new(x - 1, y, z))
        .map(|b| b == BlockType::SolidStone)
        .unwrap_or(false)
    {
        mask |= 8;
    }

    mask
}

fn block_at_world_position(
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
    world_position: Vec3i,
) -> Option<BlockType> {
    let world_size = Vec3u::new(
        world_chunks
            .x
            .checked_mul(chunk_edge)
            .expect("world x-size overflowed"),
        world_chunks
            .y
            .checked_mul(chunk_edge)
            .expect("world y-size overflowed"),
        world_chunks
            .z
            .checked_mul(chunk_edge)
            .expect("world z-size overflowed"),
    );
    let min = Vec3i::new(
        -(i32::try_from(world_size.x).expect("world size x too large") / 2),
        -(i32::try_from(world_size.y).expect("world size y too large") / 2),
        -(i32::try_from(world_size.z).expect("world size z too large") / 2),
    );

    let local_x = world_position.x - min.x;
    let local_y = world_position.y - min.y;
    let local_z = world_position.z - min.z;

    if local_x < 0
        || local_y < 0
        || local_z < 0
        || u32::try_from(local_x).ok()? >= world_size.x
        || u32::try_from(local_y).ok()? >= world_size.y
        || u32::try_from(local_z).ok()? >= world_size.z
    {
        return None;
    }

    let local_x_u = usize::try_from(local_x).ok()?;
    let local_y_u = usize::try_from(local_y).ok()?;
    let local_z_u = usize::try_from(local_z).ok()?;
    let world_size_x = usize::try_from(world_size.x).ok()?;
    let world_size_y = usize::try_from(world_size.y).ok()?;
    let index = local_z_u
        .checked_mul(world_size_x.checked_mul(world_size_y)?)?
        .checked_add(local_y_u.checked_mul(world_size_x)?)?
        .checked_add(local_x_u)?;
    blocks.get(index).copied()
}
