use std::collections::BTreeMap;
use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::world_api::{
    BlockType, EntityMovedDelta, EntityMovementSnapshot, EntitySnapshot, Vec3i, Vec3u,
    WorldCommand, WorldDelta, WorldSnapshot,
};

pub const DEFAULT_CHUNK_EDGE: u32 = 16;
pub const DEFAULT_WORLD_CHUNKS: Vec3u = Vec3u { x: 1, y: 1, z: 1 };
pub const DEFAULT_MOVEMENT_TICKS_PER_TILE: u32 = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldConfig {
    pub chunk_edge: u32,
    pub world_chunks: Vec3u,
    pub movement_ticks_per_tile: u32,
}

impl Default for WorldConfig {
    fn default() -> Self {
        Self {
            chunk_edge: DEFAULT_CHUNK_EDGE,
            world_chunks: DEFAULT_WORLD_CHUNKS,
            movement_ticks_per_tile: DEFAULT_MOVEMENT_TICKS_PER_TILE,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct EntityMovementState {
    origin: Vec3i,
    target: Vec3i,
    start_position: [f32; 3],
    elapsed_ticks: u32,
    total_ticks: u32,
}

impl EntityMovementState {
    fn with_start_position(
        origin: Vec3i,
        target: Vec3i,
        total_ticks: u32,
        start_position: [f32; 3],
    ) -> Self {
        Self {
            origin,
            target,
            start_position,
            elapsed_ticks: 0,
            total_ticks: total_ticks.max(1),
        }
    }

    fn progress_fraction(self) -> f32 {
        self.elapsed_ticks as f32 / self.total_ticks.max(1) as f32
    }

    fn progress_percent(self) -> u8 {
        let value = self.elapsed_ticks.saturating_mul(100) / self.total_ticks.max(1);
        u8::try_from(value).expect("progress percent should fit in u8")
    }

    fn direction(self) -> Vec3i {
        Vec3i::new(
            (self.target.x - self.origin.x).signum(),
            (self.target.y - self.origin.y).signum(),
            (self.target.z - self.origin.z).signum(),
        )
    }

    fn interpolated_position(self) -> [f32; 3] {
        let fraction = self.progress_fraction();
        let target_position = vec3i_to_f32(self.target);
        [
            self.start_position[0] + (target_position[0] - self.start_position[0]) * fraction,
            self.start_position[1] + (target_position[1] - self.start_position[1]) * fraction,
            self.start_position[2] + (target_position[2] - self.start_position[2]) * fraction,
        ]
    }

    fn occupies_origin(self) -> bool {
        self.progress_percent() < 75
    }

    fn occupies_target(self) -> bool {
        self.progress_percent() >= 25
    }

    fn is_complete(self) -> bool {
        self.elapsed_ticks >= self.total_ticks
    }

    fn snapshot(self) -> EntityMovementSnapshot {
        EntityMovementSnapshot {
            origin: self.origin,
            target: self.target,
            start_position: self.start_position,
            progress_percent: self.progress_percent(),
            occupies_origin: self.occupies_origin(),
            occupies_target: self.occupies_target(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct EntityState {
    position: Vec3i,
    facing_left: bool,
    is_prone: bool,
    movement: Option<EntityMovementState>,
}

impl EntityState {
    fn new(position: Vec3i) -> Self {
        Self {
            position,
            facing_left: false,
            is_prone: false,
            movement: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct WorldState {
    tick: u64,
    chunk_edge: u32,
    world_chunks: Vec3u,
    movement_ticks_per_tile: u32,
    blocks: Vec<BlockType>,
    entities: BTreeMap<u64, EntityState>,
    loaded_chunks: HashSet<Vec3i>,
    next_entity_id: u64,
}

impl WorldState {
    #[must_use]
    pub fn new(config: WorldConfig) -> Self {
        let block_count = usize::try_from(config.world_chunks.x)
            .expect("world_chunks.x does not fit in usize")
            .checked_mul(
                usize::try_from(config.world_chunks.y)
                    .expect("world_chunks.y does not fit in usize"),
            )
            .and_then(|n| {
                n.checked_mul(
                    usize::try_from(config.world_chunks.z)
                        .expect("world_chunks.z does not fit in usize"),
                )
            })
            .and_then(|n| {
                n.checked_mul(
                    usize::try_from(config.chunk_edge)
                        .expect("chunk_edge does not fit in usize")
                        .pow(3),
                )
            })
            .expect("world block count overflowed");

        Self {
            tick: 0,
            chunk_edge: config.chunk_edge,
            world_chunks: config.world_chunks,
            movement_ticks_per_tile: config.movement_ticks_per_tile.max(1),
            blocks: make_initial_blocks(config.chunk_edge, config.world_chunks, block_count),
            entities: BTreeMap::new(),
            loaded_chunks: make_initial_loaded_chunks(config.world_chunks),
            next_entity_id: 1,
        }
    }

    pub fn spawn_entity(&mut self, id: u64, position: Vec3i) -> Result<(), String> {
        if !self.contains_position(position) {
            return Err(format!("spawn position is out of bounds: {position:?}"));
        }
        self.entities.insert(id, EntityState::new(position));
        self.next_entity_id = self.next_entity_id.max(id.saturating_add(1));
        Ok(())
    }

    pub fn spawn_entity_auto(&mut self, position: Vec3i) -> Result<u64, String> {
        if !self.contains_position(position) {
            return Err(format!("spawn position is out of bounds: {position:?}"));
        }

        let mut candidate = self.next_entity_id.max(1);
        while self.entities.contains_key(&candidate) {
            candidate = candidate.saturating_add(1);
        }
        self.entities.insert(candidate, EntityState::new(position));
        self.next_entity_id = candidate.saturating_add(1);
        Ok(candidate)
    }

    pub fn start_entity_move_with_reason(
        &mut self,
        id: u64,
        direction: Vec3i,
    ) -> Result<(), MoveEntityError> {
        if !is_adjacent_direction(direction) {
            return Err(MoveEntityError::NonAdjacentDirection { direction });
        }
        let current = *self
            .entities
            .get(&id)
            .ok_or(MoveEntityError::UnknownEntity)?;
        let target_position = current.position.add(direction);

        if !self.contains_position(target_position) {
            return Err(MoveEntityError::OutOfBounds {
                from: current.position,
                to: target_position,
            });
        }
        let Some(target_chunk) = self.world_position_to_chunk_coord(target_position) else {
            return Err(MoveEntityError::OutOfBounds {
                from: current.position,
                to: target_position,
            });
        };
        if !self.is_chunk_loaded(target_chunk) {
            return Err(MoveEntityError::ChunkNotLoaded {
                from: current.position,
                to: target_position,
                chunk: target_chunk,
            });
        }

        let (movement_start_position, movement_origin) = if let Some(movement) = current.movement {
            if movement.direction() == direction {
                return Err(MoveEntityError::MovementInProgress);
            }
            (movement.interpolated_position(), current.position)
        } else {
            (vec3i_to_f32(current.position), current.position)
        };

        let facing_left_after = if direction.x > 0 {
            false
        } else if direction.x < 0 {
            true
        } else {
            current.facing_left
        };
        let is_prone_after = current.is_prone;
        let distance = if current.movement.is_some() {
            movement_distance_between(movement_start_position, target_position)
        } else {
            movement_distance(direction)
        };
        let total_ticks = (distance * self.movement_ticks_per_tile as f32).ceil() as u32;
        self.entities.insert(
            id,
            EntityState {
                position: current.position,
                facing_left: facing_left_after,
                is_prone: is_prone_after,
                movement: Some(EntityMovementState::with_start_position(
                    movement_origin,
                    target_position,
                    total_ticks,
                    movement_start_position,
                )),
            },
        );

        let _ = is_prone_after;
        Ok(())
    }

    pub fn advance_active_movements_one_tick(&mut self) -> Option<WorldDelta> {
        let moving_ids: Vec<u64> = self
            .entities
            .iter()
            .filter_map(|(id, entity)| entity.movement.map(|_| *id))
            .collect();
        if moving_ids.is_empty() {
            return None;
        }

        self.tick = self.tick.saturating_add(1);
        let mut moved_entities = Vec::new();
        for id in moving_ids {
            let Some(entity) = self.entities.get_mut(&id) else {
                continue;
            };
            let from = entity.position;
            let facing_left_before = entity.facing_left;
            let is_prone_before = entity.is_prone;

            if let Some(mut movement) = entity.movement {
                movement.elapsed_ticks = movement
                    .elapsed_ticks
                    .saturating_add(1)
                    .min(movement.total_ticks.max(1));
                if movement.progress_percent() >= 75 {
                    entity.position = movement.target;
                }
                let movement_after = if movement.is_complete() {
                    entity.position = movement.target;
                    entity.movement = None;
                    None
                } else {
                    entity.movement = Some(movement);
                    Some(movement.snapshot())
                };

                moved_entities.push(EntityMovedDelta {
                    id,
                    from,
                    to: entity.position,
                    facing_left_before,
                    facing_left_after: entity.facing_left,
                    is_prone_before,
                    is_prone_after: entity.is_prone,
                    movement_after,
                });
            }
        }

        Some(WorldDelta {
            tick: self.tick,
            moved_entities,
        })
    }

    pub fn force_advance_ticks(&mut self, count: u32) -> Vec<WorldDelta> {
        let ticks = count.max(1);
        let mut deltas = Vec::new();
        for _ in 0..ticks {
            if let Some(delta) = self.advance_active_movements_one_tick() {
                deltas.push(delta);
            } else {
                self.tick = self.tick.saturating_add(1);
                deltas.push(WorldDelta {
                    tick: self.tick,
                    moved_entities: vec![],
                });
            }
        }
        deltas
    }

    pub fn contains_position(&self, position: Vec3i) -> bool {
        let (min, max) = self.centered_bounds();
        position.x >= min.x
            && position.x <= max.x
            && position.y >= min.y
            && position.y <= max.y
            && position.z >= min.z
            && position.z <= max.z
    }

    #[must_use]
    pub fn world_bounds(&self) -> (Vec3i, Vec3i) {
        self.centered_bounds()
    }

    #[must_use]
    pub fn next_entity_id(&self) -> u64 {
        self.next_entity_id
    }

    #[must_use]
    pub fn has_entity(&self, id: u64) -> bool {
        self.entities.contains_key(&id)
    }

    pub fn set_chunk_loaded(&mut self, chunk: Vec3i, loaded: bool) {
        if loaded {
            self.loaded_chunks.insert(chunk);
        } else {
            self.loaded_chunks.remove(&chunk);
        }
    }

    #[must_use]
    pub fn is_chunk_loaded(&self, chunk: Vec3i) -> bool {
        self.loaded_chunks.contains(&chunk)
    }

    #[must_use]
    pub fn loaded_chunk_count(&self) -> usize {
        self.loaded_chunks.len()
    }

    pub fn spawn_or_replace_entity(&mut self, id: u64, position: Vec3i) -> Result<(), String> {
        if !self.contains_position(position) {
            return Err(format!("spawn position is out of bounds: {position:?}"));
        }
        self.entities.insert(id, EntityState::new(position));
        self.next_entity_id = self.next_entity_id.max(id.saturating_add(1));
        Ok(())
    }

    #[must_use]
    pub fn apply_command(&mut self, command: WorldCommand) -> Option<WorldDelta> {
        match command {
            WorldCommand::MoveEntity { id, direction } => {
                self.start_entity_move_with_reason(id, direction).ok()?;
                self.advance_active_movements_one_tick()
            }
            WorldCommand::AdvanceTicks { count } => self.force_advance_ticks(count).pop(),
            WorldCommand::SetChunkLoaded { chunk, loaded } => {
                self.set_chunk_loaded(chunk, loaded);
                Some(WorldDelta {
                    tick: self.tick,
                    moved_entities: vec![],
                })
            }
        }
    }

    #[must_use]
    pub fn snapshot(&self) -> WorldSnapshot {
        let entities = self
            .entities
            .iter()
            .map(|(id, entity)| EntitySnapshot {
                id: *id,
                position: entity.position,
                facing_left: entity.facing_left,
                is_prone: entity.is_prone,
                movement: entity.movement.map(EntityMovementState::snapshot),
            })
            .collect();

        WorldSnapshot {
            tick: self.tick,
            chunk_edge: self.chunk_edge,
            world_chunks: self.world_chunks,
            blocks: self.blocks.clone(),
            entities,
        }
    }

    #[must_use]
    pub fn centered_bounds(&self) -> (Vec3i, Vec3i) {
        let size = self.world_size_in_voxels();

        let min = Vec3i::new(
            -(i32::try_from(size.x).expect("size.x does not fit in i32") / 2),
            -(i32::try_from(size.y).expect("size.y does not fit in i32") / 2),
            -(i32::try_from(size.z).expect("size.z does not fit in i32") / 2),
        );
        let max = Vec3i::new(
            min.x + i32::try_from(size.x).expect("size.x does not fit in i32") - 1,
            min.y + i32::try_from(size.y).expect("size.y does not fit in i32") - 1,
            min.z + i32::try_from(size.z).expect("size.z does not fit in i32") - 1,
        );

        (min, max)
    }

    fn world_size_in_voxels(&self) -> Vec3u {
        Vec3u::new(
            self.world_chunks
                .x
                .checked_mul(self.chunk_edge)
                .expect("world x-size overflowed"),
            self.world_chunks
                .y
                .checked_mul(self.chunk_edge)
                .expect("world y-size overflowed"),
            self.world_chunks
                .z
                .checked_mul(self.chunk_edge)
                .expect("world z-size overflowed"),
        )
    }

    fn world_position_to_chunk_coord(&self, position: Vec3i) -> Option<Vec3i> {
        let world_size = self.world_size_in_voxels();
        let min = Vec3i::new(
            -(i32::try_from(world_size.x).ok()? / 2),
            -(i32::try_from(world_size.y).ok()? / 2),
            -(i32::try_from(world_size.z).ok()? / 2),
        );

        let local_x = position.x - min.x;
        let local_y = position.y - min.y;
        let local_z = position.z - min.z;
        if local_x < 0 || local_y < 0 || local_z < 0 {
            return None;
        }
        let local_x_u = u32::try_from(local_x).ok()?;
        let local_y_u = u32::try_from(local_y).ok()?;
        let local_z_u = u32::try_from(local_z).ok()?;
        if local_x_u >= world_size.x || local_y_u >= world_size.y || local_z_u >= world_size.z {
            return None;
        }

        let edge = self.chunk_edge.max(1);
        let chunk_local_x = local_x_u / edge;
        let chunk_local_y = local_y_u / edge;
        let chunk_local_z = local_z_u / edge;

        let center_x = i32::try_from(self.world_chunks.x).ok()? / 2;
        let center_y = i32::try_from(self.world_chunks.y).ok()? / 2;
        let center_z = i32::try_from(self.world_chunks.z).ok()? / 2;

        Some(Vec3i::new(
            i32::try_from(chunk_local_x).ok()? - center_x,
            i32::try_from(chunk_local_y).ok()? - center_y,
            i32::try_from(chunk_local_z).ok()? - center_z,
        ))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveEntityError {
    UnknownEntity,
    MovementInProgress,
    NonAdjacentDirection {
        direction: Vec3i,
    },
    OutOfBounds {
        from: Vec3i,
        to: Vec3i,
    },
    ChunkNotLoaded {
        from: Vec3i,
        to: Vec3i,
        chunk: Vec3i,
    },
}

fn is_adjacent_direction(direction: Vec3i) -> bool {
    let max_component = direction
        .x
        .unsigned_abs()
        .max(direction.y.unsigned_abs())
        .max(direction.z.unsigned_abs());
    let has_any_axis = direction.x != 0 || direction.y != 0 || direction.z != 0;
    has_any_axis && max_component <= 1
}

fn movement_distance(direction: Vec3i) -> f32 {
    let x = direction.x as f32;
    let y = direction.y as f32;
    let z = direction.z as f32;
    (x * x + y * y + z * z).sqrt()
}

fn movement_distance_between(from: [f32; 3], to: Vec3i) -> f32 {
    let to = vec3i_to_f32(to);
    let x = to[0] - from[0];
    let y = to[1] - from[1];
    let z = to[2] - from[2];
    (x * x + y * y + z * z).sqrt()
}

fn vec3i_to_f32(position: Vec3i) -> [f32; 3] {
    [position.x as f32, position.y as f32, position.z as f32]
}

fn make_initial_loaded_chunks(world_chunks: Vec3u) -> HashSet<Vec3i> {
    let mut loaded = HashSet::new();
    let offset_x = i32::try_from(world_chunks.x).expect("world_chunks.x too large") / 2;
    let offset_y = i32::try_from(world_chunks.y).expect("world_chunks.y too large") / 2;
    let offset_z = i32::try_from(world_chunks.z).expect("world_chunks.z too large") / 2;
    for z in 0..world_chunks.z {
        for y in 0..world_chunks.y {
            for x in 0..world_chunks.x {
                loaded.insert(Vec3i::new(
                    i32::try_from(x).expect("x too large") - offset_x,
                    i32::try_from(y).expect("y too large") - offset_y,
                    i32::try_from(z).expect("z too large") - offset_z,
                ));
            }
        }
    }
    loaded
}

fn make_initial_blocks(chunk_edge: u32, world_chunks: Vec3u, block_count: usize) -> Vec<BlockType> {
    let mut blocks = vec![BlockType::Air; block_count];

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
    let min_z = -(i32::try_from(world_size.z).expect("world size z does not fit in i32") / 2);
    let floor_z = -1;
    let floor_local_z = floor_z - min_z;
    if floor_local_z < 0 || u32::try_from(floor_local_z).expect("floor z negative") >= world_size.z
    {
        return blocks;
    }

    let floor_local_z =
        usize::try_from(floor_local_z).expect("floor local z does not fit in usize");
    let world_size_x = usize::try_from(world_size.x).expect("world size x does not fit in usize");
    let world_size_y = usize::try_from(world_size.y).expect("world size y does not fit in usize");
    let layer_size = world_size_x
        .checked_mul(world_size_y)
        .expect("world layer size overflowed");
    let layer_offset = floor_local_z
        .checked_mul(layer_size)
        .expect("world layer offset overflowed");
    for y in 0..world_size_y {
        for x in 0..world_size_x {
            let index = layer_offset
                .checked_add(y.checked_mul(world_size_x).expect("floor y overflowed"))
                .and_then(|offset| offset.checked_add(x))
                .expect("floor index overflowed");
            blocks[index] = BlockType::SolidStone;
        }
    }
    blocks
}

#[cfg(test)]
mod tests {
    use super::{MoveEntityError, WorldConfig, WorldState};
    use crate::world_api::{Vec3i, WorldCommand};

    fn test_world() -> WorldState {
        WorldState::new(WorldConfig {
            movement_ticks_per_tile: 4,
            ..WorldConfig::default()
        })
    }

    #[test]
    fn move_entity_within_bounds_produces_progress_delta() {
        let mut world = test_world();
        world
            .spawn_entity(1, Vec3i::ZERO)
            .expect("entity should spawn at origin");

        world
            .start_entity_move_with_reason(1, Vec3i::new(1, 0, 0))
            .expect("move should start");
        let delta = world
            .advance_active_movements_one_tick()
            .expect("movement tick should produce a delta");

        assert_eq!(delta.tick, 1);
        assert_eq!(delta.moved_entities.len(), 1);
        assert_eq!(delta.moved_entities[0].to, Vec3i::ZERO);
        assert_eq!(
            delta.moved_entities[0]
                .movement_after
                .as_ref()
                .map(|m| m.progress_percent),
            Some(25)
        );
        assert!(!delta.moved_entities[0].facing_left_after);
        assert!(!delta.moved_entities[0].is_prone_after);
    }

    #[test]
    fn move_entity_out_of_bounds_is_rejected() {
        let mut world = test_world();
        world
            .spawn_entity(1, Vec3i::new(7, 0, 0))
            .expect("entity should spawn at edge");

        let delta = world.apply_command(WorldCommand::MoveEntity {
            id: 1,
            direction: Vec3i::new(1, 0, 0),
        });

        assert!(delta.is_none());
    }

    #[test]
    fn advance_ticks_updates_tick_counter() {
        let mut world = WorldState::new(WorldConfig::default());
        world
            .apply_command(WorldCommand::AdvanceTicks { count: 4 })
            .expect("advance ticks should always produce a delta");
        let snapshot = world.snapshot();
        assert_eq!(snapshot.tick, 4);
    }

    #[test]
    fn auto_spawn_assigns_incrementing_ids() {
        let mut world = WorldState::new(WorldConfig::default());
        let first = world
            .spawn_entity_auto(Vec3i::ZERO)
            .expect("first auto spawn should work");
        let second = world
            .spawn_entity_auto(Vec3i::new(1, 0, 0))
            .expect("second auto spawn should work");

        assert_eq!(first, 1);
        assert_eq!(second, 2);
    }

    #[test]
    fn move_entity_reports_out_of_bounds_reason() {
        let mut world = WorldState::new(WorldConfig::default());
        world
            .spawn_entity_auto(Vec3i::new(7, 0, 0))
            .expect("entity should spawn at edge");

        let err = world
            .start_entity_move_with_reason(1, Vec3i::new(1, 0, 0))
            .expect_err("move should be out of bounds");

        assert!(matches!(err, MoveEntityError::OutOfBounds { .. }));
    }

    #[test]
    fn movement_updates_entity_facing() {
        let mut world = test_world();
        world
            .spawn_entity_auto(Vec3i::ZERO)
            .expect("spawn should succeed");

        let _ = world
            .start_entity_move_with_reason(1, Vec3i::new(0, -1, 0))
            .expect("move should start");
        for _ in 0..4 {
            let _ = world.advance_active_movements_one_tick();
        }
        let _ = world
            .start_entity_move_with_reason(1, Vec3i::new(-1, 0, 0))
            .expect("move should start");
        for _ in 0..4 {
            let _ = world.advance_active_movements_one_tick();
        }
        let snapshot = world.snapshot();
        let entity = snapshot
            .entities
            .into_iter()
            .find(|entity| entity.id == 1)
            .expect("entity should exist");
        assert!(entity.facing_left);
    }

    #[test]
    fn entity_starts_not_prone() {
        let mut world = WorldState::new(WorldConfig::default());
        world
            .spawn_entity_auto(Vec3i::ZERO)
            .expect("spawn should succeed");
        let snapshot = world.snapshot();
        let entity = snapshot
            .entities
            .into_iter()
            .find(|entity| entity.id == 1)
            .expect("entity should exist");
        assert!(!entity.is_prone);
    }

    #[test]
    fn move_entity_into_unloaded_chunk_is_rejected() {
        let mut world = test_world();
        world
            .spawn_entity_auto(Vec3i::ZERO)
            .expect("spawn should succeed");
        world.set_chunk_loaded(Vec3i::ZERO, false);

        let err = world
            .start_entity_move_with_reason(1, Vec3i::new(1, 0, 0))
            .expect_err("move should fail when chunk is unloaded");

        assert!(matches!(err, MoveEntityError::ChunkNotLoaded { .. }));
    }

    #[test]
    fn movement_transitions_tile_occupancy_at_quarters() {
        let mut world = test_world();
        world
            .spawn_entity_auto(Vec3i::ZERO)
            .expect("spawn should succeed");
        world
            .start_entity_move_with_reason(1, Vec3i::new(1, 0, 0))
            .expect("move should start");

        for expected in [25_u8, 50_u8, 75_u8, 100_u8] {
            let _ = world
                .advance_active_movements_one_tick()
                .expect("tick should progress movement");
            let snapshot = world.snapshot();
            let entity = snapshot
                .entities
                .into_iter()
                .find(|entity| entity.id == 1)
                .expect("entity should exist");
            if expected == 100 {
                assert!(entity.movement.is_none());
                assert_eq!(entity.position, Vec3i::new(1, 0, 0));
            } else {
                let movement = entity.movement.expect("movement should be active");
                assert_eq!(movement.progress_percent, expected);
                if expected < 75 {
                    assert_eq!(entity.position, Vec3i::ZERO);
                } else {
                    assert_eq!(entity.position, Vec3i::new(1, 0, 0));
                }
                assert_eq!(movement.occupies_origin, expected < 75);
                assert_eq!(movement.occupies_target, expected >= 25);
            }
        }
    }

    #[test]
    fn interrupting_movement_uses_interpolated_start_position() {
        let mut world = test_world();
        world
            .spawn_entity_auto(Vec3i::ZERO)
            .expect("spawn should succeed");
        world
            .start_entity_move_with_reason(1, Vec3i::new(0, -1, 0))
            .expect("south move should start");

        for _ in 0..3 {
            let _ = world.advance_active_movements_one_tick();
        }

        world
            .start_entity_move_with_reason(1, Vec3i::new(1, 1, 0))
            .expect("interrupting octant move should start");

        let snapshot = world.snapshot();
        let entity = snapshot
            .entities
            .into_iter()
            .find(|entity| entity.id == 1)
            .expect("entity should exist");
        let movement = entity.movement.expect("movement should be active");

        assert_eq!(movement.origin, Vec3i::new(0, -1, 0));
        assert_eq!(movement.target, Vec3i::new(1, 0, 0));
        assert_eq!(movement.start_position, [0.0, -0.75, 0.0]);
        assert_eq!(movement.progress_percent, 0);

        for _ in 0..4 {
            let _ = world.advance_active_movements_one_tick();
        }

        let snapshot = world.snapshot();
        let entity = snapshot
            .entities
            .into_iter()
            .find(|entity| entity.id == 1)
            .expect("entity should exist");
        assert_eq!(entity.position, Vec3i::new(1, 0, 0));
        assert!(entity.movement.is_none());
    }
}
