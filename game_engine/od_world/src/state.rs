//! Bevy-free world state ported from `game_library/world_sim/src/world_core.rs`.
//!
//! FOV is intentionally omitted for Increment 2 v1 snapshots.

use std::collections::{BTreeMap, BTreeSet};

use od_core::world::chunk::{
    CHUNK_VOLUME, SUPPORTED_CHUNK_EDGE, chunk_coord_to_index, chunk_index_to_coord,
    chunk_min_world_position, world_position_to_chunk_voxel,
};
use od_core::world::{
    BlockType, EntityMovementSnapshot, EntitySnapshot, MoveEntityError, Vec3i, Vec3u, WorldCommand,
    WorldCommandError, WorldConfig, WorldConfigError, WorldSnapshot,
};

use crate::terrain::{generate_chunk_blocks, seed_to_u64};

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

/// One fixed 16-edge chunk of authoritative terrain.
///
/// `blocks` uses the canonical local-voxel order (z-major, x fastest).
/// `terrain_revision` starts at 0 and increments on every effective block
/// mutation of this chunk. `simulation_resident` mirrors the legacy
/// "loaded chunk" gate: non-resident chunks keep their terrain but are
/// excluded from snapshots and block movement into them.
#[derive(Debug, Clone)]
struct ChunkState {
    blocks: Box<[BlockType; CHUNK_VOLUME]>,
    terrain_revision: u64,
    simulation_resident: bool,
}

/// Internal authoritative world state.
///
/// Terrain has exactly one source of truth: `chunks`, in canonical z-major
/// chunk order with x fastest. Snapshots are derived data.
#[derive(Debug, Clone)]
pub struct WorldState {
    tick: u64,
    world_chunks: Vec3u,
    movement_ticks_per_tile: u32,
    chunks: Vec<ChunkState>,
    entities: BTreeMap<u64, EntityState>,
    next_entity_id: u64,
}

impl WorldState {
    /// Construct a world after validating the fixed chunk edge.
    pub fn try_new(config: WorldConfig) -> Result<Self, WorldConfigError> {
        if config.chunk_edge != SUPPORTED_CHUNK_EDGE {
            return Err(WorldConfigError::UnsupportedChunkEdge {
                actual: config.chunk_edge,
                supported: SUPPORTED_CHUNK_EDGE,
            });
        }
        let chunk_count = usize::try_from(config.world_chunks.x)
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
            .expect("world chunk count overflowed");
        let seed = seed_to_u64(&config.terrain.seed);
        let mut chunks = Vec::with_capacity(chunk_count);
        for index in 0..chunk_count {
            let chunk = chunk_index_to_coord(index, config.world_chunks)
                .expect("canonical chunk index should map to a chunk coordinate");
            chunks.push(ChunkState {
                blocks: generate_chunk_blocks(chunk, config.world_chunks, &config.terrain, seed),
                terrain_revision: 0,
                simulation_resident: true,
            });
        }

        Ok(Self {
            tick: 0,
            world_chunks: config.world_chunks,
            movement_ticks_per_tile: config.movement_ticks_per_tile.max(1),
            chunks,
            entities: BTreeMap::new(),
            next_entity_id: 1,
        })
    }

    /// Trusted-config constructor; panics on an unsupported chunk edge.
    #[must_use]
    pub fn new(config: WorldConfig) -> Self {
        Self::try_new(config).expect("trusted WorldConfig should use the supported chunk edge")
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

    #[must_use]
    pub fn find_spawn_position(&self, preferred_xy: Vec3i) -> Option<Vec3i> {
        let (min, max) = self.centered_bounds();
        let start_x = preferred_xy.x.clamp(min.x, max.x);
        let start_y = preferred_xy.y.clamp(min.y, max.y);
        let mut best_spawn: Option<(i32, i32, i32, i32, Vec3i)> = None;

        for y in min.y..=max.y {
            for x in min.x..=max.x {
                let Some(z) = self.highest_supported_z(x, y) else {
                    continue;
                };
                if z >= max.z {
                    continue;
                }
                let distance = (x - start_x).abs() + (y - start_y).abs();
                let candidate = Vec3i::new(x, y, z);

                let is_better = match best_spawn {
                    None => true,
                    Some((best_z, best_distance, best_x, best_y, _)) => {
                        z > best_z
                            || (z == best_z
                                && (distance < best_distance
                                    || (distance == best_distance && (x, y) < (best_x, best_y))))
                    }
                };

                if is_better {
                    best_spawn = Some((z, distance, x, y, candidate));
                }
            }
        }

        best_spawn.map(|(_, _, _, _, spawn)| spawn)
    }

    pub(crate) fn block_at(&self, pos: Vec3i) -> Option<BlockType> {
        let (chunk, voxel) = world_position_to_chunk_voxel(pos, self.world_chunks)?;
        let index = chunk_coord_to_index(chunk, self.world_chunks)?;
        Some(self.chunks[index].blocks[voxel])
    }

    fn highest_supported_z(&self, x: i32, y: i32) -> Option<i32> {
        let (min, max) = self.centered_bounds();
        if x < min.x || x > max.x || y < min.y || y > max.y {
            return None;
        }

        let mut z = max.z;
        while z > min.z {
            let tile = Vec3i::new(x, y, z);
            let below = Vec3i::new(x, y, z - 1);
            if matches!(self.block_at(tile), Some(BlockType::Air))
                && matches!(self.block_at(below), Some(BlockType::SolidStone))
            {
                return Some(z);
            }
            z -= 1;
        }
        None
    }

    fn resolve_movement_direction(&self, entity_pos: Vec3i, dx: i32, dy: i32) -> Option<Vec3i> {
        let p = entity_pos;
        let flat = Vec3i::new(p.x + dx, p.y + dy, p.z);
        let floor = Vec3i::new(p.x + dx, p.y + dy, p.z - 1);

        let flat_block = self.block_at(flat);
        let is_solid = |b: Option<BlockType>| matches!(b, Some(BlockType::SolidStone));

        if !is_solid(flat_block) && is_solid(self.block_at(floor)) {
            return Some(Vec3i::new(dx, dy, 0));
        }

        let step_dest = Vec3i::new(p.x + dx, p.y + dy, p.z + 1);
        let headroom = Vec3i::new(p.x, p.y, p.z + 1);
        if is_solid(flat_block)
            && !is_solid(self.block_at(step_dest))
            && !is_solid(self.block_at(headroom))
        {
            return Some(Vec3i::new(dx, dy, 1));
        }

        let new_floor = Vec3i::new(p.x + dx, p.y + dy, p.z - 2);
        if !is_solid(flat_block)
            && !is_solid(self.block_at(floor))
            && is_solid(self.block_at(new_floor))
        {
            return Some(Vec3i::new(dx, dy, -1));
        }

        None
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

        let raw_target_position = current.position.add(direction);
        if !self.contains_position(raw_target_position) {
            return Err(MoveEntityError::OutOfBounds {
                from: current.position,
                to: raw_target_position,
            });
        }

        let direction = if direction.z == 0 {
            match self.resolve_movement_direction(current.position, direction.x, direction.y) {
                Some(d) => d,
                None => return Err(MoveEntityError::Blocked),
            }
        } else {
            direction
        };

        let target_position = current.position.add(direction);

        if !self.contains_position(target_position) {
            return Err(MoveEntityError::OutOfBounds {
                from: current.position,
                to: target_position,
            });
        }

        if is_diagonal_move_blocked(current.position, target_position, self) {
            return Err(MoveEntityError::Blocked);
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
        let distance = if current.movement.is_some() {
            movement_distance_between(movement_start_position, target_position)
        } else {
            movement_distance(direction)
        };
        let total_ticks = (distance * self.movement_ticks_per_tile as f32).ceil() as u32;
        let next_entity = EntityState {
            position: current.position,
            facing_left: facing_left_after,
            is_prone: current.is_prone,
            movement: Some(EntityMovementState::with_start_position(
                movement_origin,
                target_position,
                total_ticks,
                movement_start_position,
            )),
        };
        self.entities.insert(id, next_entity);
        Ok(())
    }

    /// Advance all in-progress movements by one tick (or no-op if none moving).
    ///
    /// Returns `true` if any entity was moving (and tick was advanced via movement).
    pub fn advance_active_movements_one_tick(&mut self) -> bool {
        let moving_ids: Vec<u64> = self
            .entities
            .iter()
            .filter_map(|(id, entity)| entity.movement.map(|_| *id))
            .collect();
        if moving_ids.is_empty() {
            return false;
        }

        self.tick = self.tick.saturating_add(1);
        for id in moving_ids {
            let Some(entity) = self.entities.get_mut(&id) else {
                continue;
            };

            if let Some(mut movement) = entity.movement {
                movement.elapsed_ticks = movement
                    .elapsed_ticks
                    .saturating_add(1)
                    .min(movement.total_ticks.max(1));
                if movement.progress_percent() >= 75 {
                    entity.position = movement.target;
                }
                if movement.is_complete() {
                    entity.position = movement.target;
                    entity.movement = None;
                } else {
                    entity.movement.replace(movement);
                }
            }
        }
        true
    }

    pub fn force_advance_ticks(&mut self, count: u32) {
        let ticks = count.max(1);
        for _ in 0..ticks {
            if !self.advance_active_movements_one_tick() {
                self.tick = self.tick.saturating_add(1);
            }
        }
    }

    #[must_use]
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
    pub fn tick_count(&self) -> u64 {
        self.tick
    }

    #[must_use]
    pub fn world_chunks(&self) -> Vec3u {
        self.world_chunks
    }

    #[must_use]
    pub fn chunk_edge(&self) -> u32 {
        SUPPORTED_CHUNK_EDGE
    }

    #[must_use]
    pub fn entity_position(&self, id: u64) -> Option<Vec3i> {
        self.entities.get(&id).map(|entity| entity.position)
    }

    #[must_use]
    pub fn entity_snapshot(&self, id: u64) -> Option<EntitySnapshot> {
        self.entities.get(&id).map(|entity| EntitySnapshot {
            id,
            position: entity.position,
            facing_left: entity.facing_left,
            is_prone: entity.is_prone,
            movement: entity.movement.map(EntityMovementState::snapshot),
        })
    }

    #[must_use]
    pub fn loaded_chunk_coords(&self) -> Vec<Vec3i> {
        let mut chunks: Vec<_> = self
            .chunks
            .iter()
            .enumerate()
            .filter(|(_, chunk)| chunk.simulation_resident)
            .map(|(index, _)| {
                chunk_index_to_coord(index, self.world_chunks)
                    .expect("stored chunk index should map to a chunk coordinate")
            })
            .collect();
        chunks.sort_unstable();
        chunks
    }

    /// Terrain revision of one chunk, or [`None`] outside the chunk grid.
    #[must_use]
    pub fn chunk_terrain_revision(&self, chunk: Vec3i) -> Option<u64> {
        let index = chunk_coord_to_index(chunk, self.world_chunks)?;
        Some(self.chunks[index].terrain_revision)
    }

    /// Copy one chunk's blocks into `out` with a single typed copy.
    ///
    /// Returns `false` without touching `out` when `chunk` is outside the
    /// chunk grid. Never allocates and never derives terrain from a snapshot.
    pub fn copy_chunk_blocks(&self, chunk: Vec3i, out: &mut [BlockType; CHUNK_VOLUME]) -> bool {
        let Some(index) = chunk_coord_to_index(chunk, self.world_chunks) else {
            return false;
        };
        out.copy_from_slice(&self.chunks[index].blocks[..]);
        true
    }

    #[must_use]
    pub fn next_entity_id(&self) -> u64 {
        self.next_entity_id
    }

    #[must_use]
    pub fn has_entity(&self, id: u64) -> bool {
        self.entities.contains_key(&id)
    }

    #[must_use]
    pub fn entity_is_moving(&self, id: u64) -> bool {
        self.entities
            .get(&id)
            .is_some_and(|entity| entity.movement.is_some())
    }

    /// Change one chunk's simulation residency.
    ///
    /// Out-of-bounds chunks return a typed error and change no state; a
    /// phantom chunk is never indexed or inserted.
    pub fn set_chunk_loaded(
        &mut self,
        chunk: Vec3i,
        loaded: bool,
    ) -> Result<(), WorldCommandError> {
        let index = chunk_coord_to_index(chunk, self.world_chunks)
            .ok_or(WorldCommandError::ChunkOutOfBounds { chunk })?;
        self.chunks[index].simulation_resident = loaded;
        Ok(())
    }

    #[must_use]
    pub fn is_chunk_loaded(&self, chunk: Vec3i) -> bool {
        chunk_coord_to_index(chunk, self.world_chunks)
            .is_some_and(|index| self.chunks[index].simulation_resident)
    }

    #[must_use]
    pub fn loaded_chunk_count(&self) -> usize {
        self.chunks
            .iter()
            .filter(|chunk| chunk.simulation_resident)
            .count()
    }

    pub fn spawn_or_replace_entity(&mut self, id: u64, position: Vec3i) -> Result<(), String> {
        if !self.contains_position(position) {
            return Err(format!("spawn position is out of bounds: {position:?}"));
        }
        self.entities.insert(id, EntityState::new(position));
        self.next_entity_id = self.next_entity_id.max(id.saturating_add(1));
        Ok(())
    }

    /// Apply a command. `MoveEntity` starts interpolation only (no hidden tick).
    pub fn apply_command(&mut self, command: WorldCommand) -> Result<(), WorldCommandError> {
        match command {
            WorldCommand::MoveEntity { id, direction } => self
                .start_entity_move_with_reason(id, direction)
                .map_err(WorldCommandError::from),
            WorldCommand::AdvanceTicks { count } => {
                self.force_advance_ticks(count);
                Ok(())
            }
            WorldCommand::SetChunkLoaded { chunk, loaded } => self.set_chunk_loaded(chunk, loaded),
        }
    }

    /// v1 snapshot without FOV / visibility.
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

        let edge = i32::try_from(SUPPORTED_CHUNK_EDGE).expect("chunk edge fits in i32");
        let mut loaded_chunks = BTreeSet::new();
        let mut terrain_blocks = BTreeMap::new();
        for (index, chunk_state) in self.chunks.iter().enumerate() {
            if !chunk_state.simulation_resident {
                continue;
            }
            let chunk = chunk_index_to_coord(index, self.world_chunks)
                .expect("stored chunk index should map to a chunk coordinate");
            loaded_chunks.insert(chunk);
            let base = chunk_min_world_position(chunk, self.world_chunks)
                .expect("stored chunk coordinate should have a world base");
            let mut voxel = 0_usize;
            for vz in 0..edge {
                for vy in 0..edge {
                    for vx in 0..edge {
                        // Sparse snapshot schema: solid cells only (unchanged).
                        if chunk_state.blocks[voxel] == BlockType::SolidStone {
                            terrain_blocks.insert(
                                Vec3i::new(base.x + vx, base.y + vy, base.z + vz),
                                BlockType::SolidStone,
                            );
                        }
                        voxel += 1;
                    }
                }
            }
        }

        WorldSnapshot {
            tick: self.tick,
            chunk_edge: SUPPORTED_CHUNK_EDGE,
            world_chunks: self.world_chunks,
            terrain_blocks,
            loaded_chunks,
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
                .checked_mul(SUPPORTED_CHUNK_EDGE)
                .expect("world x-size overflowed"),
            self.world_chunks
                .y
                .checked_mul(SUPPORTED_CHUNK_EDGE)
                .expect("world y-size overflowed"),
            self.world_chunks
                .z
                .checked_mul(SUPPORTED_CHUNK_EDGE)
                .expect("world z-size overflowed"),
        )
    }

    #[must_use]
    pub fn world_position_to_chunk_coord(&self, position: Vec3i) -> Option<Vec3i> {
        world_position_to_chunk_voxel(position, self.world_chunks).map(|(chunk, _)| chunk)
    }

    /// Test-only terrain mutation: set one block and bump only that chunk's
    /// terrain revision. Writing the already-stored value does not increment
    /// the revision. Returns `false` for out-of-bounds positions.
    ///
    /// Exists solely to exercise projection/cache invalidation until a
    /// replayable terrain-edit command is designed.
    #[cfg(test)]
    pub(crate) fn set_block_for_test(&mut self, position: Vec3i, block: BlockType) -> bool {
        let Some((chunk, voxel)) = world_position_to_chunk_voxel(position, self.world_chunks)
        else {
            return false;
        };
        let Some(index) = chunk_coord_to_index(chunk, self.world_chunks) else {
            return false;
        };
        let chunk_state = &mut self.chunks[index];
        if chunk_state.blocks[voxel] != block {
            chunk_state.blocks[voxel] = block;
            chunk_state.terrain_revision = chunk_state.terrain_revision.saturating_add(1);
        }
        true
    }
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

fn is_diagonal_move_blocked(from: Vec3i, to: Vec3i, world: &WorldState) -> bool {
    let dx = (to.x - from.x).signum();
    let dy = (to.y - from.y).signum();
    let dz = (to.z - from.z).signum();

    let axes_moving = u32::from(dx != 0) + u32::from(dy != 0) + u32::from(dz != 0);

    if axes_moving < 2 {
        return false;
    }

    let is_solid =
        |pos: Vec3i| -> bool { matches!(world.block_at(pos), Some(BlockType::SolidStone)) };

    if dx != 0 && dy != 0 && dz == 0 {
        let neighbor1 = Vec3i::new(to.x, from.y, to.z);
        let neighbor2 = Vec3i::new(from.x, to.y, to.z);
        return is_solid(neighbor1) && is_solid(neighbor2);
    }

    if dx != 0 && dz != 0 && dy == 0 {
        let neighbor1 = Vec3i::new(to.x, from.y, from.z);
        let neighbor2 = Vec3i::new(from.x, from.y, to.z);
        return is_solid(neighbor1) && is_solid(neighbor2);
    }

    if dy != 0 && dz != 0 && dx == 0 {
        let neighbor1 = Vec3i::new(from.x, to.y, from.z);
        let neighbor2 = Vec3i::new(from.x, from.y, to.z);
        return is_solid(neighbor1) && is_solid(neighbor2);
    }

    if dx != 0 && dy != 0 && dz != 0 {
        let xy1 = Vec3i::new(to.x, from.y, from.z);
        let xy2 = Vec3i::new(from.x, to.y, from.z);
        if is_solid(xy1) && is_solid(xy2) {
            return true;
        }

        let xz1 = Vec3i::new(to.x, from.y, from.z);
        let xz2 = Vec3i::new(from.x, from.y, to.z);
        if is_solid(xz1) && is_solid(xz2) {
            return true;
        }

        let yz1 = Vec3i::new(from.x, to.y, from.z);
        let yz2 = Vec3i::new(from.x, from.y, to.z);
        return is_solid(yz1) && is_solid(yz2);
    }

    false
}

fn vec3i_to_f32(position: Vec3i) -> [f32; 3] {
    [position.x as f32, position.y as f32, position.z as f32]
}

#[cfg(test)]
mod tests {
    use od_core::world::{TerrainConfig, WorldCommandError, WorldConfigError};

    use super::*;

    fn config(world_chunks: Vec3u) -> WorldConfig {
        WorldConfig {
            chunk_edge: 16,
            world_chunks,
            movement_ticks_per_tile: 10,
            terrain: TerrainConfig::default(),
        }
    }

    #[test]
    fn try_new_rejects_unsupported_chunk_edge() {
        for actual in [0_u32, 8, 15, 17, 32] {
            let result = WorldState::try_new(WorldConfig {
                chunk_edge: actual,
                ..config(Vec3u::new(1, 1, 1))
            });
            assert!(
                matches!(
                    result.as_ref().err(),
                    Some(&WorldConfigError::UnsupportedChunkEdge {
                        actual: got,
                        supported: SUPPORTED_CHUNK_EDGE,
                    }) if got == actual
                ),
                "chunk_edge {actual} must be rejected, got {result:?}"
            );
        }
    }

    #[test]
    fn default_construction_marks_every_generated_chunk_resident() {
        for dims in [
            Vec3u::new(1, 1, 1),
            Vec3u::new(2, 2, 2),
            Vec3u::new(9, 9, 1),
        ] {
            let state = WorldState::new(config(dims));
            let expected = (dims.x * dims.y * dims.z) as usize;
            assert_eq!(state.loaded_chunk_count(), expected, "{dims:?}");
            let coords = state.loaded_chunk_coords();
            assert_eq!(coords.len(), expected, "{dims:?}");
            for chunk in &coords {
                assert!(state.is_chunk_loaded(*chunk), "{chunk:?} in {dims:?}");
                assert_eq!(
                    state.chunk_terrain_revision(*chunk),
                    Some(0),
                    "fresh revision for {chunk:?} in {dims:?}"
                );
            }
        }
    }

    #[test]
    fn copy_chunk_blocks_matches_block_at_for_center_negative_and_edge_chunks() {
        let state = WorldState::new(config(Vec3u::new(9, 9, 1)));
        let mut out = Box::new([BlockType::Air; CHUNK_VOLUME]);
        for chunk in [
            Vec3i::new(0, 0, 0),
            Vec3i::new(-4, -4, 0),
            Vec3i::new(4, 4, 0),
            Vec3i::new(-4, 3, 0),
        ] {
            assert!(state.copy_chunk_blocks(chunk, &mut out), "{chunk:?}");
            let base = chunk_min_world_position(chunk, state.world_chunks()).expect("base");
            let mut voxel = 0_usize;
            for vz in 0..16 {
                for vy in 0..16 {
                    for vx in 0..16 {
                        let pos = Vec3i::new(base.x + vx, base.y + vy, base.z + vz);
                        assert_eq!(
                            Some(out[voxel]),
                            state.block_at(pos),
                            "parity at {pos:?} (chunk {chunk:?}, voxel {voxel})"
                        );
                        voxel += 1;
                    }
                }
            }
            assert_eq!(voxel, CHUNK_VOLUME);
        }
    }

    #[test]
    fn copy_chunk_blocks_invalid_coord_returns_false_without_touching_out() {
        let state = WorldState::new(config(Vec3u::new(9, 9, 1)));
        let mut out = Box::new([BlockType::Air; CHUNK_VOLUME]);
        assert!(state.copy_chunk_blocks(Vec3i::new(0, 0, 0), &mut out));
        let before = *out;
        for invalid in [
            Vec3i::new(5, 0, 0),
            Vec3i::new(-5, 0, 0),
            Vec3i::new(0, 5, 0),
            Vec3i::new(0, 0, 1),
            Vec3i::new(0, 0, -1),
            Vec3i::new(i32::MIN, i32::MAX, 0),
        ] {
            assert!(
                !state.copy_chunk_blocks(invalid, &mut out),
                "{invalid:?} must be rejected"
            );
            assert_eq!(*out, before, "output modified for {invalid:?}");
        }
    }

    #[test]
    fn out_of_bounds_set_chunk_loaded_is_typed_error_and_changes_no_state() {
        let mut state = WorldState::new(config(Vec3u::new(2, 1, 1)));
        let before = state.snapshot();
        let before_count = state.loaded_chunk_count();
        for chunk in [
            Vec3i::new(1, 0, 0),
            Vec3i::new(-2, 0, 0),
            Vec3i::new(0, 1, 0),
            Vec3i::new(0, 0, -1),
        ] {
            for loaded in [true, false] {
                let err = state
                    .apply_command(WorldCommand::SetChunkLoaded { chunk, loaded })
                    .expect_err("out-of-bounds residency command must fail");
                assert_eq!(err, WorldCommandError::ChunkOutOfBounds { chunk });
            }
            assert!(!state.is_chunk_loaded(chunk), "no phantom chunk {chunk:?}");
        }
        assert_eq!(state.loaded_chunk_count(), before_count);
        assert_eq!(state.snapshot(), before, "state must be unchanged");
    }

    #[test]
    fn test_block_mutation_bumps_exactly_one_revision_and_changes_snapshot() {
        let mut state = WorldState::new(config(Vec3u::new(2, 2, 2)));
        let position = Vec3i::new(0, 0, 0); // starter room => Air
        assert_eq!(state.block_at(position), Some(BlockType::Air));
        let target_chunk = state
            .world_position_to_chunk_coord(position)
            .expect("target chunk");
        let all_chunks = state.loaded_chunk_coords();
        let snapshot_before = state.snapshot();

        assert!(state.set_block_for_test(position, BlockType::SolidStone));

        assert_eq!(state.block_at(position), Some(BlockType::SolidStone));
        let snapshot_after = state.snapshot();
        assert_ne!(snapshot_after, snapshot_before, "snapshot must change");
        assert_eq!(
            snapshot_after.terrain_blocks.get(&position),
            Some(&BlockType::SolidStone)
        );
        for chunk in &all_chunks {
            let expected = u64::from(*chunk == target_chunk);
            assert_eq!(
                state.chunk_terrain_revision(*chunk),
                Some(expected),
                "revision for {chunk:?}"
            );
        }

        // Writing the same value again must not increment the revision.
        assert!(state.set_block_for_test(position, BlockType::SolidStone));
        assert_eq!(state.chunk_terrain_revision(target_chunk), Some(1));
        assert_eq!(state.snapshot(), snapshot_after);

        // Out-of-bounds mutation is rejected.
        assert!(!state.set_block_for_test(Vec3i::new(1000, 0, 0), BlockType::Air));
    }
}
