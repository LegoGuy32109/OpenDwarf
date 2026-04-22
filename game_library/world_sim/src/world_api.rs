use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Vec3i {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

impl Vec3i {
    pub const ZERO: Self = Self { x: 0, y: 0, z: 0 };

    #[must_use]
    pub const fn new(x: i32, y: i32, z: i32) -> Self {
        Self { x, y, z }
    }

    #[must_use]
    pub const fn add(self, rhs: Self) -> Self {
        Self {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
            z: self.z + rhs.z,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Vec3u {
    pub x: u32,
    pub y: u32,
    pub z: u32,
}

impl Vec3u {
    #[must_use]
    pub const fn new(x: u32, y: u32, z: u32) -> Self {
        Self { x, y, z }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BlockType {
    Air,
    SolidStone,
}

/// What a given observer last saw at a specific position.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TileMemory {
    /// Block type at the time of observation.
    pub block: BlockType,
    /// Sim tick when this tile was last observed (for degradation).
    pub tick_observed: u64,
}

/// Visibility snapshot for a single observer entity.
/// Included in WorldSnapshot so the render layer can drive the fog overlay
/// without recomputing FOV on the client.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VisibilitySnapshot {
    pub entity_id: u64,
    /// All positions currently in FOV. Positions absent from this set
    /// and absent from `memory` are Unknown.
    pub visible: Vec<Vec3i>,
    /// Remembered tiles (observed at least once, not currently visible).
    pub memory: std::collections::HashMap<Vec3i, TileMemory>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityMovementSnapshot {
    pub origin: Vec3i,
    pub target: Vec3i,
    pub start_position: [f32; 3],
    pub progress_percent: u8,
    pub occupies_origin: bool,
    pub occupies_target: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntitySnapshot {
    pub id: u64,
    pub position: Vec3i,
    pub facing_left: bool,
    pub is_prone: bool,
    pub movement: Option<EntityMovementSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorldSnapshot {
    pub tick: u64,
    pub chunk_edge: u32,
    pub world_chunks: Vec3u,
    /// Full terrain blocks for the renderable world state.
    #[serde(alias = "visible_blocks")]
    pub terrain_blocks: Arc<std::collections::HashMap<Vec3i, BlockType>>,
    pub entities: Vec<EntitySnapshot>,
    /// Observer visibility data used by entity mode fog rendering.
    pub visibility: Option<VisibilitySnapshot>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityMovedDelta {
    pub id: u64,
    pub from: Vec3i,
    pub to: Vec3i,
    pub facing_left_before: bool,
    pub facing_left_after: bool,
    pub is_prone_before: bool,
    pub is_prone_after: bool,
    pub movement_after: Option<EntityMovementSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockChange {
    pub position: Vec3i,
    pub from: BlockType,
    pub to: BlockType,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorldDelta {
    pub tick: u64,
    pub moved_entities: Vec<EntityMovedDelta>,
    pub block_changes: Vec<BlockChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorldCommand {
    MoveEntity { id: u64, direction: Vec3i },
    AdvanceTicks { count: u32 },
    SetChunkLoaded { chunk: Vec3i, loaded: bool },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum WorldUpdate {
    Snapshot(WorldSnapshot),
    Delta(WorldDelta),
}
