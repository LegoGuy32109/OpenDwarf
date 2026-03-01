use std::path::PathBuf;

use world_sim::replay::{ReplayRecorderOptions, save_replay};
use world_sim::scenario::{ScenarioBuilder, ScenarioRunOptions, run_scenario};
use world_sim::world_api::Vec3i;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output_path = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("world_sim_example.replay.bin"));

    let scenario = ScenarioBuilder::new("example_generate_replay")
        .move_entity(1, Vec3i::new(1, 0, 0))
        .move_entity(1, Vec3i::new(1, 0, 0))
        .move_entity(1, Vec3i::new(0, 1, 0))
        .tick(5)
        .assert_entity_position(1, Vec3i::new(2, 1, 0))
        .assert_entity_facing_left(1, true)
        .assert_entity_prone(1, false)
        .assert_tick(8)
        .build();

    let run = run_scenario(
        &scenario,
        ScenarioRunOptions {
            record_replay: true,
            replay: ReplayRecorderOptions {
                checkpoint_interval_ticks: 4,
                include_updates: true,
            },
        },
    )?;

    let replay = run
        .replay
        .ok_or("replay recording was disabled unexpectedly")?;
    save_replay(&output_path, &replay)?;

    println!("Wrote replay to {}", output_path.display());
    println!(
        "Final tick={}, entity_count={}",
        run.final_snapshot.tick,
        run.final_snapshot.entities.len()
    );

    Ok(())
}
