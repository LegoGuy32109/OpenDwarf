use std::time::{SystemTime, UNIX_EPOCH};

use world_sim::replay::{
    ReplayRecorderOptions, load_replay, replay_commands_to_snapshot, save_replay,
};
use world_sim::scenario::{ScenarioBuilder, ScenarioRunOptions, run_scenario};
use world_sim::world_api::Vec3i;

#[test]
fn scenario_builder_records_and_replays_deterministically() {
    let scenario = ScenarioBuilder::new("player_moves_and_ticks")
        .move_entity(1, Vec3i::new(1, 0, 0))
        .move_entity(1, Vec3i::new(0, -1, 0))
        .move_entity(1, Vec3i::new(-1, 0, 0))
        .tick(3)
        .assert_entity_position(1, Vec3i::new(0, -1, 0))
        .assert_entity_facing_left(1, false)
        .assert_entity_prone(1, false)
        .assert_tick(6)
        .build();

    let run = run_scenario(
        &scenario,
        ScenarioRunOptions {
            record_replay: true,
            replay: ReplayRecorderOptions {
                checkpoint_interval_ticks: 2,
                include_updates: true,
            },
        },
    )
    .expect("scenario should execute successfully");

    let replay = run
        .replay
        .clone()
        .expect("replay should be recorded when enabled");
    let replay_path = unique_temp_path("world_sim_scenario_replay.bin");
    save_replay(&replay_path, &replay).expect("should save replay");
    let loaded = load_replay(&replay_path).expect("should load replay");
    let replayed_snapshot = replay_commands_to_snapshot(&loaded).expect("should replay commands");

    assert_eq!(run.final_snapshot.tick, replayed_snapshot.tick);
    assert_eq!(run.final_snapshot.entities, replayed_snapshot.entities);

    let _ = std::fs::remove_file(&replay_path);
}

#[test]
fn scenario_asserts_entity_facing_after_pattern() {
    let scenario = ScenarioBuilder::new("entity_facing_pattern")
        .move_entity(1, Vec3i::new(1, 0, 0))
        .move_entity(1, Vec3i::new(0, 1, 0))
        .move_entity(1, Vec3i::new(-1, 0, 0))
        .move_entity(1, Vec3i::new(0, -1, 0))
        .assert_entity_position(1, Vec3i::ZERO)
        .assert_entity_facing_left(1, false)
        .assert_entity_prone(1, false)
        .build();

    run_scenario(&scenario, ScenarioRunOptions::default())
        .expect("scenario should validate facing successfully");
}

fn unique_temp_path(filename: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time moved backwards")
        .as_nanos();
    std::env::temp_dir().join(format!("{nanos}_{filename}"))
}
