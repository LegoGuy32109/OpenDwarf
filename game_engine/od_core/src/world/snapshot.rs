//! Logic-essential v1 world snapshot (no FOV / visibility).

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use super::{BlockType, Vec3i, Vec3u};

/// In-progress entity movement for snapshots / hashing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityMovementSnapshot {
    pub origin: Vec3i,
    pub target: Vec3i,
    pub start_position: [f32; 3],
    pub progress_percent: u8,
    pub occupies_origin: bool,
    pub occupies_target: bool,
}

/// Single entity in a [`WorldSnapshot`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntitySnapshot {
    pub id: u64,
    pub position: Vec3i,
    pub facing_left: bool,
    pub is_prone: bool,
    pub movement: Option<EntityMovementSnapshot>,
}

/// Authoritative sim snapshot — v1 logic-essential subset.
///
/// FOV / visibility fields are intentionally omitted (see
/// `docs/design/sim-replay.md` §3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorldSnapshot {
    pub tick: u64,
    pub chunk_edge: u32,
    pub world_chunks: Vec3u,
    /// Blocks in currently loaded chunks (sparse; typically solid cells only).
    pub terrain_blocks: BTreeMap<Vec3i, BlockType>,
    pub loaded_chunks: BTreeSet<Vec3i>,
    /// Sorted by `id` ascending for stable hashing.
    pub entities: Vec<EntitySnapshot>,
}
