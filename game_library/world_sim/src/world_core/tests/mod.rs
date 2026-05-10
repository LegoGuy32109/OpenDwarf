mod generation;
mod movement;
mod sanity;

use super::{
    BlockType, PLAYABLE_NOISE_BAND_HALF_THICKNESS, STARTER_ROOM_HALF_EXTENT,
    STARTER_ROOM_HALF_HEIGHT, TerrainConfig, WorldConfig, WorldState, world_min_for_size,
    world_position_to_index,
};
use crate::world_api::{Vec3i, Vec3u};

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

fn spawn_world(seed: &str) -> WorldState {
    WorldState::new(WorldConfig {
        chunk_edge: 16,
        world_chunks: Vec3u::new(4, 4, 4),
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

fn slice_difference_ratio(world: &WorldState, z_a: i32, z_b: i32) -> f64 {
    let (min, max) = world.centered_bounds();
    let mut different = 0usize;
    let mut total = 0usize;
    for y in min.y..=max.y {
        for x in min.x..=max.x {
            total += 1;
            let a = world.block_at(Vec3i::new(x, y, z_a));
            let b = world.block_at(Vec3i::new(x, y, z_b));
            if a != b {
                different += 1;
            }
        }
    }

    different as f64 / total.max(1) as f64
}
