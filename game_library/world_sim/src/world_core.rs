use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::world_api::{
    BlockType, EntityMovedDelta, EntitySnapshot, Vec3i, Vec3u, WorldCommand, WorldDelta,
    WorldSnapshot,
};

pub const DEFAULT_CHUNK_EDGE: u32 = 16;
pub const DEFAULT_WORLD_CHUNKS: Vec3u = Vec3u { x: 1, y: 1, z: 1 };

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldConfig {
    pub chunk_edge: u32,
    pub world_chunks: Vec3u,
}

impl Default for WorldConfig {
    fn default() -> Self {
        Self {
            chunk_edge: DEFAULT_CHUNK_EDGE,
            world_chunks: DEFAULT_WORLD_CHUNKS,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct EntityState {
    position: Vec3i,
    facing_left: bool,
    is_prone: bool,
}

impl EntityState {
    fn new(position: Vec3i) -> Self {
        Self {
            position,
            facing_left: true,
            is_prone: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct WorldState {
    tick: u64,
    chunk_edge: u32,
    world_chunks: Vec3u,
    blocks: Vec<BlockType>,
    entities: BTreeMap<u64, EntityState>,
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
            blocks: make_initial_blocks(config.chunk_edge, config.world_chunks, block_count),
            entities: BTreeMap::new(),
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

    pub fn move_entity_with_reason(
        &mut self,
        id: u64,
        direction: Vec3i,
    ) -> Result<WorldDelta, MoveEntityError> {
        let current = *self.entities.get(&id).ok_or(MoveEntityError::UnknownEntity)?;
        let target_position = current.position.add(direction);

        if !self.contains_position(target_position) {
            return Err(MoveEntityError::OutOfBounds {
                from: current.position,
                to: target_position,
            });
        }

        let facing_left_before = current.facing_left;
        let facing_left_after = if direction.x > 0 {
            true
        } else if direction.x < 0 {
            false
        } else {
            current.facing_left
        };
        let is_prone_before = current.is_prone;
        let is_prone_after = current.is_prone;
        self.tick = self.tick.saturating_add(1);
        self.entities.insert(
            id,
            EntityState {
                position: target_position,
                facing_left: facing_left_after,
                is_prone: is_prone_after,
            },
        );

        Ok(WorldDelta {
            tick: self.tick,
            moved_entities: vec![EntityMovedDelta {
                id,
                from: current.position,
                to: target_position,
                facing_left_before,
                facing_left_after,
                is_prone_before,
                is_prone_after,
            }],
        })
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
                self.move_entity_with_reason(id, direction).ok()
            }
            WorldCommand::AdvanceTicks { count } => {
                let ticks = count.max(1);
                self.tick = self.tick.saturating_add(u64::from(ticks));
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

}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveEntityError {
    UnknownEntity,
    OutOfBounds {
        from: Vec3i,
        to: Vec3i,
    },
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

    #[test]
    fn move_entity_within_bounds_produces_delta() {
        let mut world = WorldState::new(WorldConfig::default());
        world
            .spawn_entity(1, Vec3i::ZERO)
            .expect("entity should spawn at origin");

        let delta = world
            .apply_command(WorldCommand::MoveEntity {
                id: 1,
                direction: Vec3i::new(1, 0, 0),
            })
            .expect("move should be in bounds");

        assert_eq!(delta.tick, 1);
        assert_eq!(delta.moved_entities.len(), 1);
        assert_eq!(delta.moved_entities[0].to, Vec3i::new(1, 0, 0));
        assert!(delta.moved_entities[0].facing_left_after);
        assert!(!delta.moved_entities[0].is_prone_after);
    }

    #[test]
    fn move_entity_out_of_bounds_is_rejected() {
        let mut world = WorldState::new(WorldConfig::default());
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
            .move_entity_with_reason(1, Vec3i::new(1, 0, 0))
            .expect_err("move should be out of bounds");

        assert!(matches!(err, MoveEntityError::OutOfBounds { .. }));
    }

    #[test]
    fn movement_updates_entity_facing() {
        let mut world = WorldState::new(WorldConfig::default());
        world
            .spawn_entity_auto(Vec3i::ZERO)
            .expect("spawn should succeed");

        let _ = world
            .apply_command(WorldCommand::MoveEntity {
                id: 1,
                direction: Vec3i::new(0, -1, 0),
            })
            .expect("move should be in bounds");
        let _ = world
            .apply_command(WorldCommand::MoveEntity {
                id: 1,
                direction: Vec3i::new(-1, 0, 0),
            })
            .expect("move should be in bounds");
        let snapshot = world.snapshot();
        let entity = snapshot
            .entities
            .into_iter()
            .find(|entity| entity.id == 1)
            .expect("entity should exist");
        assert!(!entity.facing_left);
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
}
