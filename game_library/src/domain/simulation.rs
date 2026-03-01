use std::collections::BTreeMap;
use std::sync::Mutex;
use std::sync::mpsc::Receiver;

use bevy::prelude::*;
use bevy::sprite_render::{TileData, TilemapChunk, TilemapChunkTileData};

use crate::components::map_coordinates::MapCoordinates;
use crate::resources::input_state::InputState;
use crate::resources::player_focus_state::PlayerFocusState;
use world_sim::world_api::{BlockType, Vec3i, Vec3u, WorldCommand, WorldSnapshot, WorldUpdate};
use world_sim::world_bus::{InProcessWorldBus, WorldBus};
use world_sim::world_core::{WorldConfig, WorldState};

use super::visuals::Player;

const PLAYER_SIMULATION_ID: u64 = 1;
const FLOOR_Z: i32 = -1;
const STONE_TILE_INDEX: u16 = 1;

#[derive(Resource)]
pub struct SimulationRuntime {
    pub world: WorldState,
    pub bus: InProcessWorldBus,
}

#[derive(Resource)]
pub struct WorldSubscription {
    rx: Mutex<Receiver<WorldUpdate>>,
}

#[derive(Resource, Default)]
pub struct RenderWorldState {
    pub tick: u64,
    pub chunk_edge: u32,
    pub world_chunks: Vec3u,
    pub blocks: Vec<BlockType>,
    pub entities: BTreeMap<u64, Vec3i>,
    terrain_dirty: bool,
    entities_dirty: bool,
}

impl RenderWorldState {
    fn mark_all_dirty(&mut self) {
        self.terrain_dirty = true;
        self.entities_dirty = true;
    }
}

pub fn setup_simulation_runtime(mut commands: Commands) {
    let config = WorldConfig::default();
    let mut world = WorldState::new(config);
    world
        .spawn_entity(PLAYER_SIMULATION_ID, Vec3i::new(0, 0, 0))
        .expect("player should spawn at origin");

    let mut bus = InProcessWorldBus::default();
    let rx = bus.subscribe();
    bus.publish(WorldUpdate::Snapshot(world.snapshot()));

    commands.insert_resource(SimulationRuntime { world, bus });
    commands.insert_resource(WorldSubscription { rx: Mutex::new(rx) });
    commands.init_resource::<RenderWorldState>();
}

pub fn queue_world_commands_from_input(
    input_state: Res<InputState>,
    player_focus_state: Res<PlayerFocusState>,
    runtime: Res<SimulationRuntime>,
    mut player_sprite: Query<&mut Sprite, With<Player>>,
) {
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

    if direction.x != 0
        && let Ok(mut sprite) = player_sprite.single_mut()
    {
        sprite.flip_x = direction.x > 0;
    }

    if let Err(err) = runtime.bus.send_command(WorldCommand::MoveEntity {
        id: PLAYER_SIMULATION_ID,
        direction: Vec3i::new(direction.x, direction.y, direction.z),
    }) {
        warn!("Failed to queue world command: {err}");
    }
}

pub fn run_world_simulation(mut runtime: ResMut<SimulationRuntime>) {
    let commands = runtime.bus.drain_commands();
    for command in commands {
        if let Some(delta) = runtime.world.apply_command(command) {
            runtime.bus.publish(WorldUpdate::Delta(delta));
        } else {
            warn!("World command rejected (likely out of bounds or unknown entity)");
        }
    }
}

pub fn pull_world_updates_into_render_state(
    subscription: Res<WorldSubscription>,
    mut render_world_state: ResMut<RenderWorldState>,
) {
    let Ok(receiver) = subscription.rx.lock() else {
        return;
    };

    while let Ok(update) = receiver.try_recv() {
        match update {
            WorldUpdate::Snapshot(snapshot) => apply_snapshot(&mut render_world_state, snapshot),
            WorldUpdate::Delta(delta) => {
                render_world_state.tick = delta.tick;
                for movement in delta.moved_entities {
                    render_world_state.entities.insert(movement.id, movement.to);
                }
                render_world_state.entities_dirty = true;
            }
        }
    }
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
    tilemap: Single<&TilemapChunk>,
    mut player_query: Query<(&mut Transform, &mut MapCoordinates), With<Player>>,
) {
    if !render_world_state.entities_dirty {
        return;
    }

    let Some(player_world_position) = render_world_state
        .entities
        .get(&PLAYER_SIMULATION_ID)
        .copied()
    else {
        return;
    };

    if let Ok((mut transform, mut coordinates)) = player_query.single_mut() {
        let map_size = uvec3(
            render_world_state.chunk_edge,
            render_world_state.chunk_edge,
            1,
        );
        *coordinates = MapCoordinates::new(
            IVec3::new(
                player_world_position.x,
                player_world_position.y,
                player_world_position.z,
            ),
            map_size,
        );
        *transform = tilemap.calculate_tile_transform(coordinates.as_uvec2());
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
        .map(|entity| (entity.id, entity.position))
        .collect();
    render_world_state.mark_all_dirty();
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
