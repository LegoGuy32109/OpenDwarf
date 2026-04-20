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
pub struct TerrainConfig {
    pub seed: String,
    pub cave_frequency_xy: f64,
    pub cave_frequency_z: f64,
    pub cave_threshold: f64,
    pub cave_octaves: u32,
    pub cave_persistence: f64,
    pub cave_lacunarity: f64,
}

impl Default for TerrainConfig {
    fn default() -> Self {
        Self {
            seed: "opendwarf".to_string(),
            cave_frequency_xy: 0.09,
            cave_frequency_z: 0.022,
            cave_threshold: 0.13,
            cave_octaves: 4,
            cave_persistence: 0.58,
            cave_lacunarity: 2.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldConfig {
    pub chunk_edge: u32,
    pub world_chunks: Vec3u,
    pub movement_ticks_per_tile: u32,
    pub terrain: TerrainConfig,
}

impl Default for WorldConfig {
    fn default() -> Self {
        Self {
            chunk_edge: DEFAULT_CHUNK_EDGE,
            world_chunks: DEFAULT_WORLD_CHUNKS,
            movement_ticks_per_tile: DEFAULT_MOVEMENT_TICKS_PER_TILE,
            terrain: TerrainConfig::default(),
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
            blocks: make_initial_blocks(
                config.chunk_edge,
                config.world_chunks,
                block_count,
                &config.terrain,
            ),
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
                                    || (distance == best_distance
                                        && (x, y) < (best_x, best_y))))
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
        let world_size_x = wc.x.checked_mul(edge)? as i32;
        let world_size_y = wc.y.checked_mul(edge)? as i32;
        let world_size_z = wc.z.checked_mul(edge)? as i32;
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

        // Flat walk: target is air and floor below is solid
        if !is_solid(flat_block) && is_solid(self.block_at(floor)) {
            return Some(Vec3i::new(dx, dy, 0));
        }

        // Step up: target is solid, space above target is air, headroom above player is air
        let step_dest = Vec3i::new(p.x + dx, p.y + dy, p.z + 1);
        let headroom = Vec3i::new(p.x, p.y, p.z + 1);
        if is_solid(flat_block)
            && !is_solid(self.block_at(step_dest))
            && !is_solid(self.block_at(headroom))
        {
            return Some(Vec3i::new(dx, dy, 1));
        }

        // Step down: target is air, no floor below, but floor two below is solid
        let new_floor = Vec3i::new(p.x + dx, p.y + dy, p.z - 2);
        if !is_solid(flat_block)
            && !is_solid(self.block_at(floor))
            && is_solid(self.block_at(new_floor))
        {
            return Some(Vec3i::new(dx, dy, -1));
        }

        None // blocked
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

        // Resolve movement direction using terrain (step up/down/flat)
        let direction = if direction.z == 0 {
            let resolved =
                self.resolve_movement_direction(current.position, direction.x, direction.y);
            match resolved {
                Some(d) => d,
                None => return Err(MoveEntityError::Blocked),
            }
        } else {
            direction // explicit z (future use)
        };

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
    Blocked,
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

fn make_initial_blocks(
    chunk_edge: u32,
    world_chunks: Vec3u,
    block_count: usize,
    terrain: &TerrainConfig,
) -> Vec<BlockType> {
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
    let min = world_min_for_size(world_size);
    let max_z = min.z + i32::try_from(world_size.z).expect("world size z does not fit in i32") - 1;
    let world_size_x = usize::try_from(world_size.x).expect("world size x does not fit in usize");
    let world_size_y = usize::try_from(world_size.y).expect("world size y does not fit in usize");
    let seed = seed_to_u64(&terrain.seed);

    let mut blocks = vec![BlockType::SolidStone; block_count];
    for z in 0..world_size.z {
        let world_z = min.z + i32::try_from(z).expect("z does not fit in i32");
        for y in 0..world_size_y {
            let world_y = min.y + i32::try_from(y).expect("y does not fit in i32");
            for x in 0..world_size_x {
                let world_x = min.x + i32::try_from(x).expect("x does not fit in i32");
                let world_position = Vec3i::new(world_x, world_y, world_z);
                if world_z == max_z {
                    let index = world_position_to_index(world_position, world_size)
                        .expect("world position should be in bounds");
                    blocks[index] = BlockType::Air;
                    continue;
                }
                let density = sample_cave_density(world_position, terrain, seed);
                if density > terrain.cave_threshold {
                    let index = world_position_to_index(world_position, world_size)
                        .expect("world position should be in bounds");
                    blocks[index] = BlockType::Air;
                }
            }
        }
    }
    blocks
}

fn sample_cave_density(world_position: Vec3i, terrain: &TerrainConfig, seed: u64) -> f64 {
    let mut frequency_xy = terrain.cave_frequency_xy;
    let mut frequency_z = terrain.cave_frequency_z;
    let mut amplitude = 1.0;
    let mut total_amplitude = 0.0;
    let mut total_density = 0.0;
    let octaves = terrain.cave_octaves.max(1);
    let x = world_position.x as f64;
    let y = world_position.y as f64;
    let z = world_position.z as f64;

    for octave in 0..octaves {
        let octave_seed = seed.wrapping_add(
            u64::from(octave + 1).wrapping_mul(0x9E37_79B9_7F4A_7C15),
        );
        let noise = perlin_like_noise_3d(
            octave_seed,
            x * frequency_xy,
            y * frequency_xy,
            z * frequency_z,
        );
        total_density += noise * amplitude;
        total_amplitude += amplitude;
        amplitude *= terrain.cave_persistence;
        frequency_xy *= terrain.cave_lacunarity;
        frequency_z *= terrain.cave_lacunarity;
    }

    if total_amplitude == 0.0 {
        0.0
    } else {
        total_density / total_amplitude
    }
}

fn perlin_like_noise_3d(seed: u64, x: f64, y: f64, z: f64) -> f64 {
    let x_floor = x.floor();
    let y_floor = y.floor();
    let z_floor = z.floor();

    let x0 = x_floor as i64;
    let y0 = y_floor as i64;
    let z0 = z_floor as i64;
    let x1 = x0 + 1;
    let y1 = y0 + 1;
    let z1 = z0 + 1;

    let xf = x - x_floor;
    let yf = y - y_floor;
    let zf = z - z_floor;

    let u = fade(xf);
    let v = fade(yf);
    let w = fade(zf);

    let aaa = gradient_hash(seed, x0, y0, z0);
    let aba = gradient_hash(seed, x0, y1, z0);
    let aab = gradient_hash(seed, x0, y0, z1);
    let abb = gradient_hash(seed, x0, y1, z1);
    let baa = gradient_hash(seed, x1, y0, z0);
    let bba = gradient_hash(seed, x1, y1, z0);
    let bab = gradient_hash(seed, x1, y0, z1);
    let bbb = gradient_hash(seed, x1, y1, z1);

    let x_lerp1 = lerp(
        u,
        grad(aaa, xf, yf, zf),
        grad(baa, xf - 1.0, yf, zf),
    );
    let x_lerp2 = lerp(
        u,
        grad(aba, xf, yf - 1.0, zf),
        grad(bba, xf - 1.0, yf - 1.0, zf),
    );
    let y_lerp1 = lerp(v, x_lerp1, x_lerp2);

    let x_lerp3 = lerp(
        u,
        grad(aab, xf, yf, zf - 1.0),
        grad(bab, xf - 1.0, yf, zf - 1.0),
    );
    let x_lerp4 = lerp(
        u,
        grad(abb, xf, yf - 1.0, zf - 1.0),
        grad(bbb, xf - 1.0, yf - 1.0, zf - 1.0),
    );
    let y_lerp2 = lerp(v, x_lerp3, x_lerp4);

    lerp(w, y_lerp1, y_lerp2)
}

fn gradient_hash(seed: u64, x: i64, y: i64, z: i64) -> u64 {
    let mut hash = seed ^ 0x9E37_79B9_7F4A_7C15;
    hash ^= mix_u64(x as u64);
    hash = hash.rotate_left(17) ^ mix_u64(y as u64);
    hash = hash.rotate_left(17) ^ mix_u64(z as u64);
    mix_u64(hash)
}

fn grad(hash: u64, x: f64, y: f64, z: f64) -> f64 {
    match hash & 0xF {
        0 => x + y,
        1 => -x + y,
        2 => x - y,
        3 => -x - y,
        4 => x + z,
        5 => -x + z,
        6 => x - z,
        7 => -x - z,
        8 => y + z,
        9 => -y + z,
        10 => y - z,
        11 => -y - z,
        12 => x + y,
        13 => -x + y,
        14 => -y + z,
        _ => -x - z,
    }
}

fn fade(t: f64) -> f64 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

fn lerp(t: f64, a: f64, b: f64) -> f64 {
    a + t * (b - a)
}

fn mix_u64(mut value: u64) -> u64 {
    value ^= value >> 30;
    value = value.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94D0_49BB_1331_11EB);
    value ^ (value >> 31)
}

fn seed_to_u64(seed: &str) -> u64 {
    let mut hash = 0xCBF2_9CE4_8422_2325_u64;
    for byte in seed.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01B3);
    }
    mix_u64(hash)
}

fn world_min_for_size(world_size: Vec3u) -> Vec3i {
    Vec3i::new(
        -(i32::try_from(world_size.x).expect("world size x does not fit in i32") / 2),
        -(i32::try_from(world_size.y).expect("world size y does not fit in i32") / 2),
        -(i32::try_from(world_size.z).expect("world size z does not fit in i32") / 2),
    )
}

fn world_position_to_index(world_position: Vec3i, world_size: Vec3u) -> Option<usize> {
    let min = world_min_for_size(world_size);
    let local_x = world_position.x - min.x;
    let local_y = world_position.y - min.y;
    let local_z = world_position.z - min.z;
    if local_x < 0 || local_y < 0 || local_z < 0 {
        return None;
    }

    let local_x = usize::try_from(local_x).ok()?;
    let local_y = usize::try_from(local_y).ok()?;
    let local_z = usize::try_from(local_z).ok()?;
    let world_size_x = usize::try_from(world_size.x).ok()?;
    let world_size_y = usize::try_from(world_size.y).ok()?;
    let world_size_z = usize::try_from(world_size.z).ok()?;
    if local_x >= world_size_x || local_y >= world_size_y || local_z >= world_size_z {
        return None;
    }

    let layer_size = world_size_x.checked_mul(world_size_y)?;
    local_z
        .checked_mul(layer_size)
        .and_then(|offset| offset.checked_add(local_y.checked_mul(world_size_x)?))
        .and_then(|offset| offset.checked_add(local_x))
}

#[cfg(test)]
mod tests {
    use super::{
        BlockType, MoveEntityError, TerrainConfig, WorldConfig, WorldState, world_min_for_size,
        world_position_to_index,
    };
    use crate::world_api::{Vec3i, Vec3u, WorldCommand};

    fn test_world() -> WorldState {
        let mut world = WorldState::new(WorldConfig {
            movement_ticks_per_tile: 4,
            ..WorldConfig::default()
        });
        let world_size = Vec3u::new(
            world
                .world_chunks
                .x
                .checked_mul(world.chunk_edge)
                .expect("test world x-size overflowed"),
            world
                .world_chunks
                .y
                .checked_mul(world.chunk_edge)
                .expect("test world y-size overflowed"),
            world
                .world_chunks
                .z
                .checked_mul(world.chunk_edge)
                .expect("test world z-size overflowed"),
        );
        let (min, max) = {
            let min = world_min_for_size(world_size);
            let max = Vec3i::new(
                min.x + i32::try_from(world_size.x).expect("x too large") - 1,
                min.y + i32::try_from(world_size.y).expect("y too large") - 1,
                min.z + i32::try_from(world_size.z).expect("z too large") - 1,
            );
            (min, max)
        };

        for z in min.z..=max.z {
            for y in min.y..=max.y {
                for x in min.x..=max.x {
                    let index = world_position_to_index(Vec3i::new(x, y, z), world_size)
                        .expect("flat test world position should be in bounds");
                    world.blocks[index] = if z < 0 {
                        BlockType::SolidStone
                    } else {
                        BlockType::Air
                    };
                }
            }
        }

        world
    }

    fn cave_world(seed: &str) -> WorldState {
        WorldState::new(WorldConfig {
            chunk_edge: 16,
            world_chunks: Vec3u::new(2, 2, 4),
            movement_ticks_per_tile: 4,
            terrain: TerrainConfig {
                seed: seed.to_string(),
                ..TerrainConfig::default()
            },
        })
    }

    fn block_hash(blocks: &[BlockType]) -> u64 {
        let mut hash = 0xCBF2_9CE4_8422_2325_u64;
        for block in blocks {
            let byte = match block {
                BlockType::Air => 0_u8,
                BlockType::SolidStone => 1_u8,
            };
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01B3);
            hash ^= hash >> 32;
        }
        hash
    }

    fn slice_dump(world: &WorldState, z: i32) -> String {
        let (min, max) = world.centered_bounds();
        let mut output = String::new();
        for y in min.y..=max.y {
            for x in min.x..=max.x {
                let tile = world.block_at(Vec3i::new(x, y, z));
                output.push(match tile {
                    Some(BlockType::Air) => '.',
                    Some(BlockType::SolidStone) => '#',
                    None => ' ',
                });
            }
            output.push('\n');
        }
        output
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
        for _ in 0..8 {
            let _ = world.advance_active_movements_one_tick();
        }
        let _ = world
            .start_entity_move_with_reason(1, Vec3i::new(-1, 0, 0))
            .expect("move should start");
        for _ in 0..32 {
            let snapshot = world.snapshot();
            let entity = snapshot
                .entities
                .into_iter()
                .find(|entity| entity.id == 1)
                .expect("entity should exist");
            if entity.movement.is_none() {
                break;
            }
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
    }

    #[test]
    fn cave_generation_is_deterministic_and_seeded() {
        let world_a = cave_world("opendwarf");
        let world_b = cave_world("opendwarf");
        let world_c = cave_world("josh");

        let snapshot_a = world_a.snapshot();
        let snapshot_b = world_b.snapshot();
        let snapshot_c = world_c.snapshot();

        assert_eq!(snapshot_a.blocks.len(), snapshot_b.blocks.len());
        assert_eq!(snapshot_a.blocks.len(), snapshot_c.blocks.len());
        assert_eq!(block_hash(&snapshot_a.blocks), block_hash(&snapshot_b.blocks));
        assert_ne!(block_hash(&snapshot_a.blocks), block_hash(&snapshot_c.blocks));
        assert_eq!(slice_dump(&world_a, 0), slice_dump(&world_b, 0));
    }

    #[test]
    fn cave_generation_uses_full_volume_and_contains_air_and_stone() {
        let world = cave_world("karly");
        let snapshot = world.snapshot();
        let expected_blocks = usize::try_from(snapshot.chunk_edge)
            .expect("chunk edge should fit in usize")
            .checked_mul(usize::try_from(snapshot.chunk_edge).expect("chunk edge should fit"))
            .and_then(|n| {
                n.checked_mul(usize::try_from(snapshot.chunk_edge).expect("chunk edge should fit"))
            })
            .and_then(|n| n.checked_mul(usize::try_from(snapshot.world_chunks.x).expect("x too large")))
            .and_then(|n| n.checked_mul(usize::try_from(snapshot.world_chunks.y).expect("y too large")))
            .and_then(|n| n.checked_mul(usize::try_from(snapshot.world_chunks.z).expect("z too large")))
            .expect("block count should fit in usize");

        assert_eq!(snapshot.blocks.len(), expected_blocks);
        assert!(snapshot.blocks.iter().any(|block| *block == BlockType::Air));
        assert!(snapshot
            .blocks
            .iter()
            .any(|block| *block == BlockType::SolidStone));
    }

    #[test]
    fn cave_generation_leaves_top_slice_air() {
        let world = cave_world("opendwarf");
        let (min, max) = world.centered_bounds();

        for y in min.y..=max.y {
            for x in min.x..=max.x {
                assert!(matches!(
                    world.block_at(Vec3i::new(x, y, max.z)),
                    Some(BlockType::Air)
                ));
            }
        }
    }

    #[test]
    fn cave_spawn_finder_returns_supported_tile() {
        let world = cave_world("opendwarf");
        let spawn = world
            .find_spawn_position(Vec3i::ZERO)
            .expect("spawn position should exist");

        assert!(matches!(world.block_at(spawn), Some(BlockType::Air)));
        assert!(spawn.z < world.centered_bounds().1.z);
        assert!(matches!(
            world.block_at(Vec3i::new(spawn.x, spawn.y, spawn.z - 1)),
            Some(BlockType::SolidStone)
        ));

        let mut highest_supported = spawn.z;
        let (min, max) = world.centered_bounds();
        for z in (min.z..max.z).rev() {
            if matches!(world.block_at(Vec3i::new(spawn.x, spawn.y, z)), Some(BlockType::Air))
                && matches!(
                    world.block_at(Vec3i::new(spawn.x, spawn.y, z - 1)),
                    Some(BlockType::SolidStone)
                )
            {
                highest_supported = z;
                break;
            }
        }

        assert_eq!(spawn.z, highest_supported);
    }

    #[test]
    fn cave_spawn_finder_prefers_highest_supported_tile() {
        let mut world = WorldState::new(WorldConfig::default());
        let world_size = Vec3u::new(
            world
                .world_chunks
                .x
                .checked_mul(world.chunk_edge)
                .expect("test world x-size overflowed"),
            world
                .world_chunks
                .y
                .checked_mul(world.chunk_edge)
                .expect("test world y-size overflowed"),
            world
                .world_chunks
                .z
                .checked_mul(world.chunk_edge)
                .expect("test world z-size overflowed"),
        );

        for z in -8..=7 {
            for y in -8..=7 {
                for x in -8..=7 {
                    let index = world_position_to_index(Vec3i::new(x, y, z), world_size)
                        .expect("world position should be in bounds");
                    world.blocks[index] = BlockType::Air;
                }
            }
        }

        let low_support = Vec3i::new(0, 0, -2);
        let low_spawn = Vec3i::new(0, 0, -1);
        let high_support = Vec3i::new(7, 7, 0);
        let high_spawn = Vec3i::new(7, 7, 1);

        for pos in [low_support, low_spawn, high_support, high_spawn] {
            let index = world_position_to_index(pos, world_size)
                .expect("spawn test position should be in bounds");
            world.blocks[index] = if pos == low_support || pos == high_support {
                BlockType::SolidStone
            } else {
                BlockType::Air
            };
        }

        let spawn = world
            .find_spawn_position(Vec3i::ZERO)
            .expect("spawn position should exist");

        assert_eq!(spawn, high_spawn);
    }
}
