use super::{
    BlockType, MoveEntityError, PLAYABLE_NOISE_BAND_HALF_THICKNESS, STARTER_ROOM_HALF_EXTENT,
    STARTER_ROOM_HALF_HEIGHT, TerrainConfig, WorldConfig, WorldState, world_min_for_size,
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
fn fov_visibility_position_moves_when_target_becomes_occupied() {
    let mut world = test_world();
    world
        .spawn_entity_auto(Vec3i::ZERO)
        .expect("spawn should succeed");
    let _ = world.snapshot();

    let fov = world.entity_fov.get(&1).expect("primary fov should exist");
    assert!(!fov.dirty);

    world
        .start_entity_move_with_reason(1, Vec3i::new(1, 0, 0))
        .expect("move should start");
    assert!(!world.entity_fov.get(&1).expect("fov should exist").dirty);

    let _ = world.advance_active_movements_one_tick();
    assert!(world.entity_fov.get(&1).expect("fov should exist").dirty);

    let snapshot = world.snapshot();
    let visibility = snapshot.visibility.expect("visibility should be present");
    assert!(visibility.visible.contains(&Vec3i::new(1, 0, 0)));
}

#[test]
fn interrupting_movement_marks_fov_dirty_when_visibility_snaps_back() {
    let mut world = test_world();
    world
        .spawn_entity_auto(Vec3i::ZERO)
        .expect("spawn should succeed");
    let _ = world.snapshot();

    world
        .start_entity_move_with_reason(1, Vec3i::new(1, 0, 0))
        .expect("move should start");
    let _ = world.advance_active_movements_one_tick();
    let _ = world.snapshot();
    assert!(!world.entity_fov.get(&1).expect("fov should exist").dirty);

    world
        .start_entity_move_with_reason(1, Vec3i::new(0, 1, 0))
        .expect("interrupting move should start");
    assert!(world.entity_fov.get(&1).expect("fov should exist").dirty);

    let snapshot = world.snapshot();
    let visibility = snapshot.visibility.expect("visibility should be present");
    assert!(visibility.visible.contains(&Vec3i::ZERO));
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
