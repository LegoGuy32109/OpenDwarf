use serde::{Deserialize, Serialize};

pub use world_sim::world_api::{
    BlockType, EntityMovementSnapshot, EntityMovedDelta, EntitySnapshot, TileMemory, Vec3i,
    Vec3u, WorldCommand, WorldDelta, WorldSnapshot, WorldUpdate,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ChunkKey {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

impl ChunkKey {
    #[must_use]
    pub const fn new(x: i32, y: i32, z: i32) -> Self {
        Self { x, y, z }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LayerId {
    Floor,
    EdgeShadow,
    CeilingShadow,
    Fog,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ViewMode {
    Master,
    Entity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuntimeMode {
    Debug,
    Perf,
    Release,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuntimeTransport {
    Threaded,
    Inline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LayerMask(pub u8);

impl LayerMask {
    #[must_use]
    pub const fn all() -> Self {
        Self(0b1111)
    }

    #[must_use]
    pub const fn empty() -> Self {
        Self(0)
    }

    #[must_use]
    pub const fn contains(self, layer: LayerId) -> bool {
        let bit = match layer {
            LayerId::Floor => 0b0001,
            LayerId::EdgeShadow => 0b0010,
            LayerId::CeilingShadow => 0b0100,
            LayerId::Fog => 0b1000,
        };
        self.0 & bit != 0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ViewportIntent {
    pub camera_center: Vec3i,
    pub zoom: f32,
    pub desired_bounds_min: Vec3i,
    pub desired_bounds_max: Vec3i,
    pub relevant_z_min: i32,
    pub relevant_z_max: i32,
    pub active_layers: LayerMask,
    pub view_mode: ViewMode,
}

impl ViewportIntent {
    #[must_use]
    pub fn new(
        camera_center: Vec3i,
        zoom: f32,
        desired_bounds_min: Vec3i,
        desired_bounds_max: Vec3i,
        relevant_z_min: i32,
        relevant_z_max: i32,
        active_layers: LayerMask,
        view_mode: ViewMode,
    ) -> Self {
        Self {
            camera_center,
            zoom,
            desired_bounds_min,
            desired_bounds_max,
            relevant_z_min,
            relevant_z_max,
            active_layers,
            view_mode,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InputBatch {
    pub commands: Vec<WorldCommand>,
}

impl InputBatch {
    #[must_use]
    pub fn new(commands: Vec<WorldCommand>) -> Self {
        Self { commands }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum SnapshotKind {
    Initial,
    LayerToggle { layer: LayerId },
    Resync,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum RuntimeControl {
    Shutdown,
    RequestResync {
        reason: String,
        viewport: ViewportIntent,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChunkLayerPatch {
    pub chunk: ChunkKey,
    pub layer: LayerId,
    pub revision: u64,
    pub worker_frame_id: u64,
    pub full_chunk: bool,
    pub tile_data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityPatchBatch {
    pub worker_frame_id: u64,
    pub updates: Vec<WorldUpdate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConfig {
    pub build_id: String,
    pub session_id: String,
    pub mode: RuntimeMode,
    pub transport: RuntimeTransport,
    pub perf_mode: bool,
    pub world_config: world_sim::world_core::WorldConfig,
    pub spawn_default_player: bool,
    pub initial_viewport: Option<ViewportIntent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum RuntimeEvent {
    SessionStarted {
        session_id: String,
        build_id: String,
        mode: RuntimeMode,
        transport: RuntimeTransport,
    },
    RuntimeReady,
    InitialSnapshotStarted,
    InitialSnapshotProgress {
        completed_chunks: u32,
        total_chunks: u32,
    },
    InitialSnapshotChunkLayer(ChunkLayerPatch),
    InitialSnapshotEntities(EntityPatchBatch),
    InitialSnapshotComplete,
    ChunkLayerPatch(ChunkLayerPatch),
    EntityPatchBatch(EntityPatchBatch),
    TelemetryFrame(crate::telemetry::TelemetryFrame),
    LayerSnapshotStarted {
        layer: LayerId,
    },
    LayerSnapshotProgress {
        layer: LayerId,
        completed_chunks: u32,
        total_chunks: u32,
    },
    LayerSnapshotComplete {
        layer: LayerId,
    },
    ResyncStarted {
        reason: String,
    },
    ResyncChunkLayer(ChunkLayerPatch),
    ResyncEntities(EntityPatchBatch),
    ResyncComplete,
    RuntimeWarning(String),
    RuntimeFault(String),
    SessionEvent(crate::telemetry::SessionLifecycleEvent),
    SessionEnded(crate::telemetry::SessionStatus),
}
