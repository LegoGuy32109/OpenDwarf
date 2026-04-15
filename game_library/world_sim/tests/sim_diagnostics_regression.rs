use world_sim::bevy_app::{WorldSimApp, WorldSimSettings, WorldSimulationPlugin};
use world_sim::world_api::{Vec3i, Vec3u};
use world_sim::world_core::WorldConfig;

#[test]
fn diagnostics_count_chunk_not_loaded_rejections() {
    let mut app = WorldSimApp::new(WorldSimulationPlugin {
        settings: WorldSimSettings {
            config: WorldConfig {
                chunk_edge: 16,
                world_chunks: Vec3u::new(4, 1, 1),
                movement_ticks_per_tile: 10,
            },
            spawn_default_player: true,
        },
    });

    app.set_chunk_loaded(Vec3i::new(1, 0, 0), false)
        .expect("set_chunk_loaded should enqueue");

    for _ in 0..15 {
        app.move_entity(1, Vec3i::new(1, 0, 0))
            .expect("move command should enqueue");
        app.step_ticks(4);
    }
    app.move_entity(1, Vec3i::new(1, 0, 0))
        .expect("move command should enqueue");
    app.step_ticks(1);

    let diagnostics = app.diagnostics();
    assert_eq!(diagnostics.rejected_chunk_not_loaded, 1);
    assert_eq!(diagnostics.rejected_unknown_entity, 0);
    assert_eq!(diagnostics.rejected_out_of_bounds, 0);
}

#[test]
fn diagnostics_count_unknown_entity_rejections() {
    let mut app = WorldSimApp::new(WorldSimulationPlugin {
        settings: WorldSimSettings {
            config: WorldConfig::default(),
            spawn_default_player: true,
        },
    });

    app.move_entity(99, Vec3i::new(1, 0, 0))
        .expect("move command should enqueue");
    app.step_ticks(2);

    let diagnostics = app.diagnostics();
    assert_eq!(diagnostics.rejected_unknown_entity, 1);
    assert_eq!(diagnostics.rejected_chunk_not_loaded, 0);
}
