use bevy::platform::collections::HashSet;
use bevy::prelude::*;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use world_sim::replay::ReplayEvent;
use world_sim::world_api::{BlockType, TileMemory, Vec3i, Vec3u};

pub(super) const Z_LEVELS_BELOW_RENDERED: i32 = 5;
pub(super) const REMEMBERED_FOG_RGBA: [f32; 4] = [0.7, 0.7, 0.2, 0.05];
pub(super) const GLOBAL_MEMORY_OVERLAY_SPRITE_Z: f32 = 2.0;
#[cfg(not(target_arch = "wasm32"))]
pub(super) const REPLAY_PATH_ENV: &str = "OPEN_DWARF_REPLAY_PATH";

#[derive(Resource, Default)]
pub struct ReplayMode {
    pub active: bool,
}

#[derive(Resource, Default)]
pub struct HeldMovementState {
    pub(super) was_moving_last_frame: bool,
}

#[derive(Resource, Default, Clone)]
pub struct ReplayHudState {
    pub active: bool,
    pub playing: bool,
    pub cursor: usize,
    pub total_events: usize,
    pub tick: u64,
    pub show_all_events: bool,
    pub event_labels: Vec<String>,
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Resource)]
pub struct ReplayPlayback {
    pub(super) events: Vec<ReplayEvent>,
    pub(super) cursor: usize,
    pub(super) playing: bool,
}

#[derive(Resource, Default)]
pub struct TerrainConfig {
    pub chunk_edge: u32,
    pub world_chunks: Vec3u,
}

#[derive(Resource, Default)]
pub struct TerrainData {
    pub source_blocks: Arc<HashMap<Vec3i, BlockType>>,
    pub blocks: HashMap<Vec3i, BlockType>,
}

#[derive(Resource, Default)]
pub struct RenderEntityData {
    pub tick: u64,
    pub entities: BTreeMap<u64, RenderEntityState>,
    pub dirty: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RenderEntityState {
    pub position: Vec3i,
    pub facing_left: bool,
    pub is_prone: bool,
    pub movement: Option<RenderEntityMovementState>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RenderEntityMovementState {
    pub start_position: Vec3,
    pub origin: Vec3i,
    pub target: Vec3i,
    pub progress_percent: u8,
}

#[derive(Resource, Default)]
pub struct FogData {
    pub visible: HashSet<Vec3i>,
    pub memory: HashMap<Vec3i, TileMemory>,
}

#[derive(Resource, Default)]
pub struct ChunkStreamingState {
    pub(super) loaded_chunks: HashSet<Vec3i>,
}

#[derive(Resource, Default)]
pub struct ChunkBorderDebugState {
    pub visible: bool,
}

#[derive(Resource, Debug, Default, Clone)]
pub struct TilemapRenderMetrics {
    pub chunk_count: usize,
    pub non_empty_tile_count: usize,
    pub last_rebuild_micros: u128,
    pub rebuild_count: u64,
}

#[derive(Resource, Debug, Clone, Copy)]
pub struct TileLayerDebugState {
    pub show_floor: bool,
    pub show_edge_shadow: bool,
    pub show_ceiling_shadow: bool,
    pub show_fog_shadow: bool,
    pub show_depth_stack: bool,
}

impl Default for TileLayerDebugState {
    fn default() -> Self {
        Self {
            show_floor: true,
            show_edge_shadow: true,
            show_ceiling_shadow: true,
            show_fog_shadow: true,
            show_depth_stack: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TileLayer {
    Floor,
    EdgeShadow,
    /// Dual-grid ceiling shadow: rendered half a tile offset, shows solid blocks at z+1 above.
    CeilingShadow,
    /// Entity-mode memory overlay: transparent for visible and unknown tiles,
    /// yellow for remembered or currently-not-visible rendered tiles.
    FogShadow,
}

#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorldTileChunk {
    pub chunk_xy: IVec2,
    pub world_z: i32,
    pub layer: TileLayer,
}

#[derive(Component)]
pub struct DepthDebugLabel;
