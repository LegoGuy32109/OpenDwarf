use bevy::prelude::*;
#[cfg(target_arch = "wasm32")]
use web_sys::window;
use world_runtime::{
    InputBatch, LayerMask, RuntimeConfig, RuntimeHandle, RuntimeMode, RuntimeTransport, Vec3i,
    ViewMode as RuntimeViewMode, ViewportIntent,
};
use world_sim::bevy_app::{
    PrimarySimulationEntityId, WorldCommandQueue, WorldSimSettings, WorldView,
};

use crate::domain::runtime_telemetry::RuntimeTelemetryState;
use crate::domain::simulation::{RenderEntityData, TerrainConfig, TileLayerDebugState};
use crate::resources::view_mode::ViewMode as GameViewMode;
use crate::resources::view_z_level::ViewZLevel;

#[derive(Resource)]
pub struct RuntimeBridgeState {
    pub handle: RuntimeHandle,
    last_viewport: Option<ViewportIntent>,
    last_command_payload: Option<Vec<u8>>,
}

impl RuntimeBridgeState {
    #[must_use]
    pub fn new(handle: RuntimeHandle) -> Self {
        Self {
            handle,
            last_viewport: None,
            last_command_payload: None,
        }
    }
}

pub fn setup_runtime_bridge(
    mut commands: Commands,
    world_sim_settings: Res<WorldSimSettings>,
    telemetry: Res<RuntimeTelemetryState>,
) {
    let runtime_mode = detect_runtime_mode();
    let transport = if cfg!(target_arch = "wasm32") {
        RuntimeTransport::Inline
    } else {
        RuntimeTransport::Threaded
    };
    let config = RuntimeConfig {
        build_id: telemetry.session.build_id.clone(),
        session_id: telemetry.session.session_id.clone(),
        mode: runtime_mode,
        transport,
        perf_mode: matches!(runtime_mode, RuntimeMode::Perf),
        world_config: world_sim_settings.config.clone(),
        spawn_default_player: world_sim_settings.spawn_default_player,
        initial_viewport: None,
    };

    commands.insert_resource(RuntimeBridgeState::new(RuntimeHandle::start(config)));
}

pub fn drive_runtime_bridge(
    primary_entity_id: Res<PrimarySimulationEntityId>,
    world_view: Res<WorldView>,
    view_mode: Res<GameViewMode>,
    view_z: Res<ViewZLevel>,
    terrain_config: Res<TerrainConfig>,
    entity_data: Res<RenderEntityData>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    world_command_queue: Res<WorldCommandQueue>,
    camera_query: Query<&Projection, With<Camera2d>>,
    mut bridge: ResMut<RuntimeBridgeState>,
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
        }
    }

    let current_command_payload = if world_command_queue.0.is_empty() {
        None
    } else {
        Some(
            bincode::serde::encode_to_vec(
                &InputBatch::new(world_command_queue.0.clone()),
                bincode::config::standard(),
            )
            .expect("runtime command batch should serialize"),
        )
    };

    match (&bridge.last_command_payload, &current_command_payload) {
        (Some(previous), Some(current)) if previous == current => {}
        (_, Some(current)) => {
            if let Err(err) = bridge
                .handle
                .send_input(InputBatch::new(world_command_queue.0.clone()))
            {
                warn!("Failed to send runtime input batch: {}", err);
            } else {
                bridge.last_command_payload = Some(current.clone());
            }
        }
        (Some(_), None) => {
            bridge.last_command_payload = None;
        }
        (None, None) => {}
    }

    for event in bridge.handle.poll_events() {
        match event {
            world_runtime::RuntimeEvent::RuntimeWarning(message) => {
                warn!("Runtime warning: {}", message);
            }
            world_runtime::RuntimeEvent::RuntimeFault(message) => {
                error!("Runtime fault: {}", message);
            }
            world_runtime::RuntimeEvent::SessionEnded(status) => {
                info!("Runtime session ended: {:?}", status);
            }
            _ => {}
        }
    }

    telemetry.session = bridge.handle.session_snapshot();
    telemetry.refresh_reports();
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

fn camera_zoom(camera_query: &Query<&Projection, With<Camera2d>>) -> f32 {
    let Ok(projection) = camera_query.single() else {
        return 1.0;
    };
    match projection {
        Projection::Orthographic(orthographic) => orthographic.scale,
        _ => 1.0,
    }
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

fn detect_runtime_mode() -> RuntimeMode {
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
