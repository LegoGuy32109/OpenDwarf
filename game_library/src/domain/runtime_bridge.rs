use bevy::prelude::*;
#[cfg(target_arch = "wasm32")]
use web_sys::window;
use world_runtime::{
    LayerMask, RuntimeConfig, RuntimeHandle, RuntimeMode, RuntimeTransport, Vec3i,
    ViewMode as RuntimeViewMode, ViewportIntent,
};
use world_sim::bevy_app::{PrimarySimulationEntityId, WorldSimSettings, WorldView};

use crate::domain::runtime_cache::{
    ChunkCacheState, ChunkLayerCacheMap, RuntimeInputQueue, RuntimePatchApplyQueue,
    RuntimeViewportIntentState, build_input_batch,
};
use crate::domain::runtime_telemetry::RuntimeTelemetryState;
use crate::domain::simulation::{RenderEntityData, TerrainConfig, TileLayerDebugState};
use crate::resources::view_mode::ViewMode as GameViewMode;
use crate::resources::view_z_level::ViewZLevel;

#[cfg(target_arch = "wasm32")]
use std::sync::Mutex;

#[cfg(target_arch = "wasm32")]
static RUNTIME_WORKER_SCRIPT_URL: Mutex<Option<String>> = Mutex::new(None);

#[cfg_attr(not(target_arch = "wasm32"), derive(Resource))]
pub struct RuntimeBridgeState {
    pub handle: RuntimeHandle,
    last_viewport: Option<ViewportIntent>,
}

impl RuntimeBridgeState {
    #[must_use]
    pub fn new(handle: RuntimeHandle) -> Self {
        Self {
            handle,
            last_viewport: None,
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn setup_runtime_bridge(
    mut commands: Commands,
    world_sim_settings: Res<WorldSimSettings>,
    telemetry: Res<RuntimeTelemetryState>,
) {
    let runtime_mode = detect_runtime_mode();
    let transport = if cfg!(target_arch = "wasm32") {
        if matches!(runtime_mode, RuntimeMode::Perf | RuntimeMode::Release)
            && runtime_worker_script_url().is_some()
        {
            RuntimeTransport::Worker
        } else {
            RuntimeTransport::Inline
        }
    } else {
        RuntimeTransport::Threaded
    };
    let config = RuntimeConfig {
        build_id: telemetry.session.build_id.clone(),
        session_id: telemetry.session.session_id.clone(),
        mode: runtime_mode,
        transport,
        perf_mode: matches!(runtime_mode, RuntimeMode::Perf),
        worker_script_url: runtime_worker_script_url(),
        world_config: world_sim_settings.config.clone(),
        spawn_default_player: world_sim_settings.spawn_default_player,
        initial_viewport: None,
    };

    commands.insert_resource(RuntimeBridgeState::new(RuntimeHandle::start(config)));
    commands.insert_resource(RuntimeInputQueue::default());
    commands.insert_resource(RuntimePatchApplyQueue::default());
    commands.insert_resource(RuntimeViewportIntentState::default());
    commands.insert_resource(ChunkCacheState::default());
    commands.insert_resource(ChunkLayerCacheMap::default());
}

#[cfg(target_arch = "wasm32")]
pub fn setup_runtime_bridge(
    mut commands: Commands,
    world_sim_settings: Res<WorldSimSettings>,
    telemetry: Res<RuntimeTelemetryState>,
) {
    let runtime_mode = detect_runtime_mode();
    let transport = if matches!(runtime_mode, RuntimeMode::Perf | RuntimeMode::Release)
        && runtime_worker_script_url().is_some()
    {
        RuntimeTransport::Worker
    } else {
        RuntimeTransport::Inline
    };
    let config = RuntimeConfig {
        build_id: telemetry.session.build_id.clone(),
        session_id: telemetry.session.session_id.clone(),
        mode: runtime_mode,
        transport,
        perf_mode: matches!(runtime_mode, RuntimeMode::Perf),
        worker_script_url: runtime_worker_script_url(),
        world_config: world_sim_settings.config.clone(),
        spawn_default_player: world_sim_settings.spawn_default_player,
        initial_viewport: None,
    };

    commands.queue(move |world: &mut World| {
        world.insert_non_send_resource(RuntimeBridgeState::new(RuntimeHandle::start(config)));
    });
    commands.insert_resource(RuntimeInputQueue::default());
    commands.insert_resource(RuntimePatchApplyQueue::default());
    commands.insert_resource(RuntimeViewportIntentState::default());
    commands.insert_resource(ChunkCacheState::default());
    commands.insert_resource(ChunkLayerCacheMap::default());
}

#[cfg(not(target_arch = "wasm32"))]
pub fn drive_runtime_bridge(
    primary_entity_id: Res<PrimarySimulationEntityId>,
    world_view: Res<WorldView>,
    view_mode: Res<GameViewMode>,
    view_z: Res<ViewZLevel>,
    terrain_config: Res<TerrainConfig>,
    entity_data: Res<RenderEntityData>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    mut runtime_input_queue: ResMut<RuntimeInputQueue>,
    mut patch_queue: ResMut<RuntimePatchApplyQueue>,
    mut viewport_state: ResMut<RuntimeViewportIntentState>,
    mut chunk_cache_state: ResMut<ChunkCacheState>,
    mut chunk_layer_cache: ResMut<ChunkLayerCacheMap>,
    camera_query: Query<&Projection, With<Camera2d>>,
    mut bridge: ResMut<RuntimeBridgeState>,
    mut telemetry: ResMut<RuntimeTelemetryState>,
) {
    drive_runtime_bridge_inner(
        primary_entity_id,
        world_view,
        view_mode,
        view_z,
        terrain_config,
        entity_data,
        tile_layer_debug_state,
        runtime_input_queue,
        patch_queue,
        viewport_state,
        chunk_cache_state,
        chunk_layer_cache,
        camera_query,
        &mut *bridge,
        telemetry,
    );
}

#[cfg(target_arch = "wasm32")]
pub fn drive_runtime_bridge(
    primary_entity_id: Res<PrimarySimulationEntityId>,
    world_view: Res<WorldView>,
    view_mode: Res<GameViewMode>,
    view_z: Res<ViewZLevel>,
    terrain_config: Res<TerrainConfig>,
    entity_data: Res<RenderEntityData>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    mut runtime_input_queue: ResMut<RuntimeInputQueue>,
    mut patch_queue: ResMut<RuntimePatchApplyQueue>,
    mut viewport_state: ResMut<RuntimeViewportIntentState>,
    mut chunk_cache_state: ResMut<ChunkCacheState>,
    mut chunk_layer_cache: ResMut<ChunkLayerCacheMap>,
    camera_query: Query<&Projection, With<Camera2d>>,
    mut bridge: NonSendMut<RuntimeBridgeState>,
    mut telemetry: ResMut<RuntimeTelemetryState>,
) {
    drive_runtime_bridge_inner(
        primary_entity_id,
        world_view,
        view_mode,
        view_z,
        terrain_config,
        entity_data,
        tile_layer_debug_state,
        runtime_input_queue,
        patch_queue,
        viewport_state,
        chunk_cache_state,
        chunk_layer_cache,
        camera_query,
        &mut *bridge,
        telemetry,
    );
}

#[allow(clippy::too_many_arguments)]
fn drive_runtime_bridge_inner(
    primary_entity_id: Res<PrimarySimulationEntityId>,
    world_view: Res<WorldView>,
    view_mode: Res<GameViewMode>,
    view_z: Res<ViewZLevel>,
    terrain_config: Res<TerrainConfig>,
    entity_data: Res<RenderEntityData>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    mut runtime_input_queue: ResMut<RuntimeInputQueue>,
    mut patch_queue: ResMut<RuntimePatchApplyQueue>,
    mut viewport_state: ResMut<RuntimeViewportIntentState>,
    mut chunk_cache_state: ResMut<ChunkCacheState>,
    mut chunk_layer_cache: ResMut<ChunkLayerCacheMap>,
    camera_query: Query<&Projection, With<Camera2d>>,
    bridge: &mut RuntimeBridgeState,
    mut telemetry: ResMut<RuntimeTelemetryState>,
) {
    let Some(viewport_intent) = build_viewport_intent(
        &primary_entity_id,
        &world_view,
        *view_mode,
        *view_z,
        &terrain_config,
        &entity_data,
        &tile_layer_debug_state,
        &camera_query,
    ) else {
        return;
    };

    if bridge.last_viewport.as_ref() != Some(&viewport_intent) {
        if let Err(err) = bridge.handle.send_viewport_intent(viewport_intent) {
            warn!("Failed to send runtime viewport intent: {}", err);
        } else {
            bridge.last_viewport = Some(viewport_intent);
            viewport_state.current = Some(viewport_intent);
        }
    }

    if let Some(input_batch) = build_input_batch(runtime_input_queue.drain()) {
        if let Err(err) = bridge.handle.send_input(input_batch) {
            warn!("Failed to send runtime input batch: {}", err);
        }
    }

    for event in bridge.handle.poll_events() {
        patch_queue.push(event);
    }

    let now = now_millis();
    let mut applied_event_count = 0usize;
    for event in patch_queue.drain() {
        applied_event_count = applied_event_count.saturating_add(1);
        match event {
            world_runtime::RuntimeEvent::SessionStarted { .. } => {}
            world_runtime::RuntimeEvent::RuntimeReady => {}
            world_runtime::RuntimeEvent::InitialSnapshotStarted => {
                chunk_cache_state.snapshot_progress_percent = 0;
            }
            world_runtime::RuntimeEvent::InitialSnapshotProgress {
                completed_chunks,
                total_chunks,
            } => {
                chunk_cache_state.snapshot_progress_percent =
                    progress_percent(completed_chunks, total_chunks);
            }
            world_runtime::RuntimeEvent::InitialSnapshotChunkLayer(patch)
            | world_runtime::RuntimeEvent::ChunkLayerPatch(patch)
            | world_runtime::RuntimeEvent::ResyncChunkLayer(patch) => {
                let _ = chunk_layer_cache.apply_patch(
                    patch.chunk,
                    patch.layer,
                    patch.revision,
                    patch.worker_frame_id,
                    patch.full_chunk,
                    patch.tile_data,
                    now,
                );
            }
            world_runtime::RuntimeEvent::InitialSnapshotEntities(_)
            | world_runtime::RuntimeEvent::EntityPatchBatch(_)
            | world_runtime::RuntimeEvent::ResyncEntities(_)
            | world_runtime::RuntimeEvent::ResyncComplete => {
                chunk_cache_state.snapshot_progress_percent = 100;
            }
            world_runtime::RuntimeEvent::InitialSnapshotComplete => {
                chunk_cache_state.snapshot_progress_percent = 100;
            }
            world_runtime::RuntimeEvent::LayerSnapshotStarted { .. } => {
                chunk_cache_state.snapshot_progress_percent = 0;
            }
            world_runtime::RuntimeEvent::LayerSnapshotProgress {
                completed_chunks,
                total_chunks,
                ..
            } => {
                chunk_cache_state.snapshot_progress_percent =
                    progress_percent(completed_chunks, total_chunks);
            }
            world_runtime::RuntimeEvent::LayerSnapshotComplete { .. } => {
                chunk_cache_state.snapshot_progress_percent = 100;
            }
            world_runtime::RuntimeEvent::ResyncStarted { .. } => {
                chunk_cache_state.snapshot_progress_percent = 0;
            }
            world_runtime::RuntimeEvent::TelemetryFrame(_) => {}
            world_runtime::RuntimeEvent::RuntimeWarning(message) => {
                warn!("Runtime warning: {}", message);
                telemetry.session.record_warning(message);
            }
            world_runtime::RuntimeEvent::RuntimeFault(message) => {
                error!("Runtime fault: {}", message);
                telemetry.session.record_fault(message);
            }
            world_runtime::RuntimeEvent::SessionEvent(event) => {
                telemetry.session.lifecycle_events.push(event);
            }
            world_runtime::RuntimeEvent::SessionEnded(status) => {
                info!("Runtime session ended: {:?}", status);
                telemetry.session.set_status(status, None);
            }
        }
    }

    telemetry.session = bridge.handle.session_snapshot();
    telemetry.refresh_reports();

    chunk_layer_cache.mark_all_stale(now, chunk_cache_state.stale_grace_ms);
    let (hot, warm, cold) = chunk_layer_cache.residency_counts();
    let (latest_worker_frame_id, full_chunk_entries, materialized_entries, dirty_entries) =
        chunk_layer_cache.entry_shape_counts();
    chunk_cache_state.hot_chunks = hot;
    chunk_cache_state.warm_chunks = warm;
    chunk_cache_state.cold_chunks = cold;
    chunk_cache_state.estimated_payload_bytes = chunk_layer_cache.payload_bytes();
    chunk_cache_state.last_event_count = applied_event_count;
    chunk_cache_state.latest_worker_frame_id = latest_worker_frame_id;
    chunk_cache_state.full_chunk_entries = full_chunk_entries;
    chunk_cache_state.materialized_entries = materialized_entries;
    chunk_cache_state.dirty_entries = dirty_entries;
    chunk_cache_state.active_layers = viewport_state
        .current
        .map(|intent| intent.active_layers.0.count_ones() as usize)
        .unwrap_or(0);
}

fn build_viewport_intent(
    primary_entity_id: &PrimarySimulationEntityId,
    world_view: &WorldView,
    view_mode: GameViewMode,
    view_z: ViewZLevel,
    terrain_config: &TerrainConfig,
    entity_data: &RenderEntityData,
    tile_layer_debug_state: &TileLayerDebugState,
    camera_query: &Query<&Projection, With<Camera2d>>,
) -> Option<ViewportIntent> {
    let entity_id = primary_entity_id.0?;
    let entity = entity_data.entities.get(&entity_id)?;
    let snapshot = world_view.snapshot();
    let chunk_edge = snapshot.chunk_edge.max(1) as i32;
    let center = entity.position;
    let zoom = camera_zoom(camera_query);
    let zoom_scale = (1.0 / zoom.max(0.25)).clamp(0.75, 4.0);
    let radius_tiles = ((terrain_config.chunk_edge.max(1) as f32) * 2.0 * zoom_scale)
        .round()
        .clamp(chunk_edge as f32, (chunk_edge * 8) as f32) as i32;
    let desired_bounds_min = Vec3i::new(
        center.x - radius_tiles,
        center.y - radius_tiles,
        view_z.current - 5,
    );
    let desired_bounds_max = Vec3i::new(
        center.x + radius_tiles,
        center.y + radius_tiles,
        view_z.current,
    );
    let relevant_z_min = (view_z.current - 5).max(min_world_z(snapshot));
    let relevant_z_max = view_z.current.min(max_world_z(snapshot));
    let active_layers = build_layer_mask(view_mode, tile_layer_debug_state);

    Some(ViewportIntent::new(
        center,
        quantize_zoom(zoom),
        desired_bounds_min,
        desired_bounds_max,
        relevant_z_min,
        relevant_z_max,
        active_layers,
        match view_mode {
            GameViewMode::Master => RuntimeViewMode::Master,
            GameViewMode::Entity => RuntimeViewMode::Entity,
        },
    ))
}

fn build_layer_mask(
    view_mode: GameViewMode,
    tile_layer_debug_state: &TileLayerDebugState,
) -> LayerMask {
    let mut mask = LayerMask::empty();
    if tile_layer_debug_state.show_floor {
        mask.0 |= 0b0001;
    }
    if tile_layer_debug_state.show_edge_shadow {
        mask.0 |= 0b0010;
    }
    if tile_layer_debug_state.show_ceiling_shadow {
        mask.0 |= 0b0100;
    }
    if matches!(view_mode, GameViewMode::Entity) && tile_layer_debug_state.show_fog_shadow {
        mask.0 |= 0b1000;
    }
    mask
}

fn camera_zoom(camera_query: &Query<&Projection, With<Camera2d>>) -> f32 {
    let Ok(projection) = camera_query.single() else {
        return 1.0;
    };
    match projection {
        Projection::Orthographic(orthographic) => orthographic.scale,
        _ => 1.0,
    }
}

fn progress_percent(completed_chunks: u32, total_chunks: u32) -> u8 {
    if total_chunks == 0 {
        return 0;
    }

    ((completed_chunks as f32 / total_chunks as f32) * 100.0)
        .round()
        .clamp(0.0, 100.0) as u8
}

fn quantize_zoom(zoom: f32) -> f32 {
    (zoom * 100.0).round() / 100.0
}

fn min_world_z(snapshot: &world_runtime::WorldSnapshot) -> i32 {
    let span = i32::try_from(snapshot.chunk_edge)
        .expect("chunk edge should fit in i32")
        .checked_mul(i32::try_from(snapshot.world_chunks.z).expect("chunk count should fit in i32"))
        .expect("world z span should fit in i32");
    -(span / 2)
}

fn max_world_z(snapshot: &world_runtime::WorldSnapshot) -> i32 {
    let min_z = min_world_z(snapshot);
    let span = i32::try_from(snapshot.chunk_edge)
        .expect("chunk edge should fit in i32")
        .checked_mul(i32::try_from(snapshot.world_chunks.z).expect("chunk count should fit in i32"))
        .expect("world z span should fit in i32");
    min_z + span - 1
}

pub(crate) fn detect_runtime_mode() -> RuntimeMode {
    #[cfg(target_arch = "wasm32")]
    {
        let Some(window) = window() else {
            return RuntimeMode::Release;
        };
        let location = window.location();
        let search = location.search().unwrap_or_default();
        let search = search.to_ascii_lowercase();
        if search.contains("perf") {
            RuntimeMode::Perf
        } else if search.contains("debug") {
            RuntimeMode::Debug
        } else {
            RuntimeMode::Release
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        RuntimeMode::Release
    }
}

#[cfg(target_arch = "wasm32")]
pub fn set_runtime_worker_script_url(worker_script_url: String) {
    let mut slot = RUNTIME_WORKER_SCRIPT_URL
        .lock()
        .expect("runtime worker script url lock should be available");
    *slot = Some(worker_script_url);
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn runtime_worker_script_url() -> Option<String> {
    RUNTIME_WORKER_SCRIPT_URL
        .lock()
        .expect("runtime worker script url lock should be available")
        .clone()
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn runtime_worker_script_url() -> Option<String> {
    None
}

fn now_millis() -> u128 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now() as u128
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};

        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_millis()
    }
}
