//! Bevy-free world state ported from `game_library/world_sim/src/world_core.rs`.
//!
//! FOV is intentionally omitted for Increment 2 v1 snapshots.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use od_core::world::{
    BlockType, EntityMovementSnapshot, EntitySnapshot, MoveEntityError, Vec3i, Vec3u, WorldCommand,
    WorldConfig, WorldSnapshot,
};

use crate::terrain::{build_terrain_blocks_cache, make_initial_blocks};

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

/// Internal authoritative world state.
#[derive(Debug, Clone)]
pub struct WorldState {
    tick: u64,
    chunk_edge: u32,
    world_chunks: Vec3u,
    movement_ticks_per_tile: u32,
    blocks: Vec<BlockType>,
    terrain_blocks: HashMap<Vec3i, BlockType>,
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
        let blocks = make_initial_blocks(
            config.chunk_edge,
            config.world_chunks,
            block_count,
            &config.terrain,
        );
        let terrain_blocks =
            build_terrain_blocks_cache(&blocks, config.chunk_edge, config.world_chunks);

        Self {
            tick: 0,
            chunk_edge: config.chunk_edge,
            world_chunks: config.world_chunks,
            movement_ticks_per_tile: config.movement_ticks_per_tile.max(1),
            blocks,
            terrain_blocks,
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

    fn block_at(&self, pos: Vec3i) -> Option<BlockType> {
        let edge = self.chunk_edge;
        let wc = self.world_chunks;
        let world_size_x = i32::try_from(wc.x.checked_mul(edge)?).ok()?;
        let world_size_y = i32::try_from(wc.y.checked_mul(edge)?).ok()?;
        let world_size_z = i32::try_from(wc.z.checked_mul(edge)?).ok()?;
        let lx = pos.x + world_size_x / 2;
        let ly = pos.y + world_size_y / 2;
        let lz = pos.z + world_size_z / 2;
        if lx < 0
            || ly < 0
            || lz < 0
            || lx >= world_size_x
            || ly >= world_size_y
            || lz >= world_size_z
        {
            return None;
        }
        let ix = lx as usize;
        let iy = ly as usize;
        let iz = lz as usize;
        let sx = world_size_x as usize;
        let sy = world_size_y as usize;
        self.blocks.get(iz * sx * sy + iy * sx + ix).copied()
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
        self.chunk_edge
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
        let mut chunks: Vec<_> = self.loaded_chunks.iter().copied().collect();
        chunks.sort_unstable();
        chunks
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

    /// Apply a command. `MoveEntity` starts interpolation only (no hidden tick).
    pub fn apply_command(&mut self, command: WorldCommand) -> Result<(), MoveEntityError> {
        match command {
            WorldCommand::MoveEntity { id, direction } => {
                self.start_entity_move_with_reason(id, direction)
            }
            WorldCommand::AdvanceTicks { count } => {
                self.force_advance_ticks(count);
                Ok(())
            }
            WorldCommand::SetChunkLoaded { chunk, loaded } => {
                self.set_chunk_loaded(chunk, loaded);
                Ok(())
            }
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

        let loaded_chunks: BTreeSet<Vec3i> = self.loaded_chunks.iter().copied().collect();
        let mut terrain_blocks = BTreeMap::new();
        for (&pos, &block) in &self.terrain_blocks {
            if let Some(chunk) = self.world_position_to_chunk_coord(pos)
                && self.loaded_chunks.contains(&chunk)
            {
                terrain_blocks.insert(pos, block);
            }
        }

        WorldSnapshot {
            tick: self.tick,
            chunk_edge: self.chunk_edge,
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

    #[must_use]
    pub fn world_position_to_chunk_coord(&self, position: Vec3i) -> Option<Vec3i> {
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
