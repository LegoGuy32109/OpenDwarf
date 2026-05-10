use bevy::prelude::*;

use crate::domain::simulation::RenderEntityData;
use super::{
    ChunkBorderDebugState, ChunkStreamingState, FogData, HeldMovementState, ReplayHudState,
    ReplayMode, TerrainConfig, TerrainData, TileLayerDebugState, TilemapRenderMetrics,
};
use super::replay::{apply_first_checkpoint, try_load_replay_playback};

pub fn setup_simulation_state(mut commands: Commands) {
    let mut replay_mode = ReplayMode::default();
    let mut config = TerrainConfig::default();
    let mut terrain = TerrainData::default();
    let mut entities = RenderEntityData::default();
    let viewport = crate::resources::render_viewport::RenderViewport::default();
    let tile_layer_debug_state = TileLayerDebugState::default();
    let mut invalidation = crate::domain::tilemap_invalidation::TilemapInvalidation::default();
    invalidation.invalidate_view(); // Trigger full rebuild on first frame

    #[cfg(not(target_arch = "wasm32"))]
    if let Some(mut replay_playback) = try_load_replay_playback() {
        replay_mode.active = true;
        replay_playback.playing = false;
        if !apply_first_checkpoint(
            &mut replay_playback,
            &mut config,
            &mut terrain,
            &mut entities,
            &viewport,
            &tile_layer_debug_state,
            &mut invalidation,
        ) {
            warn!("Replay did not contain any checkpoint/snapshot data");
        }
        commands.insert_resource(replay_playback);
    }

    let fog_data = FogData::default();

    let replay_hud_state = ReplayHudState {
        active: replay_mode.active,
        playing: false,
        cursor: 0,
        total_events: 0,
        tick: entities.tick,
        show_all_events: false,
        event_labels: Vec::new(),
    };

    commands.insert_resource(replay_mode);
    commands.insert_resource(replay_hud_state);
    commands.insert_resource(HeldMovementState::default());
    commands.insert_resource(config);
    commands.insert_resource(terrain);
    commands.insert_resource(entities);
    commands.insert_resource(fog_data);
    commands.insert_resource(ChunkStreamingState::default());
    commands.insert_resource(ChunkBorderDebugState::default());
    commands.insert_resource(tile_layer_debug_state);
    commands.insert_resource(TilemapRenderMetrics::default());
    commands.insert_resource(viewport);
    commands.insert_resource(invalidation);
}
