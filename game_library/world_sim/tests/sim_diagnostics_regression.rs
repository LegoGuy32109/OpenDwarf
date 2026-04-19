use world_sim::bevy_app::{WorldSimApp, WorldSimSettings, WorldSimulationPlugin};
use world_sim::world_api::{Vec3i, Vec3u};
use world_sim::world_core::TerrainConfig;
use world_sim::world_core::WorldConfig;

fn diagnostic_world_config() -> WorldConfig {
    WorldConfig {
        chunk_edge: 16,
        world_chunks: Vec3u::new(2, 2, 1),
        movement_ticks_per_tile: 10,
        terrain: TerrainConfig {
            seed: "opendwarf".to_string(),
            cave_frequency_xy: 0.08,
            cave_frequency_z: 0.03,
            cave_threshold: -0.10,
            cave_octaves: 3,
            cave_persistence: 0.55,
            cave_lacunarity: 2.0,
        },
    }
}

#[test]
fn diagnostics_command_pipeline_updates() {
    let mut app = WorldSimApp::new(WorldSimulationPlugin {
        settings: WorldSimSettings {
            config: diagnostic_world_config(),
            spawn_default_player: true,
        },
    });

    app.move_entity(1, Vec3i::new(1, 0, 0))
        .expect("move command should enqueue");
    app.run_updates(1);

    let snapshot = app.snapshot();
    assert!(!snapshot.entities.is_empty());
}

#[test]
fn diagnostics_reports_loaded_chunk_count() {
    let app = WorldSimApp::new(WorldSimulationPlugin {
        settings: WorldSimSettings {
            config: diagnostic_world_config(),
            spawn_default_player: true,
        },
    });

    let diagnostics = app.diagnostics();
    assert!(diagnostics.loaded_chunk_count > 0);
}
