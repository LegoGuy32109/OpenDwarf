use super::{
    block_hash, cave_world, slice_difference_ratio, slice_dump, spawn_world, BlockType,
    PLAYABLE_NOISE_BAND_HALF_THICKNESS, STARTER_ROOM_HALF_EXTENT, STARTER_ROOM_HALF_HEIGHT,
};
use crate::world_api::{Vec3i, Vec3u};
use super::super::{WorldConfig, WorldState, world_position_to_index};

#[test]
fn cave_generation_is_deterministic_and_seeded() {
    let world_a = cave_world("opendwarf");
    let world_b = cave_world("opendwarf");
    let world_c = cave_world("josh");

    assert_eq!(world_a.blocks.len(), world_b.blocks.len());
    assert_eq!(world_a.blocks.len(), world_c.blocks.len());
    assert_eq!(block_hash(&world_a.blocks), block_hash(&world_b.blocks));
    assert_ne!(block_hash(&world_a.blocks), block_hash(&world_c.blocks));
    assert_eq!(slice_dump(&world_a, 0), slice_dump(&world_b, 0));
}

#[test]
fn cave_generation_uses_full_volume_and_contains_air_and_stone() {
    let mut world = cave_world("karly");
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

    assert_eq!(world.blocks.len(), expected_blocks);
    assert!(world.blocks.iter().any(|block| *block == BlockType::Air));
    assert!(world
        .blocks
        .iter()
        .any(|block| *block == BlockType::SolidStone));
}

#[test]
fn cave_generation_keeps_noise_within_the_playable_band() {
    let world = cave_world("opendwarf");
    let (min, max) = world.centered_bounds();

    for z in min.z..=max.z {
        if z.abs() <= PLAYABLE_NOISE_BAND_HALF_THICKNESS {
            continue;
        }
        for y in min.y..=max.y {
            for x in min.x..=max.x {
                assert!(matches!(
                    world.block_at(Vec3i::new(x, y, z)),
                    Some(BlockType::SolidStone)
                ));
            }
        }
    }

    let mut band_has_air = false;
    let mut band_has_stone = false;
    for z in -PLAYABLE_NOISE_BAND_HALF_THICKNESS..=PLAYABLE_NOISE_BAND_HALF_THICKNESS {
        let dump = slice_dump(&world, z);
        band_has_air |= dump.contains('.');
        band_has_stone |= dump.contains('#');
    }

    assert!(band_has_air);
    assert!(band_has_stone);
}

#[test]
fn cave_generation_keeps_the_band_varied_across_slices() {
    let world = cave_world("josh");
    let adjacent_difference = slice_difference_ratio(&world, -1, 0);
    let opposite_difference = slice_difference_ratio(&world, 0, 1);

    assert!(
        adjacent_difference > 0.02,
        "adjacent slices should vary in the band: {adjacent_difference}"
    );
    assert!(opposite_difference > 0.02);
}

#[test]
fn cave_spawn_finder_returns_supported_tile() {
    let world = spawn_world("opendwarf");
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

#[test]
fn spawn_position_is_origin_for_the_experiment() {
    let mut world = spawn_world("opendwarf");
    let entity_id = world
        .spawn_entity_auto(Vec3i::ZERO)
        .expect("origin spawn should work");
    let snapshot = world.snapshot();
    let entity = snapshot
        .entities
        .into_iter()
        .find(|entity| entity.id == entity_id)
        .expect("entity should exist");

    assert_eq!(entity.position, Vec3i::ZERO);
    for z in -STARTER_ROOM_HALF_HEIGHT..=STARTER_ROOM_HALF_HEIGHT {
        for y in -STARTER_ROOM_HALF_EXTENT..=STARTER_ROOM_HALF_EXTENT {
            for x in -STARTER_ROOM_HALF_EXTENT..=STARTER_ROOM_HALF_EXTENT {
                assert!(matches!(
                    world.block_at(Vec3i::new(x, y, z)),
                    Some(BlockType::Air)
                ));
            }
        }
    }
}
