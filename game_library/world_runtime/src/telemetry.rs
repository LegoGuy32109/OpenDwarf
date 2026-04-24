use serde::{Deserialize, Serialize};
use std::time::Duration;
#[cfg(target_arch = "wasm32")]
use js_sys::Date;
#[cfg(not(target_arch = "wasm32"))]
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionStatus {
    Starting,
    Running,
    Completed,
    Aborted,
    Crashed,
    DesyncedResync,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionLifecycleEvent {
    pub at_unix_ms: u128,
    pub status: SessionStatus,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TelemetryFrame {
    pub frame_ms: u64,
    pub worker_sim_ms: u64,
    pub fov_ms: u64,
    pub patch_build_ms: u64,
    pub serialization_ms: u64,
    pub patch_apply_ms: u64,
    pub queue_depth: u32,
    pub active_layers: u32,
    pub hot_chunks: u32,
    pub warm_chunks: u32,
    pub cold_chunks: u32,
    pub stale_chunks: u32,
    pub dropped_superseded_patches: u64,
    pub coalesced_patches: u64,
    pub snapshot_progress_percent: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetrySession {
    pub session_id: String,
    pub build_id: String,
    pub mode: String,
    pub transport: String,
    pub status: SessionStatus,
    pub started_at_unix_ms: u128,
    pub ended_at_unix_ms: Option<u128>,
    pub frames: Vec<TelemetryFrame>,
    pub lifecycle_events: Vec<SessionLifecycleEvent>,
    pub warnings: Vec<String>,
    pub faults: Vec<String>,
}

impl TelemetrySession {
    #[must_use]
    pub fn new(
        session_id: String,
        build_id: String,
        mode: String,
        transport: String,
    ) -> Self {
        let started_at_unix_ms = unix_ms_now();
        Self {
            session_id,
            build_id,
            mode,
            transport,
            status: SessionStatus::Starting,
            started_at_unix_ms,
            ended_at_unix_ms: None,
            frames: Vec::new(),
            lifecycle_events: vec![SessionLifecycleEvent {
                at_unix_ms: started_at_unix_ms,
                status: SessionStatus::Starting,
                message: None,
            }],
            warnings: Vec::new(),
            faults: Vec::new(),
        }
    }

    pub fn set_status(&mut self, status: SessionStatus, message: Option<String>) {
        if self.status == status && message.is_none() {
            return;
        }
        self.status = status;
        let at_unix_ms = unix_ms_now();
        if matches!(
            status,
            SessionStatus::Completed | SessionStatus::Aborted | SessionStatus::Crashed
        ) {
            self.ended_at_unix_ms = Some(at_unix_ms);
        }
        self.lifecycle_events.push(SessionLifecycleEvent {
            at_unix_ms,
            status,
            message,
        });
    }

    pub fn record_frame(&mut self, frame: TelemetryFrame) {
        self.frames.push(frame);
    }

    pub fn record_warning(&mut self, warning: String) {
        self.warnings.push(warning.clone());
        self.lifecycle_events.push(SessionLifecycleEvent {
            at_unix_ms: unix_ms_now(),
            status: self.status,
            message: Some(warning),
        });
    }

    pub fn record_fault(&mut self, fault: String) {
        self.faults.push(fault.clone());
        self.lifecycle_events.push(SessionLifecycleEvent {
            at_unix_ms: unix_ms_now(),
            status: SessionStatus::Crashed,
            message: Some(fault),
        });
        self.status = SessionStatus::Crashed;
        self.ended_at_unix_ms = Some(unix_ms_now());
    }

    #[must_use]
    pub fn elapsed(&self) -> Duration {
        let end = self.ended_at_unix_ms.unwrap_or_else(unix_ms_now);
        Duration::from_millis(end.saturating_sub(self.started_at_unix_ms) as u64)
    }

    #[must_use]
    pub fn to_json_string(&self) -> String {
        serde_json::to_string_pretty(self).expect("telemetry session should serialize to JSON")
    }
}

fn unix_ms_now() -> u128 {
    #[cfg(target_arch = "wasm32")]
    {
        Date::now() as u128
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_millis()
    }
}
