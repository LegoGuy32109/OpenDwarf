use bevy::prelude::*;
#[cfg(target_arch = "wasm32")]
use js_sys::Date;
use world_runtime::{
    SessionStatus, TelemetryFrame, TelemetrySession, build_long_report, build_short_report,
};

use crate::domain::messaging::clipboard;
use crate::domain::simulation::{TileLayerDebugState, TilemapRenderMetrics};
use world_sim::bevy_app::WorldSimDiagnostics;

#[cfg(not(target_arch = "wasm32"))]
use std::fs;
#[cfg(not(target_arch = "wasm32"))]
use std::path::PathBuf;

#[derive(Resource)]
pub struct RuntimeTelemetryState {
    pub session: TelemetrySession,
    pub short_report: String,
    pub long_report: String,
    last_persisted_frame_count: usize,
    last_persisted_status: SessionStatus,
}

#[derive(Resource)]
pub struct RuntimeTelemetryClipboard {
    #[cfg(not(target_arch = "wasm32"))]
    state: clipboard::ClipboardState,
}

impl RuntimeTelemetryState {
    #[must_use]
    pub fn new() -> Self {
        let session = TelemetrySession::new(
            build_session_id(),
            env!("CARGO_PKG_VERSION").to_string(),
            String::from("runtime"),
            if cfg!(target_arch = "wasm32") {
                String::from("inline")
            } else {
                String::from("threaded")
            },
        );
        let short_report = build_short_report(&session);
        let long_report = build_long_report(&session);
        let mut telemetry_state = Self {
            session,
            short_report,
            long_report,
            last_persisted_frame_count: 0,
            last_persisted_status: SessionStatus::Starting,
        };
        telemetry_state.persist_session_artifacts();
        telemetry_state.last_persisted_status = telemetry_state.session.status;
        telemetry_state
    }

    pub fn refresh_reports(&mut self) {
        self.short_report = build_short_report(&self.session);
        self.long_report = build_long_report(&self.session);
        if self.should_persist_now() {
            self.persist_session_artifacts();
            self.last_persisted_frame_count = self.session.frames.len();
            self.last_persisted_status = self.session.status;
        }
    }

    fn should_persist_now(&self) -> bool {
        if cfg!(target_arch = "wasm32") {
            return false;
        }

        let frame_count = self.session.frames.len();
        frame_count == 0
            || self.session.status != self.last_persisted_status
            || (frame_count != self.last_persisted_frame_count && frame_count % 30 == 0)
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn persist_session_artifacts(&self) {
        let artifact_dir = session_artifact_dir(&self.session);
        if let Err(err) = fs::create_dir_all(&artifact_dir) {
            eprintln!(
                "Failed to create perf session directory {}: {}",
                artifact_dir.display(),
                err
            );
            return;
        }

        let json_path = artifact_dir.join("session.json");
        if let Err(err) = fs::write(&json_path, self.session.to_json_string()) {
            eprintln!(
                "Failed to write perf session JSON {}: {}",
                json_path.display(),
                err
            );
        }

        let short_path = artifact_dir.join("short.txt");
        if let Err(err) = fs::write(&short_path, &self.short_report) {
            eprintln!(
                "Failed to write perf session short report {}: {}",
                short_path.display(),
                err
            );
        }

        let long_path = artifact_dir.join("long.txt");
        if let Err(err) = fs::write(&long_path, &self.long_report) {
            eprintln!(
                "Failed to write perf session long report {}: {}",
                long_path.display(),
                err
            );
        }
    }

    #[cfg(target_arch = "wasm32")]
    fn persist_session_artifacts(&self) {}
}

pub fn setup_runtime_telemetry(mut commands: Commands) {
    commands.insert_resource(RuntimeTelemetryState::new());
    commands.insert_resource(RuntimeTelemetryClipboard::default());
}

impl Default for RuntimeTelemetryClipboard {
    fn default() -> Self {
        Self {
            #[cfg(not(target_arch = "wasm32"))]
            state: clipboard::ClipboardState::new(),
        }
    }
}

impl RuntimeTelemetryClipboard {
    pub fn copy_short_report(&mut self, report: &str) {
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = self.state.write_text(report);
        }
        #[cfg(target_arch = "wasm32")]
        {
            let report = report.to_string();
            wasm_bindgen_futures::spawn_local(async move {
                let _ = clipboard::write_text(&report).await;
            });
        }
    }

    pub fn copy_long_report(&mut self, report: &str) {
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = self.state.write_text(report);
        }
        #[cfg(target_arch = "wasm32")]
        {
            let report = report.to_string();
            wasm_bindgen_futures::spawn_local(async move {
                let _ = clipboard::write_text(&report).await;
            });
        }
    }
}

pub fn collect_runtime_telemetry(
    time: Res<Time>,
    world_sim_diagnostics: Option<Res<WorldSimDiagnostics>>,
    tilemap_render_metrics: Option<Res<TilemapRenderMetrics>>,
    tile_layer_debug_state: Option<Res<TileLayerDebugState>>,
    mut telemetry: ResMut<RuntimeTelemetryState>,
) {
    let frame_ms = (time.delta_secs_f64() * 1000.0) as u64;
    let worker_sim_ms = world_sim_diagnostics
        .as_ref()
        .map_or(0, |diagnostics| diagnostics.commands_processed);
    let patch_build_ms = tilemap_render_metrics
        .as_ref()
        .map_or(0, |metrics| (metrics.last_rebuild_micros / 1_000) as u64);
    let hot_chunks = world_sim_diagnostics
        .as_ref()
        .map_or(0, |diagnostics| diagnostics.loaded_chunk_count as u32);
    let warm_chunks = 0;
    let cold_chunks = 0;
    let stale_chunks = if tile_layer_debug_state
        .as_ref()
        .map_or(true, |state| !state.show_depth_stack)
    {
        1
    } else {
        0
    };
    let snapshot_progress_percent = 100;

    telemetry.session.record_frame(TelemetryFrame {
        frame_ms,
        worker_sim_ms,
        fov_ms: 0,
        patch_build_ms,
        serialization_ms: 0,
        patch_apply_ms: 0,
        queue_depth: 0,
        hot_chunks,
        warm_chunks,
        cold_chunks,
        stale_chunks,
        dropped_superseded_patches: 0,
        coalesced_patches: 0,
        snapshot_progress_percent,
    });
    telemetry.session.set_status(SessionStatus::Running, None);
    telemetry.refresh_reports();
}

pub(crate) fn build_session_id() -> String {
    #[cfg(target_arch = "wasm32")]
    let millis = Date::now() as u128;

    #[cfg(not(target_arch = "wasm32"))]
    let millis = {
        use std::time::{SystemTime, UNIX_EPOCH};

        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_millis()
    };

    format!("session-{millis}")
}

#[cfg(not(target_arch = "wasm32"))]
fn session_artifact_dir(session: &TelemetrySession) -> PathBuf {
    let sanitized_session_id = session
        .session_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    PathBuf::from(".perf_sessions").join("native").join(format!(
        "{}__{}__{}__{}__{}",
        session.started_at_unix_ms,
        sanitized_session_id,
        sanitize_component(&session.build_id),
        session.mode,
        session.transport
    ))
}

#[cfg(not(target_arch = "wasm32"))]
fn sanitize_component(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}
