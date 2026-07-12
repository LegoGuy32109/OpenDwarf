//! Stage A native Scenario goldens.
//!
//! Bless hash fixtures:
//! `OD_BLESS_SCENARIO_GOLDENS=1 cargo test -p od_scenario --test scenario_goldens`

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use od_core::replay::world_state_hash;
use od_core::session::SessionIntent;
use od_core::world::{Dir, Vec3i, Vec3u, WorldConfig};
use od_scenario::{
    ScenarioBuilder, ScenarioRunError, ShellAction, run_scenario_native, scenario_from_json,
    scenario_to_json,
};
use od_world::{WorldSim, replay_commands_to_snapshot};

fn goldens_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("goldens/world_state_hash.json")
}

fn load_expected() -> BTreeMap<String, String> {
    let path = goldens_path();
    if !path.exists() {
        return BTreeMap::new();
    }
    let raw = fs::read_to_string(&path).expect("read goldens");
    serde_json::from_str(&raw).expect("parse goldens")
}

fn bless_expected(values: &BTreeMap<String, String>) {
    let path = goldens_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create goldens dir");
    }
    let raw = serde_json::to_string_pretty(values).expect("serialize goldens") + "\n";
    fs::write(&path, raw).expect("write goldens");
}

fn expect_hash(name: &str, actual: &str) {
    let bless = std::env::var("OD_BLESS_SCENARIO_GOLDENS").ok().as_deref() == Some("1");
    let mut expected = load_expected();
    if bless {
        expected.insert(name.to_string(), actual.to_string());
        bless_expected(&expected);
        return;
    }
    let want = expected.get(name).unwrap_or_else(|| {
        panic!(
            "missing golden {name:?}; run with OD_BLESS_SCENARIO_GOLDENS=1 to create {}",
            goldens_path().display()
        )
    });
    assert_eq!(actual, want, "golden mismatch for {name}");
}

#[test]
fn builder_json_round_trip() {
    let scenario = ScenarioBuilder::new("json_round_trip")
        .move_player(Dir::E)
        .wait_ticks(2)
        .move_player_exact(Dir::NE, 64)
        .record_checkpoint("mid")
        .build();
    let json = scenario_to_json(&scenario).expect("to json");
    assert!(json.contains(r#""direction": "ne""#));
    let parsed = scenario_from_json(&json).expect("from json");
    assert_eq!(parsed, scenario);
}

#[test]
fn session_shell_fail_closed_on_stage_a() {
    let with_session = ScenarioBuilder::new("has_session")
        .session(SessionIntent::OpenChat {
            prefill: String::new(),
        })
        .build();
    let err = run_scenario_native(&with_session).expect_err("session must fail");
    assert!(matches!(err, ScenarioRunError::UnsupportedInStageA { .. }));

    let with_shell = ScenarioBuilder::new("has_shell")
        .shell(ShellAction::OpenShell)
        .build();
    let err = run_scenario_native(&with_shell).expect_err("shell must fail");
    assert!(matches!(err, ScenarioRunError::UnsupportedInStageA { .. }));
}

#[test]
fn boot_assert_world_state_hash() {
    let boot_hash = world_state_hash(&WorldSim::new(WorldConfig::default(), true).snapshot());
    expect_hash("boot_default_player", &boot_hash);

    let scenario = ScenarioBuilder::new("boot_assert")
        .assert_world_state_hash(boot_hash.clone())
        .record_checkpoint("boot")
        .build();
    let result = run_scenario_native(&scenario).expect("run");
    assert_eq!(result.replay.final_state_hash, boot_hash);
    assert_eq!(result.checkpoints.len(), 1);
    assert_eq!(result.checkpoints[0].0, "boot");
}

#[test]
fn move_exact_record_replay_matches_hash() {
    let mut result = None;
    for dir in [Dir::E, Dir::W, Dir::N, Dir::S] {
        let scenario = ScenarioBuilder::new("move_exact")
            .move_player_exact(dir, 256)
            .build();
        if let Ok(run) = run_scenario_native(&scenario) {
            result = Some(run);
            break;
        }
    }
    let result = result.expect("expected at least one open move from spawn");
    expect_hash("move_exact_final", &result.replay.final_state_hash);

    let again = replay_commands_to_snapshot(&result.replay).expect("replay");
    assert_eq!(world_state_hash(&again), result.replay.final_state_hash);
}

#[test]
fn engine_chunk_gate_scenario() {
    let config = WorldConfig {
        chunk_edge: 16,
        world_chunks: Vec3u::new(2, 1, 1),
        ..WorldConfig::default()
    };
    let sim = WorldSim::new(config.clone(), true);
    let start = sim.snapshot().entities[0].position;
    let spawn_chunk = sim
        .state()
        .world_position_to_chunk_coord(start)
        .expect("spawn chunk");

    let mut builder = ScenarioBuilder::new("chunk_gate_scenario").world_config(config);
    let all_chunks: Vec<_> = sim.snapshot().loaded_chunks.iter().copied().collect();
    for chunk in all_chunks {
        builder = builder.engine_set_chunk_loaded(chunk, false);
    }
    builder = builder
        .assert_entity_position(1, start)
        .engine_set_chunk_loaded(spawn_chunk, true)
        .engine_set_chunk_loaded(
            Vec3i::new(spawn_chunk.x + 1, spawn_chunk.y, spawn_chunk.z),
            true,
        );

    let mut run_ok = None;
    for dir in [Dir::E, Dir::W, Dir::N, Dir::S] {
        let scenario = builder
            .clone()
            .move_player_exact(dir, 256)
            .record_checkpoint("after_move")
            .build();
        match run_scenario_native(&scenario) {
            Ok(result) => {
                run_ok = Some(result);
                break;
            }
            Err(ScenarioRunError::Command { .. }) => continue,
            Err(other) => panic!("unexpected: {other}"),
        }
    }
    let result = run_ok.expect("chunk gate then move should succeed");
    expect_hash("chunk_gate_final", &result.replay.final_state_hash);
    let again = replay_commands_to_snapshot(&result.replay).expect("replay");
    assert_eq!(world_state_hash(&again), result.replay.final_state_hash);
}
