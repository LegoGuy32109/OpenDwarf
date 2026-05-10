use super::test_world;
use super::super::MoveEntityError;
use crate::world_api::Vec3i;

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
