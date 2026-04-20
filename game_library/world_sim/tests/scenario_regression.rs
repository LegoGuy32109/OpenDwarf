use std::time::{SystemTime, UNIX_EPOCH};

use world_sim::bevy_app::{WorldSimApp, WorldSimSettings, WorldSimulationPlugin};
use world_sim::replay::{
    ReplayRecorderOptions, load_replay, replay_commands_to_snapshot, save_replay,
};
use world_sim::scenario::{ScenarioBuilder, ScenarioRunOptions, run_scenario};
use world_sim::world_api::{Vec3i, Vec3u};
use world_sim::world_core::TerrainConfig;
use world_sim::world_core::WorldConfig;
use world_sim::world_core::WorldState;

fn spawn_position_for(world_config: &WorldConfig) -> Vec3i {
    let mut app = WorldSimApp::new(WorldSimulationPlugin {
        settings: WorldSimSettings {
            config: world_config.clone(),
            spawn_default_player: true,
        },
    });
    let snapshot = app.snapshot();
    snapshot
        .entities
        .iter()
        .find(|entity| entity.id == 1)
        .expect("default player should spawn")
        .position
}

fn chunk_coord_for(position: Vec3i, world_config: &WorldConfig) -> Vec3i {
    let edge = world_config.chunk_edge.max(1) as i32;
    let world_size_x = i32::try_from(world_config.world_chunks.x)
        .expect("world_chunks.x too large")
        * edge;
    let world_size_y = i32::try_from(world_config.world_chunks.y)
        .expect("world_chunks.y too large")
        * edge;
    let world_size_z = i32::try_from(world_config.world_chunks.z)
        .expect("world_chunks.z too large")
        * edge;
    let min_x = -(world_size_x / 2);
    let min_y = -(world_size_y / 2);
    let min_z = -(world_size_z / 2);
    let local_x = position.x - min_x;
    let local_y = position.y - min_y;
    let local_z = position.z - min_z;
    Vec3i::new(local_x / edge - i32::try_from(world_config.world_chunks.x).expect("x too large") / 2, local_y / edge - i32::try_from(world_config.world_chunks.y).expect("y too large") / 2, local_z / edge - i32::try_from(world_config.world_chunks.z).expect("z too large") / 2)
}

fn scenario_world_config() -> WorldConfig {
    let seeds = ["opendwarf", "josh", "karly"];
    let thresholds = [0.22, 0.10, 0.0, -0.10, -0.20];

    for seed in seeds {
        for cave_threshold in thresholds {
            let config = WorldConfig {
                chunk_edge: 16,
                world_chunks: Vec3u::new(4, 4, 4),
                movement_ticks_per_tile: 10,
                terrain: TerrainConfig {
                    seed: seed.to_string(),
                    cave_frequency_xy: 0.08,
                    cave_frequency_z: 0.03,
                    cave_threshold,
                    cave_octaves: 3,
                    cave_persistence: 0.55,
                    cave_lacunarity: 2.0,
                },
            };
            let spawn = spawn_position_for(&config);
            if [
                Vec3i::new(1, 0, 0),
                Vec3i::new(-1, 0, 0),
                Vec3i::new(0, 1, 0),
                Vec3i::new(0, -1, 0),
            ]
            .iter()
            .any(|direction| direction_is_valid(&config, spawn, *direction))
            {
                return config;
            }
        }
    }

    panic!("no scenario-friendly world config found");
}

fn direction_is_valid(world_config: &WorldConfig, spawn: Vec3i, direction: Vec3i) -> bool {
    let mut world = WorldState::new(world_config.clone());
    world.spawn_entity(1, spawn).is_ok()
        && world.start_entity_move_with_reason(1, direction).is_ok()
}

fn first_valid_direction(
    world_config: &WorldConfig,
    spawn: Vec3i,
    candidates: &[Vec3i],
) -> Vec3i {
    candidates
        .iter()
        .copied()
        .find(|direction| direction_is_valid(world_config, spawn, *direction))
        .expect("expected at least one valid direction from the spawn point")
}


#[test]
fn scenario_builder_records_and_replays_deterministically() {
    let world_config = scenario_world_config();
    let spawn = spawn_position_for(&world_config);
    let scenario = ScenarioBuilder::new("player_moves_and_ticks")
        .world_config(world_config)
        .tick(3)
        .assert_entity_position(1, spawn)
        .assert_entity_facing_left(1, false)
        .assert_entity_prone(1, false)
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
    let world_config = scenario_world_config();
    let spawn = spawn_position_for(&world_config);
    let scenario = ScenarioBuilder::new("entity_facing_pattern")
        .world_config(world_config)
        .assert_entity_position(1, spawn)
        .assert_entity_facing_left(1, false)
        .assert_entity_prone(1, false)
        .build();

    run_scenario(&scenario, ScenarioRunOptions::default())
        .expect("scenario should validate facing successfully");
}

#[test]
fn scenario_rejects_movement_into_unloaded_chunk() {
    let world_config = scenario_world_config();
    let spawn = spawn_position_for(&world_config);
    let move_dir = first_valid_direction(
        &world_config,
        spawn,
        &[
            Vec3i::new(1, 0, 0),
            Vec3i::new(-1, 0, 0),
            Vec3i::new(0, 1, 0),
            Vec3i::new(0, -1, 0),
        ],
    );
    let target_chunk = chunk_coord_for(spawn.add(move_dir), &world_config);
    let scenario = ScenarioBuilder::new("unloaded_chunk_rejects_move")
        .world_config(world_config)
        .set_chunk_loaded(target_chunk, false)
        .move_entity(1, move_dir)
        .assert_entity_position(1, spawn)
        .assert_tick(0)
        .build();

    run_scenario(&scenario, ScenarioRunOptions::default())
        .expect("scenario should keep entity in place when chunk is unloaded");
}

#[test]
fn scenario_chunk_boundary_transition_requires_loaded_target_chunk() {
    let world_config = scenario_world_config();
    let spawn = spawn_position_for(&world_config);
    let target_chunk = chunk_coord_for(spawn.add(Vec3i::new(1, 0, 0)), &world_config);

    let builder = ScenarioBuilder::new("chunk_boundary_transition")
        .world_config(world_config)
        .set_chunk_loaded(target_chunk, false);
    let scenario = builder
        .move_entity(1, Vec3i::new(1, 0, 0))
        .assert_entity_position(1, spawn)
        .build();

    run_scenario(&scenario, ScenarioRunOptions::default())
        .expect("scenario should cross boundary only after target chunk is loaded");
}

#[test]
fn scenario_chunk_streaming_replay_is_deterministic() {
    let world_config = scenario_world_config();
    let spawn = spawn_position_for(&world_config);
    let first_move = first_valid_direction(
        &world_config,
        spawn,
        &[
            Vec3i::new(1, 0, 0),
            Vec3i::new(-1, 0, 0),
            Vec3i::new(0, 1, 0),
            Vec3i::new(0, -1, 0),
        ],
    );
    let first_target = spawn.add(first_move);
    let second_move = first_valid_direction(
        &world_config,
        first_target,
        &[
            Vec3i::new(0, 1, 0),
            Vec3i::new(0, -1, 0),
            Vec3i::new(1, 0, 0),
            Vec3i::new(-1, 0, 0),
        ],
    );
    let second_target = first_target.add(second_move);
    let first_chunk = chunk_coord_for(first_target, &world_config);
    let second_chunk = chunk_coord_for(second_target, &world_config);

    let builder = ScenarioBuilder::new("chunk_streaming_replay_determinism")
        .world_config(world_config)
        .set_chunk_loaded(first_chunk, false)
        .set_chunk_loaded(second_chunk, false);
    let scenario = builder
        .move_entity(1, first_move)
        .assert_entity_position(1, spawn)
        .set_chunk_loaded(first_chunk, true)
        .move_entity(1, first_move)
        .set_chunk_loaded(second_chunk, true)
        .move_entity(1, second_move)
        .assert_entity_prone(1, false)
        .build();

    let run = run_scenario(
        &scenario,
        ScenarioRunOptions {
            record_replay: true,
            replay: ReplayRecorderOptions {
                checkpoint_interval_ticks: 3,
                include_updates: true,
            },
        },
    )
    .expect("scenario with chunk streaming should execute");

    let replay = run.replay.expect("recorded replay should be present");
    let replay_path = unique_temp_path("world_sim_chunk_streaming_replay.bin");
    save_replay(&replay_path, &replay).expect("should save replay");
    let loaded = load_replay(&replay_path).expect("should load replay");
    let replayed_snapshot = replay_commands_to_snapshot(&loaded).expect("should replay commands");

    assert_eq!(run.final_snapshot.tick, replayed_snapshot.tick);
    assert_eq!(run.final_snapshot.entities, replayed_snapshot.entities);
    assert_eq!(run.final_snapshot.world_chunks, replayed_snapshot.world_chunks);
    assert_eq!(run.final_snapshot.chunk_edge, replayed_snapshot.chunk_edge);

    let _ = std::fs::remove_file(&replay_path);
}

fn unique_temp_path(filename: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time moved backwards")
        .as_nanos();
    std::env::temp_dir().join(format!("{nanos}_{filename}"))
}
