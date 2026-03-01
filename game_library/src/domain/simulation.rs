use std::collections::BTreeMap;

use bevy::prelude::*;
use bevy::sprite_render::{TileData, TilemapChunk, TilemapChunkTileData};

use crate::components::map_coordinates::MapCoordinates;
use crate::resources::input_state::InputState;
use crate::resources::player_focus_state::PlayerFocusState;
use world_sim::bevy_app::PrimarySimulationEntityId;
use world_sim::bevy_app::WorldCommandQueue;
use world_sim::bevy_app::WorldUpdateBuffer;
#[cfg(not(target_arch = "wasm32"))]
use world_sim::replay::{ReplayEvent, load_replay};
use world_sim::world_api::{BlockType, Vec3i, Vec3u, WorldCommand, WorldSnapshot, WorldUpdate};

use super::visuals::Player;

const FLOOR_Z: i32 = -1;
const STONE_TILE_INDEX: u16 = 1;
#[cfg(not(target_arch = "wasm32"))]
const REPLAY_PATH_ENV: &str = "OPEN_DWARF_REPLAY_PATH";

#[derive(Resource, Default)]
pub struct ReplayMode {
    pub active: bool,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RenderEntityState {
    pub position: Vec3i,
    pub facing_left: bool,
    pub is_prone: bool,
}

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
    commands.insert_resource(render_world_state);
}

pub fn queue_world_commands_from_input(
    input_state: Res<InputState>,
    player_focus_state: Res<PlayerFocusState>,
    replay_mode: Res<ReplayMode>,
    primary_entity_id: Res<PrimarySimulationEntityId>,
    mut world_command_queue: ResMut<WorldCommandQueue>,
) {
    if replay_mode.active {
        return;
    }

    if !player_focus_state.can_move_in_world() {
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

    if direction == IVec3::ZERO {
        return;
    }

    let Some(entity_id) = primary_entity_id.0 else {
        return;
    };

    let command = WorldCommand::MoveEntity {
        id: entity_id,
        direction: Vec3i::new(direction.x, direction.y, direction.z),
    };

    world_command_queue.push(command);
}

pub fn pull_world_updates_into_render_state(
    replay_mode: Res<ReplayMode>,
    mut world_update_buffer: ResMut<WorldUpdateBuffer>,
    mut render_world_state: ResMut<RenderWorldState>,
) {
    if replay_mode.active {
        return;
    }

    for update in world_update_buffer.drain() {
        apply_update(&mut render_world_state, update);
    }
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
    mut render_world_state: ResMut<RenderWorldState>,
    mut chunk_data_query: Single<&mut TilemapChunkTileData>,
) {
    if !render_world_state.terrain_dirty {
        return;
    }

    let chunk_edge = render_world_state.chunk_edge;
    let tile_count = chunk_edge.checked_mul(chunk_edge).unwrap_or(0);
    let mut tile_data = vec![None; usize::try_from(tile_count).expect("tile count too large")];
    for y in 0..chunk_edge {
        for x in 0..chunk_edge {
            let world_position = world_pos_from_xy(chunk_edge, x, y, FLOOR_Z);
            let index_in_slice = usize::try_from(y)
                .expect("y does not fit in usize")
                .checked_mul(usize::try_from(chunk_edge).expect("chunk edge does not fit in usize"))
                .and_then(|offset| {
                    offset.checked_add(usize::try_from(x).expect("x does not fit in usize"))
                })
                .expect("tile slice index overflowed");

            if matches!(
                block_at_world_position(
                    &render_world_state.blocks,
                    render_world_state.world_chunks,
                    chunk_edge,
                    world_position,
                ),
                Some(BlockType::SolidStone)
            ) {
                tile_data[index_in_slice] = Some(TileData::from_tileset_index(STONE_TILE_INDEX));
            }
        }
    }
    chunk_data_query.0 = tile_data;
    render_world_state.terrain_dirty = false;
}

pub fn project_world_entities_to_sprites(
    mut render_world_state: ResMut<RenderWorldState>,
    primary_entity_id: Res<PrimarySimulationEntityId>,
    tilemap: Single<&TilemapChunk>,
    mut player_query: Query<(&mut Transform, &mut MapCoordinates, &mut Sprite), With<Player>>,
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

    if let Ok((mut transform, mut coordinates, mut sprite)) = player_query.single_mut() {
        let map_size = uvec3(
            render_world_state.chunk_edge,
            render_world_state.chunk_edge,
            1,
        );
        *coordinates = MapCoordinates::new(
            IVec3::new(
                player_world_position.position.x,
                player_world_position.position.y,
                player_world_position.position.z,
            ),
            map_size,
        );
        *transform = tilemap.calculate_tile_transform(coordinates.as_uvec2());
        sprite.flip_x = player_world_position.facing_left;
    }

    render_world_state.entities_dirty = false;
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

fn world_pos_from_xy(chunk_edge: u32, x: u32, y: u32, z: i32) -> Vec3i {
    let half = i32::try_from(chunk_edge).expect("chunk edge does not fit in i32") / 2;
    Vec3i::new(
        i32::try_from(x).expect("x does not fit in i32") - half,
        i32::try_from(y).expect("y does not fit in i32") - half,
        z,
    )
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
