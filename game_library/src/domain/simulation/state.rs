use bevy::math::IVec2;
use bevy::platform::collections::HashSet;
use bevy::prelude::*;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

#[cfg(not(target_arch = "wasm32"))]
use world_sim::replay::ReplayEvent;
use world_sim::world_api::{BlockType, TileMemory, Vec3i, Vec3u};

/// Default depth stack: render this many z-levels below the current view level.
pub const Z_LEVELS_BELOW_RENDERED_DEFAULT: i32 = 5;
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

#[derive(Resource)]
pub struct TerrainConfig {
    pub chunk_edge: u32,
    pub world_chunks: Vec3u,
    /// How many z-levels below the current view level to include in the depth stack.
    pub z_levels_below_rendered: i32,
}

impl Default for TerrainConfig {
    fn default() -> Self {
        Self {
            chunk_edge: 0,
            world_chunks: Vec3u::default(),
            z_levels_below_rendered: Z_LEVELS_BELOW_RENDERED_DEFAULT,
        }
    }
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

/// Persistent cache of computed tile geometry indices per (chunk_xy, world_z, layer).
/// Geometry layers (Floor, EdgeShadow, CeilingShadow) depend only on block data, not FOV.
/// Invalidated on block changes only — never on view_z or FOV visibility transitions.
/// FogShadow full tile data cached separately since it includes per-tile RGBA color.
#[derive(Resource, Default)]
pub struct TileDataCache {
    /// Tileset index per tile position for geometry layers.
    /// None means the tile is empty (air/invisible). u16 is the atlas index.
    pub geometry: HashMap<(IVec2, i32, TileLayer), Vec<Option<u16>>>,
    /// Full per-tile fog color data. Key: (chunk_xy, world_z).
    pub fog: HashMap<(IVec2, i32), Vec<Option<[f32; 4]>>>,
}

impl TileDataCache {
    /// Remove all geometry and fog cache entries for the affected chunk and its boundary
    /// neighbors at z and z-1. Call this when a block actually changes.
    pub fn invalidate_block(&mut self, p: world_sim::world_api::Vec3i, chunk_edge: u32) {
        use crate::domain::tilemap_invalidation::chunk_of_xy;
        let c = chunk_of_xy(p, chunk_edge);
        self.remove_chunk_z(c, p.z);
        self.remove_chunk_z(c, p.z - 1);
        for (dx, dy) in [
            (1i32, 0i32),
            (-1, 0),
            (0, 1),
            (0, -1),
            (1, 1),
            (1, -1),
            (-1, 1),
            (-1, -1),
        ] {
            let nc = chunk_of_xy(
                world_sim::world_api::Vec3i::new(p.x + dx, p.y + dy, p.z),
                chunk_edge,
            );
            if nc != c {
                self.remove_chunk_z(nc, p.z);
                self.remove_chunk_z(nc, p.z - 1);
            }
        }
    }

    /// Remove all cache entries (geometry + fog) for a specific (chunk, z).
    fn remove_chunk_z(&mut self, chunk_xy: IVec2, z: i32) {
        self.geometry.remove(&(chunk_xy, z, TileLayer::Floor));
        self.geometry.remove(&(chunk_xy, z, TileLayer::EdgeShadow));
        self.geometry
            .remove(&(chunk_xy, z, TileLayer::CeilingShadow));
        self.fog.remove(&(chunk_xy, z));
    }

    /// Remove fog cache entries only for the affected chunk at z and z-1.
    /// Call this when FOV visibility changes (block geometry is unchanged).
    pub fn invalidate_fog(&mut self, p: world_sim::world_api::Vec3i, chunk_edge: u32) {
        use crate::domain::tilemap_invalidation::chunk_of_xy;
        let c = chunk_of_xy(p, chunk_edge);
        self.fog.remove(&(c, p.z));
        self.fog.remove(&(c, p.z - 1));
        for (dx, dy) in [
            (1i32, 0i32),
            (-1, 0),
            (0, 1),
            (0, -1),
            (1, 1),
            (1, -1),
            (-1, 1),
            (-1, -1),
        ] {
            let nc = chunk_of_xy(
                world_sim::world_api::Vec3i::new(p.x + dx, p.y + dy, p.z),
                chunk_edge,
            );
            if nc != c {
                self.fog.remove(&(nc, p.z));
            }
        }
    }
}
