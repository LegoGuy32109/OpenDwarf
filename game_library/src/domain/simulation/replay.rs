use bevy::prelude::*;
use std::sync::Arc;

use super::sync::{apply_snapshot, apply_update};
use super::{
    FogData, REPLAY_PATH_ENV, RenderEntityData, ReplayHudState, ReplayMode, ReplayPlayback,
    TerrainConfig, TerrainData, TileDataCache, TileLayerDebugState,
};
use crate::resources::render_viewport::RenderViewport;
use crate::resources::view_mode::ViewMode;
use crate::resources::view_z_level::ViewZLevel;
use world_sim::replay::{ReplayEvent, load_replay};
use world_sim::world_api::{Vec3u, WorldCommand, WorldUpdate};

pub fn drive_replay_playback(
    replay_mode: Res<ReplayMode>,
    keyboard_input: Res<ButtonInput<KeyCode>>,
    replay_playback: Option<ResMut<ReplayPlayback>>,
    mut replay_hud_state: ResMut<ReplayHudState>,
    mut config: ResMut<TerrainConfig>,
    mut terrain: ResMut<TerrainData>,
    mut entity_data: ResMut<RenderEntityData>,
    viewport: Res<RenderViewport>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    mut invalidation: ResMut<crate::domain::tilemap_invalidation::TilemapInvalidation>,
    mut tile_cache: ResMut<TileDataCache>,
) {
    if !replay_mode.active {
        replay_hud_state.active = false;
        return;
    }
    let Some(mut replay_playback) = replay_playback else {
        replay_hud_state.active = false;
        return;
    };

    replay_hud_state.active = true;
    replay_hud_state.total_events = replay_playback.events.len();

    if keyboard_input.just_pressed(KeyCode::F6) {
        replay_playback.playing = !replay_playback.playing;
        info!(
            "Replay playback {}",
            if replay_playback.playing {
                "resumed"
            } else {
                "paused"
            }
        );
    }

    if keyboard_input.just_pressed(KeyCode::F8) {
        replay_playback.cursor = 0;
        entity_data.entities.clear();
        terrain.source_blocks = Arc::default();
        terrain.blocks.clear();
        config.chunk_edge = 0;
        config.world_chunks = Vec3u::default();
        entity_data.tick = 0;
        entity_data.dirty = true;
        invalidation.clear();
        invalidation.invalidate_view();
        *tile_cache = TileDataCache::default();
        let _ = apply_first_checkpoint(
            &mut replay_playback,
            &mut config,
            &mut terrain,
            &mut entity_data,
            &viewport,
            &tile_layer_debug_state,
            &mut invalidation,
            &mut tile_cache,
        );
        info!("Replay reset to beginning");
    }

    if keyboard_input.just_pressed(KeyCode::F7) {
        let _ = apply_next_replay_event(
            &mut replay_playback,
            &mut config,
            &mut terrain,
            &mut entity_data,
            &viewport,
            &tile_layer_debug_state,
            &mut invalidation,
            &mut tile_cache,
        );
    }

    if keyboard_input.just_pressed(KeyCode::F9) {
        replay_hud_state.show_all_events = !replay_hud_state.show_all_events;
    }

    if replay_playback.playing
        && !apply_next_replay_event(
            &mut replay_playback,
            &mut config,
            &mut terrain,
            &mut entity_data,
            &viewport,
            &tile_layer_debug_state,
            &mut invalidation,
            &mut tile_cache,
        )
    {
        replay_playback.playing = false;
        info!("Replay playback reached end");
    }

    replay_hud_state.playing = replay_playback.playing;
    replay_hud_state.cursor = replay_playback.cursor;
    replay_hud_state.tick = entity_data.tick;
    replay_hud_state.event_labels = replay_playback
        .events
        .iter()
        .map(describe_replay_event)
        .collect();
}

#[cfg(not(target_arch = "wasm32"))]
pub(super) fn describe_replay_event(event: &ReplayEvent) -> String {
    match event {
        ReplayEvent::Command {
            tick_before,
            command,
        } => match command {
            WorldCommand::MoveEntity { id, direction } => {
                format!(
                    "[tick {tick_before}] CMD MoveEntity id={id} dir=({}, {}, {})",
                    direction.x, direction.y, direction.z
                )
            }
            WorldCommand::AdvanceTicks { count } => {
                format!("[tick {tick_before}] CMD AdvanceTicks count={count}")
            }
            WorldCommand::SetChunkLoaded { chunk, loaded } => {
                format!(
                    "[tick {tick_before}] CMD SetChunkLoaded chunk=({}, {}, {}) loaded={}",
                    chunk.x, chunk.y, chunk.z, loaded
                )
            }
        },
        ReplayEvent::Update(WorldUpdate::Snapshot(snapshot)) => {
            format!(
                "UPDATE Snapshot tick={} entities={}",
                snapshot.tick,
                snapshot.entities.len()
            )
        }
        ReplayEvent::Update(WorldUpdate::Delta(delta)) => {
            format!(
                "UPDATE Delta tick={} moved={}",
                delta.tick,
                delta.moved_entities.len()
            )
        }
        ReplayEvent::Checkpoint(snapshot) => {
            format!(
                "CHECKPOINT tick={} entities={}",
                snapshot.tick,
                snapshot.entities.len()
            )
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub(super) fn try_load_replay_playback() -> Option<ReplayPlayback> {
    let replay_path = std::env::var(REPLAY_PATH_ENV).ok()?;
    match load_replay(std::path::Path::new(&replay_path)) {
        Ok(replay) => {
            info!(
                "Loaded replay from {} with {} events",
                replay_path,
                replay.events.len()
            );
            Some(ReplayPlayback {
                events: replay.events,
                cursor: 0,
                playing: false,
            })
        }
        Err(err) => {
            warn!("Failed to load replay from {replay_path}: {err}");
            None
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub(super) fn apply_first_checkpoint(
    replay_playback: &mut ReplayPlayback,
    config: &mut TerrainConfig,
    terrain: &mut TerrainData,
    entities: &mut RenderEntityData,
    viewport: &crate::resources::render_viewport::RenderViewport,
    tile_layer_debug_state: &TileLayerDebugState,
    invalidation: &mut crate::domain::tilemap_invalidation::TilemapInvalidation,
    tile_cache: &mut TileDataCache,
) -> bool {
    // Replay doesn't carry FOV data — use a throwaway FogData
    let mut fog = FogData::default();
    while replay_playback.cursor < replay_playback.events.len() {
        let event = replay_playback.events[replay_playback.cursor].clone();
        replay_playback.cursor += 1;
        match event {
            ReplayEvent::Checkpoint(snapshot) => {
                apply_snapshot(
                    ViewMode::Entity,
                    ViewZLevel::default(),
                    config,
                    terrain,
                    entities,
                    &mut fog,
                    &snapshot,
                    viewport,
                    tile_layer_debug_state,
                    invalidation,
                    tile_cache,
                );
                return true;
            }
            ReplayEvent::Update(update) => {
                apply_update(
                    ViewMode::Entity,
                    ViewZLevel::default(),
                    config,
                    terrain,
                    entities,
                    &mut fog,
                    update,
                    viewport,
                    tile_layer_debug_state,
                    invalidation,
                    tile_cache,
                );
                return true;
            }
            ReplayEvent::Command { .. } => {}
        }
    }
    false
}

#[cfg(not(target_arch = "wasm32"))]
pub(super) fn apply_next_replay_event(
    replay_playback: &mut ReplayPlayback,
    config: &mut TerrainConfig,
    terrain: &mut TerrainData,
    entities: &mut RenderEntityData,
    viewport: &crate::resources::render_viewport::RenderViewport,
    tile_layer_debug_state: &TileLayerDebugState,
    invalidation: &mut crate::domain::tilemap_invalidation::TilemapInvalidation,
    tile_cache: &mut TileDataCache,
) -> bool {
    let mut fog = FogData::default();
    while replay_playback.cursor < replay_playback.events.len() {
        let event = replay_playback.events[replay_playback.cursor].clone();
        replay_playback.cursor += 1;
        match event {
            ReplayEvent::Command { .. } => {}
            ReplayEvent::Update(update) => {
                apply_update(
                    ViewMode::Entity,
                    ViewZLevel::default(),
                    config,
                    terrain,
                    entities,
                    &mut fog,
                    update,
                    viewport,
                    tile_layer_debug_state,
                    invalidation,
                    tile_cache,
                );
                return true;
            }
            ReplayEvent::Checkpoint(snapshot) => {
                apply_snapshot(
                    ViewMode::Entity,
                    ViewZLevel::default(),
                    config,
                    terrain,
                    entities,
                    &mut fog,
                    &snapshot,
                    viewport,
                    tile_layer_debug_state,
                    invalidation,
                    tile_cache,
                );
                return true;
            }
        }
    }
    false
}
