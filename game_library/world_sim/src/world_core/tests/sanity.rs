use super::test_world;
use super::super::{MoveEntityError, WorldConfig, WorldState};
use crate::world_api::{Vec3i, WorldCommand};

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
