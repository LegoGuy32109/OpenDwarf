use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use bevy::math::Isometry2d;
use bevy::prelude::*;
use bevy::sprite_render::{TileData, TilemapChunk, TilemapChunkTileData};

use crate::resources::input_state::InputState;
use crate::resources::view_mode::ViewMode;
use crate::resources::view_z_level::ViewZLevel;
use world_sim::bevy_app::PrimarySimulationEntityId;
use world_sim::bevy_app::WorldCommandQueue;
use world_sim::bevy_app::WorldSimDiagnostics;
use world_sim::bevy_app::WorldView;
#[cfg(not(target_arch = "wasm32"))]
use world_sim::replay::{ReplayEvent, load_replay};
use world_sim::world_api::{
    BlockType, EntityMovementSnapshot, TileMemory, Vec3i, Vec3u, WorldCommand, WorldSnapshot,
    WorldUpdate,
};

use super::visuals::{Player, PlayerRenderTarget, TILE_SIZE_IN_PX, TilemapAssets};

const CHUNK_STREAM_RADIUS_XY: i32 = 2;
const CHUNK_STREAM_RADIUS_Z: i32 = 1;
const Z_LEVELS_BELOW_RENDERED: i32 = 5;
const REMEMBERED_FOG_RGBA: [f32; 4] = [0.7, 0.7, 0.2, 0.05];
const GLOBAL_MEMORY_OVERLAY_SPRITE_Z: f32 = 2.0;
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
pub struct TerrainConfig {
    pub chunk_edge: u32,
    pub world_chunks: Vec3u,
}

#[derive(Resource, Default)]
pub struct TerrainData {
    pub source_blocks: Arc<HashMap<Vec3i, BlockType>>,
    pub blocks: HashMap<Vec3i, BlockType>,
    pub dirty: bool,
}

#[derive(Resource, Default)]
pub struct RenderEntityData {
    pub tick: u64,
    pub entities: BTreeMap<u64, RenderEntityState>,
    pub dirty: bool,
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
pub struct FogData {
    pub visible: HashSet<Vec3i>,
    pub memory: HashMap<Vec3i, TileMemory>,
    pub dirty: bool,
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

#[derive(Resource, Debug, Clone, Copy)]
pub struct TileLayerDebugState {
    pub show_floor: bool,
    pub show_edge_shadow: bool,
    pub show_ceiling_shadow: bool,
    pub show_fog_shadow: bool,
    pub show_depth_stack: bool,
}

impl Default for TileLayerDebugState {
    fn default() -> Self {
        Self {
            show_floor: true,
            show_edge_shadow: true,
            show_ceiling_shadow: true,
            show_fog_shadow: true,
            show_depth_stack: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TileLayer {
    Floor,
    EdgeShadow,
    /// Dual-grid ceiling shadow: rendered half a tile offset, shows solid blocks at z+1 above.
    CeilingShadow,
    /// Entity-mode memory overlay: transparent for visible and unknown tiles,
    /// yellow for remembered or currently-not-visible rendered tiles.
    FogShadow,
}

#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorldTileChunk {
    pub chunk_xy: IVec2,
    pub world_z: i32,
    pub layer: TileLayer,
}

#[derive(Component)]
pub struct DepthDebugLabel;

pub fn setup_simulation_state(mut commands: Commands) {
    let mut replay_mode = ReplayMode::default();
    let mut config = TerrainConfig::default();
    let mut terrain = TerrainData::default();
    let mut entities = RenderEntityData::default();
    let viewport = crate::resources::render_viewport::RenderViewport::default();
    let tile_layer_debug_state = TileLayerDebugState::default();
    let mut invalidation = crate::domain::tilemap_invalidation::TilemapInvalidation::default();

    #[cfg(not(target_arch = "wasm32"))]
    if let Some(mut replay_playback) = try_load_replay_playback() {
        replay_mode.active = true;
        replay_playback.playing = false;
        if !apply_first_checkpoint(
            &mut replay_playback,
            &mut config,
            &mut terrain,
            &mut entities,
            &viewport,
            &tile_layer_debug_state,
            &mut invalidation,
        ) {
            warn!("Replay did not contain any checkpoint/snapshot data");
        }
        commands.insert_resource(replay_playback);
    }

    let replay_hud_state = ReplayHudState {
        active: replay_mode.active,
        playing: false,
        cursor: 0,
        total_events: 0,
        tick: entities.tick,
        show_all_events: false,
        event_labels: Vec::new(),
    };

    commands.insert_resource(replay_mode);
    commands.insert_resource(replay_hud_state);
    commands.insert_resource(HeldMovementState::default());
    commands.insert_resource(config);
    commands.insert_resource(terrain);
    commands.insert_resource(entities);
    commands.insert_resource(FogData::default());
    commands.insert_resource(ChunkStreamingState::default());
    commands.insert_resource(ChunkBorderDebugState::default());
    commands.insert_resource(tile_layer_debug_state);
    commands.insert_resource(TilemapRenderMetrics::default());
    commands.insert_resource(viewport);
    commands.insert_resource(invalidation);
}

pub fn toggle_tile_layers(
    input_state: Res<InputState>,
    mut tile_layer_debug_state: ResMut<TileLayerDebugState>,
    mut terrain: ResMut<TerrainData>,
    mut fog_data: ResMut<FogData>,
    mut invalidation: ResMut<crate::domain::tilemap_invalidation::TilemapInvalidation>,
) {
    let mut changed = false;

    if input_state.just_pressed_key(KeyCode::Digit6) {
        tile_layer_debug_state.show_floor = !tile_layer_debug_state.show_floor;
        changed = true;
    }
    if input_state.just_pressed_key(KeyCode::Digit7) {
        tile_layer_debug_state.show_edge_shadow = !tile_layer_debug_state.show_edge_shadow;
        changed = true;
    }
    if input_state.just_pressed_key(KeyCode::Digit8) {
        tile_layer_debug_state.show_ceiling_shadow = !tile_layer_debug_state.show_ceiling_shadow;
        changed = true;
    }
    if input_state.just_pressed_key(KeyCode::Digit9) {
        tile_layer_debug_state.show_fog_shadow = !tile_layer_debug_state.show_fog_shadow;
        changed = true;
    }
    if input_state.just_pressed_key(KeyCode::Digit0) {
        tile_layer_debug_state.show_depth_stack = !tile_layer_debug_state.show_depth_stack;
        changed = true;
    }

    if changed {
        terrain.dirty = true;
        fog_data.dirty = true;
        invalidation.invalidate_view();
    }
}

pub fn queue_world_commands_from_input(
    input_state: Res<InputState>,
    replay_mode: Res<ReplayMode>,
    primary_entity_id: Res<PrimarySimulationEntityId>,
    entity_data: Res<RenderEntityData>,
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

    let Some(entity) = entity_data.entities.get(&entity_id) else {
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
    view_mode: Res<ViewMode>,
    view_z: Res<ViewZLevel>,
    viewport: Res<crate::resources::render_viewport::RenderViewport>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    mut config: ResMut<TerrainConfig>,
    mut terrain: ResMut<TerrainData>,
    mut entity_data: ResMut<RenderEntityData>,
    mut fog_data: ResMut<FogData>,
    mut invalidation: ResMut<crate::domain::tilemap_invalidation::TilemapInvalidation>,
) {
    if replay_mode.active {
        return;
    }

    let snapshot = world_view.snapshot();
    if entity_data.tick == snapshot.tick
        && config.chunk_edge == snapshot.chunk_edge
        && config.world_chunks == snapshot.world_chunks
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
    );
}

#[cfg(not(target_arch = "wasm32"))]
pub fn drive_replay_playback(
    replay_mode: Res<ReplayMode>,
    keyboard_input: Res<ButtonInput<KeyCode>>,
    replay_playback: Option<ResMut<ReplayPlayback>>,
    mut replay_hud_state: ResMut<ReplayHudState>,
    mut config: ResMut<TerrainConfig>,
    mut terrain: ResMut<TerrainData>,
    mut entity_data: ResMut<RenderEntityData>,
    viewport: Res<crate::resources::render_viewport::RenderViewport>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    mut invalidation: ResMut<crate::domain::tilemap_invalidation::TilemapInvalidation>,
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
        entity_data.entities.clear();
        terrain.source_blocks = Arc::default();
        terrain.blocks.clear();
        config.chunk_edge = 0;
        config.world_chunks = Vec3u::default();
        entity_data.tick = 0;
        terrain.dirty = true;
        entity_data.dirty = true;
        invalidation.clear();
        let _ = apply_first_checkpoint(
            &mut replay_playback,
            &mut config,
            &mut terrain,
            &mut entity_data,
            &viewport,
            &tile_layer_debug_state,
            &mut invalidation,
        );
        info!("Replay reset to beginning");
    }

    if keyboard_input.just_pressed(KeyCode::F7) {
        let _ = apply_next_replay_event(
            &mut replay_playback,
            &mut config,
            &mut terrain,
            &mut entity_data,
            &viewport,
            &tile_layer_debug_state,
            &mut invalidation,
        );
    }

    if keyboard_input.just_pressed(KeyCode::F9) {
        replay_hud_state.show_all_events = !replay_hud_state.show_all_events;
    }

    if replay_playback.playing
        && !apply_next_replay_event(
            &mut replay_playback,
            &mut config,
            &mut terrain,
            &mut entity_data,
            &viewport,
            &tile_layer_debug_state,
            &mut invalidation,
        )
    {
        replay_playback.playing = false;
        info!("Replay playback reached end");
    }

    replay_hud_state.playing = replay_playback.playing;
    replay_hud_state.cursor = replay_playback.cursor;
    replay_hud_state.tick = entity_data.tick;
    replay_hud_state.event_labels = replay_playback
        .events
        .iter()
        .map(describe_replay_event)
        .collect();
}

fn active_chunks_xy(
    replay_active: bool,
    world_chunks: Vec3u,
    chunk_streaming_state: Option<&ChunkStreamingState>,
) -> HashSet<IVec2> {
    if replay_active {
        all_world_chunk_coords(world_chunks)
            .into_iter()
            .map(|c| IVec2::new(c.x, c.y))
            .collect()
    } else if let Some(streaming) = chunk_streaming_state {
        if streaming.loaded_chunks.is_empty() {
            all_world_chunk_coords(world_chunks)
                .into_iter()
                .map(|c| IVec2::new(c.x, c.y))
                .collect()
        } else {
            streaming
                .loaded_chunks
                .iter()
                .map(|c| IVec2::new(c.x, c.y))
                .collect()
        }
    } else {
        all_world_chunk_coords(world_chunks)
            .into_iter()
            .map(|c| IVec2::new(c.x, c.y))
            .collect()
    }
}

fn z_levels_to_render(view_z_current: i32) -> Vec<i32> {
    (0..=Z_LEVELS_BELOW_RENDERED)
        .map(|offset| view_z_current - offset)
        .collect()
}

fn chunk_local_tile_index(local_x: u32, local_y: u32, chunk_edge: u32) -> usize {
    usize::try_from(local_y)
        .expect("local_y does not fit in usize")
        .checked_mul(usize::try_from(chunk_edge).expect("chunk edge does not fit in usize"))
        .and_then(|offset| {
            offset.checked_add(usize::try_from(local_x).expect("local_x does not fit in usize"))
        })
        .expect("chunk-local tile index overflowed")
}

pub fn project_world_to_tilemap(
    mut commands: Commands,
    replay_mode: Res<ReplayMode>,
    chunk_streaming_state: Option<Res<ChunkStreamingState>>,
    view_z: Res<ViewZLevel>,
    view_mode: Res<ViewMode>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    tilemap_assets: Res<TilemapAssets>,
    shadow_atlas: Res<super::visuals::EdgeShadowAtlas>,
    obscure_atlas: Res<super::visuals::CeilingShadowAtlas>,
    fog_atlas: Res<super::visuals::FogShadowAtlas>,
    config: Res<TerrainConfig>,
    mut terrain: ResMut<TerrainData>,
    mut fog_data: ResMut<FogData>,
    mut tilemap_render_metrics: ResMut<TilemapRenderMetrics>,
    mut chunk_query: Query<(
        Entity,
        &WorldTileChunk,
        &TilemapChunk,
        &mut TilemapChunkTileData,
        &mut Transform,
    )>,
    mut invalidation: ResMut<crate::domain::tilemap_invalidation::TilemapInvalidation>,
) {
    #[cfg(not(target_arch = "wasm32"))]
    let start = std::time::Instant::now();

    // Z-level changes require tile data rebuild for depth tinting
    if view_z.is_changed() {
        terrain.dirty = true;
        fog_data.dirty = true;
        invalidation.invalidate_view();
    }

    // ViewMode changes should refresh the full tile projection immediately.
    if view_mode.is_changed() {
        terrain.dirty = true;
        fog_data.dirty = true;
        invalidation.invalidate_view();
    }

    if tile_layer_debug_state.is_changed() {
        terrain.dirty = true;
        fog_data.dirty = true;
        invalidation.invalidate_view();
    }

    if !terrain.dirty && !fog_data.dirty {
        return;
    }

    let terrain_rebuild = terrain.dirty;
    let fog_rebuild = fog_data.dirty;

    // Phase 2 equivalence check: invalidation and dirty flags should track the same state.
    // If this fires, a producer site is missing an invalidation call.
    debug_assert_eq!(
        invalidation.is_empty() && !invalidation.view_invalidated(),
        !terrain.dirty && !fog_data.dirty,
        "invalidation state diverged from dirty flags: invalidation empty={}, view_invalidated={}, terrain.dirty={}, fog_data.dirty={}",
        invalidation.is_empty(),
        invalidation.view_invalidated(),
        terrain.dirty,
        fog_data.dirty
    );

    let chunk_edge = config.chunk_edge;
    if chunk_edge == 0 {
        return;
    }

    let active_chunks_xy = active_chunks_xy(
        replay_mode.active,
        config.world_chunks,
        chunk_streaming_state.as_deref(),
    );

    let entity_mode = *view_mode == ViewMode::Entity;
    let render_blocks = if entity_mode {
        &terrain.blocks
    } else {
        terrain.source_blocks.as_ref()
    };

    let render_floor = tile_layer_debug_state.show_floor;
    let render_edge_shadow = tile_layer_debug_state.show_edge_shadow;
    let render_ceiling_shadow = tile_layer_debug_state.show_ceiling_shadow;
    let render_fog_shadow = entity_mode && tile_layer_debug_state.show_fog_shadow;
    let render_depth_stack = tile_layer_debug_state.show_depth_stack;

    // Determine which z-levels to render: current level, or the current level plus
    // up to 5 levels below when depth stacking is enabled.
    let rendered_z_levels = if render_depth_stack {
        z_levels_to_render(view_z.current)
    } else {
        vec![view_z.current]
    };

    // Collect existing chunk keys (chunk_xy, z, layer)
    let existing_chunks: HashSet<(IVec2, i32, TileLayer)> = chunk_query
        .iter()
        .map(|(_, chunk, _, _, _)| (chunk.chunk_xy, chunk.world_z, chunk.layer))
        .collect();

    // Spawn new chunks and update existing ones.
    for &chunk_xy in &active_chunks_xy {
        if terrain_rebuild {
            for &world_z in &rendered_z_levels {
                if render_floor {
                    // Spawn floor layer.
                    let chunk_key = (chunk_xy, world_z, TileLayer::Floor);
                    if !existing_chunks.contains(&chunk_key) {
                        let z_offset = world_z - view_z.current;
                        let tile_data = build_chunk_tile_data(
                            chunk_xy,
                            world_z,
                            chunk_edge,
                            render_blocks,
                            z_offset,
                            render_depth_stack,
                        );

                        let sprite_z = calculate_sprite_z(z_offset, TileLayer::Floor);
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
                            Transform::from_translation(chunk_world_translation_xy(
                                chunk_xy, chunk_edge, sprite_z,
                            )),
                            GlobalTransform::default(),
                            Visibility::default(),
                            InheritedVisibility::default(),
                            ViewVisibility::default(),
                        ));
                    }
                }

                if render_edge_shadow {
                    // Shadow overlay is rendered at all visible z-levels to show elevation edges.
                    // To avoid visual stacking of overlapping edges, only render if there's no edge above this level.
                    let edge_shadow_key = (chunk_xy, world_z, TileLayer::EdgeShadow);
                    if rendered_z_levels.contains(&world_z)
                        && !existing_chunks.contains(&edge_shadow_key)
                    {
                        // Check if the z-level above has an edge at the same location.
                        // If it does, skip rendering here (the edge above takes visual precedence).
                        let z_above = world_z + 1;
                        let has_edge_above = if rendered_z_levels.contains(&z_above) {
                            // If the level above is also visible, check for edges there
                            chunk_has_edge(
                                chunk_xy,
                                z_above,
                                chunk_edge,
                                render_blocks,
                                entity_mode,
                            )
                        } else {
                            // If above is outside the visible range, render edges at this level
                            false
                        };

                        if !has_edge_above {
                            let edge_shadow_data = build_edge_shadow_tile_data(
                                chunk_xy,
                                world_z,
                                chunk_edge,
                                render_blocks,
                                entity_mode,
                            );
                            let z_offset = world_z - view_z.current;
                            let edge_shadow_sprite_z =
                                calculate_sprite_z(z_offset, TileLayer::EdgeShadow);
                            let half_tile = f32::from(super::visuals::TILE_SIZE_IN_PX) / 2.0;
                            commands.spawn((
                                WorldTileChunk {
                                    chunk_xy,
                                    world_z,
                                    layer: TileLayer::EdgeShadow,
                                },
                                TilemapChunk {
                                    chunk_size: UVec2::splat(chunk_edge),
                                    tile_display_size: UVec2::splat(64),
                                    tileset: shadow_atlas.atlas.clone(),
                                    alpha_mode: bevy::sprite_render::AlphaMode2d::Blend,
                                },
                                TilemapChunkTileData(edge_shadow_data),
                                Transform::from_translation(
                                    chunk_world_translation_xy(
                                        chunk_xy,
                                        chunk_edge,
                                        edge_shadow_sprite_z,
                                    ) + Vec3::new(half_tile, half_tile, 0.0),
                                ),
                                GlobalTransform::default(),
                                Visibility::default(),
                                InheritedVisibility::default(),
                                ViewVisibility::default(),
                            ));
                        }
                    }

                    // Ceiling shadow (dual-grid) — only on the current z-level
                    let ceiling_key = (chunk_xy, world_z, TileLayer::CeilingShadow);
                    if world_z == view_z.current && !existing_chunks.contains(&ceiling_key) {
                        let ceiling_data = build_ceiling_shadow_tile_data(
                            chunk_xy,
                            world_z,
                            chunk_edge,
                            render_blocks,
                            entity_mode,
                        );
                        let ceiling_sprite_z = calculate_sprite_z(0, TileLayer::CeilingShadow);
                        let half_tile = f32::from(super::visuals::TILE_SIZE_IN_PX) / 2.0;
                        commands.spawn((
                            WorldTileChunk {
                                chunk_xy,
                                world_z,
                                layer: TileLayer::CeilingShadow,
                            },
                            TilemapChunk {
                                chunk_size: UVec2::splat(chunk_edge),
                                tile_display_size: UVec2::splat(64),
                                tileset: obscure_atlas.atlas.clone(),
                                alpha_mode: bevy::sprite_render::AlphaMode2d::Blend,
                            },
                            TilemapChunkTileData(ceiling_data),
                            Transform::from_translation(
                                chunk_world_translation_xy(chunk_xy, chunk_edge, ceiling_sprite_z)
                                    + Vec3::new(half_tile, half_tile, 0.0),
                            ),
                            GlobalTransform::default(),
                            Visibility::default(),
                            InheritedVisibility::default(),
                            ViewVisibility::default(),
                        ));
                    }
                }
            }
        }

        if (terrain_rebuild || fog_rebuild) && render_fog_shadow {
            for &world_z in &rendered_z_levels {
                let fog_key = (chunk_xy, world_z, TileLayer::FogShadow);
                if !existing_chunks.contains(&fog_key) {
                    let fog_tile_data = build_fog_tile_data(
                        chunk_xy,
                        world_z,
                        view_z.current,
                        chunk_edge,
                        render_blocks,
                        &fog_data,
                    );
                    let fog_sprite_z =
                        calculate_sprite_z(world_z - view_z.current, TileLayer::FogShadow);
                    commands.spawn((
                        WorldTileChunk {
                            chunk_xy,
                            world_z,
                            layer: TileLayer::FogShadow,
                        },
                        TilemapChunk {
                            chunk_size: UVec2::splat(chunk_edge),
                            tile_display_size: UVec2::splat(64),
                            tileset: fog_atlas.atlas.clone(),
                            alpha_mode: bevy::sprite_render::AlphaMode2d::Blend,
                        },
                        TilemapChunkTileData(fog_tile_data),
                        Transform::from_translation(chunk_world_translation_xy(
                            chunk_xy,
                            chunk_edge,
                            fog_sprite_z,
                        )),
                        GlobalTransform::default(),
                        Visibility::default(),
                        InheritedVisibility::default(),
                        ViewVisibility::default(),
                    ));
                }
            }
        }
    }

    // Despawn chunks that are no longer active
    for (entity, world_chunk, _, _, _) in &mut chunk_query {
        let in_active_xy = active_chunks_xy.contains(&world_chunk.chunk_xy);
        let in_z_range =
            !(terrain_rebuild || fog_rebuild) || rendered_z_levels.contains(&world_chunk.world_z);
        let top_layer_ok = if terrain_rebuild || fog_rebuild {
            match world_chunk.layer {
                TileLayer::Floor => render_floor,
                TileLayer::EdgeShadow => render_edge_shadow,
                TileLayer::CeilingShadow => {
                    render_ceiling_shadow && world_chunk.world_z == view_z.current
                }
                TileLayer::FogShadow => {
                    render_fog_shadow && rendered_z_levels.contains(&world_chunk.world_z)
                }
            }
        } else {
            true
        };
        // FogShadow chunks are only valid in Entity mode.
        let fog_ok = if fog_rebuild {
            world_chunk.layer != TileLayer::FogShadow || render_fog_shadow
        } else {
            true
        };
        if !in_active_xy || !in_z_range || !top_layer_ok || !fog_ok {
            commands.entity(entity).despawn();
        }
    }

    // Update existing chunks.
    let half_tile = f32::from(super::visuals::TILE_SIZE_IN_PX) / 2.0;
    let mut non_empty_tile_count = 0usize;
    for (_, world_chunk, _, mut chunk_data, mut transform) in &mut chunk_query {
        let layer_needs_update = match world_chunk.layer {
            TileLayer::Floor => terrain_rebuild && render_floor,
            TileLayer::EdgeShadow => terrain_rebuild && render_edge_shadow,
            TileLayer::CeilingShadow => terrain_rebuild && render_ceiling_shadow,
            TileLayer::FogShadow => (terrain_rebuild || fog_rebuild) && render_fog_shadow,
        };
        if !layer_needs_update {
            continue;
        }

        let z_off = world_chunk.world_z - view_z.current;
        let sprite_z = calculate_sprite_z(z_off, world_chunk.layer);
        let base_translation =
            chunk_world_translation_xy(world_chunk.chunk_xy, chunk_edge, sprite_z);
        *transform = Transform::from_translation(
            if matches!(
                world_chunk.layer,
                TileLayer::EdgeShadow | TileLayer::CeilingShadow
            ) {
                base_translation + Vec3::new(half_tile, half_tile, 0.0)
            } else {
                base_translation
            },
        );

        let tile_data = match world_chunk.layer {
            TileLayer::Floor => build_chunk_tile_data(
                world_chunk.chunk_xy,
                world_chunk.world_z,
                chunk_edge,
                render_blocks,
                z_off,
                render_depth_stack,
            ),
            TileLayer::EdgeShadow => build_edge_shadow_tile_data(
                world_chunk.chunk_xy,
                world_chunk.world_z,
                chunk_edge,
                render_blocks,
                entity_mode,
            ),
            TileLayer::CeilingShadow => build_ceiling_shadow_tile_data(
                world_chunk.chunk_xy,
                world_chunk.world_z,
                chunk_edge,
                render_blocks,
                entity_mode,
            ),
            TileLayer::FogShadow => build_fog_tile_data(
                world_chunk.chunk_xy,
                world_chunk.world_z,
                view_z.current,
                chunk_edge,
                render_blocks,
                &fog_data,
            ),
        };
        non_empty_tile_count = non_empty_tile_count
            .saturating_add(tile_data.iter().filter(|tile| tile.is_some()).count());
        chunk_data.0 = tile_data;
    }

    tilemap_render_metrics.chunk_count =
        (if terrain_rebuild {
            let floor_chunks = if render_floor {
                active_chunks_xy.len() * rendered_z_levels.len()
            } else {
                0
            };
            let edge_chunks = if render_edge_shadow {
                active_chunks_xy.len() * rendered_z_levels.len()
            } else {
                0
            };
            let ceiling_chunks = if render_ceiling_shadow {
                active_chunks_xy.len()
            } else {
                0
            };
            floor_chunks + edge_chunks + ceiling_chunks
        } else {
            0
        }) + if (terrain_rebuild || fog_rebuild) && render_fog_shadow {
            active_chunks_xy.len() * rendered_z_levels.len()
        } else {
            0
        };
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
    if terrain_rebuild {
        terrain.dirty = false;
    }
    if fog_rebuild {
        fog_data.dirty = false;
    }
}

pub fn draw_depth_labels(
    mut commands: Commands,
    chunk_border_debug_state: Res<ChunkBorderDebugState>,
    view_z: Res<ViewZLevel>,
    view_mode: Res<ViewMode>,
    config: Res<TerrainConfig>,
    terrain: Res<TerrainData>,
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
    if !terrain.dirty && !view_z.is_changed() && !chunk_border_debug_state.is_changed() {
        return;
    }

    let chunk_edge = config.chunk_edge;
    let tile_size = f32::from(TILE_SIZE_IN_PX);

    // Despawn all existing labels
    for entity in &existing_labels {
        commands.entity(entity).despawn();
    }

    // Determine z-levels to render (same as tints)
    let z_levels_to_render = z_levels_to_render(view_z.current);
    let entity_mode = *view_mode == ViewMode::Entity;
    let render_blocks = if entity_mode {
        &terrain.blocks
    } else {
        terrain.source_blocks.as_ref()
    };

    // Get active chunks using the same logic as project_world_to_tilemap
    let active_chunks_xy = active_chunks_xy(
        replay_mode.active,
        config.world_chunks,
        chunk_streaming_state.as_deref(),
    );

    // For each chunk and each visible z-level, spawn shadow mask labels on air tiles
    for &chunk_xy in &active_chunks_xy {
        let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);
        for &world_z in &z_levels_to_render {
            for local_y in 0..chunk_edge {
                for local_x in 0..chunk_edge {
                    let world_position =
                        world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);

                    // Only label air tiles that have shadows
                    if terrain_block(world_position, render_blocks) == BlockType::Air {
                        let mask = compute_shadow_mask_for_air(
                            world_position.x,
                            world_position.y,
                            world_position.z,
                            render_blocks,
                        );

                        // Only spawn label if there's a shadow
                        if mask != 0 {
                            let mask_text = mask.to_string();
                            let text_position =
                                world_to_pixel_translation(world_position, tile_size);

                            commands.spawn((
                                Text2d::new(mask_text),
                                TextFont {
                                    font_size: 12.0,
                                    ..default()
                                },
                                TextColor(Color::srgba(1.0, 1.0, 0.0, 0.95)),
                                Transform::from_translation(
                                    text_position + Vec3::new(0.0, 0.0, 2.0),
                                ),
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
    entity_data: Res<RenderEntityData>,
    mut gizmos: Gizmos,
) {
    if !chunk_border_debug_state.visible {
        return;
    }

    let tile_size = tilemap_assets.tile_display_size.x as f32;
    let occupancy_color = Color::srgba(1.0, 0.72, 0.16, 0.95);

    for entity in entity_data.entities.values() {
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
    terrain: Res<TerrainData>,
    mut entity_data: ResMut<RenderEntityData>,
    primary_entity_id: Res<PrimarySimulationEntityId>,
    view_mode: Res<ViewMode>,
    view_z: Res<ViewZLevel>,
    tilemap_assets: Res<TilemapAssets>,
    mut player_query: Query<(&mut Sprite, &mut Visibility, &mut PlayerRenderTarget), With<Player>>,
) {
    if !entity_data.dirty {
        return;
    }

    let Some(entity_id) = primary_entity_id.0 else {
        return;
    };

    let Some(player_world_position) = entity_data.entities.get(&entity_id).copied() else {
        return;
    };
    let entity_mode = *view_mode == ViewMode::Entity;
    let render_blocks = if entity_mode {
        &terrain.blocks
    } else {
        terrain.source_blocks.as_ref()
    };

    if let Ok((mut sprite, mut visibility, mut render_target)) = player_query.single_mut() {
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
        let z_offset = player_world_position.position.z - view_z.current;
        sprite.color = get_depth_tint_sprite_color(z_offset);

        let in_z_range = z_offset <= 0 && z_offset >= -Z_LEVELS_BELOW_RENDERED;
        let occluded = if in_z_range && z_offset < 0 {
            (player_world_position.position.z + 1..=view_z.current).any(|check_z| {
                terrain_block_for_shadow(
                    Vec3i::new(
                        player_world_position.position.x,
                        player_world_position.position.y,
                        check_z,
                    ),
                    render_blocks,
                    entity_mode,
                ) == BlockType::SolidStone
            })
        } else {
            false
        };

        if in_z_range && !occluded {
            *visibility = Visibility::Visible;
        } else {
            *visibility = Visibility::Hidden;
        }
    }

    entity_data.dirty = false;
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
    config: Res<TerrainConfig>,
    mut terrain: ResMut<TerrainData>,
    entity_data: Res<RenderEntityData>,
    mut chunk_streaming_state: ResMut<ChunkStreamingState>,
    mut world_command_queue: ResMut<WorldCommandQueue>,
    viewport: Res<crate::resources::render_viewport::RenderViewport>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    mut invalidation: ResMut<crate::domain::tilemap_invalidation::TilemapInvalidation>,
) {
    if replay_mode.active {
        return;
    }

    let Some(entity_id) = primary_entity_id.0 else {
        return;
    };
    if config.chunk_edge == 0 {
        return;
    }
    let Some(entity) = entity_data.entities.get(&entity_id) else {
        return;
    };
    let Some(center_chunk) =
        world_pos_to_chunk_coord(entity.position, config.chunk_edge, config.world_chunks)
    else {
        return;
    };

    let desired = chunk_window(center_chunk, config.world_chunks);

    if chunk_streaming_state.loaded_chunks.is_empty() {
        chunk_streaming_state.loaded_chunks = desired.clone();
        chunk_streaming_state.last_center_chunk = Some(center_chunk);
        invalidation.mark_all_visible_layers(&viewport, &tile_layer_debug_state);
        return;
    }

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

    // Load new chunks that entered the window
    for chunk in desired.difference(&chunk_streaming_state.loaded_chunks) {
        world_command_queue.set_chunk_loaded(*chunk, true);
        tracked_chunk_set_changed = true;
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
        tracked_chunk_set_changed = true;
    }

    chunk_streaming_state.loaded_chunks.extend(desired);
    if tracked_chunk_set_changed {
        invalidation.mark_all_visible_layers(&viewport, &tile_layer_debug_state);
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
    mut terrain: ResMut<TerrainData>,
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
        terrain.dirty = true;
        entity_data.dirty = true;
        invalidation.invalidate_view();
    }
    if z_down_pressed {
        view_z.current = (view_z.current - 1).max(effective_min_z);
        terrain.dirty = true;
        entity_data.dirty = true;
        invalidation.invalidate_view();
    }
    // Clamp current view z in case the entity moved to a different level
    let clamped = view_z.current.clamp(effective_min_z, effective_max_z);
    if clamped != view_z.current {
        view_z.current = clamped;
        terrain.dirty = true;
        entity_data.dirty = true;
        invalidation.invalidate_view();
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

fn build_render_terrain_blocks(
    source_blocks: &HashMap<Vec3i, BlockType>,
    visibility: Option<&world_sim::world_api::VisibilitySnapshot>,
) -> HashMap<Vec3i, BlockType> {
    let Some(visibility) = visibility else {
        return HashMap::new();
    };

    let mut blocks = HashMap::with_capacity(visibility.visible.len() + visibility.memory.len());

    for &pos in &visibility.visible {
        let block = source_blocks.get(&pos).copied().unwrap_or(BlockType::Air);
        blocks.insert(pos, block);
    }

    for (&pos, memory) in &visibility.memory {
        blocks.entry(pos).or_insert(memory.block);
    }

    blocks
}

fn apply_snapshot(
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
        let mut visibility_changed = false;
        if let Some(vis) = visibility_snapshot {
            let new_visible: HashSet<Vec3i> = vis.visible.iter().copied().collect();
            visibility_changed = fog.visible != new_visible || fog.memory != vis.memory;
            if visibility_changed {
                fog.visible = new_visible;
                fog.memory = vis.memory.clone();
                fog.dirty = true;
                invalidation.mark_all_visible_layers(viewport, tile_layer_debug_state);
            }
        }
        if terrain_changed || visibility_changed {
            terrain.blocks =
                build_render_terrain_blocks(terrain.source_blocks.as_ref(), visibility_snapshot);
            terrain.dirty = true;
            invalidation.mark_all_visible_layers(viewport, tile_layer_debug_state);
        }
    } else {
        // Master mode: skip visibility delta + terrain.blocks rebuild.
        // Master uses source_blocks directly; fog is not rendered.
        if terrain_changed {
            terrain.dirty = true;
            invalidation.mark_all_visible_layers(viewport, tile_layer_debug_state);
        }
    }
    entities.dirty = true;
}

fn apply_update(
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
) {
    match update {
        WorldUpdate::Snapshot(snapshot) => {
            apply_snapshot(view_mode, view_z, config, terrain, entities, fog, &snapshot, viewport, tile_layer_debug_state, invalidation)
        }
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
                invalidation.mark_all_visible_layers(viewport, tile_layer_debug_state);
            }
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
    config: &mut TerrainConfig,
    terrain: &mut TerrainData,
    entities: &mut RenderEntityData,
    viewport: &crate::resources::render_viewport::RenderViewport,
    tile_layer_debug_state: &TileLayerDebugState,
    invalidation: &mut crate::domain::tilemap_invalidation::TilemapInvalidation,
) -> bool {
    // Replay doesn't carry FOV data — use a throwaway FogData
    let mut fog = FogData::default();
    while replay_playback.cursor < replay_playback.events.len() {
        let event = replay_playback.events[replay_playback.cursor].clone();
        replay_playback.cursor += 1;
        match event {
            ReplayEvent::Checkpoint(snapshot) => {
                apply_snapshot(
                    ViewMode::Entity,
                    ViewZLevel::default(),
                    config,
                    terrain,
                    entities,
                    &mut fog,
                    &snapshot,
                    viewport,
                    tile_layer_debug_state,
                    invalidation,
                );
                return true;
            }
            ReplayEvent::Update(update) => {
                apply_update(
                    ViewMode::Entity,
                    ViewZLevel::default(),
                    config,
                    terrain,
                    entities,
                    &mut fog,
                    update,
                    viewport,
                    tile_layer_debug_state,
                    invalidation,
                );
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
    config: &mut TerrainConfig,
    terrain: &mut TerrainData,
    entities: &mut RenderEntityData,
    viewport: &crate::resources::render_viewport::RenderViewport,
    tile_layer_debug_state: &TileLayerDebugState,
    invalidation: &mut crate::domain::tilemap_invalidation::TilemapInvalidation,
) -> bool {
    let mut fog = FogData::default();
    while replay_playback.cursor < replay_playback.events.len() {
        let event = replay_playback.events[replay_playback.cursor].clone();
        replay_playback.cursor += 1;
        match event {
            ReplayEvent::Command { .. } => {}
            ReplayEvent::Update(update) => {
                apply_update(
                    ViewMode::Entity,
                    ViewZLevel::default(),
                    config,
                    terrain,
                    entities,
                    &mut fog,
                    update,
                    viewport,
                    tile_layer_debug_state,
                    invalidation,
                );
                return true;
            }
            ReplayEvent::Checkpoint(snapshot) => {
                apply_snapshot(
                    ViewMode::Entity,
                    ViewZLevel::default(),
                    config,
                    terrain,
                    entities,
                    &mut fog,
                    &snapshot,
                    viewport,
                    tile_layer_debug_state,
                    invalidation,
                );
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

fn stone_tile_index() -> u16 {
    5
}

fn build_chunk_tile_data(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    z_offset: i32,
    apply_depth_tint: bool,
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
            let index_in_slice = chunk_local_tile_index(local_x, local_y, chunk_edge);

            if terrain_block(world_position, blocks) == BlockType::SolidStone {
                let mut td = TileData::from_tileset_index(stone_tile_index());
                td.color = if apply_depth_tint {
                    get_depth_tint_tile_color(z_offset)
                } else {
                    Color::WHITE
                };
                tile_data[index_in_slice] = Some(td);
            }
        }
    }

    tile_data
}

/// Dual-grid terrain edge shadow. Rendered offset by half a tile (+32, +32 px).
/// For each dual-grid cell (lx, ly), samples whether each of the 4 surrounding
/// world tiles at the same z is solid, building a 4-bit corner mask:
///
///   C = (wx,   wy+1)  |  D = (wx+1, wy+1)     bit 2 | bit 3
///   ------------------+------------------      ------+------
///   A = (wx,   wy  )  |  B = (wx+1, wy  )     bit 0 | bit 1
///
/// Mask 0 (all air) and mask 15 (all solid) produce no tile.
/// Masks 1-14 -> atlas frame index (mask - 1).
/// Check if a chunk has any edge tiles (solid adjacent to empty).
/// Used to determine if an elevation level above should suppress edge shadows below.
fn chunk_has_edge(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    unknown_is_solid: bool,
) -> bool {
    let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);

    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let wp = world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);

            let is_solid = |dx: i32, dy: i32| -> bool {
                terrain_block_for_shadow(
                    Vec3i::new(wp.x + dx, wp.y + dy, world_z),
                    blocks,
                    unknown_is_solid,
                ) == BlockType::SolidStone
            };

            let mut mask: u8 = 0;
            if is_solid(0, 0) {
                mask |= 1;
            }
            if is_solid(1, 0) {
                mask |= 2;
            }
            if is_solid(0, 1) {
                mask |= 4;
            }
            if is_solid(1, 1) {
                mask |= 8;
            }

            if mask > 0 && mask < 15 {
                return true;
            }
        }
    }
    false
}

fn build_edge_shadow_tile_data(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    unknown_is_solid: bool,
) -> Vec<Option<TileData>> {
    let tile_count = chunk_edge
        .checked_mul(chunk_edge)
        .expect("chunk tile count overflowed");
    let mut tile_data = vec![None; usize::try_from(tile_count).expect("tile count too large")];

    let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);

    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let wp = world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);
            let index_in_slice = chunk_local_tile_index(local_x, local_y, chunk_edge);

            let is_solid = |dx: i32, dy: i32| -> bool {
                terrain_block_for_shadow(
                    Vec3i::new(wp.x + dx, wp.y + dy, world_z),
                    blocks,
                    unknown_is_solid,
                ) == BlockType::SolidStone
            };

            let mut mask: u8 = 0;
            if is_solid(0, 0) {
                mask |= 1;
            } // A: bottom-left
            if is_solid(1, 0) {
                mask |= 2;
            } // B: bottom-right
            if is_solid(0, 1) {
                mask |= 4;
            } // C: top-left
            if is_solid(1, 1) {
                mask |= 8;
            } // D: top-right

            if mask > 0 && mask < 15 {
                tile_data[index_in_slice] = Some(TileData::from_tileset_index((mask - 1) as u16));
            }
        }
    }

    tile_data
}

/// Builds the dual-grid ceiling shadow tile data for one chunk at `world_z`.
///
/// The resulting tilemap is rendered offset by half a tile (+tile_size/2 in x and y)
/// relative to the regular floor chunks, so each shadow tile sits at the corner between
/// four regular tiles. For shadow tile at chunk-local (lx, ly), the 4-bit mask samples
/// whether the block ONE LEVEL ABOVE (world_z + 1) is solid at each of the four surrounding
/// world positions:
///
///   C = (wx,   wy+1)  |  D = (wx+1, wy+1)     bit 2 | bit 3
///   ──────────────────+──────────────────      ──────+──────
///   A = (wx,   wy  )  |  B = (wx+1, wy  )     bit 0 | bit 1
///
/// Mask 0 → no ceiling tile. Masks 1–15 → atlas frame index (mask - 1).
fn build_ceiling_shadow_tile_data(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    unknown_is_solid: bool,
) -> Vec<Option<TileData>> {
    let tile_count = chunk_edge
        .checked_mul(chunk_edge)
        .expect("chunk tile count overflowed");
    let mut tile_data = vec![None; usize::try_from(tile_count).expect("tile count too large")];

    let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);

    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let index_in_slice = chunk_local_tile_index(local_x, local_y, chunk_edge);
            let wp = world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);

            let mut mask: u8 = 0;

            let check_corner = |dx: i32, dy: i32| -> bool {
                let above = Vec3i::new(wp.x + dx, wp.y + dy, world_z + 1);
                let below = Vec3i::new(wp.x + dx, wp.y + dy, world_z);
                terrain_block_for_shadow(above, blocks, unknown_is_solid) == BlockType::SolidStone
                    && terrain_block_for_shadow(below, blocks, unknown_is_solid)
                        == BlockType::SolidStone
            };

            if check_corner(0, 0) {
                mask |= 1;
            } // A: bottom-left
            if check_corner(1, 0) {
                mask |= 2;
            } // B: bottom-right
            if check_corner(0, 1) {
                mask |= 4;
            } // C: top-left
            if check_corner(1, 1) {
                mask |= 8;
            } // D: top-right

            if mask != 0 {
                tile_data[index_in_slice] = Some(TileData::from_tileset_index((mask - 1) as u16));
            }
        }
    }

    tile_data
}

fn calculate_sprite_z(z_offset: i32, layer: TileLayer) -> f32 {
    let base = (z_offset.clamp(-5, 0) * 2) as f32;

    match layer {
        TileLayer::Floor => base,
        TileLayer::EdgeShadow => base + 0.5,
        TileLayer::CeilingShadow => base + 0.75, // above edge shadows, below entities
        TileLayer::FogShadow => GLOBAL_MEMORY_OVERLAY_SPRITE_Z,
    }
}

fn build_fog_tile_data(
    chunk_xy: IVec2,
    world_z: i32,
    current_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    fog: &FogData,
) -> Vec<Option<TileData>> {
    let tile_count =
        usize::try_from(chunk_edge * chunk_edge).expect("chunk tile count does not fit in usize");
    let mut tile_data = vec![None; tile_count];

    let edge_i = i32::try_from(chunk_edge).expect("chunk_edge does not fit in i32");
    let half = edge_i / 2;

    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let wx = chunk_xy.x * edge_i
                + i32::try_from(local_x).expect("local_x does not fit in i32")
                - half;
            let wy = chunk_xy.y * edge_i
                + i32::try_from(local_y).expect("local_y does not fit in i32")
                - half;
            let world_pos = Vec3i::new(wx, wy, world_z);

            let idx = chunk_local_tile_index(local_x, local_y, chunk_edge);

            if fog.visible.contains(&world_pos) {
                tile_data[idx] = None;
            } else if world_z == current_z {
                if !fog.memory.contains_key(&world_pos) {
                    tile_data[idx] = None;
                    continue;
                }

                let mut td = TileData::from_tileset_index(0);
                td.color = Color::srgba(
                    REMEMBERED_FOG_RGBA[0],
                    REMEMBERED_FOG_RGBA[1],
                    REMEMBERED_FOG_RGBA[2],
                    REMEMBERED_FOG_RGBA[3],
                );
                tile_data[idx] = Some(td);
            } else if terrain_block(world_pos, blocks) == BlockType::SolidStone {
                let mut td = TileData::from_tileset_index(0);
                td.color = Color::srgba(
                    REMEMBERED_FOG_RGBA[0],
                    REMEMBERED_FOG_RGBA[1],
                    REMEMBERED_FOG_RGBA[2],
                    REMEMBERED_FOG_RGBA[3],
                );
                tile_data[idx] = Some(td);
            } else {
                tile_data[idx] = None;
            }
        }
    }

    tile_data
}

/// Multiplicative tint color for tiles at a given z-offset from the camera.
/// Converts the old overlay-based depth tinting to per-tile color multiplication.
/// Formula: for overlay srgba(r, g, b, a), the equivalent multiplicative color is
/// srgb(1-a + a*r, 1-a + a*g, 1-a + a*b).
fn get_depth_tint_tile_color(z_offset: i32) -> Color {
    match z_offset {
        0 => Color::WHITE,
        -1 => Color::srgb(0.75, 0.75, 0.75), // 25% black overlay
        -2 => Color::srgb(0.47, 0.49, 0.49), // blue-gray 45%
        -3 => Color::srgb(0.33, 0.35, 0.61), // blue-gray 60%
        -4 => Color::srgb(0.22, 0.24, 0.61), // blue-gray 72%
        -5 => Color::srgb(0.12, 0.15, 0.43), // blue-gray 82%
        _ => Color::srgb(0.02, 0.05, 0.43),
    }
}

fn get_depth_tint_sprite_color(z_offset: i32) -> Color {
    get_depth_tint_tile_color(z_offset)
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
fn compute_shadow_mask_for_air(x: i32, y: i32, z: i32, blocks: &HashMap<Vec3i, BlockType>) -> u8 {
    let mut mask = 0u8;
    let solid = |pos: Vec3i| terrain_block_for_shadow(pos, blocks, false) == BlockType::SolidStone;

    if solid(Vec3i::new(x, y + 1, z)) {
        mask |= 1;
    } // North
    if solid(Vec3i::new(x + 1, y, z)) {
        mask |= 2;
    } // East
    if solid(Vec3i::new(x, y - 1, z)) {
        mask |= 4;
    } // South
    if solid(Vec3i::new(x - 1, y, z)) {
        mask |= 8;
    } // West

    mask
}

/// Returns the block at `pos`, defaulting to `Air` for positions not in the sparse map.
fn terrain_block(pos: Vec3i, blocks: &HashMap<Vec3i, BlockType>) -> BlockType {
    blocks.get(&pos).copied().unwrap_or(BlockType::Air)
}

fn terrain_block_for_shadow(
    pos: Vec3i,
    blocks: &HashMap<Vec3i, BlockType>,
    unknown_is_solid: bool,
) -> BlockType {
    blocks.get(&pos).copied().unwrap_or(if unknown_is_solid {
        BlockType::SolidStone
    } else {
        BlockType::Air
    })
}
